import { env } from '@lilnas/utils/env'
import { Injectable } from '@nestjs/common'

import { RetryConfigService } from 'src/config/retry.config'
import {
  AddMovieRequest,
  AddMovieResponse,
  DeleteMovieOptions,
  RadarrCommandRequest,
  RadarrCommandResponse,
  RadarrMovie,
  RadarrMovieResource,
  RadarrQualityProfile,
  RadarrQueueItem,
  RadarrQueuePaginatedResponse,
  RadarrRootFolder,
  RadarrSystemStatus,
} from 'src/media/types/radarr.types'
import { EnvKey } from 'src/utils/env'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

import { BaseMediaApiClient } from './base-media-api.client'

@Injectable()
export class RadarrClient extends BaseMediaApiClient {
  protected readonly serviceName = 'Radarr'
  protected readonly baseUrl: string
  protected readonly apiKey: string
  protected readonly circuitBreakerKey = 'radarr-api'

  constructor(
    protected readonly retryService: RetryService,
    protected readonly errorClassifier: ErrorClassificationService,
    private readonly retryConfigService: RetryConfigService,
  ) {
    super(retryService, errorClassifier)

    this.baseUrl = env<EnvKey>('RADARR_URL')
    this.apiKey = env<EnvKey>('RADARR_API_KEY')

    // Ensure baseUrl ends with /api/v3
    if (!this.baseUrl.endsWith('/api/v3')) {
      this.baseUrl = this.baseUrl.replace(/\/$/, '') + '/api/v3'
    }
  }

  /**
   * Get retry configuration for Radarr API calls
   */
  protected getRetryConfig() {
    return this.retryConfigService.getRadarrConfig()
  }

  /**
   * Search for movies by title
   * This is the main public function as requested - simple search by query string
   * Returns raw movie objects from Radarr API
   */
  async searchMovies(query: string): Promise<RadarrMovieResource[]> {
    if (!query || query.trim().length === 0) {
      throw new Error('Search query is required')
    }

    if (query.trim().length < 2) {
      throw new Error('Search query must be at least 2 characters')
    }

    const trimmedQuery = query.trim()
    const searchParams = new URLSearchParams({ term: trimmedQuery })

    this.logger.log({ query: trimmedQuery }, 'Searching movies via Radarr API')

    try {
      // Use the movie lookup endpoint as documented
      const movies = await this.get<RadarrMovieResource[]>(
        `/movie/lookup?${searchParams}`,
      )

      this.logger.log(
        { query: trimmedQuery, resultCount: movies.length },
        'Movie search completed successfully',
      )

      return movies
    } catch (error) {
      this.logger.error(
        {
          query: trimmedQuery,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to search movies',
      )
      throw error
    }
  }

  /**
   * Lookup a movie by TMDB ID
   * This uses the dedicated TMDB lookup endpoint which is more reliable than searching by TMDB ID as text
   * @param tmdbId - The TMDB ID of the movie to lookup
   * @returns Single movie resource if found
   */
  async lookupMovieByTmdbId(tmdbId: number): Promise<RadarrMovieResource> {
    if (!tmdbId || tmdbId <= 0) {
      throw new Error('Valid TMDB ID is required')
    }

    this.logger.log({ tmdbId }, 'Looking up movie by TMDB ID via Radarr API')

    try {
      const movie = await this.get<RadarrMovieResource>(
        `/movie/lookup/tmdb?tmdbId=${tmdbId}`,
      )

      this.logger.log(
        { tmdbId, title: movie.title },
        'Movie lookup by TMDB ID completed successfully',
      )

      return movie
    } catch (error) {
      this.logger.error(
        {
          tmdbId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to lookup movie by TMDB ID',
      )
      throw error
    }
  }

  /**
   * Get system status for health check
   */
  async getSystemStatus(): Promise<RadarrSystemStatus> {
    this.logger.log('Getting Radarr system status')

    try {
      const status = await this.get<RadarrSystemStatus>('/system/status')

      this.logger.log(
        { version: status.version, status: 'healthy' },
        'Radarr system status retrieved successfully',
      )

      return status
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get system status',
      )
      throw error
    }
  }

  /**
   * Health check implementation
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.getSystemStatus()
      return true
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Radarr health check failed',
      )
      return false
    }
  }

  /**
   * Get quality profiles from Radarr
   */
  async getQualityProfiles(): Promise<RadarrQualityProfile[]> {
    this.logger.log('Getting Radarr quality profiles')

    try {
      const profiles = await this.get<RadarrQualityProfile[]>('/qualityprofile')

      this.logger.log(
        { profileCount: profiles.length },
        'Quality profiles retrieved successfully',
      )

      return profiles
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get quality profiles',
      )
      throw error
    }
  }

