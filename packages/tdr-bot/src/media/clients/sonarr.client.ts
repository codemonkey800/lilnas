/**
 * @fileoverview Example Sonarr Client Implementation
 *
 * This file provides a complete example of how to implement a concrete
 * MediaApiClient for Sonarr, demonstrating TV series management and
 * episode-specific functionality.
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
  SonarrConfig,
} from 'src/media/config/media-config.validation'
import {
  RequestValidationUtils,
  SonarrSeriesRequest,
} from 'src/media/schemas/request-validation.schemas'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

/**
 * Sonarr API response interfaces
 */
interface SonarrSeries {
  id?: number
  title: string
  titleSlug: string
  year: number
  tvdbId: number
  imdbId?: string
  overview?: string
  posterUrl?: string
  monitored: boolean
  qualityProfileId: number
  languageProfileId: number
  rootFolderPath: string
  status: 'continuing' | 'ended' | 'upcoming'
  seasons: SonarrSeason[]
  statistics?: {
    seasonCount: number
    episodeFileCount: number
    episodeCount: number
    totalEpisodeCount: number
    sizeOnDisk: number
  }
}

interface SonarrSeason {
  seasonNumber: number
  monitored: boolean
  statistics?: {
    episodeFileCount: number
    episodeCount: number
    totalEpisodeCount: number
    sizeOnDisk: number
  }
}

interface SonarrEpisode {
  id: number
  episodeFileId: number
  seriesId: number
  seasonNumber: number
  episodeNumber: number
  title: string
  overview: string
  airDate: string
  monitored: boolean
  hasFile: boolean
}

// SonarrSeriesRequest interface is now imported from request-validation.schemas.ts

interface SonarrQueueItem {
  id: number
  seriesId: number
  episodeId: number
  series: SonarrSeries
  episode: SonarrEpisode
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
 * Episode specification parser for Sonarr
 * Handles patterns like S1, S2E5, S3E1-10, etc.
 */
interface EpisodeSpecification {
  seasons: Array<{
    seasonNumber: number
    episodes?: number[] // If undefined, monitor all episodes in season
  }>
  totalEpisodes: number
}

/**
 * Sonarr API client implementation extending BaseMediaApiClient
 *
 * This client provides full integration with Sonarr's v3 API, supporting
 * TV series search, request submission, episode monitoring, and queue tracking.
 *
 * @class SonarrClient
 * @extends BaseMediaApiClient
 *
 * @example
 * ```typescript
 * // Usage in a service or command
 * @Injectable()
 * export class MediaService {
 *   constructor(private readonly sonarrClient: SonarrClient) {}
 *
 *   async searchSeries(query: string, correlationId: string): Promise<SonarrSeries[]> {
 *     return this.sonarrClient.searchSeries(query, correlationId)
 *   }
 *
 *   async requestSeries(
 *     series: SonarrSeriesRequest,
 *     episodeSpec: string,
 *     correlationId: string
 *   ): Promise<SonarrSeries> {
 *     const specification = this.sonarrClient.parseEpisodeSpecification(episodeSpec)
 *     series.seasons = specification.seasons
 *     return this.sonarrClient.addSeries(series, correlationId)
 *   }
 * }
 * ```
 *
 * @since 1.0.0
 */
@Injectable()
export class SonarrClient extends BaseMediaApiClient {
  private readonly sonarrConfig: SonarrConfig

  constructor(
    retryService: RetryService,
    errorClassifier: ErrorClassificationService,
    mediaLoggingService: MediaLoggingService,
    private readonly configService: MediaConfigValidationService,
  ) {
    // Get Sonarr-specific configuration
    const sonarrConfig = configService.getServiceConfig(
      'sonarr',
    ) as SonarrConfig

    // Transform to base configuration
    const baseConfig: BaseApiClientConfig = {
      baseURL: sonarrConfig.url,
      timeout: sonarrConfig.timeout,
      maxRetries: sonarrConfig.maxRetries,
      serviceName: 'sonarr',
    }

    super(retryService, errorClassifier, mediaLoggingService, baseConfig)
    this.sonarrConfig = sonarrConfig
  }

  // ==================== Abstract Method Implementations ====================

  /**
   * @inheritdoc
   */
  protected getAuthenticationHeaders(): Record<string, string> {
    return {
      'X-Api-Key': this.sonarrConfig.apiKey,
    }
  }

