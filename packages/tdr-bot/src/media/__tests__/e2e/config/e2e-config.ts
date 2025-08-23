/**
 * @fileoverview E2E Test Configuration
 *
 * Provides secure environment configuration validation and test setup utilities
 * for end-to-end testing of media API clients.
 *
 * @module E2EConfig
 * @since 1.0.0
 * @author TDR Bot Development Team
 */

import { Logger } from '@nestjs/common'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

// Load E2E environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.e2e') })

const logger = new Logger('E2E-Config')

/**
 * E2E test configuration interface
 */
export interface E2ETestConfig {
  // Service URLs and API keys
  sonarr: {
    url: string
    apiKey: string
    enabled: boolean
  }
  radarr: {
    url: string
    apiKey: string
    enabled: boolean
  }
  emby: {
    url: string
    apiKey: string
    userId: string
    enabled: boolean
  }

  // Test configuration
  timeouts: {
    default: number
    cleanup: number
    healthCheck: number
  }

  // Safety settings
  readOnlyMode: boolean
  allowDestructiveTests: boolean
  cleanupEnabled: boolean
  debugLogging: boolean

  // Performance thresholds
  performance: {
    maxResponseTimeMs: number
    minHealthCheckIntervalMs: number
    performanceMode: boolean
    skipSlowTests: boolean
    maxConcurrentRequests: number
  }

  // HTTP connection configuration
  http: {
    timeout: number
    maxRedirects: number
    keepAlive: boolean
    maxSockets: number
    maxFreeSockets: number
    connectionTimeout: number
    socketTimeout: number
    forceCleanupBetweenTests: boolean
  }

  // Request rate limiting configuration
  request: {
    delayMs: number
    retryDelayMs: number
    maxRetryAttempts: number
    circuitBreakerEnabled: boolean
  }

  // Test isolation configuration
  isolation: {
    cleanupBetweenTests: boolean
    resetConnectionsOnError: boolean
    maxConcurrentConnections: number
    testTimeoutBuffer: number
  }
}

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  availableServices: string[]
  skippedServices: string[]
}

/**
 * Get E2E test configuration from environment variables
 */
export function getE2EConfig(): E2ETestConfig {
  return {
    sonarr: {
      url: process.env.E2E_SONARR_URL || '',
      apiKey: process.env.E2E_SONARR_API_KEY || '',
      enabled: process.env.E2E_TEST_SONARR === 'true',
    },
    radarr: {
      url: process.env.E2E_RADARR_URL || '',
      apiKey: process.env.E2E_RADARR_API_KEY || '',
      enabled: process.env.E2E_TEST_RADARR === 'true',
    },
    emby: {
      url: process.env.E2E_EMBY_URL || '',
      apiKey: process.env.E2E_EMBY_API_KEY || '',
      userId: process.env.E2E_EMBY_USER_ID || '',
      enabled: process.env.E2E_TEST_EMBY === 'true',
    },
    timeouts: {
      default: parseInt(process.env.E2E_TEST_TIMEOUT || '180000', 10),
      cleanup: parseInt(process.env.E2E_CLEANUP_TIMEOUT || '60000', 10),
      healthCheck: parseInt(
        process.env.E2E_MIN_HEALTH_CHECK_INTERVAL_MS || '15000',
        10,
      ),
    },
    readOnlyMode: process.env.E2E_READ_ONLY_MODE !== 'false',
    allowDestructiveTests: process.env.E2E_ALLOW_DESTRUCTIVE_TESTS === 'true',
    cleanupEnabled: process.env.E2E_CLEANUP_ENABLED !== 'false',
    debugLogging: process.env.E2E_DEBUG_LOGGING === 'true',
    performance: {
      maxResponseTimeMs: parseInt(
        process.env.E2E_MAX_RESPONSE_TIME_MS || '30000',
        10,
      ),
      minHealthCheckIntervalMs: parseInt(
        process.env.E2E_MIN_HEALTH_CHECK_INTERVAL_MS || '15000',
        10,
      ),
      performanceMode: process.env.E2E_PERFORMANCE_MODE === 'true',
      skipSlowTests: process.env.E2E_SKIP_SLOW_TESTS === 'true',
      maxConcurrentRequests: parseInt(
        process.env.E2E_MAX_CONCURRENT_REQUESTS || '3',
        10,
      ),
    },

    http: {
      timeout: parseInt(process.env.E2E_HTTP_TIMEOUT || '30000', 10), // Reduced from 45s to 30s
      maxRedirects: parseInt(process.env.E2E_HTTP_MAX_REDIRECTS || '3', 10), // Reduced from 5 to 3
      keepAlive: process.env.E2E_HTTP_KEEP_ALIVE !== 'false',
      maxSockets: parseInt(process.env.E2E_HTTP_MAX_SOCKETS || '5', 10), // Reduced from 10 to 5
      maxFreeSockets: parseInt(
        process.env.E2E_HTTP_MAX_FREE_SOCKETS || '2',
        10,
      ), // Reduced from 5 to 2
      connectionTimeout: parseInt(
        process.env.E2E_HTTP_CONNECTION_TIMEOUT || '8000',
        10,
      ),
      socketTimeout: parseInt(
        process.env.E2E_HTTP_SOCKET_TIMEOUT || '10000',
        10,
      ),
      forceCleanupBetweenTests:
        process.env.E2E_FORCE_CLEANUP_BETWEEN_TESTS !== 'false',
    },

    request: {
      delayMs: parseInt(process.env.E2E_REQUEST_DELAY_MS || '500', 10), // Reduced from 1000ms
      retryDelayMs: parseInt(process.env.E2E_RETRY_DELAY_MS || '2000', 10), // Reduced from 5000ms
      maxRetryAttempts: parseInt(process.env.E2E_MAX_RETRY_ATTEMPTS || '2', 10), // Reduced retries for faster failure
      circuitBreakerEnabled:
        process.env.E2E_CIRCUIT_BREAKER_ENABLED !== 'false',
    },

    isolation: {
      cleanupBetweenTests: process.env.E2E_CLEANUP_BETWEEN_TESTS !== 'false',
      resetConnectionsOnError:
        process.env.E2E_RESET_CONNECTIONS_ON_ERROR !== 'false',
      maxConcurrentConnections: parseInt(
        process.env.E2E_MAX_CONCURRENT_CONNECTIONS || '2',
        10,
      ), // Very conservative for stability
      testTimeoutBuffer: parseInt(
        process.env.E2E_TEST_TIMEOUT_BUFFER || '5000',
        10,
      ),
    },
  }
}

