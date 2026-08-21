import type {
  CommandResourceWritable,
  MovieResource,
  QueueResource,
} from '@lilnas/media/radarr'
import {
  deleteApiV3MovieById,
  deleteApiV3QueueById,
  getApiV3Movie,
  getApiV3MovieLookup,
  getApiV3MovieLookupTmdb,
  getApiV3Qualityprofile,
  getApiV3Queue,
  getApiV3Rootfolder,
  postApiV3Command,
  postApiV3Movie,
} from '@lilnas/media/radarr'
import { DownloadType, type Movie } from '@lilnas/utils/download/types'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { mediaId } from 'src/db/media-id'
import type { RadarrMediaClient } from 'src/media/clients'
import { RADARR_CLIENT } from 'src/media/clients'
import { checkSdkError, unwrapSdkResult } from 'src/media/sdk-result.util'
import { generateTitleSlug } from 'src/media/title-slug.util'

/**
 * Radarr's MoviesSearch command accepts movieIds but the generated SDK type
 * omits command-specific body parameters. We extend it locally so TypeScript
 * validates the extra field rather than silently ignoring it via a raw `as`.
 * (Mirrors apps/tdr-bot/src/media/services/radarr.service.ts.)
 */
type MoviesSearchCommand = CommandResourceWritable & { movieIds?: number[] }

export interface RequestMovieResult {
  overview?: string
  posterUrl?: string
  radarrId: number
  title: string
}

// Radarr surfaces up to four release-date-shaped fields depending on the
// movie's lifecycle stage (announced -> in cinemas -> digital -> physical) -
// none of them are guaranteed present, so the first one that is wins.
function pickMovieReleaseDate(movie: MovieResource): string | undefined {
  return (
    movie.releaseDate ??
    movie.inCinemas ??
    movie.digitalRelease ??
    movie.physicalRelease ??
    undefined
  )
}

/**
 * The single Radarr -> `Media` mapper (plan §4.1/§4.2). Everything that
 * turns a Radarr payload into a domain object goes through here: the
 * resolver's library cache and per-id fallback, `/movies/search`,
 * `/discover`, and `/media/:id`. A search hit, a discovery hit and a
 * library item are now literally the same type, differing only in which
 * optional fields are populated - which is what let three near-identical
 * mappers collapse into this one.
 */
export function toMovie(movie: MovieResource): Movie {
  const posterUrl = movie.images?.find(img => img.coverType === 'poster')?.url
  const releaseDate = pickMovieReleaseDate(movie)
  const tmdbId = movie.tmdbId ?? 0

  return {
    certification: movie.certification ?? undefined,
    filePath: movie.hasFile ? (movie.movieFile?.path ?? undefined) : undefined,
    genres: movie.genres ?? [],
    id: mediaId({ tmdbId, type: DownloadType.Movie }),
    overview: movie.overview ?? undefined,
    posterUrl: posterUrl ?? undefined,
    // Radarr returns `id: 0` for a lookup result that isn't in the library
    // - falsy rather than absent - so `|| undefined` (not `?? undefined`)
    // is what keeps a non-library hit from claiming radarrId 0.
    radarrId: movie.id || undefined,
    ratingValue: movie.ratings?.tmdb?.value ?? movie.ratings?.imdb?.value,
    releaseDate,
    // Radarr reports minutes; `Media.runtime` is seconds (see MediaBaseSchema).
    runtime: movie.runtime != null ? movie.runtime * 60 : undefined,
    title: movie.title ?? 'Unknown title',
    tmdbId,
    type: DownloadType.Movie,
    year: movie.year,
  }
}

@Injectable()
export class RadarrService {
  private logger = new Logger(RadarrService.name)

  constructor(
    @Inject(RADARR_CLIENT) private readonly client: RadarrMediaClient,
  ) {}

  /**
   * Radarr's lookup, mapped to `Media`. Backs both `/movies/search` and
   * `/discover` - they were two methods and two mappers over the identical
   * upstream call purely because their response types differed, and the
   * search mapper dropped genres/ratings/runtime/certification on the floor
   * even though the same response carried them.
   */
  async search(query: string): Promise<Movie[]> {
    const movies = unwrapSdkResult(
      await getApiV3MovieLookup({
        client: this.client,
        query: { term: query },
      }),
      'searchMovies',
    )

    return movies.map(toMovie)
  }

  /**
   * The whole Radarr library, mapped to `Media` - `MediaResolverService`'s
   * library cache is built from this (one call per TTL window rather than
   * one per job). Same underlying call as `requestMovie()`'s existing
   * library-first lookup (`getApiV3Movie`).
   */
  async getLibrary(): Promise<Movie[]> {
    const movies = unwrapSdkResult(
      await getApiV3Movie({ client: this.client }),
      'getMovies',
    )

    return movies.map(toMovie)
  }