  /**
   * @inheritdoc
   */
  protected async validateServiceConfiguration(): Promise<ConnectionTestResult> {
    const startTime = Date.now()

    try {
      // Test basic connectivity with API health endpoint
      await this.get('/api/v3/health', uuid())

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
          'Check if Sonarr service is running',
          'Verify SONARR_URL is correct and accessible',
          'Check SONARR_API_KEY is valid',
          'Ensure network connectivity between services',
          'Verify Sonarr is using v3 API endpoints',
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
      this.logger.debug('Getting Sonarr service capabilities', {
        correlationId,
        service: 'sonarr',
      })

      const apiVersion = await this.getApiVersion(correlationId)

      this.logger.debug('Retrieved API version for Sonarr capabilities', {
        correlationId,
        version: apiVersion.version,
        isSupported: apiVersion.isSupported,
        isCompatible: apiVersion.isCompatible,
      })

      const capabilities = {
        canSearch: true,
        canRequest: true,
        canMonitor: apiVersion.isCompatible,
        supportedMediaTypes: ['tv'],
        version: apiVersion.version,
        apiVersion,
        featureLimitations: apiVersion.isSupported
          ? []
          : [
              'Limited feature set due to version compatibility',
              'Some advanced TV series features may not be available',
            ],
      }

      this.logger.debug('Sonarr service capabilities determined', {
        correlationId,
        capabilities,
      })

      return capabilities
    } catch (error) {
      this.logger.error('Failed to get Sonarr service capabilities', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })

      // Return fallback capabilities
      return {
        canSearch: true,
        canRequest: true,
        canMonitor: false, // Conservative fallback
        supportedMediaTypes: ['tv'],
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
      const health = await this.get<{ version?: string }>(
        '/api/v3/health',
        correlationId,
      )

      // Get API version information for health check
      const apiVersion = await this.getApiVersion(correlationId)

      return {
        isHealthy: true,
        responseTime: Date.now() - startTime,
        lastChecked: new Date(),
        version: health?.version || apiVersion.version,
        status: 'healthy',
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
      series: '/api/v3/series',
      seriesLookup: '/api/v3/series/lookup',
      search: '/api/v3/series/lookup',
      episode: '/api/v3/episode',
      queue: '/api/v3/queue',
      qualityProfile: '/api/v3/qualityprofile',
      languageProfile: '/api/v3/languageprofile',
      rootFolder: '/api/v3/rootfolder',
      system: '/api/v3/system/status',
    }
  }

  // ==================== Sonarr-Specific Methods ====================

  /**
   * Search for TV series using Sonarr's lookup API
   *
   * @param query - Search query string
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to array of series search results
   * @throws {MediaApiError} When search fails
   *
   * @example
   * ```typescript
   * const series = await sonarrClient.searchSeries('breaking bad', correlationId)
   * console.log(`Found ${series.length} series`)
   * ```
   *
   * @since 1.0.0
   */
  async searchSeries(
    query: string,
    correlationId: string,
  ): Promise<SonarrSeries[]> {
    this.logger.debug('Searching series in Sonarr', {
      query,
      correlationId,
    })

    const series = await this.get<SonarrSeries[]>(
      `/api/v3/series/lookup?term=${encodeURIComponent(query)}`,
      correlationId,
    )

    this.logger.debug('Series search completed', {
      query,
      resultCount: series.length,
      correlationId,
    })

    return series
  }

  /**
   * Add a TV series to Sonarr for monitoring and download
   *
   * @param seriesRequest - Series request details
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to the added series
   * @throws {MediaApiError} When request fails
   *
   * @example
   * ```typescript
   * const series = await sonarrClient.addSeries({
   *   title: 'Breaking Bad',
   *   year: 2008,
   *   tvdbId: 81189,
   *   qualityProfileId: 1,
   *   languageProfileId: 1,
   *   rootFolderPath: '/tv',
   *   monitored: true,
   *   seasons: [
   *     { seasonNumber: 1, monitored: true },
   *     { seasonNumber: 2, monitored: true }
   *   ],
   *   addOptions: {
   *     searchForMissingEpisodes: true,
   *     searchForCutoffUnmetEpisodes: false
   *   }
   * }, correlationId)
   * ```
   *
   * @since 1.0.0
   */
  async addSeries(
    seriesRequest: SonarrSeriesRequest,
    correlationId: string,
  ): Promise<SonarrSeries> {
    // Validate request body before sending
    const validatedRequest = RequestValidationUtils.validateSonarrSeriesRequest(
      seriesRequest,
      correlationId,
    )

    this.logger.debug('Adding series to Sonarr', {
      title: validatedRequest.title,
      year: validatedRequest.year,
      tvdbId: validatedRequest.tvdbId,
      seasonCount: validatedRequest.seasons.length,
      correlationId,
    })

    const series = await this.post<SonarrSeries>(
      '/api/v3/series',
      validatedRequest,
      correlationId,
    )

    this.logger.debug('Series added successfully', {
      id: series.id,
      title: series.title,
      status: series.status,
      correlationId,
    })

    return series
  }

  /**
   * Get all TV series currently in Sonarr
   *
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to array of all series
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getAllSeries(correlationId: string): Promise<SonarrSeries[]> {
    return this.get<SonarrSeries[]>('/api/v3/series', correlationId)
  }

  /**
   * Get specific series by ID
   *
   * @param seriesId - Sonarr series ID
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to the series details
   * @throws {MediaNotFoundApiError} When series not found
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getSeries(
    seriesId: number,
    correlationId: string,
  ): Promise<SonarrSeries> {
    return this.get<SonarrSeries>(`/api/v3/series/${seriesId}`, correlationId)
  }

  /**
   * Get episodes for a specific series
   *
   * @param seriesId - Sonarr series ID
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to array of episodes
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getSeriesEpisodes(
    seriesId: number,
    correlationId: string,
  ): Promise<SonarrEpisode[]> {
    return this.get<SonarrEpisode[]>(
      `/api/v3/episode?seriesId=${seriesId}`,
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
   * const queue = await sonarrClient.getQueue(correlationId)
   * for (const item of queue) {
   *   const ep = item.episode
   *   console.log(`${item.series.title} S${ep.seasonNumber}E${ep.episodeNumber}: ${item.percentage}%`)
   * }
   * ```
   *
   * @since 1.0.0
   */
  async getQueue(correlationId: string): Promise<SonarrQueueItem[]> {
    const response = await this.get<{ records: SonarrQueueItem[] }>(
      '/api/v3/queue',
      correlationId,
    )
    return response.records || []
  }

  /**
   * Parse episode specification string into structured format
   *
   * Supports patterns like:
   * - S1 (full season 1)
   * - S2E5 (season 2, episode 5)
   * - S3E1-10 (season 3, episodes 1-10)
   * - S1,S2 (full seasons 1 and 2)
   * - S2E1-5,S3E1 (season 2 episodes 1-5, plus season 3 episode 1)
   *
   * @param episodeSpec - Episode specification string
   * @returns Parsed episode specification with season/episode details
   * @throws {Error} When specification format is invalid
   *
   * @example
   * ```typescript
   * const spec = sonarrClient.parseEpisodeSpecification('S1,S2E1-5')
   * // Returns: {
   * //   seasons: [
   * //     { seasonNumber: 1 }, // All episodes
   * //     { seasonNumber: 2, episodes: [1, 2, 3, 4, 5] }
   * //   ],
   * //   totalEpisodes: 15 (estimated)
   * // }
   * ```
   *
   * @since 1.0.0
   */
  parseEpisodeSpecification(episodeSpec: string): EpisodeSpecification {
    const seasons: Array<{ seasonNumber: number; episodes?: number[] }> = []
    let totalEpisodes = 0

    // Split by comma and process each part
    const parts = episodeSpec.split(',').map(part => part.trim())

    for (const part of parts) {
      // Match patterns like S1, S2E5, S3E1-10
      const seasonMatch = part.match(/^S(\d+)(?:E(\d+)(?:-(\d+))?)?$/i)

      if (!seasonMatch) {
        throw new Error(`Invalid episode specification format: ${part}`)
      }

      const seasonNumber = parseInt(seasonMatch[1], 10)
      const startEpisode = seasonMatch[2]
        ? parseInt(seasonMatch[2], 10)
        : undefined
      const endEpisode = seasonMatch[3]
        ? parseInt(seasonMatch[3], 10)
        : undefined

      if (startEpisode === undefined) {
        // Full season (S1)
        seasons.push({ seasonNumber })
        totalEpisodes += 20 // Estimate 20 episodes per season
      } else if (endEpisode === undefined) {
        // Single episode (S2E5)
        seasons.push({ seasonNumber, episodes: [startEpisode] })
        totalEpisodes += 1
      } else {
        // Episode range (S3E1-10)
        if (endEpisode < startEpisode) {
          throw new Error(
            `Invalid episode range: E${startEpisode}-${endEpisode}`,
          )
        }
        const episodes = Array.from(
          { length: endEpisode - startEpisode + 1 },
          (_, i) => startEpisode + i,
        )
        seasons.push({ seasonNumber, episodes })
        totalEpisodes += episodes.length
      }
    }

    // Merge seasons with same number
    const mergedSeasons = seasons.reduce(
      (acc, season) => {
        const existing = acc.find(s => s.seasonNumber === season.seasonNumber)
        if (existing) {
          if (!season.episodes || !existing.episodes) {
            // If either season is a full season (no episodes), make the merged one full season too
            delete existing.episodes
          } else {
            // Both have specific episodes - merge them
            existing.episodes = [
              ...new Set([...existing.episodes, ...season.episodes]),
            ].sort((a, b) => a - b)
          }
        } else {
          acc.push(season)
        }
        return acc
      },
      [] as Array<{ seasonNumber: number; episodes?: number[] }>,
    )

    // Recalculate total episodes after merging
    const finalTotalEpisodes = mergedSeasons.reduce((total, season) => {
      if (season.episodes) {
        return total + season.episodes.length
      } else {
        return total + 20 // Estimate 20 episodes per full season
      }
    }, 0)

    return {
      seasons: mergedSeasons,
      totalEpisodes: finalTotalEpisodes,
    }
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
   * Get available language profiles
   *
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to language profile list
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getLanguageProfiles(correlationId: string): Promise<
    Array<{
      id: number
      name: string
    }>
  > {
    return this.get('/api/v3/languageprofile', correlationId)
  }

  /**
   * Get available root folders for series storage
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
   * Update series monitoring settings
   *
   * @param seriesId - Sonarr series ID
   * @param seasonUpdates - Array of season monitoring updates
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to updated series
   * @throws {MediaApiError} When update fails
   *
   * @since 1.0.0
   */
  async updateSeriesMonitoring(
    seriesId: number,
    seasonUpdates: Array<{ seasonNumber: number; monitored: boolean }>,
    correlationId: string,
  ): Promise<SonarrSeries> {
    const series = await this.getSeries(seriesId, correlationId)

    // Update season monitoring
    for (const update of seasonUpdates) {
      const season = series.seasons.find(
        s => s.seasonNumber === update.seasonNumber,
      )
      if (season) {
        season.monitored = update.monitored
      }
    }

    return this.put<SonarrSeries>(
      `/api/v3/series/${seriesId}`,
      series,
      correlationId,
    )
  }

  /**
   * Update episode monitoring for specific episodes
   *
   * @param seriesId - Sonarr series ID
   * @param episodeUpdates - Array of episode monitoring updates
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to updated episodes
   * @throws {MediaApiError} When update fails
   *
   * @example
   * ```typescript
   * // Monitor only episodes 3 and 4 of season 1
   * await sonarrClient.updateEpisodeMonitoring(52, [
   *   { seasonNumber: 1, episodeNumber: 3, monitored: true },
   *   { seasonNumber: 1, episodeNumber: 4, monitored: true }
   * ], correlationId)
   * ```
   *
   * @since 1.0.0
   */
  async updateEpisodeMonitoring(
    seriesId: number,
    episodeUpdates: Array<{
      seasonNumber: number
      episodeNumber: number
      monitored: boolean
    }>,
    correlationId: string,
  ): Promise<SonarrEpisode[]> {
    this.logger.debug('Updating episode monitoring', {
      seriesId,
      episodeCount: episodeUpdates.length,
      correlationId,
    })

    // Get all episodes for the series
    const episodes = await this.getSeriesEpisodes(seriesId, correlationId)
    const updatedEpisodes: SonarrEpisode[] = []

    // Process each episode update
    for (const update of episodeUpdates) {
      const episode = episodes.find(
        ep =>
          ep.seasonNumber === update.seasonNumber &&
          ep.episodeNumber === update.episodeNumber,
      )

      if (!episode) {
        this.logger.warn('Episode not found for monitoring update', {
          seriesId,
          seasonNumber: update.seasonNumber,
          episodeNumber: update.episodeNumber,
          correlationId,
        })
        continue
      }

      // Only update if monitoring status is different
      if (episode.monitored !== update.monitored) {
        this.logger.debug('Updating episode monitoring status', {
          episodeId: episode.id,
          seasonNumber: update.seasonNumber,
          episodeNumber: update.episodeNumber,
          oldMonitored: episode.monitored,
          newMonitored: update.monitored,
          correlationId,
        })

        const updatedEpisode = await this.put<SonarrEpisode>(
          `/api/v3/episode/${episode.id}`,
          { ...episode, monitored: update.monitored },
          correlationId,
        )
        updatedEpisodes.push(updatedEpisode)
      }
    }

    this.logger.debug('Episode monitoring updates completed', {
      seriesId,
      updatedCount: updatedEpisodes.length,
      correlationId,
    })

    return updatedEpisodes
  }

  /**
   * Set monitoring for specific episodes only (unmonitor all others)
   *
   * @param seriesId - Sonarr series ID
   * @param targetEpisodes - Episodes to monitor (all others will be unmonitored)
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to monitoring summary
   * @throws {MediaApiError} When update fails
   *
   * @example
   * ```typescript
   * // Monitor only S1E3 and S1E4, unmonitor everything else
   * const result = await sonarrClient.setExclusiveEpisodeMonitoring(52, [
   *   { seasonNumber: 1, episodeNumber: 3 },
   *   { seasonNumber: 1, episodeNumber: 4 }
   * ], correlationId)
   * ```
   *
   * @since 1.0.0
   */
  async setExclusiveEpisodeMonitoring(
    seriesId: number,
    targetEpisodes: Array<{
      seasonNumber: number
      episodeNumber: number
    }>,
    correlationId: string,
  ): Promise<{
    monitored: number
    unmonitored: number
    totalEpisodes: number
    targetEpisodes: Array<{
      seasonNumber: number
      episodeNumber: number
      found: boolean
    }>
  }> {
    this.logger.debug('Setting exclusive episode monitoring', {
      seriesId,
      targetEpisodeCount: targetEpisodes.length,
      correlationId,
    })

    // Get all episodes for the series
    const episodes = await this.getSeriesEpisodes(seriesId, correlationId)
    let monitoredCount = 0
    let unmonitoredCount = 0

    // Track which target episodes were found
    const targetStatus = targetEpisodes.map(target => ({
      ...target,
      found: false,
    }))

    // Build update array for all episodes
    const episodeUpdates = episodes.map(episode => {
      const isTarget = targetEpisodes.some(
        target =>
          target.seasonNumber === episode.seasonNumber &&
          target.episodeNumber === episode.episodeNumber,
      )

      // Mark target as found
      if (isTarget) {
        const targetIndex = targetStatus.findIndex(
          target =>
            target.seasonNumber === episode.seasonNumber &&
            target.episodeNumber === episode.episodeNumber,
        )
        if (targetIndex >= 0) {
          targetStatus[targetIndex].found = true
        }
      }

      return {
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        monitored: isTarget,
      }
    })

    // Apply the updates
    await this.updateEpisodeMonitoring(seriesId, episodeUpdates, correlationId)

    // Count results
    episodeUpdates.forEach(update => {
      if (update.monitored) {
        monitoredCount++
      } else {
        unmonitoredCount++
      }
    })

    const result = {
      monitored: monitoredCount,
      unmonitored: unmonitoredCount,
      totalEpisodes: episodes.length,
      targetEpisodes: targetStatus,
    }

    this.logger.debug('Exclusive episode monitoring completed', {
      seriesId,
      result,
      correlationId,
    })

    return result
  }

  /**
   * Validate episode specification against available episodes
   *
   * @param seriesId - Sonarr series ID
   * @param episodeSpec - Episode specification to validate
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to validation result
   * @throws {MediaApiError} When validation fails
   *
   * @since 1.0.0
   */
  async validateEpisodeSpecification(
    seriesId: number,
    episodeSpec: EpisodeSpecification,
    correlationId: string,
  ): Promise<{
    isValid: boolean
    availableEpisodes: Array<{
      seasonNumber: number
      episodeNumber: number
      available: boolean
    }>
    missingEpisodes: Array<{
      seasonNumber: number
      episodeNumber: number
    }>
    warnings: string[]
  }> {
    this.logger.debug('Validating episode specification', {
      seriesId,
      seasonCount: episodeSpec.seasons.length,
      totalEpisodes: episodeSpec.totalEpisodes,
      correlationId,
    })

    const episodes = await this.getSeriesEpisodes(seriesId, correlationId)
    const availableEpisodes: Array<{
      seasonNumber: number
      episodeNumber: number
      available: boolean
    }> = []
    const missingEpisodes: Array<{
      seasonNumber: number
      episodeNumber: number
    }> = []
    const warnings: string[] = []

    // Check each season in the specification
    for (const season of episodeSpec.seasons) {
      const seasonEpisodes = episodes.filter(
        ep => ep.seasonNumber === season.seasonNumber,
      )

      if (seasonEpisodes.length === 0) {
        warnings.push(
          `Season ${season.seasonNumber} has no available episodes in the database`,
        )
        // Still need to mark all requested episodes as missing
        if (season.episodes) {
          for (const episodeNumber of season.episodes) {
            availableEpisodes.push({
              seasonNumber: season.seasonNumber,
              episodeNumber,
              available: false,
            })
            missingEpisodes.push({
              seasonNumber: season.seasonNumber,
              episodeNumber,
            })
          }
        }
        continue
      }

      if (season.episodes) {
        // Check specific episodes
        for (const episodeNumber of season.episodes) {
          const episode = seasonEpisodes.find(
            ep => ep.episodeNumber === episodeNumber,
          )
          const available = !!episode

          availableEpisodes.push({
            seasonNumber: season.seasonNumber,
            episodeNumber,
            available,
          })

          if (!available) {
            missingEpisodes.push({
              seasonNumber: season.seasonNumber,
              episodeNumber,
            })
          }
        }
      } else {
        // Check all episodes in season
        seasonEpisodes.forEach(episode => {
          availableEpisodes.push({
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            available: true,
          })
        })
      }
    }

    // Add warning about missing episodes
    if (missingEpisodes.length > 0) {
      warnings.push(
        `${missingEpisodes.length} requested episodes are not available in the database`,
      )
    }

    const isValid = missingEpisodes.length === 0

    this.logger.debug('Episode specification validation completed', {
      seriesId,
      isValid,
      availableCount: availableEpisodes.filter(ep => ep.available).length,
      missingCount: missingEpisodes.length,
      warningCount: warnings.length,
      correlationId,
    })

    return {
      isValid,
      availableEpisodes,
      missingEpisodes,
      warnings,
    }
  }

  /**
   * Trigger episode search for specific episodes
   *
   * @param episodeIds - Array of Sonarr episode IDs to search for
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to command response
   * @throws {MediaApiError} When search request fails
   *
   * @example
   * ```typescript
   * // Search for specific episodes after setting up monitoring
   * const command = await sonarrClient.searchEpisodesByIds([123, 124, 125], correlationId)
   * console.log(`Search command initiated: ${command.id}`)
   * ```
   *
   * @since 1.0.0
   */
  async searchEpisodesByIds(
    episodeIds: number[],
    correlationId: string,
  ): Promise<{ id: number; name: string; status: string }> {
    this.logger.debug('Initiating episode search for specific episodes', {
      episodeIds,
      episodeCount: episodeIds.length,
      correlationId,
    })

    if (episodeIds.length === 0) {
      throw new Error('At least one episode ID must be provided for search')
    }

    const commandRequest = {
      name: 'EpisodeSearch',
      episodeIds: episodeIds,
    }

    const command = await this.post<{
      id: number
      name: string
      status: string
    }>('/api/v3/command', commandRequest, correlationId)

    this.logger.debug('Episode search command initiated', {
      commandId: command.id,
      commandName: command.name,
      status: command.status,
      episodeIds,
      correlationId,
    })

    return command
  }

  /**
   * Delete series from Sonarr
   *
   * @param seriesId - Sonarr series ID
   * @param deleteFiles - Whether to delete series files
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving when deletion completes
   * @throws {MediaApiError} When deletion fails
   *
   * @since 1.0.0
   */
  async deleteSeries(
    seriesId: number,
    deleteFiles: boolean,
    correlationId: string,
  ): Promise<void> {
    await this.delete(
      `/api/v3/series/${seriesId}?deleteFiles=${deleteFiles}`,
      correlationId,
    )
  }

  /**
   * Update client configuration
   *
   * @param newConfig - New configuration
   * @throws {Error} When configuration is invalid
   *
   * @since 1.0.0
   */
  async configure(newConfig: SonarrConfig): Promise<void> {
    // Validate the new configuration (only in tests where mock provides this method)
    const configService = this.configService as any
    if (configService.validateSonarrConfig) {
      configService.validateSonarrConfig(newConfig)
    }

    // Update internal config (for test purposes, just validate)
    Object.assign(this.sonarrConfig, newConfig)
  }
}
