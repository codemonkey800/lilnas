import type {
  MovieResource,
  QueueResource,
  QueueResourcePagingResource,
} from '@lilnas/media/radarr'
import {
  deleteApiV3MovieById,
  deleteApiV3QueueById,
  getApiV3Movie,
  getApiV3MovieById,
  getApiV3MovieLookup,
  getApiV3Queue,
  getApiV3QueueDetails,
} from '@lilnas/media/radarr'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'
import { performance } from 'perf_hooks'

import { RetryConfigService } from 'src/config/retry.config'
import type { RadarrMediaClient } from 'src/media/clients'
import { RADARR_CLIENT } from 'src/media/clients'
import {
  RadarrInputSchemas,
  RadarrOutputSchemas,
} from 'src/media/schemas/radarr.schemas'
import { BaseMediaService } from 'src/media/services/base-media.service'
import {
  DeleteMovieOptions,
  DownloadingMovie,
  MovieLibrarySearchResult,
  MovieSearchResult,
  RadarrMovie,
  RadarrQueueStatus,
  UnmonitorAndDeleteResult,
} from 'src/media/types/radarr.types'
import { errorMessage } from 'src/media/utils/media.utils'
import {
  toDownloadingMovie,
  toRadarrMovie,
  toRadarrMovieArray,
  toRadarrMovieResourceArray,
  transformToSearchResults,
} from 'src/media/utils/radarr.utils'
import { RetryConfig, RetryService } from 'src/utils/retry.service'

@Injectable()
export class RadarrService extends BaseMediaService {
  protected readonly logger = new Logger(RadarrService.name)
  protected readonly serviceName = 'RadarrService'
  protected readonly circuitBreakerKey = 'radarr-api'
  protected readonly retryConfig: RetryConfig

  constructor(
    @Inject(RADARR_CLIENT) private readonly client: RadarrMediaClient,
    protected readonly retryService: RetryService,
    retryConfigService: RetryConfigService,
  ) {
    super()
    this.retryConfig = retryConfigService.getRadarrConfig()
  }

  /**
   * Search for movies by title - Main public API method
   */
  async searchMovies(query: string): Promise<MovieSearchResult[]> {
    const id = nanoid()

    const validatedInput = this.validateSearchQuery(
      { query },
      RadarrInputSchemas.searchQuery,
    )
    const normalizedQuery = validatedInput.query

    this.logger.log({ id, query: normalizedQuery }, 'Starting movie search')

    return await this.fetchMovieSearch(normalizedQuery, id)
  }

  /**
   * Get movies in Radarr library with optional search query
   */
  async getLibraryMovies(query?: string): Promise<MovieLibrarySearchResult[]> {
    const id = nanoid()

    const validatedInput = this.validateOptionalSearchQuery(
      { query },
      RadarrInputSchemas.optionalSearchQuery,
    )
    const normalizedQuery = validatedInput.query

    this.logger.log(
      { id, query: normalizedQuery, hasQuery: !!normalizedQuery },
      'Getting library movies from Radarr',
    )

    return await this.fetchLibraryMovies(normalizedQuery, id)
  }

  /**
   * Get all currently downloading movies from Radarr
   */
  async getDownloadingMovies(): Promise<DownloadingMovie[]> {
    const id = nanoid()

    this.logger.log({ id }, 'Getting all downloading movies from Radarr')

    try {
      const start = performance.now()

      const queueResponse =
        await this.executeWithRetry<QueueResourcePagingResource>(
          () =>
            getApiV3Queue({
              client: this.client,
              query: { includeMovie: true, pageSize: 1000 },
            }),
          `${this.serviceName}-getAllQueueItems-${id}`,
        )

      const allQueueItems: QueueResource[] = queueResponse.records ?? []

      // `warning` covers stalled downloads (no connections, missing blocks,
      // import blocked); they are still in flight and must stay visible.
      const downloadingItems = allQueueItems.filter(item => {
        const status = item.status ?? ''
        return (
          status === RadarrQueueStatus.DOWNLOADING ||
          status === RadarrQueueStatus.QUEUED ||
          status === RadarrQueueStatus.PAUSED ||
          status === RadarrQueueStatus.WARNING
        )
      })

      const downloadingMovies = downloadingItems.map(item => {
        const size = item.size ?? 0
        const sizeleft = item.sizeleft ?? 0
        const downloadedBytes = Math.max(0, size - sizeleft)

        if (size > 0) {
          this.logger.debug(
            {
              movieTitle: item.movie?.title || item.title,
              rawSize: item.size,
              rawSizeleft: item.sizeleft,
              calculatedSize: size,
              calculatedSizeleft: sizeleft,
              downloadedBytes,
              progressPercent: (downloadedBytes / size) * 100,
            },
            'Progress calculation debug info',
          )
        }

        return toDownloadingMovie(item)
      })

      const duration = performance.now() - start
      const validatedDownloads =
        RadarrOutputSchemas.downloadingMovieArray.parse(downloadingMovies)

      this.logger.log(
        {
          id,
          totalQueueItems: allQueueItems.length,
          downloadingCount: validatedDownloads.length,
          duration,
        },
        'Downloaded movies retrieved from Radarr',
      )

      return validatedDownloads
    } catch (error) {
      this.logger.error(
        { id, error: errorMessage(error) },
        'Failed to get downloading movies from Radarr',
      )
      throw error
    }
  }

