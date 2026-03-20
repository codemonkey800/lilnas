import {
  getApiV3CommandById as radarrGetCommandById,
  getApiV3QueueDetails as radarrGetQueueDetails,
  postApiV3Command as radarrPostCommand,
  type QueueResource as RadarrQueueItem,
} from '@lilnas/media/radarr-next'
import {
  deleteApiV3QueueById as sonarrDeleteQueueById,
  getApiV3CommandById as sonarrGetCommandById,
  getApiV3QueueDetails as sonarrGetQueueDetails,
  postApiV3Command as sonarrPostCommand,
  putApiV3EpisodeMonitor,
  type QueueResource as SonarrQueueItem,
} from '@lilnas/media/sonarr'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'

import {
  RADARR_CLIENT,
  type RadarrMediaClient,
  SONARR_CLIENT,
  type SonarrMediaClient,
} from 'src/media/clients'

import { DownloadGateway } from './download.gateway'
import { DownloadsService } from './downloads.service'
import {
  computeProgress,
  DownloadEvents,
  type TrackedDownload,
  type TrackedEpisodeDownload,
  type TrackedMovieDownload,
} from './downloads.types'

const POLL_INTERVAL_MS = 3_000
const REFRESH_INTERVAL_MS = 15_000
const SEARCH_TIMEOUT_MS = 30_000
const COMMAND_TERMINAL_GRACE_MS = 15_000

const FAILURE_STATES = new Set(['failed', 'failedPending', 'importFailed'])

const TERMINAL_COMMAND_STATUSES = new Set([
  'completed',
  'failed',
  'aborted',
  'cancelled',
  'orphaned',
])

function eventIdsFromEntry(entry: TrackedDownload) {
  if (entry.kind === 'movie') {
    return { mediaType: 'movie' as const, tmdbId: entry.tmdbId }
  }
  return {
    mediaType: 'episode' as const,
    tvdbId: entry.tvdbId,
    episodeId: entry.sonarrEpisodeId,
  }
}

function logLabel(entry: TrackedDownload): string {
  if (entry.kind === 'movie') return `Movie tmdbId=${entry.tmdbId}`
  return `Episode tvdbId=${entry.tvdbId} episodeId=${entry.sonarrEpisodeId}`
}

@Injectable()
export class DownloadPollerService {
  private readonly logger = new Logger(DownloadPollerService.name)

  private lastRefreshAt = 0

