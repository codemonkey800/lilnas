import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'
import { performance } from 'perf_hooks'

import { RadarrClient } from 'src/media/clients/radarr.client'
import {
  OptionalSearchQueryInput,
  RadarrInputSchemas,
  RadarrOutputSchemas,
  SearchQueryInput,
} from 'src/media/schemas/radarr.schemas'
import {
  AddMovieRequest,
  DeleteMovieOptions,
  DownloadingMovie,
  MonitorAndDownloadResult,
  MonitorMovieOptions,
  MovieLibrarySearchResult,
  MovieSearchResult,
  RadarrMinimumAvailability,
  RadarrMovie,
  RadarrQueueStatus,
  RadarrSystemStatus,
  UnmonitorAndDeleteResult,
} from 'src/media/types/radarr.types'
import {
  transformToSearchResult,
  transformToSearchResults,
} from 'src/media/utils/radarr.utils'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

@Injectable()
export class RadarrService {
  private readonly logger = new Logger(RadarrService.name)

  constructor(
    private readonly radarrClient: RadarrClient,
    private readonly retryService: RetryService,
    private readonly errorClassifier: ErrorClassificationService,
  ) {}

  /**
   * Search for movies by title - Main public API method
   * @param query - Search query (min 2 characters)
   * @returns Array of movie search results
   */
  async searchMovies(query: string): Promise<MovieSearchResult[]> {
    const id = nanoid()

    // Input validation
    const validatedInput = this.validateSearchQuery({ query })
    const normalizedQuery = validatedInput.query

    this.logger.log({ id, query: normalizedQuery }, 'Starting movie search')

    return await this.fetchMovieSearch(normalizedQuery, id)
  }