/**
 * Validate E2E configuration and environment setup
 */
export function validateE2EConfig(
  config: E2ETestConfig,
): ConfigValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const availableServices: string[] = []
  const skippedServices: string[] = []

  // Check if .env.e2e file exists
  const envPath = path.join(process.cwd(), '.env.e2e')
  if (!fs.existsSync(envPath)) {
    errors.push(
      '.env.e2e file not found. Copy .env.e2e.example to .env.e2e and configure your settings.',
    )
    return {
      isValid: false,
      errors,
      warnings,
      availableServices,
      skippedServices,
    }
  }

  // Validate Sonarr configuration
  if (config.sonarr.enabled) {
    if (!config.sonarr.url) {
      errors.push('E2E_SONARR_URL is required when E2E_TEST_SONARR is enabled')
    }
    if (!config.sonarr.apiKey) {
      errors.push(
        'E2E_SONARR_API_KEY is required when E2E_TEST_SONARR is enabled',
      )
    }
    if (config.sonarr.url && config.sonarr.apiKey) {
      availableServices.push('sonarr')
    }
  } else {
    skippedServices.push('sonarr')
    warnings.push(
      'Sonarr tests are disabled - set E2E_TEST_SONARR=true to enable',
    )
  }

  // Validate Radarr configuration
  if (config.radarr.enabled) {
    if (!config.radarr.url) {
      errors.push('E2E_RADARR_URL is required when E2E_TEST_RADARR is enabled')
    }
    if (!config.radarr.apiKey) {
      errors.push(
        'E2E_RADARR_API_KEY is required when E2E_TEST_RADARR is enabled',
      )
    }
    if (config.radarr.url && config.radarr.apiKey) {
      availableServices.push('radarr')
    }
  } else {
    skippedServices.push('radarr')
    warnings.push(
      'Radarr tests are disabled - set E2E_TEST_RADARR=true to enable',
    )
  }

  // Validate Emby configuration
  if (config.emby.enabled) {
    if (!config.emby.url) {
      errors.push('E2E_EMBY_URL is required when E2E_TEST_EMBY is enabled')
    }
    if (!config.emby.apiKey) {
      errors.push('E2E_EMBY_API_KEY is required when E2E_TEST_EMBY is enabled')
    }
    if (!config.emby.userId) {
      errors.push('E2E_EMBY_USER_ID is required when E2E_TEST_EMBY is enabled')
    }
    if (config.emby.url && config.emby.apiKey && config.emby.userId) {
      availableServices.push('emby')
    }
  } else {
    skippedServices.push('emby')
    warnings.push('Emby tests are disabled - set E2E_TEST_EMBY=true to enable')
  }

  // Check if any services are available
  if (availableServices.length === 0 && errors.length === 0) {
    warnings.push(
      'No services are enabled for testing. Enable at least one service by setting E2E_TEST_*=true',
    )
  }

  // Validate timeouts
  if (config.timeouts.default < 20000) {
    warnings.push(
      'E2E_TEST_TIMEOUT is very low (<20000ms), external media APIs may timeout',
    )
  }
  if (config.timeouts.default > 300000) {
    warnings.push(
      'E2E_TEST_TIMEOUT is very high (>300000ms), tests may run slowly',
    )
  }

  // Validate HTTP configuration
  if (
    config.http.timeout >
    config.timeouts.default - config.isolation.testTimeoutBuffer
  ) {
    warnings.push(
      'HTTP timeout is too close to test timeout, may cause test failures',
    )
  }

  if (config.http.maxSockets > 10) {
    warnings.push(
      'HTTP max sockets is high (>10), may cause connection issues in tests',
    )
  }

  // Validate isolation settings
  if (!config.isolation.cleanupBetweenTests) {
    warnings.push(
      'Test cleanup is disabled, may cause connection leaks between tests',
    )
  }

  if (config.isolation.maxConcurrentConnections > 5) {
    warnings.push(
      'Max concurrent connections is high (>5), may cause API rate limiting in tests',
    )
  }

  // Validate performance settings
  if (config.performance.maxResponseTimeMs < 10000) {
    warnings.push(
      'E2E_MAX_RESPONSE_TIME_MS is low (<10000ms) for external media services',
    )
  }
  if (config.performance.maxConcurrentRequests > 10) {
    warnings.push(
      'E2E_MAX_CONCURRENT_REQUESTS is high (>10), may cause API rate limiting',
    )
  }

  // Performance mode warnings
  if (config.performance.performanceMode) {
    warnings.push('Performance mode enabled - test coverage may be reduced')
  }
  if (config.performance.skipSlowTests) {
    warnings.push(
      'Slow tests are being skipped - some functionality may not be tested',
    )
  }

  // Rate limiting warnings
  if (config.request.delayMs === 0) {
    warnings.push(
      'Request delay is disabled (E2E_REQUEST_DELAY_MS=0) - may cause API rate limiting issues',
    )
  }

  if (config.request.maxRetryAttempts > 5) {
    warnings.push(
      'Max retry attempts is high (>5), tests may run slowly on failures',
    )
  }

  if (!config.request.circuitBreakerEnabled) {
    warnings.push(
      'Circuit breaker is disabled - may not prevent cascading failures in tests',
    )
  }

  // Safety warnings
  if (!config.readOnlyMode) {
    warnings.push('Read-only mode is disabled - tests may modify service data')
  }
  if (config.allowDestructiveTests) {
    warnings.push('Destructive tests are enabled - use with caution')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    availableServices,
    skippedServices,
  }
}

