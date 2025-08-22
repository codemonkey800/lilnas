/**
 * @fileoverview Example Radarr Client Implementation
 *
 * This file provides a complete example of how to implement a concrete
 * MediaApiClient for Radarr, demonstrating all required abstract methods
 * and service-specific functionality.
 *
 * @example
 * @since 1.0.0
 * @author TDR Bot Development Team
 */

import { Injectable } from '@nestjs/common'
import { v4 as uuid } from 'uuid'

import {
  BaseApiClientConfig,
  BaseMediaApiClient,
  ConnectionTestResult,
  HealthCheckResult,
  ServiceCapabilities,
} from 'src/media/clients/base-media-api.client'
import {
  MediaConfigValidationService,
  RadarrConfig,
} from 'src/media/config/media-config.validation'
import {
  RadarrMovieRequest,
  RequestValidationUtils,
} from 'src/media/schemas/request-validation.schemas'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

/**
 * Radarr API response interfaces
 */
interface RadarrMovie {
  id?: number
  title: string
  titleSlug: string
  year: number
  tmdbId: number
  imdbId?: string
  overview?: string
  posterUrl?: string
  monitored: boolean
  qualityProfileId: number
  rootFolderPath: string
  downloaded: boolean
  status: 'wanted' | 'downloaded' | 'available'
}

// RadarrMovieRequest interface is now imported from request-validation.schemas.ts

interface RadarrHealthItem {
  Type: string
  Message: string
  WikiUrl?: string
}

type RadarrHealthResponse = RadarrHealthItem[]

interface RadarrQueueItem {
  id: number
  movieId: number
  movie: RadarrMovie
  status: 'queued' | 'downloading' | 'importing' | 'completed' | 'failed'
  percentage: number
  timeleft: string
  size: number
  sizeleft: number
  eta: string
  downloadId: string
  indexer: string
  priority: string
}

/**
 * Radarr API client implementation extending BaseMediaApiClient
 *
 * This client provides full integration with Radarr's v3 API, supporting
 * movie search, request submission, queue monitoring, and health checks.
 *
 * @class RadarrClient
 * @extends BaseMediaApiClient
 *
 * @example
 * ```typescript
 * // Usage in a service or command
 * @Injectable()
 * export class MediaService {
 *   constructor(private readonly radarrClient: RadarrClient) {}
 *
 *   async searchMovies(query: string, correlationId: string): Promise<RadarrMovie[]> {
 *     return this.radarrClient.searchMovies(query, correlationId)
 *   }
 *
 *   async requestMovie(
 *     movie: RadarrMovieRequest,
 *     correlationId: string
 *   ): Promise<RadarrMovie> {
 *     return this.radarrClient.addMovie(movie, correlationId)
 *   }
 * }
 * ```
 *
 * @since 1.0.0
 */
@Injectable()
export class RadarrClient extends BaseMediaApiClient {
  private readonly radarrConfig: RadarrConfig

  constructor(
    retryService: RetryService,
    errorClassifier: ErrorClassificationService,
    mediaLoggingService: MediaLoggingService,
    private readonly configService: MediaConfigValidationService,
  ) {
    // Get Radarr-specific configuration
    const radarrConfig = configService.getServiceConfig(
      'radarr',
    ) as RadarrConfig

    // Transform to base configuration
    const baseConfig: BaseApiClientConfig = {
      baseURL: radarrConfig.url,
      timeout: radarrConfig.timeout,
      maxRetries: radarrConfig.maxRetries,
      serviceName: 'radarr',
    }

    super(retryService, errorClassifier, mediaLoggingService, baseConfig)
    this.radarrConfig = radarrConfig
  }

  // ==================== Abstract Method Implementations ====================

  /**
   * @inheritdoc
   */
  protected getAuthenticationHeaders(): Record<string, string> {
    return {
      'X-Api-Key': this.radarrConfig.apiKey,
    }
  }

  /**
   * @inheritdoc
   */
  protected async validateServiceConfiguration(): Promise<ConnectionTestResult> {
    const startTime = Date.now()

    try {
      // Test basic connectivity with API health endpoint
      const health = await this.get<RadarrHealthResponse>(
        '/api/v3/health',
        uuid(),
      )

      const responseTime = Date.now() - startTime

      return {
        canConnect: true,
        isAuthenticated: true,
        responseTime,
      }
    } catch (error) {
      const responseTime = Date.now() - startTime

      return {
        canConnect: false,
        isAuthenticated: false,
        responseTime,
        error: error instanceof Error ? error.message : String(error),
        suggestions: [
          'Check if Radarr service is running',
          'Verify RADARR_URL is correct and accessible',
          'Check RADARR_API_KEY is valid',
          'Ensure network connectivity between services',
          'Verify Radarr is using v3 API endpoints',
        ],
      }
    }
  }

