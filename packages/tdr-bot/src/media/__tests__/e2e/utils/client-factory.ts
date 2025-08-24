/**
 * @fileoverview E2E Test Client Factory
 *
 * Factory functions for creating configured media API clients for E2E testing
 * with proper configuration, authentication, and error handling.
 *
 * @module E2EClientFactory
 * @since 1.0.0
 * @author TDR Bot Development Team
 */

import { Logger } from '@nestjs/common'

import {
  E2ETestConfig,
  getServiceConfig,
} from 'src/media/__tests__/e2e/config/e2e-config'
import { EmbyClient } from 'src/media/clients/emby.client'
import { RadarrClient } from 'src/media/clients/radarr.client'
import { SonarrClient } from 'src/media/clients/sonarr.client'
import { MediaConfigValidationService } from 'src/media/config/media-config.validation'

import { createTestDependencies } from './test-setup'

const logger = new Logger('E2E-ClientFactory')

/**
 * Validate service configuration with detailed error messages
 */
function validateServiceConfig(
  serviceName: string,
  config: Record<string, unknown>,
): string[] {
  const errors: string[] = []

  if (!config) {
    errors.push(`Configuration object is null/undefined for ${serviceName}`)
    return errors
  }

  // Common validations
  if (!config.url) {
    errors.push(`Missing required field: url for ${serviceName}`)
  } else {
    try {
      new URL(config.url as string)
    } catch {
      errors.push(`Invalid URL format for ${serviceName}: ${config.url}`)
    }
  }

  if (!config.apiKey) {
    errors.push(`Missing required field: apiKey for ${serviceName}`)
  } else if (
    typeof config.apiKey !== 'string' ||
    config.apiKey.trim().length === 0
  ) {
    errors.push(`Invalid apiKey for ${serviceName}: must be a non-empty string`)
  }

  // Service-specific validations
  if (serviceName === 'emby') {
    if (!config.userId) {
      errors.push(`Missing required field: userId for ${serviceName}`)
    } else if (
      typeof config.userId !== 'string' ||
      config.userId.trim().length === 0
    ) {
      errors.push(
        `Invalid userId for ${serviceName}: must be a non-empty string`,
      )
    }
  }

  // Validate numeric fields
  if (config.timeout !== undefined) {
    if (typeof config.timeout !== 'number' || config.timeout <= 0) {
      errors.push(
        `Invalid timeout for ${serviceName}: must be a positive number`,
      )
    }
  }

  if (config.maxRetries !== undefined) {
    if (typeof config.maxRetries !== 'number' || config.maxRetries < 0) {
      errors.push(
        `Invalid maxRetries for ${serviceName}: must be a non-negative number`,
      )
    }
  }

  return errors
}

/**
 * Create mock configuration service for E2E testing with validation
 */
function createMockConfigService(
  serviceConfig: Record<string, Record<string, unknown>>,
) {
  return {
    getServiceConfig: (serviceName: string) => {
      const config = serviceConfig[serviceName] || {}

      // Log configuration for debugging
      logger.debug(`Mock config service returning config for ${serviceName}`, {
        serviceName,
        hasUrl: !!config.url,
        hasApiKey: !!config.apiKey,
        hasUserId: !!config.userId,
        timeout: config.timeout,
        maxRetries: config.maxRetries,
      })

      return config
    },
  }
}

/**
 * Create Sonarr client for E2E testing
 */
