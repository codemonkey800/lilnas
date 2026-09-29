import {
  DownloadType,
  type EpisodeStateEntry,
  isShow,
  MEDIA_EVENT_TYPE,
  type MediaEvent,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

import { mediaTypeFromKey } from 'src/db/media-id'
import {
  DownloadGateway,
  type DownloadGatewayMessage,
} from 'src/download-gateway/download.gateway'

import { type MediaKey, MediaResolverService } from './media-resolver.service'
import { MediaStateService } from './media-state.service'
import { toEpisodeStateEntries } from './media-state.util'
import { SonarrService } from './sonarr.service'

const LIBRARY_TYPES = [DownloadType.Movie, DownloadType.Show] as const

/**
 * Keeps open pages in step with changes made to the Radarr/Sonarr libraries
 * outside the download queue - a file deleted, a title removed or added in
 * Radarr's own UI, or by this app's own delete. `MediaPollerService` only
 * watches the queue, so without this a page showed such a change only after
 * a reload.
 *
 * Two lanes feed `MediaResolverService`, which diffs every library read
 * against the last and reports what changed (`onLibraryChange`):
 *
 * - **Watched, every second.** The titles a tab has a detail page open for
 *   (`WATCH_MEDIA_EVENT`, see `DownloadGateway`), each re-read with its own
 *   small call (`refreshTitles`).
 * - **Background, every minute.** The whole library (`refreshLibrary`), for
 *   every title nobody has open - the gallery's cards. Skipped while no tab
 *   is connected, when the resolver's own read-through TTL is enough.
 *
 * Every change, from either lane or from any other library read, is resolved
 * and broadcast as a `MediaEvent`, so a page's state, Watch/Delete buttons
 * and a show's episodes follow it.
 */
@Injectable()
export class LibraryWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LibraryWatchService.name)
  private refreshingWatched = false
  private refreshingLibrary = false
  private unsubscribe?: () => void

  constructor(
    private readonly downloadGateway: DownloadGateway,
    private readonly mediaResolverService: MediaResolverService,
    private readonly mediaStateService: MediaStateService,
    private readonly sonarrService: SonarrService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.mediaResolverService.onLibraryChange(mediaIds => {
      void this.broadcastChanges(mediaIds)
    })
    this.downloadGateway.setMediaSyncSource((mediaIds, watching) =>
      this.syncFrames(mediaIds, watching),
    )
  }

  onModuleDestroy(): void {
    this.unsubscribe?.()
  }

  /**
   * The watched lane. A tick still in flight when the next one fires skips
   * it rather than stacking a second read of the same titles.
   */
  @Cron('*/1 * * * * *')
  async refreshWatched(): Promise<void> {
    if (this.refreshingWatched) return

    const mediaIds = this.downloadGateway.watchedMediaIds()
    if (mediaIds.size === 0) return

    this.refreshingWatched = true
    try {
      await this.mediaResolverService.refreshTitles(Array.from(mediaIds))
    } finally {
      this.refreshingWatched = false
    }
  }

  /**
   * The background lane. A source whose read fails is logged and retried on
   * the next minute; the resolver keeps serving its last good copy.
   */
  @Cron('0 * * * * *')
  async refreshLibrary(): Promise<void> {
    if (this.refreshingLibrary || this.downloadGateway.clientCount === 0) {
      return
    }

    this.refreshingLibrary = true
    try {
      await Promise.all(
        LIBRARY_TYPES.map(async type => {
          try {
            await this.mediaResolverService.refreshLibrary(type)
          } catch (err) {
            this.logger.warn(
              { action: 'refreshLibrary', error: getErrorMessage(err), type },
              'Library refresh failed - retrying next minute',
            )
          }
        }),
      )
    } finally {
      this.refreshingLibrary = false
    }
  }

  /**
   * Resolves each changed title and broadcasts it. A source that resolves
   * degraded is skipped - its placeholder would replace a page's real copy
   * with a bare id - and so is a show whose episodes can't be read, whose
   * page would otherwise keep the old per-episode states under the new
   * series state. Never throws.
   */
  private async broadcastChanges(mediaIds: readonly string[]): Promise<void> {
    if (this.downloadGateway.clientCount === 0) return

    try {
      const events = await this.mediaEventsFor(
        mediaIds.flatMap((mediaId): MediaKey[] => {
          const type = mediaTypeFromKey(mediaId)
          return type === DownloadType.Movie || type === DownloadType.Show
            ? [{ mediaId, type }]
            : []
        }),
        () => true,
      )

      for (const event of events) {
        this.downloadGateway.broadcast({ data: event, type: MEDIA_EVENT_TYPE })
      }
    } catch (err) {
      this.logger.warn(
        { action: 'broadcastChanges', error: getErrorMessage(err), mediaIds },
        'Library change broadcast failed',
      )
    }
  }

  /**
   * The media half of a reconnecting socket's catch-up (`SYNC_JOBS_EVENT`):
   * the current state of every movie, show and video the tab is showing -
   * nothing above re-sends a title that did not change *again*, so one that
   * changed while the tab had no socket would otherwise stay stale.
   *
   * A title open on a detail page (`watching`) is re-read upstream first, as
   * the watched lane would a second later, and a show among them carries its
   * episodes. A gallery card gets the cached copy and no episodes - it reads
   * neither. Never throws.
   */
  async syncFrames(
    mediaIds: readonly string[],
    watching: ReadonlySet<string>,
  ): Promise<DownloadGatewayMessage[]> {
    try {
      await this.mediaResolverService.refreshTitles(
        mediaIds.filter(mediaId => watching.has(mediaId)),
      )

      const events = await this.mediaEventsFor(
        mediaIds.flatMap((mediaId): MediaKey[] => {
          const type = mediaTypeFromKey(mediaId)
          return type ? [{ mediaId, type }] : []
        }),
        mediaId => watching.has(mediaId),
      )

      return events.map(event => ({ data: event, type: MEDIA_EVENT_TYPE }))
    } catch (err) {
      this.logger.warn(
        { action: 'syncFrames', error: getErrorMessage(err), mediaIds },
        'Media catch-up failed',
      )
      return []
    }
  }

  /**
   * The current `MediaEvent` for each key, from one batched resolve. A
   * degraded source is left out - its placeholder would replace a page's real
   * copy with a bare id - and so is a show `withEpisodes` asks episodes for
   * but whose episodes can't be read, whose page would otherwise keep the old
   * per-episode states under the new series state.
   */
  private async mediaEventsFor(
    keys: readonly MediaKey[],
    withEpisodes: (mediaId: string) => boolean,
  ): Promise<MediaEvent[]> {
    if (keys.length === 0) return []

    const { degradedSources, media } =
      await this.mediaResolverService.resolve(keys)

    const events = await Promise.all(
      keys.map(async ({ mediaId, type }): Promise<MediaEvent | undefined> => {
        const item = media.get(mediaId)
        if (!item || degradedSources.includes(type)) return undefined

        if (!isShow(item) || item.sonarrId == null || !withEpisodes(mediaId)) {
          return { media: item }
        }

        const episodes = await this.episodesFor(mediaId, item.sonarrId)
        return episodes ? { episodes, media: item } : undefined
      }),
    )

    return events.filter(event => event !== undefined)
  }

  private async episodesFor(
    mediaId: string,
    sonarrId: number,
  ): Promise<EpisodeStateEntry[] | undefined> {
    try {
      return toEpisodeStateEntries(
        await this.sonarrService.getEpisodes(sonarrId),
        this.mediaStateService.queueItemsFor(DownloadType.Show, sonarrId),
        downloadId => this.mediaStateService.clientReading(downloadId),
      )
    } catch (err) {
      this.logger.warn(
        { action: 'episodesFor', error: getErrorMessage(err), mediaId },
        'Episode read failed - skipping this media event',
      )
      return undefined
    }
  }
}