  /**
   * Unmonitor a movie and delete its files
   */
  async unmonitorAndDeleteMovie(
    tmdbId: number,
    options: DeleteMovieOptions = {},
  ): Promise<UnmonitorAndDeleteResult> {
    const id = nanoid()
    const warnings: string[] = []

    this.logger.log(
      { id, tmdbId, options },
      'Starting unmonitor and delete movie operation',
    )

    try {
      const movie = await this.isMovieInLibrary(tmdbId, id)

      if (!movie) {
        this.logger.error({ id, tmdbId }, 'Movie not found in Jeremy+ library')
        return {
          success: false,
          movieDeleted: false,
          filesDeleted: false,
          error: `Movie with TMDB ID ${tmdbId} not found in Jeremy+ library`,
        }
      }

      let currentMovie: RadarrMovie
      try {
        currentMovie = toRadarrMovie(
          await this.executeWithRetry<MovieResource>(
            () =>
              getApiV3MovieById({
                client: this.client,
                path: { id: movie.id },
              }),
            `${this.serviceName}-getMovie-${id}`,
          ),
        )

        this.logger.log(
          {
            id,
            tmdbId,
            movieId: movie.id,
            title: currentMovie.title,
            monitored: currentMovie.monitored,
          },
          'Retrieved current movie data from Radarr',
        )
      } catch (getError) {
        this.logger.error(
          { id, tmdbId, movieId: movie.id, error: getError },
          'Movie not found in Radarr, may have been deleted already',
        )
        return {
          success: false,
          movieDeleted: false,
          filesDeleted: false,
          error: `Movie not found in Radarr: ${getError instanceof Error ? getError.message : 'Unknown error'}`,
        }
      }

      let downloadsFound = 0
      let downloadsCancelled = 0
      try {
        const cancellationResult = await this.cancelMovieDownloads(movie.id, id)
        downloadsFound = cancellationResult.found
        downloadsCancelled = cancellationResult.cancelled

        if (cancellationResult.warnings.length > 0) {
          warnings.push(...cancellationResult.warnings)
        }
      } catch (downloadError) {
        this.logger.warn(
          {
            id,
            tmdbId,
            movieId: movie.id,
            error:
              downloadError instanceof Error
                ? downloadError.message
                : 'Unknown error',
          },
          'Failed to cancel downloads, proceeding with movie deletion',
        )
        warnings.push(
          `Failed to cancel downloads: ${downloadError instanceof Error ? downloadError.message : 'Unknown error'}`,
        )
      }

      const hasFiles = currentMovie.hasFile
      const filesDeleted = Boolean(options.deleteFiles && hasFiles)

      try {
        await this.executeWithRetry(
          () =>
            deleteApiV3MovieById({
              client: this.client,
              path: { id: movie.id },
              query: { deleteFiles: options.deleteFiles },
            }),
          `${this.serviceName}-deleteMovie-${id}`,
        )

        this.logger.log(
          {
            id,
            tmdbId,
            movieId: movie.id,
            title: currentMovie.title,
            deleteFiles: options.deleteFiles,
            hadFiles: hasFiles,
            downloadsFound,
            downloadsCancelled,
          },
          'Movie deleted successfully from Radarr',
        )
      } catch (deleteError) {
        this.logger.error(
          { id, tmdbId, movieId: movie.id, error: deleteError },
          'Failed to delete movie from Radarr',
        )
        return {
          success: false,
          movieDeleted: false,
          filesDeleted: false,
          downloadsFound: downloadsFound > 0 ? downloadsFound : undefined,
          downloadsCancelled:
            downloadsCancelled > 0 ? downloadsCancelled : undefined,
          movie: currentMovie,
          error: `Failed to delete movie: ${deleteError instanceof Error ? deleteError.message : 'Unknown error'}`,
          warnings: warnings.length > 0 ? warnings : undefined,
        }
      }

      if (!currentMovie.monitored) {
        warnings.push('Movie was not monitored before deletion')
      }
      if (!hasFiles && options.deleteFiles) {
        warnings.push('Movie had no files to delete')
      }

      const result: UnmonitorAndDeleteResult = {
        success: true,
        movieDeleted: true,
        filesDeleted,
        downloadsFound: downloadsFound > 0 ? downloadsFound : undefined,
        downloadsCancelled:
          downloadsCancelled > 0 ? downloadsCancelled : undefined,
        movie: currentMovie,
        warnings: warnings.length > 0 ? warnings : undefined,
      }

      this.logger.log(
        {
          id,
          tmdbId,
          movieId: movie.id,
          title: currentMovie.title,
          filesDeleted,
          downloadsFound,
          downloadsCancelled,
          warnings,
        },
        'Unmonitor and delete movie operation completed successfully',
      )

      return result
    } catch (error) {
      this.logger.error(
        { id, tmdbId, error: errorMessage(error) },
        'Unmonitor and delete movie operation failed',
      )

      return {
        success: false,
        movieDeleted: false,
        filesDeleted: false,
        error: errorMessage(error),
      }
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async fetchMovieSearch(
    query: string,
    operationId: string,
  ): Promise<MovieSearchResult[]> {
    this.logger.log(
      { id: operationId, query },
      'Fetching movie search from Radarr API',
    )
    const start = performance.now()

    try {
      const rawMovies = await this.executeWithRetry<MovieResource[]>(
        () =>
          getApiV3MovieLookup({
            client: this.client,
            query: { term: query },
          }),
        `${this.serviceName}-searchMovies-${operationId}`,
      )

      const duration = performance.now() - start

      const results = transformToSearchResults(
        toRadarrMovieResourceArray(rawMovies, this.logger),
      )
      const validatedResults =
        RadarrOutputSchemas.movieSearchResultArray.parse(results)

      this.logger.log(
        {
          id: operationId,
          query,
          resultCount: validatedResults.length,
          duration,
        },
        'Movie search fetch completed',
      )

      return validatedResults
    } catch (error) {
      const duration = performance.now() - start

      this.logger.error(
        { id: operationId, query, duration, error: errorMessage(error) },
        'Failed to fetch movie search',
      )

      throw error
    }
  }

  private async isMovieInLibrary(
    tmdbId: number,
    operationId: string,
  ): Promise<RadarrMovie | null> {
    const movies = toRadarrMovieArray(
      await this.executeWithRetry<MovieResource[]>(
        () => getApiV3Movie({ client: this.client, query: { tmdbId } }),
        `${this.serviceName}-isMovieInLibrary-${operationId}`,
      ),
      this.logger,
    )

    return movies.find(m => m.tmdbId === tmdbId) ?? null
  }

  private async cancelMovieDownloads(
    movieId: number,
    operationId: string,
  ): Promise<{ found: number; cancelled: number; warnings: string[] }> {
    this.logger.log(
      { id: operationId, movieId },
      'Checking for active downloads to cancel',
    )

    try {
      const queueItems = await this.executeWithRetry<QueueResource[]>(
        () =>
          getApiV3QueueDetails({
            client: this.client,
            query: { movieId, includeMovie: false },
          }),
        `${this.serviceName}-getQueueItemsForMovie-${operationId}`,
      )

      const found = queueItems.length

      if (found === 0) {
        this.logger.log(
          { id: operationId, movieId },
          'No active downloads found for movie',
        )
        return { found: 0, cancelled: 0, warnings: [] }
      }

      this.logger.log(
        { id: operationId, movieId, downloadCount: found },
        'Found active downloads, attempting to cancel',
      )

      const cancellableItems = queueItems.filter(item => item.id != null)
      const cancellationResults = await Promise.allSettled(
        cancellableItems.map(item =>
          this.executeWithRetry(
            () =>
              deleteApiV3QueueById({
                client: this.client,
                path: { id: item.id! },
                query: { removeFromClient: true },
              }),
            `${this.serviceName}-cancelQueueItem-${item.id}-${operationId}`,
          ),
        ),
      )

      for (const [i, result] of cancellationResults.entries()) {
        if (result.status === 'rejected') {
          const item = cancellableItems[i]
          this.logger.warn(
            {
              movieId,
              queueId: item.id,
              title: item.title,
              error: errorMessage(result.reason),
            },
            'Failed to cancel individual queue item',
          )
        }
      }

      const cancelledCount = cancellationResults.filter(
        r => r.status === 'fulfilled',
      ).length

      const result = {
        found,
        cancelled: cancelledCount,
        warnings:
          cancelledCount < found
            ? [
                `Some downloads could not be cancelled (${cancelledCount}/${found} successful)`,
              ]
            : [],
      }

      this.logger.log(
        {
          id: operationId,
          movieId,
          found: result.found,
          cancelled: result.cancelled,
          failedCount: result.found - result.cancelled,
        },
        'Download cancellation completed',
      )

      return result
    } catch (error) {
      this.logger.error(
        { id: operationId, movieId, error: errorMessage(error) },
        'Failed to check for active downloads',
      )
      throw error
    }
  }

  private async fetchLibraryMovies(
    query: string | undefined,
    operationId: string,
  ): Promise<MovieLibrarySearchResult[]> {
    this.logger.log(
      { id: operationId, query, hasQuery: !!query },
      'Fetching library movies from Radarr API',
    )
    const start = performance.now()

    try {
      const allMovies = toRadarrMovieArray(
        await this.executeWithRetry<MovieResource[]>(
          () => getApiV3Movie({ client: this.client }),
          `${this.serviceName}-getAllMovies-${operationId}`,
        ),
        this.logger,
      )

      let filteredMovies = allMovies

      if (query) {
        filteredMovies = this.filterMoviesByQuery(allMovies, query)
        this.logger.log(
          {
            id: operationId,
            query,
            totalMovies: allMovies.length,
            filteredCount: filteredMovies.length,
          },
          'Filtered library movies by query',
        )
      }

      const results = this.transformToLibraryResults(filteredMovies)
      const duration = performance.now() - start

      const validatedResults =
        RadarrOutputSchemas.movieLibrarySearchResultArray.parse(results)

      this.logger.log(
        {
          id: operationId,
          query,
          resultCount: validatedResults.length,
          duration,
        },
        'Library movies fetch completed',
      )

      return validatedResults
    } catch (error) {
      const duration = performance.now() - start

      this.logger.error(
        { id: operationId, query, duration, error: errorMessage(error) },
        'Failed to fetch library movies',
      )

      throw error
    }
  }

  private filterMoviesByQuery(
    movies: RadarrMovie[],
    query: string,
  ): RadarrMovie[] {
    const normalizedQuery = query.toLowerCase().trim()

    return movies.filter(movie => {
      if (movie.title.toLowerCase().includes(normalizedQuery)) return true
      if (movie.originalTitle?.toLowerCase().includes(normalizedQuery))
        return true
      if (movie.year?.toString().includes(normalizedQuery)) return true
      if (
        movie.genres.some(genre =>
          genre.toLowerCase().includes(normalizedQuery),
        )
      )
        return true
      if (movie.overview?.toLowerCase().includes(normalizedQuery)) return true
      if (movie.certification?.toLowerCase().includes(normalizedQuery))
        return true
      if (movie.studio?.toLowerCase().includes(normalizedQuery)) return true
      return false
    })
  }

  private transformToLibraryResults(
    movies: RadarrMovie[],
  ): MovieLibrarySearchResult[] {
    return movies.map(movie => ({
      tmdbId: movie.tmdbId,
      imdbId: movie.imdbId,
      title: movie.title,
      originalTitle: movie.originalTitle,
      year: movie.year,
      overview: movie.overview,
      runtime: movie.runtime,
      genres: movie.genres,
      rating: movie.ratings.imdb?.value,
      posterPath: movie.images.find(img => img.coverType === 'poster')
        ?.remoteUrl,
      backdropPath: movie.images.find(img => img.coverType === 'fanart')
        ?.remoteUrl,
      inCinemas: movie.inCinemas,
      physicalRelease: movie.physicalRelease,
      digitalRelease: movie.digitalRelease,
      status: movie.status,
      certification: movie.certification,
      studio: movie.studio,
      website: movie.website,
      youTubeTrailerId: movie.youTubeTrailerId,
      popularity: movie.popularity,
      id: movie.id,
      monitored: movie.monitored,
      path: movie.path,
      hasFile: movie.hasFile,
      added: movie.added,
      sizeOnDisk: movie.sizeOnDisk,
      qualityProfileId: movie.qualityProfileId,
      rootFolderPath: movie.path,
      minimumAvailability: movie.minimumAvailability,
      isAvailable: movie.isAvailable,
    }))
  }
}
