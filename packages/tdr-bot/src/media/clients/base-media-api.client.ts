/**
 * @fileoverview BaseMediaApiClient - Abstract base class for media service API clients
 *
 * This module provides a standardized foundation for interacting with media services
 * (Sonarr, Radarr, Emby) with comprehensive error handling, retry logic,
 * integration, and health monitoring capabilities.
 *
 * @module BaseMediaApiClient
 * @since 1.0.0
 * @author TDR Bot Development Team
 */

import { Injectable, Logger } from '@nestjs/common'
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'
import { Agent as HttpAgent } from 'http'
import { Agent as HttpsAgent } from 'https'

import {
  MediaApiError,
  MediaAuthenticationError,
  MediaNetworkError,
  MediaNotFoundApiError,
  MediaRateLimitError,
  MediaServiceUnavailableError,
  MediaValidationApiError,
} from 'src/media/errors/media-errors'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import {
  ErrorCategory,
  ErrorClassificationService,
} from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

/**
 * HTTP connection pool configuration
 *
 * @interface HttpConnectionConfig
 * @since 1.0.0
 */
export interface HttpConnectionConfig {
  /** Maximum number of sockets to allow per host (default: Infinity) */
  maxSockets?: number
  /** Maximum number of free sockets to keep per host (default: 256) */
  maxFreeSockets?: number
  /** Keep-alive timeout in milliseconds (default: 5000) */
  keepAliveTimeout?: number
  /** Enable keep-alive connections (default: true) */
  keepAlive?: boolean
  /** Connection timeout in milliseconds (default: 30000) */
  connectTimeout?: number
  /** Maximum request/response body size in bytes (default: 10MB) */
  maxContentLength?: number
  /** Maximum redirects to follow (default: 5) */
  maxRedirects?: number
}

/**
 * API version validation configuration
 *
 * @interface ApiVersionConfig
 * @since 1.0.0
 */
export interface ApiVersionConfig {
  /** Supported API versions for this service */
  supportedVersions: string[]
  /** Preferred API version to use (latest supported) */
  preferredVersion?: string
  /** Enable dynamic version detection (default: true) */
  enableVersionDetection?: boolean
  /** Fallback version if detection fails */
  fallbackVersion?: string
  /** Version compatibility checking mode */
  compatibilityMode: 'strict' | 'loose' | 'fallback'
}

/**
 * Configuration interface for BaseMediaApiClient instances
 *
 * @interface BaseApiClientConfig
 * @since 1.0.0
 */
export interface BaseApiClientConfig {
  /** Base URL for the media service API (e.g., 'http://radarr:7878') */
  baseURL: string
  /** Request timeout in milliseconds (recommended: 30000) */
  timeout: number
  /** Maximum number of retry attempts for failed requests (recommended: 3) */
  maxRetries: number
  /** Type of media service this client handles */
  serviceName: 'sonarr' | 'radarr' | 'emby'
  /** HTTP connection pool configuration */
  httpConfig?: HttpConnectionConfig
  /** API version validation configuration */
  versionConfig?: ApiVersionConfig
}

/**
 * Retry configuration for API requests
 *
 * @interface RetryConfiguration
 * @since 1.0.0
 */
export interface RetryConfiguration {
  /** Maximum number of retry attempts before giving up */
  maxAttempts: number
  /** Initial delay between retries in milliseconds */
  baseDelayMs: number
  /** Maximum delay between retries in milliseconds */
  maxDelayMs: number
  /** Multiplier for exponential backoff (e.g., 2.0 for doubling) */
  backoffFactor: number
  /** Array of error types that should trigger retries */
  retryableErrorTypes: string[]
}

/**
 * Result of API version detection
 *
 * @interface ApiVersionResult
 * @since 1.0.0
 */
export interface ApiVersionResult {
  /** Detected or configured API version */
  version: string
  /** Whether version detection was successful */
  detected: boolean
  /** Whether the version is supported */
  isSupported: boolean
  /** Whether this version is compatible (may have limitations) */
  isCompatible: boolean
  /** Version compatibility warnings or limitations */
  compatibilityWarnings?: string[]
  /** Error message if version detection failed */
  error?: string
}

/**
 * Result of a service health check operation
 *
 * @interface HealthCheckResult
 * @since 1.0.0
 */
export interface HealthCheckResult {
  /** Whether the service is considered healthy */
  isHealthy: boolean
  /** Response time in milliseconds for the health check */
  responseTime?: number
  /** Error message if health check failed */
  error?: string
  /** Timestamp when the health check was performed */
  lastChecked: Date
  /** Service version if available */
  version?: string
  /** Service status string (e.g., 'healthy', 'degraded') */
  status?: string
  /** API version compatibility information */
  apiVersion?: ApiVersionResult
}

/**
 * Capabilities supported by a media service
 *
 * @interface ServiceCapabilities
 * @since 1.0.0
 */
export interface ServiceCapabilities {
  /** Whether the service supports media search operations */
  canSearch: boolean
  /** Whether the service supports adding media requests */
  canRequest: boolean
  /** Whether the service supports monitoring media status */
  canMonitor: boolean
  /** Array of supported media types (e.g., ['movie', 'tv']) */
  supportedMediaTypes: string[]
  /** Service version if available */
  version?: string
  /** API version compatibility information */
  apiVersion?: ApiVersionResult
  /** Version-specific feature limitations */
  featureLimitations?: string[]
}

/**
 * Result of a connection test to a media service
 *
 * @interface ConnectionTestResult
 * @since 1.0.0
 */
export interface ConnectionTestResult {
  /** Whether a basic connection to the service was successful */
  canConnect: boolean
  /** Whether authentication with the service was successful */
  isAuthenticated: boolean
  /** Response time in milliseconds for the connection test */
  responseTime?: number
  /** Error message if connection test failed */
  error?: string
  /** Array of suggestions for resolving connection issues */
  suggestions?: string[]
}