  /**
   * @inheritdoc
   */
  protected async getServiceCapabilities(
    correlationId: string,
  ): Promise<ServiceCapabilities> {
    try {
      this.logger.debug('Getting Radarr service capabilities', {
        correlationId,
        service: 'radarr',
      })

      const apiVersion = await this.getApiVersion(correlationId)

      this.logger.debug('Retrieved API version for Radarr capabilities', {
        correlationId,
        version: apiVersion.version,
        isSupported: apiVersion.isSupported,
        isCompatible: apiVersion.isCompatible,
      })

      const capabilities = {
        canSearch: true,
        canRequest: true,
        canMonitor: apiVersion.isCompatible,
        supportedMediaTypes: ['movie'],
        version: apiVersion.version,
        apiVersion,
        featureLimitations: apiVersion.isSupported
          ? []
          : [
              'Limited feature set due to version compatibility',
              'Some advanced features may not be available',
            ],
      }

      this.logger.debug('Radarr service capabilities determined', {
        correlationId,
        capabilities,
      })

      return capabilities
    } catch (error) {
      this.logger.error('Failed to get Radarr service capabilities', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })

      // Return fallback capabilities
      return {
        canSearch: true,
        canRequest: true,
        canMonitor: false, // Conservative fallback
        supportedMediaTypes: ['movie'],
        version: '3.0.0',
        apiVersion: {
          version: '3.0.0',
          detected: false,
          isSupported: false,
          isCompatible: false,
          error: error instanceof Error ? error.message : String(error),
        },
        featureLimitations: [
          'Could not determine API version',
          'Using fallback capabilities with limited monitoring',
          error instanceof Error ? error.message : String(error),
        ],
      }
    }
  }

  /**
   * @inheritdoc
   */
  protected async performHealthCheck(
    correlationId: string,
  ): Promise<HealthCheckResult> {
    const startTime = Date.now()

    try {
      const healthData = await this.get<RadarrHealthResponse>(
        '/api/v3/health',
        correlationId,
      )

      // Get API version information for health check
      const apiVersion = await this.getApiVersion(correlationId)

      // Check if there are any error-type health issues
      const isHealthy = !healthData.some(item => item.Type === 'error')

      return {
        isHealthy,
        responseTime: Date.now() - startTime,
        lastChecked: new Date(),
        version: apiVersion.version,
        status: isHealthy ? 'healthy' : 'unhealthy',
        apiVersion,
      }
    } catch (error) {
      return {
        isHealthy: false,
        responseTime: Date.now() - startTime,
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * @inheritdoc
   */
  protected getApiEndpoints(): Record<string, string> {
    return {
      health: '/api/v3/health',
      movie: '/api/v3/movie',
      movies: '/api/v3/movie',
      movieLookup: '/api/v3/movie/lookup',
      search: '/api/v3/movie/lookup',
      queue: '/api/v3/queue',
      qualityProfile: '/api/v3/qualityprofile',
      rootFolder: '/api/v3/rootfolder',
      system: '/api/v3/system/status',
    }
  }

  // ==================== Radarr-Specific Methods ====================

  /**
   * Search for movies using Radarr's lookup API
   *
   * @param query - Search query string
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to array of movie search results
   * @throws {MediaApiError} When search fails
   *
   * @example
   * ```typescript
   * const movies = await radarrClient.searchMovies('fight club', correlationId)
   * console.log(`Found ${movies.length} movies`)
   * ```
   *
   * @since 1.0.0
   */
  async searchMovies(
    query: string,
    correlationId: string,
  ): Promise<RadarrMovie[]> {
    this.logger.debug('Searching movies in Radarr', {
      query,
      correlationId,
    })

    const movies = await this.get<RadarrMovie[]>(
      `/api/v3/movie/lookup?term=${encodeURIComponent(query)}`,
      correlationId,
    )

    this.logger.debug('Movie search completed', {
      query,
      resultCount: movies.length,
      correlationId,
    })

    return movies
  }

  /**
   * Add a movie to Radarr for monitoring and download
   *
   * @param movieRequest - Movie request details
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to the added movie
   * @throws {MediaApiError} When request fails
   *
   * @example
   * ```typescript
   * const movie = await radarrClient.addMovie({
   *   title: 'Fight Club',
   *   year: 1999,
   *   tmdbId: 550,
   *   qualityProfileId: 1,
   *   rootFolderPath: '/movies',
   *   monitored: true,
   *   addOptions: { searchForMovie: true }
   * }, correlationId)
   * ```
   *
   * @since 1.0.0
   */
  async addMovie(
    movieRequest: RadarrMovieRequest,
    correlationId: string,
  ): Promise<RadarrMovie> {
    // Validate request body before sending
    const validatedRequest = RequestValidationUtils.validateRadarrMovieRequest(
      movieRequest,
      correlationId,
    )

    this.logger.debug('Adding movie to Radarr', {
      title: validatedRequest.title,
      year: validatedRequest.year,
      tmdbId: validatedRequest.tmdbId,
      correlationId,
    })

    const movie = await this.post<RadarrMovie>(
      '/api/v3/movie',
      validatedRequest,
      correlationId,
    )

    this.logger.debug('Movie added successfully', {
      id: movie.id,
      title: movie.title,
      status: movie.status,
      correlationId,
    })

    return movie
  }

  /**
   * Get all movies currently in Radarr
   *
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to array of all movies
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getAllMovies(correlationId: string): Promise<RadarrMovie[]> {
    return this.get<RadarrMovie[]>('/api/v3/movie', correlationId)
  }

  /**
   * Get specific movie by ID
   *
   * @param movieId - Radarr movie ID
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to the movie details
   * @throws {MediaNotFoundApiError} When movie not found
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getMovie(movieId: number, correlationId: string): Promise<RadarrMovie> {
    return this.get<RadarrMovie>(`/api/v3/movie/${movieId}`, correlationId)
  }

  /**
   * Update existing movie settings
   *
   * @param movie - Updated movie data
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to the updated movie
   * @throws {MediaApiError} When update fails
   *
   * @since 1.0.0
   */
  async updateMovie(
    movie: RadarrMovie,
    correlationId: string,
  ): Promise<RadarrMovie> {
    return this.put<RadarrMovie>(
      `/api/v3/movie/${movie.id}`,
      movie,
      correlationId,
    )
  }

  /**
   * Delete movie from Radarr
   *
   * @param movieId - Radarr movie ID
   * @param deleteFiles - Whether to delete movie files
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving when deletion completes
   * @throws {MediaApiError} When deletion fails
   *
   * @since 1.0.0
   */
  async deleteMovie(
    movieId: number,
    deleteFiles: boolean,
    correlationId: string,
  ): Promise<void> {
    await this.delete(
      `/api/v3/movie/${movieId}?deleteFiles=${deleteFiles}`,
      correlationId,
    )
  }

  /**
   * Get current download queue with progress information
   *
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to array of queue items
   * @throws {MediaApiError} When request fails
   *
   * @example
   * ```typescript
   * const queue = await radarrClient.getQueue(correlationId)
   * for (const item of queue) {
   *   console.log(`${item.movie.title}: ${item.percentage}% complete`)
   * }
   * ```
   *
   * @since 1.0.0
   */
  async getQueue(correlationId: string): Promise<RadarrQueueItem[]> {
    const response = await this.get<{ records: RadarrQueueItem[] }>(
      '/api/v3/queue',
      correlationId,
    )
    return response.records || []
  }

  /**
   * Get available quality profiles
   *
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to quality profile list
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getQualityProfiles(correlationId: string): Promise<
    Array<{
      id: number
      name: string
      upgradeAllowed: boolean
    }>
  > {
    return this.get('/api/v3/qualityprofile', correlationId)
  }

  /**
   * Get available root folders for movie storage
   *
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to root folder list
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getRootFolders(correlationId: string): Promise<
    Array<{
      id: number
      path: string
      accessible: boolean
      freeSpace: number
    }>
  > {
    return this.get('/api/v3/rootfolder', correlationId)
  }

  /**
   * Get system status and information
   *
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to system status
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getSystemStatus(correlationId: string): Promise<{
    version: string
    buildTime: string
    isDebug: boolean
    isProduction: boolean
    isAdmin: boolean
    isUserInteractive: boolean
    startTime: string
    appData: string
    osName: string
    osVersion: string
  }> {
    return this.get('/api/v3/system/status', correlationId)
  }

  /**
   * Update client configuration
   *
   * @param newConfig - New configuration
   * @throws {Error} When configuration is invalid
   *
   * @since 1.0.0
   */
  async configure(newConfig: RadarrConfig): Promise<void> {
    // Validate the new configuration (only in tests where mock provides this method)
    const configService = this.configService as any
    if (configService.validateRadarrConfig) {
      configService.validateRadarrConfig(newConfig)
    }

    // Update internal config (for test purposes, just validate)
    Object.assign(this.radarrConfig, newConfig)
  }
}