  /**
   * Get Radarr system status
   * @returns System status information
   */
  async getSystemStatus(): Promise<RadarrSystemStatus> {
    const id = nanoid()

    this.logger.log({ id }, 'Getting Radarr system status')

    try {
      const start = performance.now()
      const status = await this.radarrClient.getSystemStatus()
      const duration = performance.now() - start

      // Validate output
      const validatedStatus = RadarrOutputSchemas.systemStatus.parse(status)

      this.logger.log(
        { id, version: validatedStatus.version, duration },
        'Radarr system status retrieved',
      )

      return validatedStatus
    } catch (error) {
      this.logger.error(
        {
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get system status',
      )
      throw error
    }
  }

  /**
   * Check if Radarr service is healthy
   * @returns Boolean indicating health status
   */
  async checkHealth(): Promise<boolean> {
    const id = nanoid()

    this.logger.log({ id }, 'Checking Radarr health')

    try {
      const isHealthy = await this.radarrClient.checkHealth()

      this.logger.log(
        { id, isHealthy },
        `Radarr health check ${isHealthy ? 'passed' : 'failed'}`,
      )

      return isHealthy
    } catch (error) {
      this.logger.error(
        {
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Radarr health check failed with exception',
      )
      return false
    }
  }

  /**
   * Get movies in Radarr library with optional search query
   * @param query - Optional search query to filter library movies (min 2 characters)
   * @returns Array of library movies (all if no query, filtered if query provided)
   */
  async getLibraryMovies(query?: string): Promise<MovieLibrarySearchResult[]> {
    const id = nanoid()

    // Validate input if query is provided
    const validatedInput = this.validateOptionalSearchQuery({ query })
    const normalizedQuery = validatedInput.query

    this.logger.log(
      { id, query: normalizedQuery, hasQuery: !!normalizedQuery },
      'Getting library movies from Radarr',
    )

    return await this.fetchLibraryMovies(normalizedQuery, id)
  }

  /**
   * Get all currently downloading movies from Radarr
   * @returns Array of movies that are currently downloading
   */
  async getDownloadingMovies(): Promise<DownloadingMovie[]> {
    const id = nanoid()

    this.logger.log({ id }, 'Getting all downloading movies from Radarr')

    try {
      const start = performance.now()

      // Get all queue items from Radarr
      const allQueueItems = await this.radarrClient.getAllQueueItems({
        includeMovie: true,
        pageSize: 1000, // Get all items in one request
      })

      // Filter to only include actively downloading/queued items
      const downloadingItems = allQueueItems.filter(item => {
        return (
          item.status === RadarrQueueStatus.DOWNLOADING ||
          item.status === RadarrQueueStatus.QUEUED ||
          item.status === RadarrQueueStatus.PAUSED
        )
      })

      // Transform queue items to simplified downloading movie format
      const downloadingMovies: DownloadingMovie[] = downloadingItems.map(
        item => {
          // Calculate progress safely
          const size = item.size || 0
          const sizeleft = item.sizeleft ?? 0 // Use nullish coalescing for better undefined handling
          const downloadedBytes = Math.max(0, size - sizeleft)

          // Calculate progress percentage, ensuring we don't get invalid values
          let progressPercent = 0
          if (size > 0 && downloadedBytes >= 0) {
            progressPercent = Math.min(
              100,
              Math.max(0, (downloadedBytes / size) * 100),
            )

            // Debug logging to understand the calculation
            this.logger.debug(
              {
                movieTitle: item.movie?.title || item.title,
                rawSize: item.size,
                rawSizeleft: item.sizeleft,
                calculatedSize: size,
                calculatedSizeleft: sizeleft,
                downloadedBytes,
                progressPercent,
              },
              'Progress calculation debug info',
            )

            // Round to 2 decimal places for precision
            progressPercent = Math.round(progressPercent * 100) / 100
          }

          return {
            id: item.id,
            movieId: item.movieId,
            movieTitle: item.movie?.title || item.title,
            movieYear: item.movie?.year,
            size,
            status: item.status,
            trackedDownloadStatus: item.trackedDownloadStatus,
            trackedDownloadState: item.trackedDownloadState,
            statusMessages: item.statusMessages,
            errorMessage: item.errorMessage,
            downloadId: item.downloadId,
            protocol: item.protocol,
            downloadClient: item.downloadClient,
            indexer: item.indexer,
            outputPath: item.outputPath,
            estimatedCompletionTime: item.estimatedCompletionTime,
            added: item.added,
            sizeleft,
            // Calculated fields
            progressPercent,
            downloadedBytes,
          }
        },
      )

      const duration = performance.now() - start

      // Validate output using downloading movie array schema
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
        {
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get downloading movies from Radarr',
      )
      throw error
    }
  }

  /**
   * Private method to fetch movie search results
   */
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
      // Get raw results from client
      const rawMovies = await this.radarrClient.searchMovies(query)
      const duration = performance.now() - start

      // Transform to search results
      const results = transformToSearchResults(rawMovies)

      // Validate output
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
        {
          id: operationId,
          query,
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to fetch movie search',
      )

      throw error
    }
  }