/**
 * Get configuration for specific service
 */
export function getServiceConfig(
  service: 'sonarr' | 'radarr' | 'emby',
  config?: E2ETestConfig,
) {
  const e2eConfig = config || getE2EConfig()
  return e2eConfig[service]
}

/**
 * Check if service is available for testing
 */
export function isServiceAvailable(
  service: 'sonarr' | 'radarr' | 'emby',
): boolean {
  const config = getE2EConfig()
  const validation = validateE2EConfig(config)
  return validation.availableServices.includes(service)
}

/**
 * Log configuration validation results
 */
export function logConfigValidation(validation: ConfigValidationResult): void {
  if (validation.isValid) {
    logger.log('E2E configuration is valid')
    logger.log(
      `Available services: ${validation.availableServices.join(', ') || 'none'}`,
    )
    if (validation.skippedServices.length > 0) {
      logger.log(`Skipped services: ${validation.skippedServices.join(', ')}`)
    }
  } else {
    logger.error('E2E configuration validation failed')
    validation.errors.forEach(error => logger.error(`  ❌ ${error}`))
  }

  if (validation.warnings.length > 0) {
    logger.warn('Configuration warnings:')
    validation.warnings.forEach(warning => logger.warn(`  ⚠️  ${warning}`))
  }
}

/**
 * Skip test if service is not available
 * Use this in describe() or test() blocks to conditionally skip tests
 */
export function skipIfServiceUnavailable(
  service: 'sonarr' | 'radarr' | 'emby',
) {
  if (!isServiceAvailable(service)) {
    const config = getServiceConfig(service)
    if (!config.enabled) {
      return `${service} tests are disabled (E2E_TEST_${service.toUpperCase()}=false)`
    }
    if (!config.url) {
      return `${service} URL not configured (E2E_${service.toUpperCase()}_URL)`
    }
    if (!config.apiKey) {
      return `${service} API key not configured (E2E_${service.toUpperCase()}_API_KEY)`
    }
    if (service === 'emby') {
      const embyConfig = config as typeof config & { userId?: string }
      if (!embyConfig.userId) {
        return `${service} user ID not configured (E2E_${service.toUpperCase()}_USER_ID)`
      }
    }
    return `${service} service is not properly configured`
  }
  return null
}