/**
 * Abstract base class for media service API clients (Sonarr, Radarr, Emby)
 *
 * This class provides a standardized foundation for interacting with media services
 * with comprehensive error handling, retry logic, health monitoring,
 * and health monitoring capabilities.
 *
 * @abstract
 * @class BaseMediaApiClient
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * // Example concrete implementation for Radarr
 * @Injectable()
 * export class RadarrClient extends BaseMediaApiClient {
 *   constructor(
 *     retryService: RetryService,
 *     errorClassifier: ErrorClassificationService,
 *     mediaLoggingService: MediaLoggingService,
 *     configService: MediaConfigValidationService,
 *   ) {
 *     const config = configService.getServiceConfig('radarr') as RadarrConfig
 *     const baseConfig: BaseApiClientConfig = {
 *       baseURL: config.url,
 *       timeout: config.timeout,
 *       maxRetries: config.maxRetries,
 *       serviceName: 'radarr',
 *     }
 *     super(retryService, errorClassifier, mediaLoggingService, baseConfig)
 *   }
 *
 *   protected getAuthenticationHeaders(): Record<string, string> {
 *     return { 'X-Api-Key': this.apiKey }
 *   }
 *
 *   protected async validateServiceConfiguration(): Promise<ConnectionTestResult> {
 *     try {
 *       await this.get('/health', uuid())
 *       return { canConnect: true, isAuthenticated: true }
 *     } catch (error) {
 *       return { canConnect: false, isAuthenticated: false, error: error.message }
 *     }
 *   }
 *
 *   protected async getServiceCapabilities(): Promise<ServiceCapabilities> {
 *     return {
 *       canSearch: true,
 *       canRequest: true,
 *       canMonitor: true,
 *       supportedMediaTypes: ['movie'],
 *       version: '3.0.0',
 *     }
 *   }
 *
 *   protected async performHealthCheck(correlationId: string): Promise<HealthCheckResult> {
 *     const startTime = Date.now()
 *     try {
 *       const health = await this.get('/health', correlationId)
 *       return {
 *         isHealthy: true,
 *         responseTime: Date.now() - startTime,
 *         lastChecked: new Date(),
 *         version: health.version,
 *         status: health.status,
 *       }
 *     } catch (error) {
 *       return {
 *         isHealthy: false,
 *         responseTime: Date.now() - startTime,
 *         lastChecked: new Date(),
 *         error: error.message,
 *       }
 *     }
 *   }
 *
 *   protected getApiEndpoints(): Record<string, string> {
 *     return {
 *       health: '/health',
 *       movies: '/api/v3/movie',
 *       search: '/api/v3/movie/lookup',
 *       queue: '/api/v3/queue',
 *     }
 *   }
 *
 *   // Radarr-specific methods
 *   async searchMovies(query: string, correlationId: string): Promise<Movie[]> {
 *     return this.get(`/api/v3/movie/lookup?term=${encodeURIComponent(query)}`, correlationId)
 *   }
 *
 *   async addMovie(movie: MovieRequest, correlationId: string): Promise<Movie> {
 *     return this.post('/api/v3/movie', movie, correlationId)
 *   }
 * }
 * ```
 *
 * @description
 * ## Key Features
 *
 * ### HTTP Methods with Retry Protection
 * - GET, POST, PUT, DELETE methods with automatic retry logic
 * - Retry logic with exponential backoff for transient failures
 * - Correlation ID propagation for distributed tracing
 * - Comprehensive error mapping to domain-specific exceptions
 *
 * ### Error Handling Strategy
 * - HTTP status codes mapped to specific MediaApiError subclasses
 * - Retry-after header support for rate limiting
 * - Network error detection and classification
 * - User-friendly error messages for Discord display
 *
 * ### Health Monitoring & Diagnostics
 * - Connection testing with authentication verification
 * - Health checks with performance metrics
 * - Service capability detection
 * - Comprehensive diagnostic suite
 *
 * ### Performance & Reliability
 * - Configurable timeout and retry policies
 * - Exponential backoff for transient errors
 * - Request/response interceptors for logging
 * - Performance metrics collection
 *
 * ## Implementation Requirements
 *
 * Concrete subclasses must implement the following abstract methods:
 *
 * - `getAuthenticationHeaders()`: Service-specific authentication
 * - `validateServiceConfiguration()`: Connection and auth testing
 * - `getServiceCapabilities()`: Feature detection
 * - `performHealthCheck()`: Service health verification
 * - `getApiEndpoints()`: API endpoint mapping
 *
 * ## Error Handling
 *
 * The client automatically maps HTTP errors to appropriate MediaApiError subclasses:
 *
 * - 401 → MediaAuthenticationError (non-retryable)
 * - 429 → MediaRateLimitError (retryable with delay)
 * - 404 → MediaNotFoundApiError (limited retry)
 * - 400/422 → MediaValidationApiError (non-retryable)
 * - 5xx → MediaServiceUnavailableError (retryable)
 * - Network → MediaNetworkError (retryable)
 *
 * ## Integration with TDR-Bot Services
 *
 * - RetryService: Retry logic and exponential backoff
 * - ErrorClassificationService: Error categorization
 * - MediaLoggingService: Structured logging with correlation IDs
 * - MediaConfigValidationService: Configuration validation
 *
 * @see {@link MediaLoggingService} for logging integration
 * @see {@link RetryService} for retry functionality
 * @see {@link MediaApiError} for error types
 * @see {@link MediaConfigValidationService} for configuration
 */

@Injectable()
export abstract class BaseMediaApiClient {
  protected readonly logger = new Logger(this.constructor.name)
  protected readonly axiosInstance: AxiosInstance
  protected readonly config: BaseApiClientConfig
  protected httpAgent: HttpAgent | HttpsAgent
  private detectedApiVersion?: ApiVersionResult

  /**
   * Initialize the BaseMediaApiClient with required dependencies and configuration
   *
   * @param retryService - Service for handling retries and failure recovery
   * @param errorClassifier - Service for classifying and categorizing errors
   * @param mediaLoggingService - Service for structured logging with correlation ID support
   * @param config - Configuration object containing service URL, timeout, and retry settings
   *
   * @since 1.0.0
   */
  constructor(
    protected readonly retryService: RetryService,
    protected readonly errorClassifier: ErrorClassificationService,
    protected readonly mediaLoggingService: MediaLoggingService,
    config: BaseApiClientConfig,
  ) {
    // Store config first so serviceName is available for defaults
    this.config = config

    const defaultHttpConfig = this.getDefaultHttpConfig()
    const defaultVersionConfig = this.getDefaultVersionConfig()

    this.config = {
      ...config,
      // Merge nested configs with defaults
      httpConfig: { ...defaultHttpConfig, ...config.httpConfig },
      versionConfig: { ...defaultVersionConfig, ...config.versionConfig },
    }
    this.httpAgent = this.createHttpAgent()
    this.axiosInstance = this.createAxiosInstance()
  }

  /**
   * Perform GET request with retry logic and failure recovery
   *
   * @template T - The expected response data type
   * @param path - API endpoint path relative to baseURL
   * @param correlationId - Unique identifier for request tracing
   * @param config - Optional Axios request configuration
   * @returns Promise resolving to the response data
   * @throws {MediaApiError} Various subtypes based on error conditions
   *
   * @protected
   * @since 1.0.0
   */
  protected async get<T = unknown>(
    path: string,
    correlationId: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.executeRequest<T>('GET', path, correlationId, {
      ...config,
      method: 'GET',
    })
  }

  /**
   * Perform POST request with retry logic and failure recovery
   *
   * @template T - The expected response data type
   * @param path - API endpoint path relative to baseURL
   * @param data - Request body data
   * @param correlationId - Unique identifier for request tracing
   * @param config - Optional Axios request configuration
   * @returns Promise resolving to the response data
   * @throws {MediaApiError} Various subtypes based on error conditions
   *
   * @protected
   * @since 1.0.0
   */
  protected async post<T = unknown>(
    path: string,
    data: unknown,
    correlationId: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.executeRequest<T>('POST', path, correlationId, {
      ...config,
      method: 'POST',
      data,
    })
  }

  /**
   * Perform PUT request with retry logic and failure recovery
   *
   * @template T - The expected response data type
   * @param path - API endpoint path relative to baseURL
   * @param data - Request body data
   * @param correlationId - Unique identifier for request tracing
   * @param config - Optional Axios request configuration
   * @returns Promise resolving to the response data
   * @throws {MediaApiError} Various subtypes based on error conditions
   *
   * @protected
   * @since 1.0.0
   */
  protected async put<T = unknown>(
    path: string,
    data: unknown,
    correlationId: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.executeRequest<T>('PUT', path, correlationId, {
      ...config,
      method: 'PUT',
      data,
    })
  }

