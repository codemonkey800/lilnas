/**
 * @fileoverview Example Emby Client Implementation
 *
 * This file provides a complete example of how to implement a concrete
 * MediaApiClient for Emby, demonstrating library browsing and playback
 * link generation functionality.
 *
 * @example
 * @since 1.0.0
 * @author TDR Bot Development Team
 */

import { Injectable } from '@nestjs/common'
import { nanoid } from 'nanoid'

import {
  BaseApiClientConfig,
  BaseMediaApiClient,
  ConnectionTestResult,
  HealthCheckResult,
  ServiceCapabilities,
} from 'src/media/clients/base-media-api.client'
import {
  EmbyConfig,
  MediaConfigValidationService,
} from 'src/media/config/media-config.validation'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

/**
 * Emby API response interfaces
 */
interface EmbyItem {
  Id: string
  Name: string
  Type: 'Movie' | 'Series' | 'Season' | 'Episode' | 'Folder'
  Path?: string
  ServerId: string
  IsFolder: boolean
  ProductionYear?: number
  RunTimeTicks?: number
  Overview?: string
  Taglines?: string[]
  Genres?: string[]
  CommunityRating?: number
  OfficialRating?: string
  PremiereDate?: string
  DateCreated: string
  UserData?: {
    PlayedPercentage?: number
    Played: boolean
    IsFavorite: boolean
    LastPlayedDate?: string
    PlaybackPositionTicks: number
  }
  ImageTags?: {
    Primary?: string
    Backdrop?: string
    Logo?: string
  }
  BackdropImageTags?: string[]
  SeriesName?: string // For episodes
  SeasonName?: string // For episodes
  IndexNumber?: number // Episode number
  ParentIndexNumber?: number // Season number
}

interface EmbyItemsResponse {
  Items: EmbyItem[]
  TotalRecordCount: number
  StartIndex: number
}

interface EmbyPlaybackInfo {
  mediaId: string
  title: string
  type: 'Movie' | 'Series' | 'Episode'
  isAvailable: boolean
  playbackUrl?: string
  fileSize?: string
  quality?: string
  duration?: number
  posterUrl?: string
}

interface EmbyLink {
  playUrl: string
  mediaTitle: string
  mediaType: 'Movie' | 'Series' | 'Episode'
  duration?: number
  posterUrl?: string
  quality?: string
  fileSize?: string
  correlationId: string
}

interface EmbySystemInfo {
  Version: string
  Id: string
  ServerName: string
  LocalAddress: string
  WanAddress?: string
  OperatingSystem: string
  SystemUpdateLevel: string
  HasPendingRestart: boolean
  IsShuttingDown: boolean
  CanSelfRestart: boolean
  CanSelfUpdate: boolean
  TranscodingTempPath?: string
  HttpServerPortNumber: number
  HttpsPortNumber: number
  SupportsHttps: boolean
  WebSocketPortNumber: number
  CompletedInstallations?: unknown[]
  InProgressInstallations?: unknown[]
}

/**
 * Emby API client implementation extending BaseMediaApiClient
 *
 * This client provides full integration with Emby's API, supporting
 * library browsing, media availability checking, and playback link generation.
 *
 * @class EmbyClient
 * @extends BaseMediaApiClient
 *
 * @example
 * ```typescript
 * // Usage in a service or command
 * @Injectable()
 * export class MediaService {
 *   constructor(private readonly embyClient: EmbyClient) {}
 *
 *   async browseLibrary(correlationId: string): Promise<EmbyItem[]> {
 *     return this.embyClient.getLibraryItems(correlationId)
 *   }
 *
 *   async generatePlaybackLink(mediaId: string, correlationId: string): Promise<EmbyLink> {
 *     return this.embyClient.generatePlaybackLink(mediaId, correlationId)
 *   }
 * }
 * ```
 *
 * @since 1.0.0
 */
@Injectable()
export class EmbyClient extends BaseMediaApiClient {
  private readonly embyConfig: EmbyConfig

  constructor(
    retryService: RetryService,
    errorClassifier: ErrorClassificationService,
    mediaLoggingService: MediaLoggingService,
    private readonly configService: MediaConfigValidationService,
  ) {
    // Get Emby-specific configuration
    const embyConfig = configService.getServiceConfig('emby') as EmbyConfig

    // Transform to base configuration
    const baseConfig: BaseApiClientConfig = {
      baseURL: embyConfig.url,
      timeout: embyConfig.timeout,
      maxRetries: embyConfig.maxRetries,
      serviceName: 'emby',
    }

    super(retryService, errorClassifier, mediaLoggingService, baseConfig)
    this.embyConfig = embyConfig
  }

