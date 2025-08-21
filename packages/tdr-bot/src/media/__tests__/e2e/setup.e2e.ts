/**
 * @fileoverview E2E Test Setup
 *
 * Global setup and configuration for E2E tests including
 * environment validation and test lifecycle management.
 *
 * @module E2ESetup
 * @since 1.0.0
 * @author TDR Bot Development Team
 */

import { Logger } from '@nestjs/common'

import { getCachedE2EConfig, logConfigValidation } from './config/e2e-config'

const logger = new Logger('E2E-Setup')

// Global setup for E2E tests
beforeAll(async () => {
  logger.log('Starting E2E test suite setup')

  const { config, validation } = getCachedE2EConfig()

  // Log configuration validation results
  logConfigValidation(validation)

  if (!validation.isValid) {
    logger.error('E2E configuration is invalid, tests may fail or be skipped')
    if (process.env.CI) {
      // In CI, fail fast if configuration is invalid
      throw new Error(
        `E2E configuration is invalid: ${validation.errors.join(', ')}`,
      )
    }
  }

  if (validation.availableServices.length === 0) {
    logger.warn('No services are available for testing')
    logger.warn('Make sure you have:')
    logger.warn('1. Created .env.e2e file from .env.e2e.example')
    logger.warn('2. Configured service URLs and API keys')
    logger.warn('3. Enabled at least one service with E2E_TEST_*=true')

    if (process.env.CI) {
      throw new Error('No services available for E2E testing in CI environment')
    }
  }

  // Log test configuration
  logger.log('E2E test configuration:', {
    availableServices: validation.availableServices,
    skippedServices: validation.skippedServices,
    readOnlyMode: config.readOnlyMode,
    allowDestructiveTests: config.allowDestructiveTests,
    cleanupEnabled: config.cleanupEnabled,
    defaultTimeout: config.timeouts.default,
    maxResponseTime: config.performance.maxResponseTimeMs,
  })

  // Set longer timeout for E2E tests
  jest.setTimeout(config.timeouts.default)

  // Log final timeout settings for verification
  logger.log('Jest timeout settings:', {
    jestTimeout: config.timeouts.default,
    httpTimeout: config.http.timeout,
    maxResponseTime: config.performance.maxResponseTimeMs,
    requestDelay: config.request.delayMs,
    retryDelay: config.request.retryDelayMs,
  })
}, 45000) // Increased setup timeout

// Global cleanup
afterAll(async () => {
  logger.log('E2E test suite cleanup completed')
}, 10000)

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection in E2E tests:', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
})

// Handle uncaught exceptions
process.on('uncaughtException', error => {
  logger.error('Uncaught exception in E2E tests:', {
    message: error.message,
    stack: error.stack,
  })
})