// Global config instance for reuse
let globalConfig: E2ETestConfig | null = null
let globalValidation: ConfigValidationResult | null = null

/**
 * Get cached configuration (initialize once)
 */
export function getCachedE2EConfig(): {
  config: E2ETestConfig
  validation: ConfigValidationResult
} {
  if (!globalConfig || !globalValidation) {
    globalConfig = getE2EConfig()
    globalValidation = validateE2EConfig(globalConfig)

    // Log configuration on first access
    if (
      process.env.NODE_ENV !== 'test' ||
      process.env.E2E_DEBUG_LOGGING === 'true'
    ) {
      logConfigValidation(globalValidation)
    }
  }

  return { config: globalConfig, validation: globalValidation }
}

/**
 * Check if performance mode is enabled
 */
export function isPerformanceModeEnabled(): boolean {
  const config = getE2EConfig()
  return config.performance.performanceMode
}

/**
 * Check if slow tests should be skipped
 */
export function shouldSkipSlowTests(): boolean {
  const config = getE2EConfig()
  return config.performance.skipSlowTests
}

/**
 * Get maximum concurrent requests allowed
 */
export function getMaxConcurrentRequests(): number {
  const config = getE2EConfig()
  return config.performance.maxConcurrentRequests
}

/**
 * Skip test conditionally based on performance settings
 * Use this in describe() or test() blocks to conditionally skip slow tests
 */
export function skipIfSlowTestsDisabled(testName: string) {
  if (shouldSkipSlowTests()) {
    return `${testName} skipped (E2E_SKIP_SLOW_TESTS=true)`
  }
  return null
}

/**
 * Skip test conditionally based on performance mode
 */
export function skipIfPerformanceMode(testName: string) {
  if (isPerformanceModeEnabled()) {
    return `${testName} skipped (E2E_PERFORMANCE_MODE=true)`
  }
  return null
}

/**
 * Get optimized HTTP configuration for test environment
 */
export function getOptimizedHttpConfig(): {
  timeout: number
  maxSockets: number
  maxFreeSockets: number
  connectionTimeout: number
  socketTimeout: number
  keepAlive: boolean
} {
  const config = getE2EConfig()
  return {
    timeout: config.http.timeout,
    maxSockets: config.http.maxSockets,
    maxFreeSockets: config.http.maxFreeSockets,
    connectionTimeout: config.http.connectionTimeout,
    socketTimeout: config.http.socketTimeout,
    keepAlive: config.http.keepAlive,
  }
}

/**
 * Get connection management settings for better test isolation
 */
export function getConnectionManagementConfig(): {
  cleanupBetweenTests: boolean
  resetOnError: boolean
  maxConcurrent: number
  requestDelay: number
  circuitBreakerEnabled: boolean
} {
  const config = getE2EConfig()
  return {
    cleanupBetweenTests: config.isolation.cleanupBetweenTests,
    resetOnError: config.isolation.resetConnectionsOnError,
    maxConcurrent: config.isolation.maxConcurrentConnections,
    requestDelay: config.request.delayMs,
    circuitBreakerEnabled: config.request.circuitBreakerEnabled,
  }
}

/**
 * Create a delay for rate limiting between requests
 */
export async function createTestDelay(customDelayMs?: number): Promise<void> {
  const config = getE2EConfig()
  const delayMs = customDelayMs || config.request.delayMs

  if (delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
}

/**
 * Get recommended timeout for specific operation types
 */
export function getTimeoutForOperation(
  operation: 'health' | 'search' | 'request' | 'queue' | 'system',
): number {
  const config = getE2EConfig()
  const baseTimeout = config.http.timeout

  switch (operation) {
    case 'health':
      return Math.min(baseTimeout, 10000) // Health checks should be fast
    case 'search':
      return Math.min(baseTimeout, 15000) // Search operations are usually quick
    case 'request':
      return baseTimeout // Full timeout for adding requests
    case 'queue':
      return Math.min(baseTimeout, 20000) // Queue checks
    case 'system':
      return Math.min(baseTimeout, 8000) // System status should be very fast
    default:
      return baseTimeout
  }
}

/**
 * Check if connection cleanup should be forced
 */
export function shouldForceCleanup(): boolean {
  const config = getE2EConfig()
  return config.http.forceCleanupBetweenTests
}

/**
 * Get circuit breaker configuration for tests
 */
export function getCircuitBreakerConfig(): {
  enabled: boolean
  failureThreshold: number
  openTimeoutMs: number
} {
  const config = getE2EConfig()
  return {
    enabled: config.request.circuitBreakerEnabled,
    failureThreshold: 2, // Lower threshold for tests
    openTimeoutMs: 3000, // Shorter timeout for tests
  }
}