  // ==================== Abstract Method Implementations ====================

  /**
   * @inheritdoc
   */
  protected getAuthenticationHeaders(): Record<string, string> {
    // Emby authentication is handled via query parameters, not headers
    return {}
  }

  /**
   * Get authentication query parameters for Emby API requests
   *
   * According to the design document, Emby uses query parameter authentication:
   * GET /Items?api_key={key}&userId={userId}&recursive=true
   *
   * @protected
   * @returns Object containing authentication query parameters
   * @since 1.0.0
   */
  protected getAuthenticationParams(): Record<string, string> {
    return {
      api_key: this.embyConfig.apiKey,
      userId: this.embyConfig.userId,
    }
  }

  /**
   * @inheritdoc
   */
  protected async validateServiceConfiguration(): Promise<ConnectionTestResult> {
    const startTime = Date.now()

    try {
      // Test basic connectivity and authentication with system info endpoint
      await this.get<EmbySystemInfo>('/System/Info', nanoid())

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
          'Check if Emby server is running',
          'Verify EMBY_URL is correct and accessible',
          'Check EMBY_API_TOKEN is valid',
          'Verify EMBY_USER_ID is correct UUID format',
          'Ensure network connectivity between services',
          'Check Emby server is accessible via HTTP/HTTPS',
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
    const apiVersion = await this.getApiVersion(correlationId)

    return {
      canSearch: true,
      canRequest: false, // Emby doesn't handle requests, only library browsing
      canMonitor: false, // Emby doesn't monitor downloads
      supportedMediaTypes: ['movie', 'tv'],
      version: apiVersion.version,
      apiVersion,
      featureLimitations: apiVersion.isSupported
        ? []
        : [
            'Limited feature set due to version compatibility',
            'Some advanced Emby features may not be available',
          ],
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
      const systemInfo = await this.get<EmbySystemInfo>(
        '/System/Info',
        correlationId,
      )

      // Get API version information for health check
      const apiVersion = await this.getApiVersion(correlationId)

      return {
        isHealthy: !systemInfo.IsShuttingDown && !systemInfo.HasPendingRestart,
        responseTime: Date.now() - startTime,
        lastChecked: new Date(),
        version: systemInfo.Version,
        status: systemInfo.IsShuttingDown ? 'shutting_down' : 'healthy',
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
      systemInfo: '/System/Info',
      items: '/Items', // Updated to match design doc pattern
      itemById: '/Items/{itemId}',
      playbackInfo: '/Items/{itemId}/PlaybackInfo',
      search: '/Items', // Updated to match design doc pattern
      libraries: '/Users/Views', // Keep user-specific for libraries
    }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Build URL with authentication query parameters
   *
   * Creates URLs following the design document pattern:
   * GET /Items?api_key={key}&userId={userId}&recursive=true
   *
   * @private
   * @param basePath - The base API path
   * @param additionalParams - Additional query parameters
   * @returns Complete URL with authentication parameters
   * @since 1.0.0
   */
  private buildAuthenticatedUrl(
    basePath: string,
    additionalParams: Record<string, string> = {},
  ): string {
    const authParams = this.getAuthenticationParams()
    const allParams = { ...authParams, ...additionalParams }

    const params = new URLSearchParams(allParams)
    return `${basePath}?${params.toString()}`
  }

  // ==================== Emby-Specific Methods ====================

  /**
   * Get all library items (movies and TV shows)
   *
   * @param correlationId - Unique identifier for request tracing
   * @param includeItemTypes - Filter by item types
   * @param limit - Maximum number of items to return
   * @param startIndex - Starting index for pagination
   * @returns Promise resolving to library items
   * @throws {MediaApiError} When request fails
   *
   * @example
   * ```typescript
   * const items = await embyClient.getLibraryItems(correlationId, ['Movie', 'Series'])
   * console.log(`Found ${items.length} items in library`)
   * ```
   *
   * @since 1.0.0
   */
  async getLibraryItems(
    correlationId: string,
    includeItemTypes?: Array<'Movie' | 'Series' | 'Episode'>,
    limit: number = 100,
    startIndex: number = 0,
  ): Promise<EmbyItem[]> {
    this.logger.debug('Fetching library items from Emby', {
      includeItemTypes,
      limit,
      startIndex,
      correlationId,
    })

    const additionalParams: Record<string, string> = {
      recursive: 'true', // Design document specifies lowercase 'recursive'
      Fields:
        'Overview,Genres,CommunityRating,DateCreated,UserData,MediaStreams',
      limit: limit.toString(),
      StartIndex: startIndex.toString(),
    }

    if (includeItemTypes && includeItemTypes.length > 0) {
      additionalParams.IncludeItemTypes = includeItemTypes.join(',')
    }

    // Build URL according to design document pattern: /Items?api_key={key}&userId={userId}&recursive=true
    const url = this.buildAuthenticatedUrl('/Items', additionalParams)

    const response = await this.get<EmbyItemsResponse>(url, correlationId)

    this.logger.debug('Library items fetched successfully', {
      itemCount: response.Items.length,
      totalRecords: response.TotalRecordCount,
      correlationId,
    })

    return response.Items
  }

  /**
   * Search for media items in the library
   *
   * @param query - Search query string
   * @param correlationId - Unique identifier for request tracing
   * @param includeItemTypes - Filter by item types
   * @param limit - Maximum number of results
   * @returns Promise resolving to search results
   * @throws {MediaApiError} When search fails
   *
   * @example
   * ```typescript
   * const results = await embyClient.searchLibrary('fight club', correlationId, ['Movie'])
   * console.log(`Found ${results.length} matching movies`)
   * ```
   *
   * @since 1.0.0
   */
  async searchLibrary(
    query: string,
    correlationId: string,
    includeItemTypes?: Array<'Movie' | 'Series' | 'Episode'>,
    limit: number = 50,
  ): Promise<EmbyItem[]> {
    this.logger.debug('Searching Emby library', {
      query,
      includeItemTypes,
      limit,
      correlationId,
    })

    const additionalParams: Record<string, string> = {
      searchTerm: query,
      recursive: 'true', // Design document specifies lowercase 'recursive'
      Fields: 'Overview,Genres,CommunityRating,DateCreated,UserData',
      limit: limit.toString(),
    }

    if (includeItemTypes && includeItemTypes.length > 0) {
      additionalParams.IncludeItemTypes = includeItemTypes.join(',')
    }

    // Build URL according to design document pattern: /Items?api_key={key}&userId={userId}&recursive=true
    const url = this.buildAuthenticatedUrl('/Items', additionalParams)

    const response = await this.get<EmbyItemsResponse>(url, correlationId)

    this.logger.debug('Library search completed', {
      query,
      resultCount: response.Items.length,
      correlationId,
    })

    return response.Items
  }

  /**
   * Get specific media item by ID
   *
   * @param itemId - Emby item ID
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to the media item
   * @throws {MediaNotFoundApiError} When item not found
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getItem(itemId: string, correlationId: string): Promise<EmbyItem> {
    // For individual items, we still need the user context but use query parameters
    const url = this.buildAuthenticatedUrl(`/Items/${itemId}`)
    return this.get<EmbyItem>(url, correlationId)
  }

  /**
   * Generate direct playback link for media content
   *
   * @param mediaId - Emby media item ID
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to playback link information
   * @throws {MediaNotFoundApiError} When media not found
   * @throws {MediaApiError} When link generation fails
   *
   * @example
   * ```typescript
   * const link = await embyClient.generatePlaybackLink('abc123', correlationId)
   * console.log(`Play URL: ${link.playUrl}`)
   * console.log(`Title: ${link.mediaTitle}`)
   * ```
   *
   * @since 1.0.0
   */
  async generatePlaybackLink(
    mediaId: string,
    correlationId: string,
  ): Promise<EmbyLink> {
    this.logger.debug('Generating playback link', {
      mediaId,
      correlationId,
    })

    // First, get media item details
    const item = await this.getItem(mediaId, correlationId)

    // Validate media availability
    if (!this.isMediaAvailable(item)) {
      throw new Error(`Media item ${mediaId} is not available for playback`)
    }

    // Get system info for server ID
    const systemInfo = await this.get<EmbySystemInfo>(
      '/System/Info',
      correlationId,
    )

    // Generate Emby web client URL
    const playUrl = `${this.embyConfig.url}/web/index.html#!/item?id=${mediaId}&serverId=${systemInfo.Id}`

    // Calculate duration from ticks (10,000 ticks = 1 millisecond)
    const duration = item.RunTimeTicks
      ? Math.floor(item.RunTimeTicks / 10000000)
      : undefined

    // Generate poster URL if available
    const posterUrl = item.ImageTags?.Primary
      ? `${this.embyConfig.url}/Items/${mediaId}/Images/Primary`
      : undefined

    const link: EmbyLink = {
      playUrl,
      mediaTitle: item.Name,
      mediaType:
        item.Type === 'Movie'
          ? 'Movie'
          : item.Type === 'Episode'
            ? 'Episode'
            : 'Series',
      duration,
      posterUrl,
      correlationId,
    }

    this.logger.debug('Playback link generated successfully', {
      mediaId,
      mediaTitle: link.mediaTitle,
      mediaType: link.mediaType,
      hasPoster: !!posterUrl,
      correlationId,
    })

    return link
  }

  /**
   * Check if media item is available for playback
   *
   * @param mediaId - Emby media item ID
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to availability status
   * @throws {MediaApiError} When availability check fails
   *
   * @since 1.0.0
   */
  async validateMediaAvailability(
    mediaId: string,
    correlationId: string,
  ): Promise<boolean> {
    try {
      const item = await this.getItem(mediaId, correlationId)
      return this.isMediaAvailable(item)
    } catch (error) {
      return false
    }
  }

  /**
   * Get playback information for a media item
   *
   * @param mediaId - Emby media item ID
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to playback information
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getMediaPlaybackInfo(
    mediaId: string,
    correlationId: string,
  ): Promise<EmbyPlaybackInfo> {
    const item = await this.getItem(mediaId, correlationId)

    const playbackInfo: EmbyPlaybackInfo = {
      mediaId,
      title: item.Name,
      type:
        item.Type === 'Movie'
          ? 'Movie'
          : item.Type === 'Episode'
            ? 'Episode'
            : 'Series',
      isAvailable: this.isMediaAvailable(item),
    }

    if (playbackInfo.isAvailable) {
      const link = await this.generatePlaybackLink(mediaId, correlationId)
      playbackInfo.playbackUrl = link.playUrl
      playbackInfo.duration = link.duration
      playbackInfo.posterUrl = link.posterUrl
    }

    return playbackInfo
  }

  /**
   * Get available libraries/views
   *
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to library list
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getLibraries(correlationId: string): Promise<EmbyItem[]> {
    // Libraries/Views still require user-specific endpoint but with query parameters
    const url = this.buildAuthenticatedUrl('/Users/Views')
    const response = await this.get<EmbyItemsResponse>(url, correlationId)
    return response.Items
  }

  /**
   * Get items from a specific library
   *
   * @param libraryId - Library/collection ID
   * @param correlationId - Unique identifier for request tracing
   * @param limit - Maximum number of items
   * @param startIndex - Starting index for pagination
   * @returns Promise resolving to library items
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getLibraryItemsFromCollection(
    libraryId: string,
    correlationId: string,
    limit: number = 100,
    startIndex: number = 0,
  ): Promise<EmbyItem[]> {
    const additionalParams: Record<string, string> = {
      ParentId: libraryId,
      recursive: 'true', // Design document specifies lowercase 'recursive'
      Fields: 'Overview,Genres,CommunityRating,DateCreated,UserData',
      limit: limit.toString(),
      StartIndex: startIndex.toString(),
    }

    // Build URL according to design document pattern: /Items?api_key={key}&userId={userId}&recursive=true
    const url = this.buildAuthenticatedUrl('/Items', additionalParams)

    const response = await this.get<EmbyItemsResponse>(url, correlationId)

    return response.Items
  }

  /**
   * Get system information
   *
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to system information
   * @throws {MediaApiError} When request fails
   *
   * @since 1.0.0
   */
  async getSystemInfo(correlationId: string): Promise<EmbySystemInfo> {
    return this.get<EmbySystemInfo>('/System/Info', correlationId)
  }

  // ==================== Private Helper Methods ====================

  /**
   * Check if a media item is available for playback
   *
   * @private
   * @param item - Emby media item
   * @returns Whether the item is available for playback
   *
   * @since 1.0.0
   */
  private isMediaAvailable(item: EmbyItem): boolean {
    // For folders (like series), they're always "available" for browsing
    if (item.IsFolder) {
      return true
    }

    // For playable items, check if they have actual media files
    // This is a simple check - in practice you might want more sophisticated logic
    return !!item.Path && item.Type !== 'Folder'
  }
}