export function createSonarrClient(config: E2ETestConfig): SonarrClient {
  const sonarrConfig = getServiceConfig('sonarr', config)
  const dependencies = createTestDependencies()

  // Validate configuration with detailed error messages
  const validationErrors = validateServiceConfig('sonarr', sonarrConfig)
  if (validationErrors.length > 0) {
    const errorMessage = [
      'Sonarr client configuration validation failed:',
      ...validationErrors.map(err => `  - ${err}`),
      '',
      'Required environment variables:',
      '  - E2E_SONARR_URL: Base URL for Sonarr service',
      '  - E2E_SONARR_API_KEY: API key for Sonarr authentication',
      '',
      `Current configuration: ${JSON.stringify(sonarrConfig, null, 2)}`,
    ].join('\n')

    logger.error('Sonarr client creation failed', {
      validationErrors,
      config: sonarrConfig,
    })

    throw new Error(errorMessage)
  }

  // Create mock config service with enhanced HTTP configuration
  const mockConfigService = createMockConfigService({
    sonarr: {
      url: sonarrConfig.url,
      apiKey: sonarrConfig.apiKey,
      timeout: config.http.timeout,
      maxRetries: 3,
      httpConfig: {
        maxSockets: config.http.maxSockets,
        maxFreeSockets: config.http.maxFreeSockets,
        keepAlive: config.http.keepAlive,
        connectTimeout: config.http.timeout,
        maxRedirects: config.http.maxRedirects,
      },
    },
  })

  const client = new SonarrClient(
    dependencies.retryService,
    dependencies.errorClassifier,
    dependencies.mediaLoggingService,
    mockConfigService as unknown as MediaConfigValidationService,
  )

  if (config.debugLogging) {
    logger.debug('Created Sonarr E2E client', {
      url: sonarrConfig.url,
      timeout: config.timeouts.default,
    })
  }

  return client
}

/**
 * Create Radarr client for E2E testing
 */
export function createRadarrClient(config: E2ETestConfig): RadarrClient {
  const radarrConfig = getServiceConfig('radarr', config)
  const dependencies = createTestDependencies()

  // Validate configuration with detailed error messages
  const validationErrors = validateServiceConfig('radarr', radarrConfig)
  if (validationErrors.length > 0) {
    const errorMessage = [
      'Radarr client configuration validation failed:',
      ...validationErrors.map(err => `  - ${err}`),
      '',
      'Required environment variables:',
      '  - E2E_RADARR_URL: Base URL for Radarr service',
      '  - E2E_RADARR_API_KEY: API key for Radarr authentication',
      '',
      `Current configuration: ${JSON.stringify(radarrConfig, null, 2)}`,
    ].join('\n')

    logger.error('Radarr client creation failed', {
      validationErrors,
      config: radarrConfig,
    })

    throw new Error(errorMessage)
  }

  // Create mock config service with enhanced HTTP configuration
  const mockConfigService = createMockConfigService({
    radarr: {
      url: radarrConfig.url,
      apiKey: radarrConfig.apiKey,
      timeout: config.http.timeout,
      maxRetries: 3,
      httpConfig: {
        maxSockets: config.http.maxSockets,
        maxFreeSockets: config.http.maxFreeSockets,
        keepAlive: config.http.keepAlive,
        connectTimeout: config.http.timeout,
        maxRedirects: config.http.maxRedirects,
      },
    },
  })

  const client = new RadarrClient(
    dependencies.retryService,
    dependencies.errorClassifier,
    dependencies.mediaLoggingService,
    mockConfigService as unknown as MediaConfigValidationService,
  )

  if (config.debugLogging) {
    logger.debug('Created Radarr E2E client', {
      url: radarrConfig.url,
      timeout: config.timeouts.default,
    })
  }

  return client
}

/**
 * Create Emby client for E2E testing
 */
export function createEmbyClient(config: E2ETestConfig): EmbyClient {
  const embyConfig = getServiceConfig('emby', config) as {
    url: string
    apiKey: string
    userId: string
    enabled: boolean
  }
  const dependencies = createTestDependencies()

  // Validate configuration with detailed error messages
  const validationErrors = validateServiceConfig('emby', embyConfig)
  if (validationErrors.length > 0) {
    const errorMessage = [
      'Emby client configuration validation failed:',
      ...validationErrors.map(err => `  - ${err}`),
      '',
      'Required environment variables:',
      '  - E2E_EMBY_URL: Base URL for Emby service',
      '  - E2E_EMBY_API_KEY: API key for Emby authentication',
      '  - E2E_EMBY_USER_ID: User ID for Emby API calls',
      '',
      'Note: Emby userId should be a valid UUID format',
      '',
      `Current configuration: ${JSON.stringify(embyConfig, null, 2)}`,
    ].join('\n')

    logger.error('Emby client creation failed', {
      validationErrors,
      config: embyConfig,
    })

    throw new Error(errorMessage)
  }

  // Create mock config service with enhanced HTTP configuration
  const mockConfigService = createMockConfigService({
    emby: {
      url: embyConfig.url,
      apiKey: embyConfig.apiKey,
      userId: embyConfig.userId,
      timeout: config.http.timeout,
      maxRetries: 3,
      httpConfig: {
        maxSockets: config.http.maxSockets,
        maxFreeSockets: config.http.maxFreeSockets,
        keepAlive: config.http.keepAlive,
        connectTimeout: config.http.timeout,
        maxRedirects: config.http.maxRedirects,
      },
    },
  })

  const client = new EmbyClient(
    dependencies.retryService,
    dependencies.errorClassifier,
    dependencies.mediaLoggingService,
    mockConfigService as unknown as MediaConfigValidationService,
  )

  if (config.debugLogging) {
    logger.debug('Created Emby E2E client', {
      url: embyConfig.url,
      userId: embyConfig.userId,
      timeout: config.timeouts.default,
    })
  }

  return client
}