  /**
   * Get root folders from Radarr
   */
  async getRootFolders(): Promise<RadarrRootFolder[]> {
    this.logger.log('Getting Radarr root folders')

    try {
      const folders = await this.get<RadarrRootFolder[]>('/rootfolder')

      this.logger.log(
        { folderCount: folders.length },
        'Root folders retrieved successfully',
      )

      return folders
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get root folders',
      )
      throw error
    }
  }

  /**
   * Add a movie to Radarr
   */
  async addMovie(movieData: AddMovieRequest): Promise<AddMovieResponse> {
    this.logger.log(
      { tmdbId: movieData.tmdbId, title: movieData.title },
      'Adding movie to Radarr',
    )

    try {
      const movie = await this.post<AddMovieResponse>('/movie', movieData)

      this.logger.log(
        { movieId: movie.id, title: movie.title, monitored: movie.monitored },
        'Movie added successfully to Radarr',
      )

      return movie
    } catch (error) {
      this.logger.error(
        {
          tmdbId: movieData.tmdbId,
          title: movieData.title,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to add movie to Radarr',
      )
      throw error
    }
  }

  /**
   * Get a specific movie from Radarr by ID
   */
  async getMovie(movieId: number): Promise<RadarrMovie> {
    this.logger.log({ movieId }, 'Getting movie from Radarr')

    try {
      const movie = await this.get<RadarrMovie>(`/movie/${movieId}`)

      this.logger.log(
        { movieId, title: movie.title, hasFile: movie.hasFile },
        'Movie retrieved successfully from Radarr',
      )

      return movie
    } catch (error) {
      this.logger.error(
        {
          movieId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get movie from Radarr',
      )
      throw error
    }
  }

  /**
   * Trigger a movie search command
   */
  async triggerMovieSearch(movieId: number): Promise<RadarrCommandResponse> {
    const commandRequest: RadarrCommandRequest = {
      name: 'MoviesSearch',
      movieIds: [movieId],
    }

    this.logger.log({ movieId }, 'Triggering movie search in Radarr')

    try {
      const command = await this.post<RadarrCommandResponse>(
        '/command',
        commandRequest,
      )

      this.logger.log(
        { movieId, commandId: command.id, commandName: command.name },
        'Movie search command triggered successfully',
      )

      return command
    } catch (error) {
      this.logger.error(
        {
          movieId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to trigger movie search',
      )
      throw error
    }
  }

  /**
   * Check if a movie is already in Radarr by TMDB ID
   */
  async isMovieInLibrary(tmdbId: number): Promise<RadarrMovie | null> {
    this.logger.log({ tmdbId }, 'Checking if movie is in Radarr library')

    try {
      const movies = await this.get<RadarrMovie[]>('/movie')
      const existingMovie = movies.find(movie => movie.tmdbId === tmdbId)

      if (existingMovie) {
        this.logger.log(
          { tmdbId, movieId: existingMovie.id, title: existingMovie.title },
          'Movie found in Radarr library',
        )
        return existingMovie
      } else {
        this.logger.log({ tmdbId }, 'Movie not found in Radarr library')
        return null
      }
    } catch (error) {
      this.logger.error(
        {
          tmdbId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to check if movie is in library',
      )
      throw error
    }
  }

  /**
   * Get all movies from Radarr library
   */
  async getAllMovies(): Promise<RadarrMovie[]> {
    this.logger.log('Getting all movies from Radarr library')

    try {
      const movies = await this.get<RadarrMovie[]>('/movie')

      this.logger.log(
        { movieCount: movies.length },
        'All movies retrieved successfully from Radarr',
      )

      return movies
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get all movies from Radarr',
      )
      throw error
    }
  }

  /**
   * Delete a movie from Radarr
   */
  async deleteMovie(
    movieId: number,
    options: DeleteMovieOptions = {},
  ): Promise<void> {
    this.logger.log(
      { movieId, deleteFiles: options.deleteFiles },
      'Deleting movie from Radarr',
    )

    try {
      const queryParams = new URLSearchParams()
      if (options.deleteFiles !== undefined) {
        queryParams.set('deleteFiles', options.deleteFiles.toString())
      }

      const queryString = queryParams.toString()
      const endpoint = queryString
        ? `/movie/${movieId}?${queryString}`
        : `/movie/${movieId}`

      await this.delete<void>(endpoint)

      this.logger.log(
        { movieId, deleteFiles: options.deleteFiles },
        'Movie deleted successfully from Radarr',
      )
    } catch (error) {
      this.logger.error(
        {
          movieId,
          deleteFiles: options.deleteFiles,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to delete movie from Radarr',
      )
      throw error
    }
  }

  /**
   * Get all queue items from Radarr
   */
  async getAllQueueItems(
    options: {
      page?: number
      pageSize?: number
      sortKey?: string
      sortDirection?: 'ascending' | 'descending'
      includeUnknownMovieItems?: boolean
      includeMovie?: boolean
    } = {},
  ): Promise<RadarrQueueItem[]> {
    this.logger.log({ options }, 'Getting all queue items from Radarr')

    try {
      const queryParams = new URLSearchParams()

      if (options.page !== undefined) {
        queryParams.set('page', options.page.toString())
      }
      if (options.pageSize !== undefined) {
        queryParams.set('pageSize', options.pageSize.toString())
      }
      if (options.sortKey) {
        queryParams.set('sortKey', options.sortKey)
      }
      if (options.sortDirection) {
        queryParams.set('sortDirection', options.sortDirection)
      }
      if (options.includeUnknownMovieItems !== undefined) {
        queryParams.set(
          'includeUnknownMovieItems',
          options.includeUnknownMovieItems.toString(),
        )
      }
      if (options.includeMovie !== undefined) {
        queryParams.set('includeMovie', options.includeMovie.toString())
      }

      const queryString = queryParams.toString()
      const endpoint = queryString ? `/queue?${queryString}` : '/queue'

      const paginatedResponse =
        await this.get<RadarrQueuePaginatedResponse>(endpoint)

      // Validate response structure
      if (
        !paginatedResponse.records ||
        !Array.isArray(paginatedResponse.records)
      ) {
        throw new Error(
          'Invalid queue response: missing or invalid records array',
        )
      }

      this.logger.log(
        {
          queueItemCount: paginatedResponse.records.length,
          totalRecords: paginatedResponse.totalRecords,
          page: paginatedResponse.page,
          pageSize: paginatedResponse.pageSize,
          options,
        },
        'All queue items retrieved successfully from Radarr',
      )

      return paginatedResponse.records
    } catch (error) {
      this.logger.error(
        {
          options,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get all queue items from Radarr',
      )
      throw error
    }
  }

  /**
   * Get queue items for a specific movie
   */
  async getQueueItemsForMovie(movieId: number): Promise<RadarrQueueItem[]> {
    this.logger.log({ movieId }, 'Getting queue items for movie from Radarr')

    try {
      const queryParams = new URLSearchParams({
        movieId: movieId.toString(),
        includeMovie: 'false',
      })

      const queueItems = await this.get<RadarrQueueItem[]>(
        `/queue/details?${queryParams}`,
      )

      this.logger.log(
        { movieId, queueItemCount: queueItems.length },
        'Queue items retrieved successfully from Radarr',
      )

      return queueItems
    } catch (error) {
      this.logger.error(
        {
          movieId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get queue items for movie from Radarr',
      )
      throw error
    }
  }

  /**
   * Cancel a specific queue item
   */
  async cancelQueueItem(
    queueId: number,
    options: {
      removeFromClient?: boolean
      blocklist?: boolean
    } = {},
  ): Promise<void> {
    this.logger.log({ queueId, options }, 'Cancelling queue item from Radarr')

    try {
      const queryParams = new URLSearchParams()
      if (options.removeFromClient !== undefined) {
        queryParams.set('removeFromClient', options.removeFromClient.toString())
      }
      if (options.blocklist !== undefined) {
        queryParams.set('blocklist', options.blocklist.toString())
      }

      const queryString = queryParams.toString()
      const endpoint = queryString
        ? `/queue/${queueId}?${queryString}`
        : `/queue/${queueId}`

      await this.delete<void>(endpoint)

      this.logger.log(
        { queueId, options },
        'Queue item cancelled successfully from Radarr',
      )
    } catch (error) {
      this.logger.error(
        {
          queueId,
          options,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to cancel queue item from Radarr',
      )
      throw error
    }
  }

  /**
   * Cancel all queue items for a specific movie
   * Returns the number of items that were successfully cancelled
   */
  async cancelAllQueueItemsForMovie(movieId: number): Promise<number> {
    this.logger.log(
      { movieId },
      'Cancelling all queue items for movie from Radarr',
    )

    try {
      const queueItems = await this.getQueueItemsForMovie(movieId)

      if (queueItems.length === 0) {
        this.logger.log(
          { movieId },
          'No queue items found for movie, nothing to cancel',
        )
        return 0
      }

      let cancelledCount = 0
      const cancellationPromises = queueItems.map(async item => {
        try {
          await this.cancelQueueItem(item.id, { removeFromClient: true })
          cancelledCount++
        } catch (error) {
          this.logger.warn(
            {
              movieId,
              queueId: item.id,
              title: item.title,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            'Failed to cancel individual queue item',
          )
        }
      })

      await Promise.allSettled(cancellationPromises)

      this.logger.log(
        {
          movieId,
          totalItems: queueItems.length,
          cancelledCount,
        },
        'Queue item cancellation completed for movie',
      )

      return cancelledCount
    } catch (error) {
      this.logger.error(
        {
          movieId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to cancel queue items for movie',
      )
      throw error
    }
  }
}