  /**
   * Perform DELETE request with retry logic and failure recovery
   *
   * @template T - The expected response data type
   * @param path - API endpoint path relative to baseURL
   * @param correlationId - Unique identifier for request tracing
   * @param config - Optional Axios request configuration
   * @returns Promise resolving to the response data
   * @throws {MediaApiError} Various subtypes based on error conditions
   *
   * @protected
   * @since 1.0.0
   */
  protected async delete<T = unknown>(
    path: string,
    correlationId: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.executeRequest<T>('DELETE', path, correlationId, {
      ...config,
      method: 'DELETE',
    })
  }

  /**
   * Execute HTTP request with comprehensive error handling, retry logic, and failure recovery
   */
  private async executeRequest<T>(
    method: string,
    path: string,
    correlationId: string,
    config: AxiosRequestConfig,
  ): Promise<T> {
    const startTime = Date.now()
    const fullUrl = `${this.config.baseURL}${path}`

    this.logger.debug(
      `Making ${method} request to ${this.config.serviceName}`,
      {
        method,
        url: fullUrl,
        correlationId,
        service: this.config.serviceName,
      },
    )

    try {
      const response = await this.retryService.executeWithRetry(
        async () => {
          // Build URL with authentication query parameters if needed
          const authParams = this.getAuthenticationParams()
          let requestUrl = path

          if (Object.keys(authParams).length > 0) {
            const url = new URL(path, this.config.baseURL)
            Object.entries(authParams).forEach(([key, value]) => {
              url.searchParams.set(key, value)
            })
            // Get the path and search params portion only (without base URL)
            requestUrl = url.pathname + url.search
          }

          const requestConfig: AxiosRequestConfig = {
            ...config,
            url: requestUrl,
            headers: {
              ...config.headers,
              'X-Correlation-ID': correlationId,
              ...this.getAuthenticationHeaders(),
            },
            timeout: this.config.timeout,
          }

          return await this.axiosInstance.request<T>(requestConfig)
        },
        this.getOptimizedRetryConfig(method, path),
        `${this.config.serviceName}_${method}_${path}`,
        this.getErrorCategory(),
      )

      // Log successful API call
      this.mediaLoggingService.logApiCall(
        this.config.serviceName,
        method,
        fullUrl,
        startTime,
        correlationId,
        response.status,
      )

      // Ensure JSON responses are properly parsed and detect unexpected HTML responses
      let responseData = response.data
      const contentType = response.headers?.['content-type'] || ''

      // If we expect JSON but got HTML (usually a login page), treat as error
      if (
        typeof responseData === 'string' &&
        contentType.includes('text/html')
      ) {
        throw new MediaValidationApiError(
          this.config.serviceName,
          `${method} ${path}`,
          'Invalid response type: received HTML instead of JSON',
          correlationId,
          {
            originalError:
              'Received HTML response instead of expected JSON - likely authentication required',
            responsePreview: responseData.substring(0, 200),
            contentType,
            httpStatus: response.status,
          },
        )
      }

      // Parse JSON responses if they come as strings
      if (
        typeof responseData === 'string' &&
        contentType.includes('application/json')
      ) {
        try {
          responseData = JSON.parse(responseData)
        } catch (parseError) {
          this.logger.warn(
            `Failed to parse JSON response from ${this.config.serviceName}`,
            {
              correlationId,
              parseError:
                parseError instanceof Error
                  ? parseError.message
                  : String(parseError),
              responseLength:
                typeof responseData === 'string'
                  ? responseData.length
                  : 'unknown',
              contentType,
            },
          )
        }
      }

      return responseData
    } catch (error) {
      const apiError = this.createMediaApiError(
        error as Error,
        correlationId,
        method,
        path,
      )

      // Log failed API call
      this.mediaLoggingService.logApiCall(
        this.config.serviceName,
        method,
        fullUrl,
        startTime,
        correlationId,
        apiError.httpStatus,
        apiError,
      )

      throw apiError
    }
  }