  /**
   * Per-id fallback for `MediaResolverService` when a tmdbId isn't in the
   * library cache - metadata-only, no `radarrId`/`filePath` (this is the
   * *discover* lookup, not a library query, so a title requested but since
   * removed from Radarr still resolves).
   */
  async lookupByTmdbId(tmdbId: number): Promise<Movie> {
    const lookup = unwrapSdkResult(
      await getApiV3MovieLookupTmdb({
        client: this.client,
        query: { tmdbId },
      }),
      'lookupMovieByTmdbId',
    )

    return toMovie(lookup)
  }

  /**
   * Adds (if needed) and triggers a search for a movie by TMDB ID.
   * Simplified relative to tdr-bot's monitorAndDownloadMovie: no
   * retry/circuit-breaker wrapper, no granular options, just enough to get
   * the movie monitored in Radarr and a search command queued.
   */
  async requestMovie(tmdbId: number): Promise<RequestMovieResult> {
    const existingMovies = unwrapSdkResult(
      await getApiV3Movie({ client: this.client }),
      'getMovies',
    )

    let movie = existingMovies.find(m => m.tmdbId === tmdbId)

    if (!movie) {
      const lookup = unwrapSdkResult(
        await getApiV3MovieLookupTmdb({
          client: this.client,
          query: { tmdbId },
        }),
        'lookupMovieByTmdbId',
      )

      const { qualityProfileId, rootFolderPath } =
        await this.getDefaultConfiguration()

      const title = lookup.title ?? `Movie ${tmdbId}`

      movie = unwrapSdkResult(
        await postApiV3Movie({
          client: this.client,
          // Domain fields line up 1:1 with MovieResource; addOptions is the
          // only nested writable-only shape, so a targeted cast covers it.
          body: {
            tmdbId,
            title,
            titleSlug: generateTitleSlug(title),
            year: lookup.year,
            qualityProfileId,
            rootFolderPath,
            monitored: true,
            minimumAvailability: 'released',
            addOptions: { searchForMovie: false },
          } as unknown as MovieResource,
        }),
        'addMovie',
      )
    }

    if (movie.id == null) {
      throw new Error(`Radarr did not return an id for movie tmdbId=${tmdbId}`)
    }

    const command: MoviesSearchCommand = {
      name: 'MoviesSearch',
      movieIds: [movie.id],
    }
    checkSdkError(
      await postApiV3Command({ client: this.client, body: command }),
      'triggerMovieSearch',
    )

    const posterUrl = movie.images?.find(
      img => img.coverType === 'poster',
    )?.remoteUrl

    return {
      overview: movie.overview ?? undefined,
      posterUrl: posterUrl ?? undefined,
      radarrId: movie.id,
      title: movie.title ?? `Movie ${tmdbId}`,
    }
  }

  /**
   * Fetches the current Radarr queue, optionally scoped to specific movie
   * IDs. Used by MediaPollerService (no filter -> all tracked jobs matched
   * client-side) and by unmonitorAndDelete (filtered to one movie).
   */
  async getQueue(movieIds?: number[]): Promise<QueueResource[]> {
    const paging = unwrapSdkResult(
      await getApiV3Queue({
        client: this.client,
        query: {
          includeMovie: false,
          pageSize: 1000,
          ...(movieIds && movieIds.length > 0 ? { movieIds } : {}),
        },
      }),
      'getQueue',
    )

    return paging.records ?? []
  }

  /**
   * Cancels any in-progress downloads for the movie, then unmonitors and
   * deletes it. Mirrors apps/tdr-bot/src/media/services/radarr.service.ts's
   * unmonitorAndDeleteMovie operation order (cancel queue items, then
   * delete) without the retry/warnings apparatus.
   */
  async unmonitorAndDelete(
    radarrId: number,
    deleteFiles = true,
  ): Promise<void> {
    const queueItems = await this.getQueue([radarrId])

    const cancellations = await Promise.allSettled(
      queueItems
        .filter(item => item.id != null)
        .map(item =>
          deleteApiV3QueueById({
            client: this.client,
            path: { id: item.id as number },
            query: { removeFromClient: true },
          }),
        ),
    )

    for (const result of cancellations) {
      if (result.status === 'rejected') {
        this.logger.warn(
          { radarrId, error: String(result.reason) },
          'Failed to cancel an in-progress queue item before deleting movie',
        )
      }
    }

    checkSdkError(
      await deleteApiV3MovieById({
        client: this.client,
        path: { id: radarrId },
        query: { deleteFiles },
      }),
      'deleteMovie',
    )
  }

  private async getDefaultConfiguration(): Promise<{
    qualityProfileId: number
    rootFolderPath: string
  }> {
    const [profiles, folders] = await Promise.all([
      unwrapSdkResult(
        await getApiV3Qualityprofile({ client: this.client }),
        'getQualityProfiles',
      ),
      unwrapSdkResult(
        await getApiV3Rootfolder({ client: this.client }),
        'getRootFolders',
      ),
    ])

    const profile = profiles[0]
    if (!profile || profile.id == null) {
      throw new Error('No quality profiles available in Radarr')
    }

    const folder = folders.find(f => f.accessible)
    if (!folder || folder.path == null) {
      throw new Error('No accessible root folders available in Radarr')
    }

    return { qualityProfileId: profile.id, rootFolderPath: folder.path }
  }
}
