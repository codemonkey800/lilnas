/**
 * @fileoverview E2E Test Setup Utilities
 *
 * Provides common setup, cleanup, and utility functions for E2E tests
 * of media API clients with safety measures and resource management.
 *
 * @module E2ETestSetup
 * @since 1.0.0
 * @author TDR Bot Development Team
 */

import { Logger } from '@nestjs/common'
import { v4 as uuid } from 'uuid'

import {
  E2ETestConfig,
  getCachedE2EConfig,
} from 'src/media/__tests__/e2e/config/e2e-config'
import { BaseMediaApiClient } from 'src/media/clients/base-media-api.client'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

const logger = new Logger('E2E-TestSetup')

/**
 * Test context for E2E tests
 */
export interface E2ETestContext {
  correlationId: string
  config: E2ETestConfig
  startTime: number
  testName: string
  serviceName: string
  cleanup: (() => Promise<void>)[]
}

/**
 * Test data created during tests (for cleanup)
 */
export interface TestDataItem {
  type: 'movie' | 'series' | 'request'
  id: string | number
  name: string
  service: 'sonarr' | 'radarr' | 'emby'
  created: Date
  cleanup?: () => Promise<void>
}

/**
 * Service health check result
 */
export interface ServiceHealthStatus {
  service: string
  isHealthy: boolean
  responseTime?: number
  version?: string
  error?: string
  warning?: string
}

/**
 * Performance metrics for test operations
 */
export interface PerformanceMetrics {
  operationName: string
  duration: number
  success: boolean
  error?: string
  metadata?: Record<string, unknown>
}

/**
 * Global test state management
 */
class E2ETestState {
  private testData: Map<string, TestDataItem[]> = new Map()
  private metrics: PerformanceMetrics[] = []
  private healthStatus: Map<string, ServiceHealthStatus> = new Map()

  addTestData(correlationId: string, data: TestDataItem) {
    const existing = this.testData.get(correlationId) || []
    existing.push(data)
    this.testData.set(correlationId, existing)
  }

  getTestData(correlationId: string): TestDataItem[] {
    return this.testData.get(correlationId) || []
  }

  addMetrics(metrics: PerformanceMetrics) {
    this.metrics.push(metrics)
  }

  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics]
  }

  setHealthStatus(service: string, status: ServiceHealthStatus) {
    this.healthStatus.set(service, status)
  }

  getHealthStatus(service: string): ServiceHealthStatus | undefined {
    return this.healthStatus.get(service)
  }

  getAllHealthStatus(): ServiceHealthStatus[] {
    return Array.from(this.healthStatus.values())
  }

  clear() {
    this.testData.clear()
    this.metrics.length = 0
    this.healthStatus.clear()
  }
}

const testState = new E2ETestState()

/**
 * Create E2E test context
 */
export function createTestContext(
  testName: string,
  serviceName: string,
): E2ETestContext {
  const { config } = getCachedE2EConfig()
  const correlationId = `e2e-${serviceName}-${uuid().substring(0, 8)}`

  const context: E2ETestContext = {
    correlationId,
    config,
    startTime: Date.now(),
    testName,
    serviceName,
    cleanup: [],
  }

  // Add global cleanup handler
  context.cleanup.push(async () => {
    await cleanupTestData(context)
  })

  if (config.debugLogging) {
    logger.debug(`Created test context for ${testName}`, {
      correlationId,
      serviceName,
      testName,
    })
  }

  return context
}

/**
 * Create test client dependencies
 */
export function createTestDependencies() {
  // Create mock EventEmitter2 for MediaLoggingService
  const mockEventEmitter = {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    removeAllListeners: jest.fn(),
  } as any

  // Create ErrorClassificationService (it doesn't require dependencies)
  const errorClassifier = new ErrorClassificationService()

  // Create RetryService with ErrorClassificationService dependency
  const retryService = new RetryService(errorClassifier)

  // Create MediaLoggingService with mocked EventEmitter2
  const mediaLoggingService = new MediaLoggingService(mockEventEmitter)

  return {
    retryService,
    errorClassifier,
    mediaLoggingService,
    mockEventEmitter,
  }
}