/**
 * Create all available clients based on configuration
 */
export function createAvailableClients(config: E2ETestConfig): {
  sonarr?: SonarrClient
  radarr?: RadarrClient
  emby?: EmbyClient
} {
  const clients: {
    sonarr?: SonarrClient
    radarr?: RadarrClient
    emby?: EmbyClient
  } = {}

  try {
    if (config.sonarr.enabled && config.sonarr.url && config.sonarr.apiKey) {
      clients.sonarr = createSonarrClient(config)
    }
  } catch (error) {
    logger.warn('Failed to create Sonarr client', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    if (config.radarr.enabled && config.radarr.url && config.radarr.apiKey) {
      clients.radarr = createRadarrClient(config)
    }
  } catch (error) {
    logger.warn('Failed to create Radarr client', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    if (
      config.emby.enabled &&
      config.emby.url &&
      config.emby.apiKey &&
      config.emby.userId
    ) {
      clients.emby = createEmbyClient(config)
    }
  } catch (error) {
    logger.warn('Failed to create Emby client', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return clients
}

/**
 * Test client connectivity
 */
export async function testClientConnectivity(
  clients: {
    sonarr?: SonarrClient
    radarr?: RadarrClient
    emby?: EmbyClient
  },
  correlationId: string,
): Promise<{
  sonarr?: boolean
  radarr?: boolean
  emby?: boolean
  errors: string[]
}> {
  const results: {
    sonarr?: boolean
    radarr?: boolean
    emby?: boolean
    errors: string[]
  } = {
    errors: [],
  }

  // Test Sonarr connectivity
  if (clients.sonarr) {
    try {
      const connectionTest = await clients.sonarr.testConnection(correlationId)
      results.sonarr =
        connectionTest.canConnect && connectionTest.isAuthenticated
      if (!results.sonarr) {
        results.errors.push(
          `Sonarr connection failed: ${connectionTest.error || 'Unknown error'}`,
        )
      }
    } catch (error) {
      results.sonarr = false
      results.errors.push(
        `Sonarr connection error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Test Radarr connectivity
  if (clients.radarr) {
    try {
      const connectionTest = await clients.radarr.testConnection(correlationId)
      results.radarr =
        connectionTest.canConnect && connectionTest.isAuthenticated
      if (!results.radarr) {
        results.errors.push(
          `Radarr connection failed: ${connectionTest.error || 'Unknown error'}`,
        )
      }
    } catch (error) {
      results.radarr = false
      results.errors.push(
        `Radarr connection error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Test Emby connectivity
  if (clients.emby) {
    try {
      const connectionTest = await clients.emby.testConnection(correlationId)
      results.emby = connectionTest.canConnect && connectionTest.isAuthenticated
      if (!results.emby) {
        results.errors.push(
          `Emby connection failed: ${connectionTest.error || 'Unknown error'}`,
        )
      }
    } catch (error) {
      results.emby = false
      results.errors.push(
        `Emby connection error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return results
}

/**
 * Cleanup all clients
 */
export function cleanupClients(clients: {
  sonarr?: SonarrClient
  radarr?: RadarrClient
  emby?: EmbyClient
}): void {
  Object.values(clients).forEach(client => {
    if (client && typeof client.destroy === 'function') {
      try {
        client.destroy()
      } catch (error) {
        logger.warn('Error destroying client', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  })
}
