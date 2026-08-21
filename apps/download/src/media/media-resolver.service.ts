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
 * (plan §4.1). Not yet wired into any request path: `DownloadStateService`'s
 * `resolveJob()` and the controller's job routes still return the pre-Media
 * `DownloadJob` shapes (see the plan doc's Phase 5 status note for why that
 * wiring is Phase 6 work, done together with the response reshape).
 *
 * A `video:` key resolves via one `videos` query; a `tmdb:`/`tvdb:` key via
 * a whole-library cache
 * (`RadarrService.getLibrary()`/`SonarrService.getLibrary()`, 60s success /
 * 10s failure TTL, mirroring `AdminCheckService`) with a per-id fallback on a
 * cache miss. An upstream throw never propagates - a placeholder `Media`
 * (`{ id, title: id, type }`) is returned instead, with the source flagged in
 * `degradedSources`, so a list endpoint degrades rather than 500s.
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
