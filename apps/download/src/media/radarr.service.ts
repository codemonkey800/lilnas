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
import type { MovieSearchResult } from '@lilnas/utils/download/types'
import { Inject, Injectable, Logger } from '@nestjs/common'

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
  posterUrl?: string
  radarrId: number
  title: string
}

function toMovieSearchResult(movie: MovieResource): MovieSearchResult {
  const posterUrl = movie.images?.find(img => img.coverType === 'poster')?.url

  return {
    overview: movie.overview ?? undefined,
    posterUrl: posterUrl ?? undefined,
    title: movie.title ?? 'Unknown title',
    tmdbId: movie.tmdbId ?? 0,
    year: movie.year,
  }
}

@Injectable()
export class RadarrService {
  private logger = new Logger(RadarrService.name)

  constructor(
    @Inject(RADARR_CLIENT) private readonly client: RadarrMediaClient,
  ) {}

  async search(query: string): Promise<MovieSearchResult[]> {
    const movies = unwrapSdkResult(
      await getApiV3MovieLookup({
        client: this.client,
        query: { term: query },
      }),
      'searchMovies',
    )

    return movies.map(toMovieSearchResult)
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