  /**
   * Create Axios instance with enhanced HTTP configuration and connection pooling
   */
  private createAxiosInstance(): AxiosInstance {
    const httpConfig = this.config.httpConfig!
    const isHttps = this.config.baseURL.startsWith('https:')

    const instance = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      maxContentLength: httpConfig.maxContentLength,
      maxBodyLength: httpConfig.maxContentLength,
      maxRedirects: httpConfig.maxRedirects,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': `TDR-Bot/${this.config.serviceName}-client/1.0.0`,
        'X-Client-Name': 'TDR-Bot-Media-Client',
        // Add connection management headers
        Connection: httpConfig.keepAlive ? 'keep-alive' : 'close',
      },
      // Use custom HTTP agent with connection pooling
      httpAgent: !isHttps ? this.httpAgent : undefined,
      httpsAgent: isHttps ? this.httpAgent : undefined,
      // Enhanced error handling for connection issues
      validateStatus: status => status >= 200 && status < 300,
      // Disable automatic request transformation that can cause issues
      transformRequest: [
        data => {
          if (data && typeof data === 'object') {
            return JSON.stringify(data)
          }
          return data
        },
      ],
      // Add response timeout separate from connection timeout
      transitional: {
        silentJSONParsing: false,
        forcedJSONParsing: false,
      },
    })

    // Validate instance creation - critical for test environments
    if (!instance || !instance.interceptors) {
      throw new Error(
        `Failed to create Axios instance for ${this.config.serviceName}. Instance: ${!!instance}, Interceptors: ${!!instance?.interceptors}`,
      )
    }

    this.logger.debug(`Created Axios instance for ${this.config.serviceName}`, {
      service: this.config.serviceName,
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      maxContentLength: httpConfig.maxContentLength,
      maxRedirects: httpConfig.maxRedirects,
      agentType: isHttps ? 'HTTPS' : 'HTTP',
    })

    // Request interceptor for enhanced logging and headers
    instance.interceptors.request.use(
      request => {
        // Add correlation ID if available in headers
        const correlationId = request.headers?.['X-Correlation-ID']

        this.logger.debug(`${this.config.serviceName.toUpperCase()} Request`, {
          method: request.method?.toUpperCase(),
          url: request.url,
          service: this.config.serviceName,
          correlationId,
          contentType: request.headers?.['Content-Type'],
          contentLength: request.headers?.['Content-Length'],
        })

        // Add request size validation
        if (request.data) {
          const dataSize = JSON.stringify(request.data).length
          if (dataSize > httpConfig.maxContentLength!) {
            this.logger.warn(
              `Large request body detected for ${this.config.serviceName}`,
              {
                service: this.config.serviceName,
                bodySize: dataSize,
                maxSize: httpConfig.maxContentLength,
                correlationId,
              },
            )
          }
        }

        return request
      },
      error => {
        this.logger.error(
          `${this.config.serviceName.toUpperCase()} Request Error`,
          {
            error: error.message,
            service: this.config.serviceName,
            code: error.code,
            config: {
              method: error.config?.method,
              url: error.config?.url,
            },
          },
        )
        return Promise.reject(error)
      },
    )

    // Response interceptor for enhanced logging and metrics
    instance.interceptors.response.use(
      response => {
        const correlationId = response.config.headers?.['X-Correlation-ID']
        const contentLength = response.headers?.['content-length']

        this.logger.debug(`${this.config.serviceName.toUpperCase()} Response`, {
          status: response.status,
          statusText: response.statusText,
          service: this.config.serviceName,
          correlationId,
          contentLength,
          responseTime: response.headers?.['x-response-time'],
          contentType: response.headers?.['content-type'],
        })

        // Check for large responses
        if (
          contentLength &&
          parseInt(contentLength) > httpConfig.maxContentLength!
        ) {
          this.logger.warn(
            `Large response received from ${this.config.serviceName}`,
            {
              service: this.config.serviceName,
              contentLength: parseInt(contentLength),
              maxSize: httpConfig.maxContentLength,
              correlationId,
            },
          )
        }

        return response
      },
      error => {
        const correlationId = error.config?.headers?.['X-Correlation-ID']

        this.logger.error(
          `${this.config.serviceName.toUpperCase()} Response Error`,
          {
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.message,
            service: this.config.serviceName,
            correlationId,
            code: error.code,
            url: error.config?.url,
            method: error.config?.method,
            timeout: error.code === 'ECONNABORTED',
          },
        )
        return Promise.reject(error)
      },
    )

    return instance
  }

  /**
   * Get default HTTP connection configuration optimized for media API stability
   */
  private getDefaultHttpConfig(): HttpConnectionConfig {
    // Detect if running in test environment
    const isTestEnv =
      process.env.NODE_ENV === 'test' ||
      process.env.JEST_WORKER_ID !== undefined

    return {
      // Reduced connection pool for better resource management in tests
      maxSockets: isTestEnv ? 3 : 10,
      maxFreeSockets: isTestEnv ? 2 : 5,
      // Longer keep-alive for external services but shorter for tests to avoid hangs
      keepAliveTimeout: isTestEnv ? 3000 : 10000,
      keepAlive: true,
      // More conservative connection timeout for external services
      connectTimeout: isTestEnv ? 8000 : 15000,
      maxContentLength: 10 * 1024 * 1024, // 10MB
      maxRedirects: 3, // Reduced to prevent redirect loops
    }
  }

  /**
   * Get default version configuration for the service type
   */
  private getDefaultVersionConfig(): ApiVersionConfig {
    const serviceDefaults = {
      sonarr: {
        supportedVersions: ['4.0.15', '4.0.0', '3.0.0', '2.0.0'],
        preferredVersion: '4.0.15',
        fallbackVersion: '3.0.0',
      },
      radarr: {
        supportedVersions: ['5.26.2', '5.0.0', '4.0.0', '3.0.0', '2.0.0'],
        preferredVersion: '5.26.2',
        fallbackVersion: '3.0.0',
      },
      emby: {
        supportedVersions: ['4.7.0', '4.6.0', '4.5.0'],
        preferredVersion: '4.7.0',
        fallbackVersion: '4.7.0',
      },
    }

    const defaults = serviceDefaults[this.config.serviceName]

    return {
      ...defaults,
      enableVersionDetection: true,
      compatibilityMode: 'fallback',
    }
  }

  /**
   * Create HTTP/HTTPS agent with optimized connection pooling and keep-alive
   */
  private createHttpAgent(): HttpAgent | HttpsAgent {
    const httpConfig = this.config.httpConfig!
    const isHttps = this.config.baseURL.startsWith('https:')
    const isTestEnv =
      process.env.NODE_ENV === 'test' ||
      process.env.JEST_WORKER_ID !== undefined

    const agentOptions = {
      keepAlive: httpConfig.keepAlive,
      keepAliveMsecs: httpConfig.keepAliveTimeout,
      maxSockets: httpConfig.maxSockets,
      maxFreeSockets: httpConfig.maxFreeSockets,
      timeout: httpConfig.connectTimeout,
      // Add socket timeout to prevent hanging connections
      socketTimeout: isTestEnv ? 10000 : 30000,
      // Enable TCP_NODELAY for faster small requests
      noDelay: true,
      // Set scheduling policy for better performance
      scheduling: 'fifo' as const,
    }

    // Add HTTPS-specific options for secure connections
    if (isHttps) {
      Object.assign(agentOptions, {
        // Allow self-signed certificates in development/test environments
        rejectUnauthorized: process.env.NODE_ENV === 'production',
        // Set secure protocol versions
        secureProtocol: 'TLSv1_2_method',
      })
    }

    this.logger.debug(
      `Creating optimized ${isHttps ? 'HTTPS' : 'HTTP'} agent for ${this.config.serviceName}`,
      {
        service: this.config.serviceName,
        keepAlive: agentOptions.keepAlive,
        maxSockets: agentOptions.maxSockets,
        maxFreeSockets: agentOptions.maxFreeSockets,
        timeout: agentOptions.timeout,
        socketTimeout: agentOptions.socketTimeout,
        isTestEnv,
      },
    )

    return isHttps ? new HttpsAgent(agentOptions) : new HttpAgent(agentOptions)
  }

  /**
   * Detect API version from service endpoint
   */
  private async detectApiVersion(
    correlationId: string,
  ): Promise<ApiVersionResult> {
    const versionConfig = this.config.versionConfig!

    if (!versionConfig.enableVersionDetection) {
      const fallbackVersion =
        versionConfig.fallbackVersion ||
        versionConfig.preferredVersion ||
        '3.0.0'
      return {
        version: fallbackVersion,
        detected: false,
        isSupported: versionConfig.supportedVersions.includes(fallbackVersion),
        isCompatible: true,
      }
    }

    this.logger.debug(`Detecting API version for ${this.config.serviceName}`, {
      service: this.config.serviceName,
      correlationId,
      supportedVersions: versionConfig.supportedVersions,
    })

    try {
      // Try different version detection endpoints based on service type
      const versionEndpoints = this.getVersionDetectionEndpoints()

      for (const endpoint of versionEndpoints) {
        try {
          this.logger.debug(`Trying version detection endpoint: ${endpoint}`, {
            service: this.config.serviceName,
            correlationId,
            endpoint,
          })

          const response = await this.axiosInstance.get(endpoint, {
            headers: {
              ...this.getAuthenticationHeaders(),
              'X-Correlation-ID': correlationId,
            },
            timeout: 10000, // Shorter timeout for version detection
          })

          const detectedVersion = this.extractVersionFromResponse(
            response.data,
            endpoint,
          )
          if (detectedVersion) {
            const isSupported =
              versionConfig.supportedVersions.includes(detectedVersion)
            const isCompatible = this.checkVersionCompatibility(
              detectedVersion,
              versionConfig,
            )

            this.logger.debug(
              `API version detected for ${this.config.serviceName}`,
              {
                service: this.config.serviceName,
                detectedVersion,
                isSupported,
                isCompatible,
                endpoint,
                correlationId,
              },
            )

            const result: ApiVersionResult = {
              version: detectedVersion,
              detected: true,
              isSupported,
              isCompatible,
            }

            if (!isSupported && versionConfig.compatibilityMode === 'strict') {
              result.error = `Detected version ${detectedVersion} is not supported`
              result.compatibilityWarnings = [
                `Supported versions: ${versionConfig.supportedVersions.join(', ')}`,
              ]
            } else if (!isSupported) {
              result.compatibilityWarnings = [
                `Version ${detectedVersion} is not officially supported`,
                `Supported versions: ${versionConfig.supportedVersions.join(', ')}`,
                'Using fallback compatibility mode',
              ]
            }

            return result
          }
        } catch (endpointError) {
          this.logger.debug(`Version detection endpoint failed: ${endpoint}`, {
            service: this.config.serviceName,
            endpoint,
            error:
              endpointError instanceof Error
                ? endpointError.message
                : String(endpointError),
            correlationId,
          })
          // Continue to next endpoint
        }
      }

      // All endpoints failed, use fallback
      const fallbackVersion =
        versionConfig.fallbackVersion ||
        versionConfig.preferredVersion ||
        '3.0.0'
      this.logger.warn(
        `API version detection failed for ${this.config.serviceName}, using fallback`,
        {
          service: this.config.serviceName,
          fallbackVersion,
          correlationId,
        },
      )

      return {
        version: fallbackVersion,
        detected: false,
        isSupported: versionConfig.supportedVersions.includes(fallbackVersion),
        isCompatible: true,
        error: 'Version detection failed, using fallback version',
        compatibilityWarnings: ['Could not detect API version from service'],
      }
    } catch (error) {
      const fallbackVersion =
        versionConfig.fallbackVersion ||
        versionConfig.preferredVersion ||
        '3.0.0'
      this.logger.error(
        `Critical error during API version detection for ${this.config.serviceName}`,
        {
          service: this.config.serviceName,
          error: error instanceof Error ? error.message : String(error),
          fallbackVersion,
          correlationId,
        },
      )

      return {
        version: fallbackVersion,
        detected: false,
        isSupported: versionConfig.supportedVersions.includes(fallbackVersion),
        isCompatible: true,
        error: `Version detection error: ${error instanceof Error ? error.message : String(error)}`,
        compatibilityWarnings: ['Version detection failed due to error'],
      }
    }
  }

  /**
   * Get version detection endpoints for different services
   */
  private getVersionDetectionEndpoints(): string[] {
    switch (this.config.serviceName) {
      case 'sonarr':
      case 'radarr':
        return ['/api/v3/system/status', '/system/status', '/health']
      case 'emby':
        return ['/System/Info', '/System/Info/Public', '/health']
      default:
        return ['/health', '/status', '/api/version']
    }
  }

  /**
   * Extract version from API response
   */
  private extractVersionFromResponse(
    data: unknown,
    endpoint: string,
  ): string | null {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null
    }

    // Cast to a more specific type for safe property access
    const responseData = data as Record<string, unknown>

    // Try common version fields
    const versionFields = [
      'version',
      'Version',
      'apiVersion',
      'serverVersion',
      'buildVersion',
    ]
    for (const field of versionFields) {
      if (responseData[field] && typeof responseData[field] === 'string') {
        // Clean version string (remove build info, etc.)
        const cleanVersion = this.cleanVersionString(
          responseData[field] as string,
        )
        if (cleanVersion) {
          return cleanVersion
        }
      }
    }

    // Service-specific version extraction
    switch (this.config.serviceName) {
      case 'sonarr':
      case 'radarr':
        if (endpoint.includes('system/status')) {
          const versionData = (responseData.version ||
            responseData.buildTime) as string
          return this.cleanVersionString(versionData)
        }
        break
      case 'emby':
        if (responseData.ServerVersion) {
          return this.cleanVersionString(responseData.ServerVersion as string)
        }
        break
    }

    return null
  }

  /**
   * Clean and normalize version string
   */
  private cleanVersionString(version: string): string | null {
    if (!version || typeof version !== 'string') {
      return null
    }

    // Extract semantic version (e.g., "3.0.0.1234" -> "3.0.0")
    const versionMatch = version.match(/(\d+\.\d+\.\d+)/)
    return versionMatch ? versionMatch[1] : null
  }

  /**
   * Check if a version is compatible based on configuration
   */
  private checkVersionCompatibility(
    version: string,
    config: ApiVersionConfig,
  ): boolean {
    const { supportedVersions, compatibilityMode } = config

    if (supportedVersions.includes(version)) {
      return true
    }

    if (compatibilityMode === 'strict') {
      return false
    }

    if (compatibilityMode === 'loose' || compatibilityMode === 'fallback') {
      // Allow compatible major versions
      const [majorVersion] = version.split('.')
      return supportedVersions.some(supported => {
        const [supportedMajor] = supported.split('.')
        return supportedMajor === majorVersion
      })
    }

    return false
  }

  /**
   * Get authentication headers for API requests
   *
   * @abstract
   * @protected
   * @returns Object containing authentication headers (typically API key)
   *
   * @example
   * ```typescript
   * protected getAuthenticationHeaders(): Record<string, string> {
   *   return { 'X-Api-Key': this.apiKey }
   * }
   * ```
   *
   * @since 1.0.0
   */
  protected abstract getAuthenticationHeaders(): Record<string, string>

  /**
   * Get authentication query parameters for API requests
   *
   * Some services (like Emby) require authentication via query parameters
   * instead of or in addition to headers.
   *
   * @protected
   * @returns Object containing authentication query parameters, or empty object if not needed
   *
   * @example
   * ```typescript
   * // For Emby
   * protected getAuthenticationParams(): Record<string, string> {
   *   return {
   *     api_key: this.apiKey,
   *     userId: this.userId
   *   }
   * }
   *
   * // For Sonarr/Radarr (default)
   * protected getAuthenticationParams(): Record<string, string> {
   *   return {} // Use headers only
   * }
   * ```
   *
   * @since 1.0.0
   */
  protected getAuthenticationParams(): Record<string, string> {
    return {} // Default implementation for services that use headers only
  }

  /**
   * Validate service-specific configuration and test connectivity
   *
   * This method should perform a basic connectivity test and authentication
   * verification to ensure the service is properly configured and accessible.
   *
   * @abstract
   * @protected
   * @returns Promise resolving to connection test results
   *
   * @example
   * ```typescript
   * protected async validateServiceConfiguration(): Promise<ConnectionTestResult> {
   *   const startTime = Date.now()
   *   try {
   *     await this.get('/health', uuid())
   *     return {
   *       canConnect: true,
   *       isAuthenticated: true,
   *       responseTime: Date.now() - startTime,
   *     }
   *   } catch (error) {
   *     return {
   *       canConnect: false,
   *       isAuthenticated: false,
   *       responseTime: Date.now() - startTime,
   *       error: error.message,
   *       suggestions: ['Check service URL', 'Verify API key'],
   *     }
   *   }
   * }
   * ```
   *
   * @since 1.0.0
   */
  protected abstract validateServiceConfiguration(): Promise<ConnectionTestResult>

  /**
   * Get service capabilities and supported features with version detection
   *
   * This method should return what operations the service supports,
   * such as search, request submission, monitoring, and media types.
   * It now includes dynamic API version detection and compatibility checking.
   *
   * @abstract
   * @protected
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to service capabilities
   *
   * @example
   * ```typescript
   * protected async getServiceCapabilities(correlationId: string): Promise<ServiceCapabilities> {
   *   const apiVersion = await this.getApiVersion(correlationId)
   *   return {
   *     canSearch: true,
   *     canRequest: true,
   *     canMonitor: apiVersion.isCompatible,
   *     supportedMediaTypes: ['movie'], // or ['tv'] for Sonarr
   *     version: apiVersion.version,
   *     apiVersion,
   *     featureLimitations: apiVersion.isSupported ? [] : ['Limited feature set due to version compatibility'],
   *   }
   * }
   * ```
   *
   * @since 1.0.0
   */
  protected abstract getServiceCapabilities(
    correlationId: string,
  ): Promise<ServiceCapabilities>

  /**
   * Perform comprehensive health check on the service
   *
   * This method should verify that the service is responding correctly,
   * measure response times, and gather version/status information.
   *
   * @abstract
   * @protected
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to health check results
   *
   * @example
   * ```typescript
   * protected async performHealthCheck(correlationId: string): Promise<HealthCheckResult> {
   *   const startTime = Date.now()
   *   try {
   *     const health = await this.get('/health', correlationId)
   *     return {
   *       isHealthy: true,
   *       responseTime: Date.now() - startTime,
   *       lastChecked: new Date(),
   *       version: health.version,
   *       status: health.status,
   *     }
   *   } catch (error) {
   *     return {
   *       isHealthy: false,
   *       responseTime: Date.now() - startTime,
   *       lastChecked: new Date(),
   *       error: error.message,
   *     }
   *   }
   * }
   * ```
   *
   * @since 1.0.0
   */
  protected abstract performHealthCheck(
    correlationId: string,
  ): Promise<HealthCheckResult>

  /**
   * Get mapping of service-specific API endpoints
   *
   * This method should return a map of logical endpoint names to their
   * actual API paths for documentation and diagnostic purposes.
   *
   * @abstract
   * @protected
   * @returns Object mapping endpoint names to API paths
   *
   * @example
   * ```typescript
   * protected getApiEndpoints(): Record<string, string> {
   *   return {
   *     health: '/health',
   *     movies: '/api/v3/movie',
   *     search: '/api/v3/movie/lookup',
   *     queue: '/api/v3/queue',
   *   }
   * }
   * ```
   *
   * @since 1.0.0
   */
  protected abstract getApiEndpoints(): Record<string, string>

  /**
   * Get error category for retry logic
   */
  protected getErrorCategory(): ErrorCategory {
    return ErrorCategory.MEDIA_API
  }

  /**
   * Get retry configuration for this API client
   */
  protected getRetryConfiguration(): RetryConfiguration {
    return {
      maxAttempts: this.config.maxRetries,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      backoffFactor: 2,
      retryableErrorTypes: [
        'MediaRateLimitError',
        'MediaServiceUnavailableError',
        'MediaNotFoundApiError',
        'MediaNetworkError',
      ],
    }
  }

  /**
   * Get optimized retry configuration based on request type and environment
   */
  protected getOptimizedRetryConfig(method: string, path: string) {
    const isTestEnv =
      process.env.NODE_ENV === 'test' ||
      process.env.JEST_WORKER_ID !== undefined
    const isHealthCheck =
      path.includes('/health') || path.includes('/system/status')
    const isQuickOperation =
      method === 'GET' && (isHealthCheck || path.includes('/lookup'))

    // Base configuration
    const baseConfig = {
      maxAttempts: this.config.maxRetries,
      baseDelay: isTestEnv ? 500 : 1000, // Faster retries in tests
      maxDelay: isTestEnv ? 10000 : 30000, // Shorter max delay in tests
      backoffFactor: isTestEnv ? 1.5 : 2, // Less aggressive backoff in tests
      jitter: true,
      timeout: this.config.timeout,
      logRetryAttempts: !isTestEnv, // Reduce log noise in tests
      logRetryDelays: !isTestEnv,
    }

    // Optimize for quick operations
    if (isQuickOperation) {
      return {
        ...baseConfig,
        maxAttempts: Math.min(this.config.maxRetries, 2), // Fewer retries for health checks
        baseDelay: isTestEnv ? 250 : 500, // Very fast retries
        maxDelay: isTestEnv ? 2000 : 5000, // Short max delay
      }
    }

    // Optimize for test environment
    if (isTestEnv) {
      return {
        ...baseConfig,
        // Reduce total retry time in tests to prevent hangs
        maxAttempts: Math.min(this.config.maxRetries, 3),
        timeout: Math.min(this.config.timeout, 15000), // Shorter timeout in tests
      }
    }

    return baseConfig
  }

  /**
   * Create appropriate MediaApiError subclass based on HTTP status and error type
   */
  private createMediaApiError(
    error: Error,
    correlationId: string,
    method: string,
    path: string,
  ): MediaApiError {
    const axiosError = error as AxiosError
    const operation = `${method} ${path}`

    // Handle network/connection errors (no HTTP response)
    if (!axiosError.response && axiosError.code) {
      return new MediaNetworkError(
        this.config.serviceName,
        operation,
        axiosError.code,
        correlationId,
        {},
        error,
      )
    }

    const status = axiosError.response?.status
    if (!status) {
      // Unknown error without status code
      return new MediaNetworkError(
        this.config.serviceName,
        operation,
        'UNKNOWN_ERROR',
        correlationId,
        {},
        error,
      )
    }

    // Handle HTTP status code specific errors
    return this.mapHttpStatusToError(
      status,
      operation,
      correlationId,
      axiosError,
    )
  }

  /**
   * Map HTTP status codes to appropriate MediaApiError subclasses
   */
  private mapHttpStatusToError(
    status: number,
    operation: string,
    correlationId: string,
    axiosError: AxiosError,
  ): MediaApiError {
    const errorMessage = this.formatErrorMessage(axiosError, 'API', operation)

    switch (status) {
      case 401:
        return new MediaAuthenticationError(
          this.config.serviceName,
          operation,
          correlationId,
          { originalError: errorMessage },
        )

      case 429: {
        const retryAfterSeconds = this.extractRetryAfterSeconds(
          axiosError.response?.headers,
        )
        return new MediaRateLimitError(
          this.config.serviceName,
          operation,
          retryAfterSeconds,
          correlationId,
          { originalError: errorMessage },
        )
      }

      case 404:
        return new MediaNotFoundApiError(
          this.config.serviceName,
          operation,
          'resource',
          'unknown',
          correlationId,
          { originalError: errorMessage, httpStatus: status },
        )

      case 400:
      case 422: {
        const validationDetails = this.extractValidationDetails(axiosError)
        return new MediaValidationApiError(
          this.config.serviceName,
          operation,
          validationDetails,
          correlationId,
          { originalError: errorMessage, httpStatus: status },
        )
      }

      case 500:
      case 502:
      case 503:
      case 504:
        return new MediaServiceUnavailableError(
          this.config.serviceName,
          operation,
          status,
          correlationId,
          { originalError: errorMessage },
          axiosError,
        )

      default:
        // For any other status code, use the most appropriate error type
        if (status >= 500) {
          return new MediaServiceUnavailableError(
            this.config.serviceName,
            operation,
            status,
            correlationId,
            { originalError: errorMessage },
            axiosError,
          )
        } else {
          return new MediaValidationApiError(
            this.config.serviceName,
            operation,
            `HTTP ${status}: ${errorMessage}`,
            correlationId,
            { originalError: errorMessage, httpStatus: status },
          )
        }
    }
  }

  /**
   * Format error message with context
   */
  private formatErrorMessage(
    axiosError: AxiosError,
    method: string,
    operation: string,
  ): string {
    const status = axiosError.response?.status
    const statusText = axiosError.response?.statusText

    let message = `${this.config.serviceName.toUpperCase()} API ${operation} failed`

    if (status) {
      message += ` with status ${status}`
      if (statusText) {
        message += ` (${statusText})`
      }
    }

    if (axiosError.message) {
      message += `: ${axiosError.message}`
    }

    return message
  }

  /**
   * Extract retry-after seconds from response headers
   */
  private extractRetryAfterSeconds(
    headers?: Record<string, unknown>,
  ): number | undefined {
    if (!headers) return undefined

    const retryAfter = headers['retry-after'] || headers['Retry-After']
    if (typeof retryAfter === 'string') {
      const seconds = parseInt(retryAfter, 10)
      return isNaN(seconds) ? undefined : seconds
    }

    return undefined
  }

  /**
   * Extract validation details from error response
   */
  private extractValidationDetails(axiosError: AxiosError): string {
    const responseData = axiosError.response?.data as Record<string, unknown>

    if (responseData?.message) {
      return String(responseData.message)
    }

    if (responseData?.error) {
      return String(responseData.error)
    }

    if (responseData?.errors && Array.isArray(responseData.errors)) {
      return responseData.errors.join('; ')
    }

    return axiosError.message || 'Invalid request data'
  }

  /**
   * Handle specific HTTP status codes and provide context-aware logging
   */
  protected handleHttpError(
    status: number,
    correlationId: string,
    operation?: string,
    retryAttempt?: number,
  ): void {
    const serviceName = this.config.serviceName.toUpperCase()
    const logContext = {
      status,
      correlationId,
      service: this.config.serviceName,
      operation,
      retryAttempt,
    }

    switch (status) {
      case 401:
        this.logger.error(`${serviceName} authentication failed`, {
          ...logContext,
          severity: 'critical',
          suggestion: 'Check API key configuration and permissions',
          retryable: false,
        })
        break

      case 403:
        this.logger.error(`${serviceName} access forbidden`, {
          ...logContext,
          severity: 'high',
          suggestion: 'Check API permissions and user access rights',
          retryable: false,
        })
        break

      case 404:
        this.logger.warn(`${serviceName} resource not found`, {
          ...logContext,
          severity: 'low',
          suggestion:
            'Resource may not exist or may be temporarily unavailable',
          retryable: true,
        })
        break

      case 429:
        this.logger.warn(`${serviceName} rate limit exceeded`, {
          ...logContext,
          severity: 'medium',
          suggestion:
            'Requests are being rate limited, will retry with exponential backoff',
          retryable: true,
        })
        break

      case 400:
      case 422:
        this.logger.warn(`${serviceName} validation error`, {
          ...logContext,
          severity: 'medium',
          suggestion: 'Check request data format and required fields',
          retryable: false,
        })
        break

      case 500:
        this.logger.error(`${serviceName} internal server error`, {
          ...logContext,
          severity: 'high',
          suggestion: 'Server-side error, will retry with backoff',
          retryable: true,
        })
        break

      case 502:
        this.logger.warn(`${serviceName} bad gateway`, {
          ...logContext,
          severity: 'medium',
          suggestion: 'Gateway error, service may be restarting',
          retryable: true,
        })
        break

      case 503:
        this.logger.warn(`${serviceName} service unavailable`, {
          ...logContext,
          severity: 'medium',
          suggestion:
            'Service temporarily unavailable, will retry with backoff',
          retryable: true,
        })
        break

      case 504:
        this.logger.warn(`${serviceName} gateway timeout`, {
          ...logContext,
          severity: 'medium',
          suggestion: 'Gateway timeout, request took too long',
          retryable: true,
        })
        break

      default:
        this.logger.debug(`${serviceName} HTTP error`, {
          ...logContext,
          severity: status >= 500 ? 'medium' : 'low',
          retryable: status >= 500,
        })
    }
  }

  /**
   * Log error context with correlation tracking
   */
  protected logErrorContext(
    error: MediaApiError,
    operation: string,
    retryAttempt?: number,
  ): void {
    this.logger.error(
      `${this.config.serviceName.toUpperCase()} ${error.constructor.name}`,
      {
        correlationId: error.correlationId,
        service: error.service,
        operation: error.operation,
        httpStatus: error.httpStatus,
        retryable: error.isRetryable,
        retryDelayMs: error.retryDelayMs,
        retryAttempt,
        errorContext: error.context,
        userMessage: error.toUserMessage(),
      },
    )
  }

  /**
   * Get service configuration for debugging
   */
  public getServiceInfo(): {
    serviceName: string
    baseURL: string
    timeout: number
    maxRetries: number
    httpConfig: HttpConnectionConfig
    versionConfig: ApiVersionConfig
    detectedApiVersion?: ApiVersionResult
  } {
    return {
      serviceName: this.config.serviceName,
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
      httpConfig: this.config.httpConfig!,
      versionConfig: this.config.versionConfig!,
      detectedApiVersion: this.detectedApiVersion,
    }
  }

  /**
   * Cleanup resources when client is destroyed
   */
  public destroy(): void {
    this.logger.debug(`Destroying ${this.config.serviceName} API client`, {
      service: this.config.serviceName,
    })

    // Destroy HTTP agent and close connections
    if (this.httpAgent) {
      this.httpAgent.destroy()
    }

    // Clear detected version cache
    this.detectedApiVersion = undefined
  }

  /**
   * Force connection cleanup - useful between tests
   */
  public async forceCleanup(): Promise<void> {
    this.logger.debug(
      `Force cleanup for ${this.config.serviceName} API client`,
      {
        service: this.config.serviceName,
      },
    )

    // Destroy current agent
    if (this.httpAgent) {
      this.httpAgent.destroy()
    }

    // Create new agent to ensure clean state
    this.httpAgent = this.createHttpAgent()

    // Small delay to ensure connections are properly closed
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  /**
   * Get connection statistics for monitoring
   */
  public getConnectionStats(): {
    maxSockets: number
    maxFreeSockets: number
    keepAlive: boolean
    keepAliveTimeout: number
    connectTimeout: number
    baseURL: string
    serviceName: string
  } {
    const httpConfig = this.config.httpConfig!
    return {
      maxSockets: httpConfig.maxSockets || 10,
      maxFreeSockets: httpConfig.maxFreeSockets || 5,
      keepAlive: httpConfig.keepAlive || true,
      keepAliveTimeout: httpConfig.keepAliveTimeout || 5000,
      connectTimeout: httpConfig.connectTimeout || 10000,
      baseURL: this.config.baseURL,
      serviceName: this.config.serviceName,
    }
  }

  /**
   * Test connection to the service and validate configuration
   * This is a public method that orchestrates the service validation
   */
  public async testConnection(
    correlationId: string,
  ): Promise<ConnectionTestResult> {
    this.logger.debug(`Testing connection to ${this.config.serviceName}`, {
      correlationId,
      service: this.config.serviceName,
      baseURL: this.config.baseURL,
    })

    try {
      const result = await this.validateServiceConfiguration()

      this.mediaLoggingService.logOperation(
        'connection_test',
        `Connection test for ${this.config.serviceName}: ${result.canConnect ? 'success' : 'failed'}`,
        {
          correlationId,
          service: this.config.serviceName,
          action: 'connection_test',
          timestamp: new Date(),
        },
      )

      return result
    } catch (error) {
      const connectionError: ConnectionTestResult = {
        canConnect: false,
        isAuthenticated: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: [
          `Check if ${this.config.serviceName} service is running`,
          `Verify ${this.config.serviceName.toUpperCase()}_URL is correct`,
          `Check API key configuration`,
          'Ensure network connectivity between services',
        ],
      }

      this.mediaLoggingService.logOperation(
        'connection_test_failed',
        `Connection test for ${this.config.serviceName} failed: ${connectionError.error}`,
        {
          correlationId,
          service: this.config.serviceName,
          action: 'connection_test_failed',
          timestamp: new Date(),
        },
      )

      return connectionError
    }
  }

  /**
   * Get detected API version information
   */
  public async getApiVersion(correlationId: string): Promise<ApiVersionResult> {
    if (!this.detectedApiVersion) {
      this.detectedApiVersion = await this.detectApiVersion(correlationId)
    }
    return this.detectedApiVersion
  }

  /**
   * Force API version re-detection (useful for health checks)
   */
  public async refreshApiVersion(
    correlationId: string,
  ): Promise<ApiVersionResult> {
    this.detectedApiVersion = await this.detectApiVersion(correlationId)
    return this.detectedApiVersion
  }

  /**
   * Get service capabilities (public wrapper for abstract method)
   */
  public async getCapabilities(
    correlationId: string,
  ): Promise<ServiceCapabilities> {
    return this.getServiceCapabilities(correlationId)
  }

  /**
   * Perform health check (public wrapper for abstract method)
   */
  public async checkHealth(correlationId: string): Promise<HealthCheckResult> {
    const startTime = Date.now()

    try {
      const result = await this.performHealthCheck(correlationId)

      // Include API version information in health check
      if (!result.apiVersion) {
        try {
          result.apiVersion = await this.getApiVersion(correlationId)
        } catch (versionError) {
          this.logger.warn(
            `Could not get API version during health check for ${this.config.serviceName}`,
            {
              service: this.config.serviceName,
              error:
                versionError instanceof Error
                  ? versionError.message
                  : String(versionError),
              correlationId,
            },
          )
        }
      }

      this.mediaLoggingService.logPerformance(
        `${this.config.serviceName}_health_check`,
        startTime,
        correlationId,
        result.isHealthy,
        {
          service: this.config.serviceName,
          version: result.version,
          status: result.status,
          apiVersion: result.apiVersion?.version,
          apiVersionSupported: result.apiVersion?.isSupported,
          apiVersionCompatible: result.apiVersion?.isCompatible,
        },
      )

      return result
    } catch (error) {
      const healthResult: HealthCheckResult = {
        isHealthy: false,
        error: error instanceof Error ? error.message : String(error),
        lastChecked: new Date(),
        responseTime: Date.now() - startTime,
      }

      this.mediaLoggingService.logPerformance(
        `${this.config.serviceName}_health_check`,
        startTime,
        correlationId,
        false,
        {
          service: this.config.serviceName,
          error: healthResult.error,
        },
      )

      return healthResult
    }
  }

  /**
   * Get available API endpoints for the service
   */
  public getEndpoints(): Record<string, string> {
    return this.getApiEndpoints()
  }

  /**
   * Comprehensive service diagnostics
   * Combines connection test, health check, and capabilities
   */
  public async runDiagnostics(correlationId: string): Promise<{
    connection: ConnectionTestResult
    health: HealthCheckResult
    capabilities: ServiceCapabilities
    endpoints: Record<string, string>
    summary: {
      isOperational: boolean
      issues: string[]
      recommendations: string[]
    }
  }> {
    this.logger.debug(`Running diagnostics for ${this.config.serviceName}`, {
      correlationId,
      service: this.config.serviceName,
    })

    const diagnostics = {
      connection: await this.testConnection(correlationId),
      health: await this.checkHealth(correlationId),
      capabilities: await this.getCapabilities(correlationId),
      endpoints: this.getEndpoints(),
      apiVersion: await this.getApiVersion(correlationId),
      httpConfig: this.config.httpConfig,
      summary: {
        isOperational: false,
        issues: [] as string[],
        recommendations: [] as string[],
      },
    }

    // Analyze results and provide summary
    const { connection, health, capabilities, apiVersion } = diagnostics
    const issues: string[] = []
    const recommendations: string[] = []

    if (!connection.canConnect) {
      issues.push('Cannot connect to service')
      recommendations.push(...(connection.suggestions || []))
    }

    if (!connection.isAuthenticated) {
      issues.push('Authentication failed')
      recommendations.push('Check API key configuration')
    }

    if (!health.isHealthy) {
      issues.push('Service health check failed')
      if (health.error) {
        issues.push(`Health error: ${health.error}`)
      }
      recommendations.push('Check service logs for errors')
    }

    if (!capabilities.canSearch && !capabilities.canRequest) {
      issues.push('Service has no usable capabilities')
      recommendations.push('Check service configuration and permissions')
    }

    if (connection.responseTime && connection.responseTime > 5000) {
      issues.push('Slow response time detected')
      recommendations.push('Check network connectivity and service performance')
    }

    // Only treat version detection failure as an issue if the service is truly unusable
    if (!apiVersion.detected && !apiVersion.isSupported) {
      issues.push('Could not detect API version and service may be unsupported')
      recommendations.push(
        'Check service endpoints, authentication, and version compatibility',
      )
    } else if (!apiVersion.detected) {
      // Version detection failed but service is still supported - treat as recommendation only
      recommendations.push(
        'API version detection failed but service appears functional - check service endpoints if issues occur',
      )
    }

    if (!apiVersion.isSupported) {
      issues.push(
        `API version ${apiVersion.version} is not officially supported`,
      )
      recommendations.push(
        `Consider upgrading to a supported version: ${this.config.versionConfig?.supportedVersions.join(', ')}`,
      )
    }

    if (!apiVersion.isCompatible) {
      issues.push('API version is not compatible')
      recommendations.push('Service may have limited functionality')
    }

    // Treat compatibility warnings as recommendations, not critical issues
    if (apiVersion.compatibilityWarnings?.length) {
      recommendations.push(
        ...apiVersion.compatibilityWarnings.map(
          warning => `Version warning: ${warning}`,
        ),
      )
    }

    diagnostics.summary = {
      isOperational:
        connection.canConnect && connection.isAuthenticated && health.isHealthy,
      issues,
      recommendations,
    }

    this.mediaLoggingService.logOperation(
      'service_diagnostics',
      `Diagnostics for ${this.config.serviceName} completed`,
      {
        correlationId,
        service: this.config.serviceName,
        action: 'service_diagnostics',
        timestamp: new Date(),
      },
    )

    return diagnostics
  }
}