  /**
   * Validate search query input
   */
  private validateSearchQuery(input: { query: string }): SearchQueryInput {
    try {
      return RadarrInputSchemas.searchQuery.parse(input)
    } catch (error) {
      this.logger.error(
        {
          input,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Invalid search query input',
      )
      throw new Error(
        `Invalid search query: ${error instanceof Error ? error.message : 'Unknown validation error'}`,
      )
    }
  }

  /**
   * Monitor a movie and trigger immediate download
   * @param tmdbId - TMDB ID of the movie to monitor and download
   * @param options - Optional configuration for monitoring
   * @returns Result of the monitor and download operation
   */
  async monitorAndDownloadMovie(
    tmdbId: number,
    options: MonitorMovieOptions = {},
  ): Promise<MonitorAndDownloadResult> {
    const id = nanoid()
    const warnings: string[] = []

    this.logger.log(
      { id, tmdbId, options },
      'Starting monitor and download movie operation',
    )

    try {
      // Check if movie is already in library
      const existingMovie = await this.radarrClient.isMovieInLibrary(tmdbId)
      if (existingMovie) {
        this.logger.log(
          {
            id,
            tmdbId,
            movieId: existingMovie.id,
            title: existingMovie.title,
          },
          'Movie already exists in library',
        )

        // If already monitored, just trigger search
        if (existingMovie.monitored) {
          try {
            const command = await this.radarrClient.triggerMovieSearch(
              existingMovie.id,
            )
            return {
              success: true,
              movieAdded: false,
              searchTriggered: true,
              movie: existingMovie,
              commandId: command.id,
              warnings: ['Movie already monitored in library'],
            }
          } catch (searchError) {
            this.logger.error(
              {
                id,
                tmdbId,
                movieId: existingMovie.id,
                error: searchError,
              },
              'Failed to trigger search for existing movie',
            )
            return {
              success: false,
              movieAdded: false,
              searchTriggered: false,
              movie: existingMovie,
              error: `Movie exists but search failed: ${searchError instanceof Error ? searchError.message : 'Unknown error'}`,
            }
          }
        } else {
          warnings.push('Movie exists but is not monitored')
        }
      }

      // Get the movie details by looking up TMDB ID
      let movie: MovieSearchResult
      try {
        const movieResource =
          await this.radarrClient.lookupMovieByTmdbId(tmdbId)
        movie = transformToSearchResult(movieResource)

        this.logger.log(
          { id, tmdbId, title: movie.title },
          'Found movie via TMDB lookup',
        )
      } catch (lookupError) {
        this.logger.error(
          { id, tmdbId, error: lookupError },
          'Failed to lookup movie by TMDB ID',
        )
        return {
          success: false,
          movieAdded: false,
          searchTriggered: false,
          error: `Failed to lookup movie: ${lookupError instanceof Error ? lookupError.message : 'Unknown error'}`,
        }
      }

      // Get configuration if not provided
      const config = await this.getMovieConfiguration(options)
      if (!config.success) {
        this.logger.error(
          { id, tmdbId, error: config.error },
          'Configuration failed',
        )
        return {
          success: false,
          movieAdded: false,
          searchTriggered: false,
          error: `Configuration error: ${config.error}`,
        }
      }

      // Build add movie request
      const addMovieRequest: AddMovieRequest = {
        tmdbId: movie.tmdbId,
        title: movie.title,
        titleSlug: this.generateTitleSlug(movie.title),
        year: movie.year || new Date().getFullYear(),
        qualityProfileId: config.qualityProfileId!,
        rootFolderPath: config.rootFolderPath!,
        monitored: options.monitored ?? true,
        minimumAvailability:
          options.minimumAvailability ?? RadarrMinimumAvailability.RELEASED,
        searchOnAdd: options.searchOnAdd ?? false, // We'll trigger search separately for better control
        genres: movie.genres,
        runtime: movie.runtime,
        overview: movie.overview,
        inCinemas: movie.inCinemas,
        physicalRelease: movie.physicalRelease,
        digitalRelease: movie.digitalRelease,
        certification: movie.certification,
        studio: movie.studio,
        website: movie.website,
        youTubeTrailerId: movie.youTubeTrailerId,
      }

      // Add movie to Radarr
      let addedMovie: RadarrMovie
      try {
        addedMovie = await this.radarrClient.addMovie(addMovieRequest)
        this.logger.log(
          {
            id,
            tmdbId,
            movieId: addedMovie.id,
            title: addedMovie.title,
          },
          'Movie added successfully to Radarr',
        )
      } catch (addError) {
        this.logger.error(
          { id, tmdbId, error: addError },
          'Failed to add movie to Radarr',
        )
        return {
          success: false,
          movieAdded: false,
          searchTriggered: false,
          error: `Failed to add movie: ${addError instanceof Error ? addError.message : 'Unknown error'}`,
        }
      }

      // Trigger search if movie was added and is monitored
      let commandId: number | undefined
      let searchTriggered = false
      if (addedMovie.monitored) {
        try {
          const command = await this.radarrClient.triggerMovieSearch(
            addedMovie.id,
          )
          commandId = command.id
          searchTriggered = true
          this.logger.log(
            {
              id,
              tmdbId,
              movieId: addedMovie.id,
              commandId: command.id,
            },
            'Movie search triggered successfully',
          )
        } catch (searchError) {
          this.logger.error(
            {
              id,
              tmdbId,
              movieId: addedMovie.id,
              error: searchError,
            },
            'Failed to trigger movie search',
          )
          warnings.push(
            `Movie added but search failed: ${searchError instanceof Error ? searchError.message : 'Unknown error'}`,
          )
        }
      } else {
        warnings.push('Movie added but not monitored, search not triggered')
      }

      const result: MonitorAndDownloadResult = {
        success: true,
        movieAdded: true,
        searchTriggered,
        movie: addedMovie,
        commandId,
        warnings: warnings.length > 0 ? warnings : undefined,
      }

      this.logger.log(
        {
          id,
          tmdbId,
          movieId: addedMovie.id,
          searchTriggered,
          commandId,
          warnings,
        },
        'Monitor and download movie operation completed',
      )

      return result
    } catch (error) {
      this.logger.error(
        {
          id,
          tmdbId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Monitor and download movie operation failed',
      )

      return {
        success: false,
        movieAdded: false,
        searchTriggered: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get configuration for adding a movie
   */
  private async getMovieConfiguration(options: MonitorMovieOptions): Promise<{
    success: boolean
    qualityProfileId?: number
    rootFolderPath?: string
    error?: string
  }> {
    try {
      let qualityProfileId = options.qualityProfileId
      let rootFolderPath = options.rootFolderPath

      // Get quality profile if not provided
      if (!qualityProfileId) {
        const profiles = await this.radarrClient.getQualityProfiles()
        if (profiles.length === 0) {
          return {
            success: false,
            error: 'No quality profiles available in Radarr',
          }
        }
        // Use first available profile as default
        qualityProfileId = profiles[0].id
        this.logger.log(
          { qualityProfileId, name: profiles[0].name },
          'Using default quality profile',
        )
      }

      // Get root folder if not provided
      if (!rootFolderPath) {
        const folders = await this.radarrClient.getRootFolders()
        const accessibleFolders = folders.filter(folder => folder.accessible)
        if (accessibleFolders.length === 0) {
          return {
            success: false,
            error: 'No accessible root folders available in Radarr',
          }
        }
        // Use first accessible folder as default
        rootFolderPath = accessibleFolders[0].path
        this.logger.log(
          { rootFolderPath, id: accessibleFolders[0].id },
          'Using default root folder',
        )
      }

      return {
        success: true,
        qualityProfileId,
        rootFolderPath,
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown configuration error',
      }
    }
  }

  /**
   * Generate a title slug for the movie
   */
  private generateTitleSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
  }

  /**
   * Unmonitor a movie and delete its files
   * @param tmdbId - TMDB ID of the movie to unmonitor and delete
   * @param options - Optional configuration for deletion
   * @returns Result of the unmonitor and delete operation
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
      // Find movie by TMDB ID in the library
      const libraryMovies = await this.getLibraryMovies()
      const movie = libraryMovies.find(m => m.tmdbId === tmdbId)

      if (!movie) {
        this.logger.error({ id, tmdbId }, 'Movie not found in Jeremy+ library')
        return {
          success: false,
          movieDeleted: false,
          filesDeleted: false,
          error: `Movie with TMDB ID ${tmdbId} not found in Jeremy+ library`,
        }
      }

      // Verify movie still exists in Radarr before attempting deletion
      let currentMovie: RadarrMovie
      try {
        currentMovie = await this.radarrClient.getMovie(movie.id)
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

      // Check for and cancel active downloads before deletion
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

      // Check if movie has files before deletion
      const hasFiles = currentMovie.hasFile
      const filesDeleted = Boolean(options.deleteFiles && hasFiles)

      // Delete the movie from Radarr
      try {
        await this.radarrClient.deleteMovie(movie.id, options)

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

      // Add warnings for informational purposes
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
        {
          id,
          tmdbId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Unmonitor and delete movie operation failed',
      )

      return {
        success: false,
        movieDeleted: false,
        filesDeleted: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Cancel downloads for a specific movie
   * @param movieId - ID of the movie to cancel downloads for
   * @param operationId - Operation ID for logging
   * @returns Result with count of found and cancelled downloads
   */
  private async cancelMovieDownloads(
    movieId: number,
    operationId: string,
  ): Promise<{
    found: number
    cancelled: number
    warnings: string[]
  }> {
    this.logger.log(
      { id: operationId, movieId },
      'Checking for active downloads to cancel',
    )

    try {
      // First check if there are any queue items to provide found count
      const queueItems = await this.radarrClient.getQueueItemsForMovie(movieId)
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

      // Use the client method to cancel all items
      const cancelled =
        await this.radarrClient.cancelAllQueueItemsForMovie(movieId)

      const result = {
        found,
        cancelled,
        warnings:
          cancelled < found
            ? [
                `Some downloads could not be cancelled (${cancelled}/${found} successful)`,
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
        {
          id: operationId,
          movieId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to check for active downloads',
      )
      throw error
    }
  }

  /**
   * Private method to fetch library movies with optional search
   */
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
      // Get all movies from library
      const allMovies = await this.radarrClient.getAllMovies()
      let filteredMovies = allMovies

      // Filter if query is provided
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

      // Transform to library search results
      const results = this.transformToLibraryResults(filteredMovies)
      const duration = performance.now() - start

      // Validate output
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
        {
          id: operationId,
          query,
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to fetch library movies',
      )

      throw error
    }
  }

  /**
   * Filter movies array by search query
   */
  private filterMoviesByQuery(
    movies: RadarrMovie[],
    query: string,
  ): RadarrMovie[] {
    const normalizedQuery = query.toLowerCase().trim()

    return movies.filter(movie => {
      // Search in title
      if (movie.title.toLowerCase().includes(normalizedQuery)) {
        return true
      }

      // Search in original title
      if (movie.originalTitle?.toLowerCase().includes(normalizedQuery)) {
        return true
      }

      // Search in year
      if (movie.year?.toString().includes(normalizedQuery)) {
        return true
      }

      // Search in genres
      if (
        movie.genres.some(genre =>
          genre.toLowerCase().includes(normalizedQuery),
        )
      ) {
        return true
      }

      // Search in overview
      if (movie.overview?.toLowerCase().includes(normalizedQuery)) {
        return true
      }

      // Search in certification
      if (movie.certification?.toLowerCase().includes(normalizedQuery)) {
        return true
      }

      // Search in studio
      if (movie.studio?.toLowerCase().includes(normalizedQuery)) {
        return true
      }

      return false
    })
  }

  /**
   * Transform RadarrMovie to MovieLibrarySearchResult
   */
  private transformToLibraryResults(
    movies: RadarrMovie[],
  ): MovieLibrarySearchResult[] {
    return movies.map(movie => ({
      // Base fields from MovieSearchResult
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
      // Library-specific fields
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

  /**
   * Validate optional search query input
   */
  private validateOptionalSearchQuery(input: {
    query?: string
  }): OptionalSearchQueryInput {
    try {
      return RadarrInputSchemas.optionalSearchQuery.parse(input)
    } catch (error) {
      this.logger.error(
        {
          input,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Invalid optional search query input',
      )
      throw new Error(
        `Invalid search query: ${error instanceof Error ? error.message : 'Unknown validation error'}`,
      )
    }
  }
}