  constructor(
    @Inject(RADARR_CLIENT) private readonly radarr: RadarrMediaClient,
    @Inject(SONARR_CLIENT) private readonly sonarr: SonarrMediaClient,
    private readonly downloadsService: DownloadsService,
    private readonly downloadGateway: DownloadGateway,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    const tracked = this.downloadsService.getTracked()
    const pendingCancels = this.downloadsService.getPendingCancelEpisodes()

    if (
      tracked.size === 0 &&
      pendingCancels.size === 0 &&
      !this.downloadGateway.hasConnectedClients()
    ) {
      return
    }

    if (tracked.size === 0 && pendingCancels.size === 0) return

    try {
      const shouldRefresh =
        Date.now() - this.lastRefreshAt >= REFRESH_INTERVAL_MS
      if (shouldRefresh) this.lastRefreshAt = Date.now()

      const [radarrQueue, sonarrQueue] = await Promise.all([
        this.fetchRadarrQueue(shouldRefresh),
        this.fetchSonarrQueue(shouldRefresh),
      ])

      const radarrByMovieId = new Map<number, RadarrQueueItem>()
      for (const item of radarrQueue) {
        if (item.movieId != null) radarrByMovieId.set(item.movieId, item)
      }

      const sonarrByEpisodeId = new Map<number, SonarrQueueItem>()
      for (const item of sonarrQueue) {
        if (item.episodeId != null) sonarrByEpisodeId.set(item.episodeId, item)
      }

      const radarrCommandIds = new Set<number>()
      const sonarrCommandIds = new Set<number>()
      for (const entry of tracked.values()) {
        if (entry.commandId == null || entry.queueId !== null) continue
        const hasQueueItem =
          entry.kind === 'movie'
            ? radarrByMovieId.has(entry.radarrMovieId)
            : sonarrByEpisodeId.has(entry.sonarrEpisodeId)
        if (!hasQueueItem) {
          if (entry.kind === 'movie') {
            radarrCommandIds.add(entry.commandId)
          } else {
            sonarrCommandIds.add(entry.commandId)
          }
        }
      }

      const [radarrCommandStatuses, sonarrCommandStatuses] = await Promise.all([
        this.fetchRadarrCommandStatuses(radarrCommandIds),
        this.fetchSonarrCommandStatuses(sonarrCommandIds),
      ])

      for (const [key, entry] of tracked) {
        const queueItem =
          entry.kind === 'movie'
            ? radarrByMovieId.get(entry.radarrMovieId)
            : sonarrByEpisodeId.get(entry.sonarrEpisodeId)
        this.processEntry(
          key,
          entry,
          queueItem,
          radarrCommandStatuses,
          sonarrCommandStatuses,
        )
      }

      await this.processPendingCancels(sonarrByEpisodeId)
    } catch (err) {
      this.logger.error(
        'Error during download poll',
        err instanceof Error ? err.stack : String(err),
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Per-entry processing
  // ---------------------------------------------------------------------------

  private processEntry(
    key: string,
    entry: TrackedDownload,
    queueItem: RadarrQueueItem | SonarrQueueItem | undefined,
    radarrCommandStatuses: Map<number, string>,
    sonarrCommandStatuses: Map<number, string>,
  ): void {
    const ids = eventIdsFromEntry(entry)
    const label = logLabel(entry)

    if (!queueItem) {
      if (entry.queueId !== null) {
        this.downloadsService.emitEvent({
          event: DownloadEvents.COMPLETED,
          ...ids,
        })
        this.downloadsService.removeTracked(key)
        this.logger.log(`${label} download completed`)
      } else if (entry.commandId != null) {
        const statuses =
          entry.kind === 'movie' ? radarrCommandStatuses : sonarrCommandStatuses
        const commandStatus = statuses.get(entry.commandId)
        if (commandStatus && TERMINAL_COMMAND_STATUSES.has(commandStatus)) {
          if (entry.commandTerminalAt == null) {
            this.downloadsService.updateTracked(key, {
              commandTerminalAt: Date.now(),
            })
          } else if (
            Date.now() - entry.commandTerminalAt >=
            COMMAND_TERMINAL_GRACE_MS
          ) {
            this.handleSearchNotFound(key, entry)
          }
        }
      } else if (Date.now() - entry.initiatedAt > SEARCH_TIMEOUT_MS) {
        this.handleSearchNotFound(key, entry)
      }
      return
    }

    const queueId = queueItem.id ?? null

    if (entry.queueId === null && queueId !== null) {
      this.downloadsService.updateTracked(key, {
        queueId,
        lastTitle: queueItem.title ?? null,
        lastSize: queueItem.size ?? null,
      })
      this.downloadsService.emitEvent({
        event: DownloadEvents.GRABBING,
        ...ids,
        title: queueItem.title ?? null,
        size: queueItem.size ?? 0,
      })
      this.logger.log(`${label} release grabbed title="${queueItem.title}"`)
    }

    if (this.isFailed(queueItem)) {
      this.downloadsService.emitEvent({
        event: DownloadEvents.FAILED,
        ...ids,
        error:
          queueItem.errorMessage ??
          queueItem.trackedDownloadStatus ??
          'Download failed',
      })
      this.downloadsService.removeTracked(key)
      this.logger.warn(`${label} download failed`)
      return
    }

    const progress = computeProgress(queueItem.size, queueItem.sizeleft)
    if (
      progress !== null &&
      (progress !== entry.lastProgress ||
        (queueItem.sizeleft ?? null) !== entry.lastSizeleft)
    ) {
      this.downloadsService.updateTracked(key, {
        lastProgress: progress,
        lastSizeleft: queueItem.sizeleft ?? null,
        lastStatus: queueItem.status ?? null,
        lastSize: queueItem.size ?? null,
        lastEta: queueItem.estimatedCompletionTime ?? null,
      })
      this.downloadsService.emitEvent({
        event: DownloadEvents.PROGRESS,
        ...ids,
        progress,
        size: queueItem.size ?? 0,
        sizeleft: queueItem.sizeleft ?? 0,
        eta: queueItem.estimatedCompletionTime ?? null,
        status: queueItem.status ?? 'queued',
      })
    }
  }

  private handleSearchNotFound(key: string, entry: TrackedDownload): void {
    if (entry.kind === 'movie') {
      this.handleMovieSearchNotFound(key, entry)
    } else {
      this.handleEpisodeSearchNotFound(key, entry)
    }
  }

  private handleMovieSearchNotFound(
    key: string,
    entry: TrackedMovieDownload,
  ): void {
    this.downloadsService.emitEvent({
      event: DownloadEvents.FAILED,
      mediaType: 'movie',
      tmdbId: entry.tmdbId,
      error: 'No releases found',
    })
    this.downloadsService.removeTracked(key)
    this.logger.warn(`Movie search found no releases tmdbId=${entry.tmdbId}`)
  }

  private handleEpisodeSearchNotFound(
    key: string,
    entry: TrackedEpisodeDownload,
  ): void {
    this.downloadsService.emitEvent({
      event: DownloadEvents.FAILED,
      mediaType: 'episode',
      tvdbId: entry.tvdbId,
      episodeId: entry.sonarrEpisodeId,
      error: 'No releases found',
    })
    this.downloadsService.removeTracked(key)
    this.logger.warn(
      `Episode search found no releases tvdbId=${entry.tvdbId} episodeId=${entry.sonarrEpisodeId}`,
    )
  }

  private async processPendingCancels(
    sonarrByEpisodeId: Map<number, SonarrQueueItem>,
  ): Promise<void> {
    const pending = this.downloadsService.getPendingCancelEpisodes()
    if (pending.size === 0) return

    for (const [episodeId, meta] of pending) {
      const queueItem = sonarrByEpisodeId.get(episodeId)
      if (queueItem?.id != null) {
        try {
          await sonarrDeleteQueueById({
            client: this.sonarr,
            path: { id: queueItem.id },
            query: { removeFromClient: true, blocklist: false },
          })
          await putApiV3EpisodeMonitor({
            client: this.sonarr,
            body: { episodeIds: [episodeId], monitored: false },
          })
        } catch (err) {
          this.logger.warn(
            `Failed to cancel pending episode ${episodeId}`,
            err instanceof Error ? err.message : String(err),
          )
        }
        this.downloadsService.removePendingCancel(episodeId)
        this.logger.log(
          `Cancelled late queue item for episode ${episodeId} tvdbId=${meta.tvdbId}`,
        )
      } else if (Date.now() - meta.cancelledAt > SEARCH_TIMEOUT_MS) {
        this.downloadsService.removePendingCancel(episodeId)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async fetchRadarrCommandStatuses(
    commandIds: Set<number>,
  ): Promise<Map<number, string>> {
    if (commandIds.size === 0) return new Map()
    const results = await Promise.allSettled(
      Array.from(commandIds).map(async id => {
        const result = await radarrGetCommandById({
          client: this.radarr,
          path: { id },
        })
        const status = (result.data as { status?: string } | null)?.status
        return { id, status }
      }),
    )
    return this.buildStatusMap(results)
  }

  private async fetchSonarrCommandStatuses(
    commandIds: Set<number>,
  ): Promise<Map<number, string>> {
    if (commandIds.size === 0) return new Map()
    const results = await Promise.allSettled(
      Array.from(commandIds).map(async id => {
        const result = await sonarrGetCommandById({
          client: this.sonarr,
          path: { id },
        })
        const status = (result.data as { status?: string } | null)?.status
        return { id, status }
      }),
    )
    return this.buildStatusMap(results)
  }

  private buildStatusMap(
    results: PromiseSettledResult<{ id: number; status: string | undefined }>[],
  ): Map<number, string> {
    const statuses = new Map<number, string>()
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.status) {
        statuses.set(result.value.id, result.value.status)
      }
    }
    return statuses
  }

  private isFailed(item: RadarrQueueItem | SonarrQueueItem): boolean {
    return (
      FAILURE_STATES.has(item.trackedDownloadState ?? '') ||
      item.trackedDownloadStatus === 'error' ||
      item.status === 'failed'
    )
  }

  private async fetchRadarrQueue(refresh: boolean): Promise<RadarrQueueItem[]> {
    if (refresh) {
      await radarrPostCommand({
        client: this.radarr,
        body: { name: 'RefreshMonitoredDownloads' } as Record<string, unknown>,
      })
    }
    const result = await radarrGetQueueDetails({ client: this.radarr })
    return (result.data ?? []) as RadarrQueueItem[]
  }

  private async fetchSonarrQueue(refresh: boolean): Promise<SonarrQueueItem[]> {
    if (refresh) {
      await sonarrPostCommand({
        client: this.sonarr,
        body: { name: 'RefreshMonitoredDownloads' } as Record<string, unknown>,
      })
    }
    const result = await sonarrGetQueueDetails({ client: this.sonarr })
    return (result.data ?? []) as SonarrQueueItem[]
  }
}
