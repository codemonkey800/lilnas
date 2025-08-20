/**
 * Media Service Configuration Validation
 *
 * This module provides comprehensive validation for all media service configurations
 * including environment variable checks, URL validation, and service-specific requirements.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { URL } from 'url'

import { EnvKey } from 'src/utils/env'

// ConfigService interface with proper generic constraints
interface ConfigService {
  get<T = string>(propertyPath: string): T | undefined
  get<T = string>(propertyPath: string, defaultValue: T): T
}

export interface MediaServiceConfig {
  sonarr: SonarrConfig
  radarr: RadarrConfig
  emby: EmbyConfig
}

export interface HttpConnectionConfig {
  maxSockets?: number
  maxFreeSockets?: number
  keepAliveTimeout?: number
  keepAlive?: boolean
  connectTimeout?: number
  maxContentLength?: number
  maxRedirects?: number
}

export interface ApiVersionConfig {
  supportedVersions: string[]
  preferredVersion?: string
  enableVersionDetection?: boolean
  fallbackVersion?: string
  compatibilityMode: 'strict' | 'loose' | 'fallback'
}

export interface SonarrConfig {
  url: string
  apiKey: string
  timeout: number
  maxRetries: number
  isValidated: boolean
  httpConfig?: HttpConnectionConfig
  versionConfig?: ApiVersionConfig
}

export interface RadarrConfig {
  url: string
  apiKey: string
  timeout: number
  maxRetries: number
  isValidated: boolean
  httpConfig?: HttpConnectionConfig
  versionConfig?: ApiVersionConfig
}

export interface EmbyConfig {
  url: string
  apiKey: string
  userId: string
  timeout: number
  maxRetries: number
  isValidated: boolean
  httpConfig?: HttpConnectionConfig
  versionConfig?: ApiVersionConfig
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  serviceStatus: {
    sonarr: 'valid' | 'invalid' | 'partial'
    radarr: 'valid' | 'invalid' | 'partial'
    emby: 'valid' | 'invalid' | 'partial'
  }
}

export interface ServiceHealthStatus {
  service: 'sonarr' | 'radarr' | 'emby'
  isHealthy: boolean
  responseTime?: number
  error?: string
  lastChecked: Date
}

@Injectable()
export class MediaConfigValidationService implements OnModuleInit {
  private readonly logger = new Logger(MediaConfigValidationService.name)
  private mediaConfig?: MediaServiceConfig
  private lastValidation?: ValidationResult

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing media service configuration validation')

    try {
      const config = this.loadConfiguration()
      const validation = this.validateConfiguration(config)

      if (!validation.isValid) {
        this.logger.error('Media service configuration validation failed', {
          errors: validation.errors,
          warnings: validation.warnings,
          serviceStatus: validation.serviceStatus,
        })

        // Log specific guidance for each service failure
        this.logServiceGuidance(validation)

        throw new Error(
          'Invalid media service configuration. Check the logs for details.',
        )
      }

      this.mediaConfig = config
      this.lastValidation = validation

      if (validation.warnings.length > 0) {
        this.logger.warn('Media service configuration has warnings', {
          warnings: validation.warnings,
        })
      }

      this.logger.log('Media service configuration validation successful', {
        serviceStatus: validation.serviceStatus,
      })
    } catch (error) {
      this.logger.error('Failed to initialize media configuration', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Get default HTTP connection configuration
   */
  private getDefaultHttpConfig(): HttpConnectionConfig {
    return {
      maxSockets: parseInt(process.env.MEDIA_HTTP_MAX_SOCKETS || '10'),
      maxFreeSockets: parseInt(process.env.MEDIA_HTTP_MAX_FREE_SOCKETS || '5'),
      keepAliveTimeout: parseInt(
        process.env.MEDIA_HTTP_KEEP_ALIVE_TIMEOUT || '5000',
      ),
      keepAlive: process.env.MEDIA_HTTP_KEEP_ALIVE !== 'false',
      connectTimeout: parseInt(
        process.env.MEDIA_HTTP_CONNECT_TIMEOUT || '10000',
      ),
      maxContentLength: parseInt(
        process.env.MEDIA_HTTP_MAX_CONTENT_LENGTH || '10485760',
      ), // 10MB
      maxRedirects: parseInt(process.env.MEDIA_HTTP_MAX_REDIRECTS || '5'),
    }
  }

  /**
   * Get default version configuration for service
   */
  private getDefaultVersionConfig(
    serviceName: 'sonarr' | 'radarr' | 'emby',
  ): ApiVersionConfig {
    const serviceDefaults = {
      sonarr: {
        supportedVersions: ['3.0.0', '2.0.0'],
        preferredVersion: '3.0.0',
        fallbackVersion: '3.0.0',
      },
      radarr: {
        supportedVersions: ['3.0.0', '2.0.0'],
        preferredVersion: '3.0.0',
        fallbackVersion: '3.0.0',
      },
      emby: {
        supportedVersions: ['4.7.0', '4.6.0', '4.5.0'],
        preferredVersion: '4.7.0',
        fallbackVersion: '4.7.0',
      },
    }

    const defaults = serviceDefaults[serviceName]
    const compatibilityMode = (process.env.MEDIA_VERSION_COMPATIBILITY_MODE ||
      'fallback') as 'strict' | 'loose' | 'fallback'

    return {
      ...defaults,
      enableVersionDetection: process.env.MEDIA_VERSION_DETECTION !== 'false',
      compatibilityMode,
    }
  }

  /**
   * Load configuration from environment variables
   */
  private loadConfiguration(): MediaServiceConfig {
    const sonarrUrl = this.getRequiredEnvVar('SONARR_URL', 'http://sonarr:8989')
    const sonarrApiKey = this.getRequiredEnvVar('SONARR_API_KEY')

    const radarrUrl = this.getRequiredEnvVar('RADARR_URL', 'http://radarr:7878')
    const radarrApiKey = this.getRequiredEnvVar('RADARR_API_KEY')

    const embyUrl = this.getRequiredEnvVar('EMBY_URL', 'http://emby:8096')
    const embyApiKey = this.getRequiredEnvVar('EMBY_API_TOKEN')
    const embyUserId = this.getRequiredEnvVar('EMBY_USER_ID')

    return {
      sonarr: {
        url: sonarrUrl,
        apiKey: sonarrApiKey,
        timeout: 30000, // 30 seconds
        maxRetries: 3,
        isValidated: false,
        httpConfig: this.getDefaultHttpConfig(),
        versionConfig: this.getDefaultVersionConfig('sonarr'),
      },
      radarr: {
        url: radarrUrl,
        apiKey: radarrApiKey,
        timeout: 30000, // 30 seconds
        maxRetries: 3,
        isValidated: false,
        httpConfig: this.getDefaultHttpConfig(),
        versionConfig: this.getDefaultVersionConfig('radarr'),
      },
      emby: {
        url: embyUrl,
        apiKey: embyApiKey,
        userId: embyUserId,
        timeout: 30000, // 30 seconds
        maxRetries: 3,
        isValidated: false,
        httpConfig: this.getDefaultHttpConfig(),
        versionConfig: this.getDefaultVersionConfig('emby'),
      },
    }
  }

  /**
   * Validate the complete media service configuration
   */
  private validateConfiguration(config: MediaServiceConfig): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Validate Sonarr configuration
    const sonarrValidation = this.validateSonarrConfig(config.sonarr)
    errors.push(...sonarrValidation.errors)
    warnings.push(...sonarrValidation.warnings)

    // Validate Radarr configuration
    const radarrValidation = this.validateRadarrConfig(config.radarr)
    errors.push(...radarrValidation.errors)
    warnings.push(...radarrValidation.warnings)

    // Validate Emby configuration
    const embyValidation = this.validateEmbyConfig(config.emby)
    errors.push(...embyValidation.errors)
    warnings.push(...embyValidation.warnings)

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      serviceStatus: {
        sonarr: sonarrValidation.status,
        radarr: radarrValidation.status,
        emby: embyValidation.status,
      },
    }
  }

  /**
   * Validate Sonarr-specific configuration
   */
  private validateSonarrConfig(config: SonarrConfig): {
    errors: string[]
    warnings: string[]
    status: 'valid' | 'invalid' | 'partial'
  } {
    const errors: string[] = []
    const warnings: string[] = []

    // Validate URL
    if (!this.isValidUrl(config.url)) {
      errors.push(`Invalid Sonarr URL: ${config.url}`)
    }

    // Validate API key format (basic check)
    if (!this.isValidApiKey(config.apiKey)) {
      errors.push('Invalid Sonarr API key format')
    }

    // Check URL accessibility patterns
    if (
      config.url.includes('localhost') &&
      process.env.NODE_ENV === 'production'
    ) {
      warnings.push('Sonarr URL uses localhost in production environment')
    }

    // Validate timeout settings
    if (config.timeout < 5000 || config.timeout > 120000) {
      warnings.push(
        `Sonarr timeout (${config.timeout}ms) outside recommended range (5000-120000ms)`,
      )
    }

    return {
      errors,
      warnings,
      status:
        errors.length === 0
          ? warnings.length > 0
            ? 'partial'
            : 'valid'
          : 'invalid',
    }
  }

  /**
   * Validate Radarr-specific configuration
   */
  private validateRadarrConfig(config: RadarrConfig): {
    errors: string[]
    warnings: string[]
    status: 'valid' | 'invalid' | 'partial'
  } {
    const errors: string[] = []
    const warnings: string[] = []

    // Validate URL
    if (!this.isValidUrl(config.url)) {
      errors.push(`Invalid Radarr URL: ${config.url}`)
    }

    // Validate API key format
    if (!this.isValidApiKey(config.apiKey)) {
      errors.push('Invalid Radarr API key format')
    }

    // Check URL accessibility patterns
    if (
      config.url.includes('localhost') &&
      process.env.NODE_ENV === 'production'
    ) {
      warnings.push('Radarr URL uses localhost in production environment')
    }

    // Validate timeout settings
    if (config.timeout < 5000 || config.timeout > 120000) {
      warnings.push(
        `Radarr timeout (${config.timeout}ms) outside recommended range (5000-120000ms)`,
      )
    }

    return {
      errors,
      warnings,
      status:
        errors.length === 0
          ? warnings.length > 0
            ? 'partial'
            : 'valid'
          : 'invalid',
    }
  }

  /**
   * Validate Emby-specific configuration
   */
  private validateEmbyConfig(config: EmbyConfig): {
    errors: string[]
    warnings: string[]
    status: 'valid' | 'invalid' | 'partial'
  } {
    const errors: string[] = []
    const warnings: string[] = []

    // Validate URL
    if (!this.isValidUrl(config.url)) {
      errors.push(`Invalid Emby URL: ${config.url}`)
    }

    // Validate API key format
    if (!this.isValidApiKey(config.apiKey)) {
      errors.push('Invalid Emby API key format')
    }

    // Validate User ID format (should be UUID-like)
    if (!this.isValidEmbyUserId(config.userId)) {
      errors.push('Invalid Emby User ID format (should be a valid UUID)')
    }

    // Check URL accessibility patterns
    if (
      config.url.includes('localhost') &&
      process.env.NODE_ENV === 'production'
    ) {
      warnings.push('Emby URL uses localhost in production environment')
    }

    // Validate timeout settings
    if (config.timeout < 5000 || config.timeout > 120000) {
      warnings.push(
        `Emby timeout (${config.timeout}ms) outside recommended range (5000-120000ms)`,
      )
    }

    return {
      errors,
      warnings,
      status:
        errors.length === 0
          ? warnings.length > 0
            ? 'partial'
            : 'valid'
          : 'invalid',
    }
  }

  /**
   * Validate URL format and basic accessibility
   */
  private isValidUrl(urlString: string): boolean {
    try {
      const url = new URL(urlString)
      return ['http:', 'https:'].includes(url.protocol)
    } catch {
      return false
    }
  }

  /**
   * Validate API key format (basic length and character check)
   */
  private isValidApiKey(apiKey: string): boolean {
    // API keys should be at least 16 characters and contain alphanumeric characters
    if (!apiKey || typeof apiKey !== 'string') {
      return false
    }
    return apiKey.length >= 16 && /^[a-zA-Z0-9]+$/.test(apiKey)
  }

  /**
   * Validate Emby User ID format (should be UUID-like)
   */
  private isValidEmbyUserId(userId: string): boolean {
    // Check if it's a valid UUID format
    if (!userId || typeof userId !== 'string') {
      return false
    }
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    return uuidRegex.test(userId)
  }

  /**
   * Get required environment variable with optional default
   */
  private getRequiredEnvVar(key: EnvKey, defaultValue?: string): string {
    const value = this.configService.get<string>(key) || defaultValue

    if (!value) {
      throw new Error(`Required environment variable ${key} is not set`)
    }

    return value
  }

  /**
   * Log service-specific guidance for configuration issues
   */
  private logServiceGuidance(validation: ValidationResult): void {
    const { serviceStatus, errors } = validation

    if (serviceStatus.sonarr === 'invalid') {
      this.logger.error('Sonarr Configuration Issues:', {
        requiredVars: ['SONARR_URL', 'SONARR_API_KEY'],
        defaultUrl: 'http://sonarr:8989',
        guidance: 'Check Sonarr container is running and API key is correct',
        errors: errors.filter(e => e.includes('Sonarr')),
      })
    }

    if (serviceStatus.radarr === 'invalid') {
      this.logger.error('Radarr Configuration Issues:', {
        requiredVars: ['RADARR_URL', 'RADARR_API_KEY'],
        defaultUrl: 'http://radarr:7878',
        guidance: 'Check Radarr container is running and API key is correct',
        errors: errors.filter(e => e.includes('Radarr')),
      })
    }

    if (serviceStatus.emby === 'invalid') {
      this.logger.error('Emby Configuration Issues:', {
        requiredVars: ['EMBY_URL', 'EMBY_API_TOKEN', 'EMBY_USER_ID'],
        defaultUrl: 'http://emby:8096',
        guidance:
          'Check Emby container is running, API key is correct, and User ID is valid UUID',
        errors: errors.filter(e => e.includes('Emby')),
      })
    }
  }

  /**
   * Get the validated configuration
   */
  getConfiguration(): MediaServiceConfig {
    if (!this.mediaConfig) {
      throw new Error(
        'Media configuration not initialized. Call onModuleInit() first.',
      )
    }
    return this.mediaConfig
  }

  /**
   * Get configuration for a specific service
   */
  getServiceConfig(
    service: 'sonarr' | 'radarr' | 'emby',
  ): SonarrConfig | RadarrConfig | EmbyConfig {
    const config = this.getConfiguration()
    return config[service]
  }

  /**
   * Get the last validation result
   */
  getLastValidation(): ValidationResult {
    if (!this.lastValidation) {
      throw new Error('No validation has been performed yet')
    }
    return this.lastValidation
  }

  /**
   * Re-validate configuration (useful for health checks)
   */
  revalidateConfiguration(): ValidationResult {
    if (!this.mediaConfig) {
      throw new Error('Media configuration not initialized')
    }

    this.lastValidation = this.validateConfiguration(this.mediaConfig)
    return this.lastValidation
  }

  /**
   * Check if all services are properly configured
   */
  areAllServicesValid(): boolean {
    const validation = this.getLastValidation()
    const { serviceStatus } = validation

    return (
      serviceStatus.sonarr === 'valid' &&
      serviceStatus.radarr === 'valid' &&
      serviceStatus.emby === 'valid'
    )
  }

  /**
   * Get list of configured and valid services
   */
  getAvailableServices(): Array<'sonarr' | 'radarr' | 'emby'> {
    const validation = this.getLastValidation()
    const { serviceStatus } = validation

    const available: Array<'sonarr' | 'radarr' | 'emby'> = []

    if (serviceStatus.sonarr === 'valid') available.push('sonarr')
    if (serviceStatus.radarr === 'valid') available.push('radarr')
    if (serviceStatus.emby === 'valid') available.push('emby')

    return available
  }
}
