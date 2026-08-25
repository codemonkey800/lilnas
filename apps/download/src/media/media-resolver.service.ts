import {
  DownloadType,
  type Media,
  type Movie,
  type Show,
  type Video,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'

import { DbService } from 'src/db/db.service'
import { mediaId, mediaIdSuffix } from 'src/db/media-id'
import type { VideoRow } from 'src/db/schema'
import { getVideosByIds } from 'src/db/videos.repo'
import { EmbyStatusService } from 'src/emby/emby-status.service'

import { RadarrService } from './radarr.service'
import { SonarrService } from './sonarr.service'

export interface MediaKey {
  mediaId: string
  type: DownloadType
}

export interface MediaResolverResult {
  degradedSources: DownloadType[]
  media: Map<string, Media>
}

interface LibraryCacheEntry<T> {
  entries: Map<number, T>
  expiresAtMs: number
}

function hydrateVideo(row: VideoRow): Video {
  return {
    downloadUrls: row.downloadUrls ?? undefined,
    id: mediaId({ id: row.id, type: DownloadType.Video }),
    overview: row.overview ?? undefined,
    posterUrl: row.posterUrl ?? undefined,
    runtime: row.runtime ?? undefined,
    sourceUrl: row.sourceUrl,
    timeRange: row.timeRange ?? undefined,
    title: row.title,
    type: DownloadType.Video,
  }
}

/**
 * `(type, mediaId)[] -> Media[]` - the single place a key becomes a `Media`
 * (plan §4.1). Everything that renders a job or a gallery card goes through
 * here, so there is exactly one place that knows how a key becomes a media.
 *
 * A `video:` key resolves via one `videos` query; a `tmdb:`/`tvdb:` key via
 * a whole-library cache
 * (`RadarrService.getLibrary()`/`SonarrService.getLibrary()`, 60s success /
 * 10s failure TTL, mirroring `AdminCheckService`) with a per-id fallback on a
 * cache miss. An upstream throw never propagates - a placeholder `Media`
 * (`{ id, title: id, type }`) is returned instead, with the source flagged in
 * `degradedSources`, so a list endpoint degrades rather than 500s.
 *
 * Every resolved movie/show that has a file on disk is then annotated with
 * its Emby state (`EmbyStatusService.annotate()`), so a caller never has to
 * ask a second service where to watch something.
 */
@Injectable()
export class MediaResolverService {
  private static readonly TTL_MS = 60_000
  private static readonly FAILURE_TTL_MS = 10_000

  private readonly logger = new Logger(MediaResolverService.name)
  private movieLibraryCache?: LibraryCacheEntry<Movie>
  private showLibraryCache?: LibraryCacheEntry<Show>

  constructor(
    private readonly dbService: DbService,
    private readonly embyStatusService: EmbyStatusService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  async resolve(keys: readonly MediaKey[]): Promise<MediaResolverResult> {
    const media = new Map<string, Media>()
    const degradedSources = new Set<DownloadType>()

    const videoKeys = keys.filter(key => key.type === DownloadType.Video)
    const movieKeys = keys.filter(key => key.type === DownloadType.Movie)
    const showKeys = keys.filter(key => key.type === DownloadType.Show)

    if (videoKeys.length > 0) {
      this.resolveVideos(videoKeys, media)
    }

    await Promise.all([
      movieKeys.length > 0
        ? this.resolveMovies(movieKeys, media, degradedSources)
        : undefined,
      showKeys.length > 0
        ? this.resolveShows(showKeys, media, degradedSources)
        : undefined,
    ])

    // Called unconditionally, including for a video-only or empty result:
    // "is this batch worth an Emby round trip" is EmbyStatusService's own
    // decision (it returns before any HTTP call when nothing has a
    // filePath), and duplicating that test here would be a second place to
    // keep in sync. One batched call per resolve() - never a per-key one -
    // is the whole integration; resolve() runs on a 10s cron, and the 60s
    // path-index TTL inside EmbyStatusService is what bounds Emby load.
    //
    // Emby state is deliberately NOT reflected in degradedSources: Emby
    // isn't a DownloadType, and a per-title `unknown` already carries the
    // degradation signal at the only granularity a caller can act on.
    try {
      await this.embyStatusService.annotate(media.values())
    } catch (err) {
      // annotate() is documented never to throw, so this is a guard against
      // a future regression in it rather than a live path. resolve() backs
      // every list endpoint and the poller, so a broken Emby annotation must
      // cost a badge, not the whole payload - which is already resolved and
      // correct by this point.
      this.logger.warn(
        { action: 'resolve', error: getErrorMessage(err) },
        'Emby annotation threw - returning media without Emby status',
      )
    }

    return { degradedSources: [...degradedSources], media }
  }

  private resolveVideos(
    keys: readonly MediaKey[],
    media: Map<string, Media>,
  ): void {
    const ids = keys.map(key => mediaIdSuffix(key.mediaId))
    const rows = getVideosByIds(this.dbService.db, ids)

    for (const row of rows) {
      media.set(
        mediaId({ id: row.id, type: DownloadType.Video }),
        hydrateVideo(row),
      )
    }

    // `jobs.media_id` has no foreign key (it points at `videos` for a third
    // of rows and at TMDB/TVDB for the rest, and SQLite FKs can't be
    // conditional), so a dangling `video:` key is structurally possible even
    // though `ensureVideo()` is the only writer of either table. Emitting a
    // placeholder rather than a gap means `resolve()` always answers for
    // every key it was given, and a list endpoint degrades one card instead
    // of failing the page. `/media/:id` still 404s a missing video - it
    // checks the row directly rather than going through this path.
    for (const key of keys) {
      if (media.has(key.mediaId)) continue

      this.logger.warn(
        { action: 'resolveVideos', mediaId: key.mediaId },
        'No videos row for media id - returning a placeholder',
      )
      media.set(key.mediaId, {
        id: key.mediaId,
        sourceUrl: '',
        title: key.mediaId,
        type: DownloadType.Video,
      })
    }
  }

  private async resolveMovies(
    keys: readonly MediaKey[],
    media: Map<string, Media>,
    degradedSources: Set<DownloadType>,
  ): Promise<void> {
    let library: Map<number, Movie>
    try {
      library = await this.getMovieLibrary()
    } catch (err) {
      this.logger.warn(
        { action: 'resolveMovies', error: getErrorMessage(err) },
        'Radarr library lookup failed - falling back to per-id lookups',
      )
      degradedSources.add(DownloadType.Movie)
      library = new Map()
    }

    await Promise.all(
      keys.map(async key => {
        const tmdbId = Number(mediaIdSuffix(key.mediaId))
        const cached = library.get(tmdbId)
        if (cached) {
          media.set(key.mediaId, cached)
          return
        }

        try {
          media.set(
            key.mediaId,
            await this.radarrService.lookupByTmdbId(tmdbId),
          )
        } catch (err) {
          this.logger.warn(
            {
              action: 'resolveMovies',
              error: getErrorMessage(err),
              tmdbId,
            },
            'Radarr per-id lookup failed - returning a placeholder',
          )
          degradedSources.add(DownloadType.Movie)
          media.set(key.mediaId, {
            id: key.mediaId,
            title: key.mediaId,
            tmdbId,
            type: DownloadType.Movie,
          })
        }
      }),
    )
  }

  private async resolveShows(
    keys: readonly MediaKey[],
    media: Map<string, Media>,
    degradedSources: Set<DownloadType>,
  ): Promise<void> {
    let library: Map<number, Show>
    try {
      library = await this.getShowLibrary()
    } catch (err) {
      this.logger.warn(
        { action: 'resolveShows', error: getErrorMessage(err) },
        'Sonarr library lookup failed - falling back to per-id lookups',
      )
      degradedSources.add(DownloadType.Show)
      library = new Map()
    }

    await Promise.all(
      keys.map(async key => {
        const tvdbId = Number(mediaIdSuffix(key.mediaId))
        const cached = library.get(tvdbId)
        if (cached) {
          media.set(key.mediaId, cached)
          return
        }

        try {
          media.set(
            key.mediaId,
            await this.sonarrService.lookupByTvdbId(tvdbId),
          )
        } catch (err) {
          this.logger.warn(
            {
              action: 'resolveShows',
              error: getErrorMessage(err),
              tvdbId,
            },
            'Sonarr per-id lookup failed - returning a placeholder',
          )
          degradedSources.add(DownloadType.Show)
          media.set(key.mediaId, {
            id: key.mediaId,
            title: key.mediaId,
            tvdbId,
            type: DownloadType.Show,
          })
        }
      }),
    )
  }

  /**
   * Evicts one key from whichever library cache holds it, so the next read
   * goes back upstream. Called after a mutation the app itself made (a
   * delete), where waiting out the TTL would serve a copy the app already
   * knows is wrong - normal staleness is still bounded by the TTL alone.
   */
  invalidate(key: string): void {
    const suffix = Number(mediaIdSuffix(key))
    if (Number.isNaN(suffix)) return

    this.movieLibraryCache?.entries.delete(suffix)
    this.showLibraryCache?.entries.delete(suffix)
  }

  private async getMovieLibrary(): Promise<Map<number, Movie>> {
    const now = Date.now()
    if (this.movieLibraryCache && this.movieLibraryCache.expiresAtMs > now) {
      return this.movieLibraryCache.entries
    }

    try {
      const movies = await this.radarrService.getLibrary()
      const entries = new Map(movies.map(movie => [movie.tmdbId, movie]))
      this.movieLibraryCache = {
        entries,
        expiresAtMs: now + MediaResolverService.TTL_MS,
      }
      return entries
    } catch (err) {
      this.movieLibraryCache = {
        entries: new Map(),
        expiresAtMs: now + MediaResolverService.FAILURE_TTL_MS,
      }
      throw err
    }
  }

  private async getShowLibrary(): Promise<Map<number, Show>> {
    const now = Date.now()
    if (this.showLibraryCache && this.showLibraryCache.expiresAtMs > now) {
      return this.showLibraryCache.entries
    }

    try {
      const series = await this.sonarrService.getLibrary()
      const entries = new Map(series.map(show => [show.tvdbId, show]))
      this.showLibraryCache = {
        entries,
        expiresAtMs: now + MediaResolverService.TTL_MS,
      }
      return entries
    } catch (err) {
      this.showLibraryCache = {
        entries: new Map(),
        expiresAtMs: now + MediaResolverService.FAILURE_TTL_MS,
      }
      throw err
    }
  }
}