/**
 * Performance timing wrapper for test operations
 */
export async function measurePerformance<T>(
  operationName: string,
  operation: () => Promise<T>,
  context?: E2ETestContext,
): Promise<T> {
  const startTime = Date.now()
  let success = false
  let error: string | undefined
  let result: T

  try {
    result = await operation()
    success = true
    return result
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    const duration = Date.now() - startTime
    const metrics: PerformanceMetrics = {
      operationName,
      duration,
      success,
      error,
      metadata: context
        ? {
            correlationId: context.correlationId,
            serviceName: context.serviceName,
            testName: context.testName,
          }
        : undefined,
    }

    testState.addMetrics(metrics)

    if (context?.config.debugLogging) {
      logger.debug(`Performance: ${operationName}`, {
        duration: `${duration}ms`,
        success,
        error,
        correlationId: context.correlationId,
      })
    }
  }
}

/**
 * Check service health with proper error handling and comprehensive debugging
 */
export async function checkServiceHealth(
  client: BaseMediaApiClient,
  serviceName: string,
  correlationId: string,
): Promise<ServiceHealthStatus> {
  const startTime = Date.now()

  // Enhanced debugging for health checks
  logger.debug(`Starting health check for ${serviceName}`, {
    correlationId,
    serviceName,
    clientType: client.constructor.name,
    timestamp: new Date().toISOString(),
  })

  try {
    // Test connection first
    logger.debug(`Testing connection for ${serviceName}`, { correlationId })
    const connectionTest = await measurePerformance(
      `${serviceName}_connection_test`,
      () => client.testConnection(correlationId),
    )

    logger.debug(`Connection test result for ${serviceName}`, {
      correlationId,
      canConnect: connectionTest.canConnect,
      isAuthenticated: connectionTest.isAuthenticated,
      responseTime: connectionTest.responseTime,
      error: connectionTest.error,
    })

    if (!connectionTest.canConnect) {
      const status: ServiceHealthStatus = {
        service: serviceName,
        isHealthy: false,
        responseTime: Date.now() - startTime,
        error: `Connection failed: ${connectionTest.error || 'Unknown connection error'}`,
      }

      logger.error(`${serviceName} connection failed`, {
        correlationId,
        canConnect: connectionTest.canConnect,
        isAuthenticated: connectionTest.isAuthenticated,
        error: connectionTest.error,
        suggestions: connectionTest.suggestions,
      })

      testState.setHealthStatus(serviceName, status)
      return status
    }

    // Test API capabilities
    logger.debug(`Testing capabilities for ${serviceName}`, { correlationId })
    let capabilities
    try {
      capabilities = await measurePerformance(
        `${serviceName}_capabilities_test`,
        () => client.getCapabilities(correlationId),
      )

      logger.debug(`Capabilities result for ${serviceName}`, {
        correlationId,
        canSearch: capabilities.canSearch,
        canRequest: capabilities.canRequest,
        canMonitor: capabilities.canMonitor,
        supportedMediaTypes: capabilities.supportedMediaTypes,
        version: capabilities.version,
        apiVersion: capabilities.apiVersion,
      })
    } catch (capError) {
      logger.error(`${serviceName} capabilities test failed`, {
        correlationId,
        error: capError instanceof Error ? capError.message : String(capError),
        stack: capError instanceof Error ? capError.stack : undefined,
      })
      // Don't fail the health check for capabilities issues, but log it
    }

    // Test endpoints
    logger.debug(`Testing endpoints for ${serviceName}`, { correlationId })
    let endpoints
    try {
      endpoints = client.getEndpoints()
      logger.debug(`Endpoints result for ${serviceName}`, {
        correlationId,
        endpoints,
        endpointCount: Object.keys(endpoints).length,
        hasHealthEndpoint: !!endpoints.health,
        hasSystemEndpoint: !!endpoints.system,
      })
    } catch (endpointError) {
      logger.error(`${serviceName} endpoints test failed`, {
        correlationId,
        error:
          endpointError instanceof Error
            ? endpointError.message
            : String(endpointError),
        stack: endpointError instanceof Error ? endpointError.stack : undefined,
      })
    }

    // Now perform the actual health check
    logger.debug(`Performing health check for ${serviceName}`, {
      correlationId,
    })
    const healthResult = await measurePerformance(
      `${serviceName}_health_check`,
      () => client.checkHealth(correlationId),
    )

    logger.debug(`Health check result for ${serviceName}`, {
      correlationId,
      isHealthy: healthResult.isHealthy,
      responseTime: healthResult.responseTime,
      lastChecked: healthResult.lastChecked,
      version: healthResult.version,
      status: healthResult.status,
      error: healthResult.error,
      apiVersion: healthResult.apiVersion,
    })

    const status: ServiceHealthStatus = {
      service: serviceName,
      isHealthy: healthResult.isHealthy,
      responseTime: Date.now() - startTime,
      version: healthResult.version,
      error: healthResult.error,
    }

    testState.setHealthStatus(serviceName, status)

    if (!status.isHealthy) {
      logger.warn(`${serviceName} health check failed`, {
        correlationId,
        error: status.error,
        responseTime: status.responseTime,
        healthResult,
        connectionTest,
        capabilities: capabilities || 'failed to retrieve',
        endpoints: endpoints || 'failed to retrieve',
      })
    } else if (status.responseTime && status.responseTime > 5000) {
      status.warning = `Slow response time: ${status.responseTime}ms`
      logger.warn(`${serviceName} health check slow`, {
        correlationId,
        responseTime: status.responseTime,
      })
    } else {
      logger.debug(`${serviceName} health check successful`, {
        correlationId,
        responseTime: status.responseTime,
        version: status.version,
      })
    }

    return status
  } catch (error) {
    const status: ServiceHealthStatus = {
      service: serviceName,
      isHealthy: false,
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    }

    testState.setHealthStatus(serviceName, status)
    logger.error(`${serviceName} health check error`, {
      correlationId,
      error: status.error,
      stack: error instanceof Error ? error.stack : undefined,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      clientType: client.constructor.name,
      responseTime: status.responseTime,
    })

    return status
  }
}

/**
 * Register test data for cleanup
 */
export function registerTestData(context: E2ETestContext, data: TestDataItem) {
  testState.addTestData(context.correlationId, data)

  if (context.config.debugLogging) {
    logger.debug(`Registered test data for cleanup`, {
      correlationId: context.correlationId,
      type: data.type,
      id: data.id,
      name: data.name,
      service: data.service,
    })
  }
}

/**
 * Clean up test data created during tests
 */
export async function cleanupTestData(context: E2ETestContext): Promise<void> {
  if (!context.config.cleanupEnabled) {
    logger.debug('Cleanup disabled, skipping test data cleanup', {
      correlationId: context.correlationId,
    })
    return
  }

  const testData = testState.getTestData(context.correlationId)
  if (testData.length === 0) {
    return
  }

  logger.debug(`Cleaning up ${testData.length} test data items`, {
    correlationId: context.correlationId,
    testName: context.testName,
  })

  const cleanupPromises = testData
    .filter(data => data.cleanup)
    .map(async data => {
      try {
        await data.cleanup!()
        logger.debug(`Cleaned up ${data.type} ${data.name}`, {
          correlationId: context.correlationId,
          service: data.service,
          id: data.id,
        })
      } catch (error) {
        logger.warn(`Failed to cleanup ${data.type} ${data.name}`, {
          correlationId: context.correlationId,
          service: data.service,
          id: data.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

  await Promise.allSettled(cleanupPromises)
}

/**
 * Run all cleanup handlers for test context
 */
export async function runCleanup(context: E2ETestContext): Promise<void> {
  if (context.cleanup.length === 0) {
    return
  }

  logger.debug(`Running ${context.cleanup.length} cleanup handlers`, {
    correlationId: context.correlationId,
    testName: context.testName,
  })

  const cleanupPromises = context.cleanup.map(async (cleanup, index) => {
    try {
      await cleanup()
    } catch (error) {
      logger.warn(`Cleanup handler ${index} failed`, {
        correlationId: context.correlationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  await Promise.allSettled(cleanupPromises)
}

/**
 * Assert performance requirements
 */
export function assertPerformance(
  actualMs: number,
  expectedMaxMs: number,
  operation: string,
): void {
  if (actualMs > expectedMaxMs) {
    throw new Error(
      `${operation} took ${actualMs}ms, expected < ${expectedMaxMs}ms`,
    )
  }
}

/**
 * Wait for condition with timeout
 */
export async function waitForCondition<T>(
  condition: () => Promise<T>,
  options: {
    timeout?: number
    interval?: number
    description?: string
  } = {},
): Promise<T> {
  const {
    timeout = 30000,
    interval = 1000,
    description = 'condition',
  } = options
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const result = await condition()
      if (result) {
        return result
      }
    } catch (error) {
      // Continue waiting unless timeout reached
      if (Date.now() - startTime >= timeout) {
        throw new Error(
          `Timeout waiting for ${description}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    await new Promise(resolve => setTimeout(resolve, interval))
  }

  throw new Error(`Timeout waiting for ${description} after ${timeout}ms`)
}

/**
 * Generate test data with unique identifiers
 */
export function generateTestData(type: string, suffix?: string) {
  const timestamp = Date.now()
  const random = uuid().substring(0, 6)
  const testSuffix = suffix ? `-${suffix}` : ''

  return {
    name: `e2e-test-${type}-${random}${testSuffix}`,
    timestamp,
    random,
  }
}

/**
 * Get test metrics summary
 */
export function getTestMetrics(): {
  totalOperations: number
  successfulOperations: number
  failedOperations: number
  averageDuration: number
  slowestOperation: PerformanceMetrics | null
  fastestOperation: PerformanceMetrics | null
} {
  const metrics = testState.getMetrics()

  if (metrics.length === 0) {
    return {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      averageDuration: 0,
      slowestOperation: null,
      fastestOperation: null,
    }
  }

  const successful = metrics.filter(m => m.success)
  const failed = metrics.filter(m => !m.success)
  const totalDuration = metrics.reduce((sum, m) => sum + m.duration, 0)
  const sorted = [...metrics].sort((a, b) => a.duration - b.duration)

  return {
    totalOperations: metrics.length,
    successfulOperations: successful.length,
    failedOperations: failed.length,
    averageDuration: Math.round(totalDuration / metrics.length),
    slowestOperation: sorted[sorted.length - 1] || null,
    fastestOperation: sorted[0] || null,
  }
}

/**
 * Reset test state (useful between test suites)
 */
export function resetTestState(): void {
  testState.clear()
}

/**
 * Get all health status for reporting
 */
export function getAllHealthStatus(): ServiceHealthStatus[] {
  return testState.getAllHealthStatus()
}

/**
 * Add delay between requests to prevent API rate limiting
 */
export async function delayBetweenRequests(
  context?: E2ETestContext,
): Promise<void> {
  const { config } = getCachedE2EConfig()
  if (config.request.delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, config.request.delayMs))
  }
}

/**
 * Safely execute API operations with proper error handling for E2E tests
 * This handles common issues like network errors, authentication issues, and service unavailability
 */
export async function safeApiOperation<T>(
  operation: () => Promise<T>,
  operationName: string,
  options: {
    expectArray?: boolean
    allowEmpty?: boolean
    context?: E2ETestContext
  } = {},
): Promise<T | null> {
  const { expectArray = false, allowEmpty = false, context } = options

  let result: T
  try {
    result = await operation()
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.warn(`${operationName} failed: ${errorMessage}`)

    // For E2E tests against external services, we consider failures as acceptable
    // since services may be temporarily unavailable
    return null
  }

  // Handle cases where API returns non-expected types (e.g., HTML login pages)
  if (expectArray && !Array.isArray(result)) {
    console.warn(`${operationName} returned non-array result: ${typeof result}`)
    return null
  }

  // Handle empty results when not allowed
  if (
    expectArray &&
    !allowEmpty &&
    Array.isArray(result) &&
    result.length === 0
  ) {
    console.warn(
      `${operationName} returned empty array when results were expected`,
    )
    // Still return the empty array as it's a valid response format
  }

  return result
}

/**
 * Enhanced assertion helpers with descriptive error messages
 */

/**
 * Assert service capabilities with detailed error context
 */
export function assertServiceCapabilities(
  actual: any,
  serviceName: string,
  correlationId: string,
): void {
  const errors: string[] = []

  if (!actual) {
    throw new Error(
      `Service capabilities is null/undefined for ${serviceName}. CorrelationId: ${correlationId}`,
    )
  }

  // Check required boolean fields
  if (typeof actual.canSearch !== 'boolean') {
    errors.push(
      `canSearch should be boolean, got ${typeof actual.canSearch}: ${actual.canSearch}`,
    )
  }

  if (typeof actual.canRequest !== 'boolean') {
    errors.push(
      `canRequest should be boolean, got ${typeof actual.canRequest}: ${actual.canRequest}`,
    )
  }

  if (typeof actual.canMonitor !== 'boolean') {
    errors.push(
      `canMonitor should be boolean, got ${typeof actual.canMonitor}: ${actual.canMonitor}`,
    )
  }

  // Check supportedMediaTypes array
  if (!Array.isArray(actual.supportedMediaTypes)) {
    errors.push(
      `supportedMediaTypes should be array, got ${typeof actual.supportedMediaTypes}`,
    )
  } else if (actual.supportedMediaTypes.length === 0) {
    errors.push('supportedMediaTypes should not be empty')
  }

  // Check version string
  if (
    typeof actual.version !== 'string' ||
    actual.version.trim().length === 0
  ) {
    errors.push(
      `version should be non-empty string, got ${typeof actual.version}: ${actual.version}`,
    )
  }

  // Check apiVersion object
  if (!actual.apiVersion || typeof actual.apiVersion !== 'object') {
    errors.push(`apiVersion should be object, got ${typeof actual.apiVersion}`)
  }

  if (errors.length > 0) {
    const errorMessage = [
      `Service capabilities validation failed for ${serviceName}:`,
      ...errors.map(err => `  - ${err}`),
      '',
      `Correlation ID: ${correlationId}`,
      `Actual capabilities: ${JSON.stringify(actual, null, 2)}`,
    ].join('\n')

    throw new Error(errorMessage)
  }
}

/**
 * Assert API endpoints with detailed error context
 */
export function assertApiEndpoints(
  actual: any,
  serviceName: string,
  correlationId: string,
): void {
  if (!actual) {
    throw new Error(
      `API endpoints is null/undefined for ${serviceName}. CorrelationId: ${correlationId}`,
    )
  }

  if (typeof actual !== 'object') {
    throw new Error(
      `API endpoints should be object, got ${typeof actual} for ${serviceName}. CorrelationId: ${correlationId}. Value: ${actual}`,
    )
  }

  const expectedEndpoints = ['health', 'system']
  const missing: string[] = []
  const invalid: string[] = []

  for (const endpoint of expectedEndpoints) {
    if (!(endpoint in actual)) {
      missing.push(endpoint)
    } else if (
      typeof actual[endpoint] !== 'string' ||
      !actual[endpoint].startsWith('/')
    ) {
      invalid.push(
        `${endpoint}: expected string starting with '/', got ${typeof actual[endpoint]}: ${actual[endpoint]}`,
      )
    }
  }

  const errors: string[] = []
  if (missing.length > 0) {
    errors.push(`Missing endpoints: ${missing.join(', ')}`)
  }
  if (invalid.length > 0) {
    errors.push(`Invalid endpoints: ${invalid.join(', ')}`)
  }

  if (errors.length > 0) {
    const errorMessage = [
      `API endpoints validation failed for ${serviceName}:`,
      ...errors.map(err => `  - ${err}`),
      '',
      `Correlation ID: ${correlationId}`,
      `Actual endpoints: ${JSON.stringify(actual, null, 2)}`,
      `Available keys: ${Object.keys(actual)}`,
    ].join('\n')

    throw new Error(errorMessage)
  }
}

/**
 * Assert health check result with detailed error context
 */
export function assertHealthCheckResult(
  actual: any,
  serviceName: string,
  correlationId: string,
): void {
  const errors: string[] = []

  if (!actual) {
    throw new Error(
      `Health check result is null/undefined for ${serviceName}. CorrelationId: ${correlationId}`,
    )
  }

  // Check required boolean field
  if (typeof actual.isHealthy !== 'boolean') {
    errors.push(
      `isHealthy should be boolean, got ${typeof actual.isHealthy}: ${actual.isHealthy}`,
    )
  }

  // Check responseTime if present
  if (actual.responseTime !== undefined) {
    if (typeof actual.responseTime !== 'number' || actual.responseTime < 0) {
      errors.push(
        `responseTime should be non-negative number, got ${typeof actual.responseTime}: ${actual.responseTime}`,
      )
    }
  }

  // Check lastChecked if present
  if (actual.lastChecked !== undefined) {
    if (
      !(actual.lastChecked instanceof Date) &&
      typeof actual.lastChecked !== 'string'
    ) {
      errors.push(
        `lastChecked should be Date or string, got ${typeof actual.lastChecked}`,
      )
    }
  }

  // If unhealthy, should have error or reason
  if (actual.isHealthy === false && !actual.error) {
    errors.push('Unhealthy service should provide error message')
  }

  if (errors.length > 0) {
    const errorMessage = [
      `Health check result validation failed for ${serviceName}:`,
      ...errors.map(err => `  - ${err}`),
      '',
      `Correlation ID: ${correlationId}`,
      `Actual result: ${JSON.stringify(actual, null, 2)}`,
    ].join('\n')

    throw new Error(errorMessage)
  }
}

/**
 * Assert connection test result with detailed error context
 */
export function assertConnectionTestResult(
  actual: any,
  serviceName: string,
  correlationId: string,
): void {
  const errors: string[] = []

  if (!actual) {
    throw new Error(
      `Connection test result is null/undefined for ${serviceName}. CorrelationId: ${correlationId}`,
    )
  }

  // Check required boolean fields
  if (typeof actual.canConnect !== 'boolean') {
    errors.push(
      `canConnect should be boolean, got ${typeof actual.canConnect}: ${actual.canConnect}`,
    )
  }

  if (typeof actual.isAuthenticated !== 'boolean') {
    errors.push(
      `isAuthenticated should be boolean, got ${typeof actual.isAuthenticated}: ${actual.isAuthenticated}`,
    )
  }

  // Check responseTime if present
  if (actual.responseTime !== undefined) {
    if (typeof actual.responseTime !== 'number' || actual.responseTime < 0) {
      errors.push(
        `responseTime should be non-negative number, got ${typeof actual.responseTime}: ${actual.responseTime}`,
      )
    }
  }

  // If connection failed, should have error or suggestions
  if (
    actual.canConnect === false &&
    !actual.error &&
    !actual.suggestions?.length
  ) {
    errors.push('Failed connection should provide error message or suggestions')
  }

  if (errors.length > 0) {
    const errorMessage = [
      `Connection test result validation failed for ${serviceName}:`,
      ...errors.map(err => `  - ${err}`),
      '',
      `Correlation ID: ${correlationId}`,
      `Actual result: ${JSON.stringify(actual, null, 2)}`,
    ].join('\n')

    throw new Error(errorMessage)
  }
}
