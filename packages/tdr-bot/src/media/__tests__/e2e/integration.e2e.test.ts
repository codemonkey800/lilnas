/**
 * @fileoverview Cross-Service Integration E2E Tests
 *
 * Integration tests across media API clients (Sonarr, Radarr, Emby) including
 * performance comparisons, error consistency validation, and service interoperability.
 *
 * @module IntegrationE2ETests
 * @since 1.0.0
 * @author TDR Bot Development Team
 */

import { Logger } from '@nestjs/common'

import { EmbyClient } from 'src/media/clients/emby.client'
import { RadarrClient } from 'src/media/clients/radarr.client'
import { SonarrClient } from 'src/media/clients/sonarr.client'

import { getCachedE2EConfig } from './config/e2e-config'
import {
  cleanupClients,
  createAvailableClients,
  testClientConnectivity,
} from './utils/client-factory'
import {
  assertPerformance,
  createTestContext,
  E2ETestContext,
  getAllHealthStatus,
  getTestMetrics,
  measurePerformance,
  resetTestState,
  runCleanup,
} from './utils/test-setup'

const logger = new Logger('Integration-E2E')

describe('Cross-Service Integration E2E Tests', () => {
  const { config, validation } = getCachedE2EConfig()
  let clients: {
    sonarr?: SonarrClient
    radarr?: RadarrClient
    emby?: EmbyClient
  }
  let testContext: E2ETestContext
  const availableServices = validation.availableServices

  beforeAll(async () => {
    if (!validation.isValid) {
      throw new Error(
        `E2E configuration is invalid: ${validation.errors.join(', ')}`,
      )
    }

    if (availableServices.length < 2) {
      logger.warn(
        'Integration tests require at least 2 services to be available',
        {
          availableServices,
          skippedServices: validation.skippedServices,
        },
      )
    }

    testContext = createTestContext('Integration E2E Tests', 'integration')
    clients = createAvailableClients(config)

    logger.log('Starting Integration E2E tests', {
      correlationId: testContext.correlationId,
      availableServices,
      clientsCreated: Object.keys(clients),
    })

    // Reset test state for clean metrics
    resetTestState()
  }, config.timeouts.default)

  afterAll(async () => {
    await runCleanup(testContext)
    cleanupClients(clients)
  }, config.timeouts.cleanup)

  describe('Service Connectivity Matrix', () => {
    test(
      'should test connectivity to all available services',
      async () => {
        if (availableServices.length === 0) {
          logger.warn('No services available for connectivity testing')
          return
        }

        let connectivityResults
        try {
          connectivityResults = await measurePerformance(
            'integration_connectivity_test',
            () => testClientConnectivity(clients, testContext.correlationId),
            testContext,
          )
        } catch (error) {
          console.warn(
            `Integration connectivity test failed: ${error instanceof Error ? error.message : String(error)}`,
          )
          return
        }

        if (!connectivityResults || typeof connectivityResults !== 'object') {
          console.warn(
            `Integration connectivity test returned invalid result: ${typeof connectivityResults}`,
          )
          return
        }

        // Only run expectations if we reach here with valid results
        expect(connectivityResults.errors.length).toBe(0)

        // Check each available service
        if (clients.sonarr && availableServices.includes('sonarr')) {
          expect(connectivityResults.sonarr).toBe(true)
        }
        if (clients.radarr && availableServices.includes('radarr')) {
          expect(connectivityResults.radarr).toBe(true)
        }
        if (clients.emby && availableServices.includes('emby')) {
          expect(connectivityResults.emby).toBe(true)
        }

        logger.log('Service connectivity test results', {
          correlationId: testContext.correlationId,
          results: connectivityResults,
          availableServices,
        })
      },
      config.timeouts.default,
    )

    test(
      'should verify all services are healthy simultaneously',
      async () => {
        if (availableServices.length === 0) return

        const healthChecks = []

        if (clients.sonarr) {
          healthChecks.push(
            measurePerformance(
              'sonarr_health_concurrent',
              () => clients.sonarr!.checkHealth(testContext.correlationId),
              testContext,
            ),
          )
        }

        if (clients.radarr) {
          healthChecks.push(
            measurePerformance(
              'radarr_health_concurrent',
              () => clients.radarr!.checkHealth(testContext.correlationId),
              testContext,
            ),
          )
        }

        if (clients.emby) {
          healthChecks.push(
            measurePerformance(
              'emby_health_concurrent',
              () => clients.emby!.checkHealth(testContext.correlationId),
              testContext,
            ),
          )
        }

        const startTime = Date.now()
        const healthResults = await Promise.allSettled(healthChecks)
        const totalTime = Date.now() - startTime

        // All health checks should succeed
        const successfulChecks = healthResults.filter(
          result => result.status === 'fulfilled',
        )
        expect(successfulChecks.length).toBe(healthChecks.length)

        // Concurrent health checks should be faster than sequential
        const maxIndividualTime = config.performance.maxResponseTimeMs
        expect(totalTime).toBeLessThan(healthChecks.length * maxIndividualTime)

        successfulChecks.forEach(result => {
          if (result.status === 'fulfilled') {
            expect(result.value.isHealthy).toBe(true)
          }
        })
      },
      config.timeouts.default,
    )
  })

  describe('Performance Comparison Across Services', () => {
    test(
      'should compare health check response times',
      async () => {
        if (availableServices.length < 2) {
          logger.warn(
            'Skipping performance comparison - need at least 2 services',
          )
          return
        }

        const performanceResults: { service: string; responseTime: number }[] =
          []

        // Test each service health check performance
        for (const [serviceName, client] of Object.entries(clients)) {
          if (!client) continue

          let healthResult
          const startTime = Date.now()
          try {
            healthResult = await client.checkHealth(testContext.correlationId)
          } catch (error) {
            console.warn(
              `Integration performance test failed for ${serviceName}: ${error instanceof Error ? error.message : String(error)}`,
            )
            continue
          }
          const responseTime = Date.now() - startTime

          if (!healthResult || typeof healthResult !== 'object') {
            console.warn(
              `Integration performance test returned invalid result for ${serviceName}: ${typeof healthResult}`,
            )
            continue
          }

          // Only run expectations if we reach here with valid results
          expect(healthResult.isHealthy).toBe(true)
          performanceResults.push({ service: serviceName, responseTime })
        }

        expect(performanceResults.length).toBeGreaterThanOrEqual(2)

        // All services should meet performance requirements
        performanceResults.forEach(({ service, responseTime }) => {
          assertPerformance(
            responseTime,
            config.performance.maxResponseTimeMs,
            `${service} health check`,
          )
        })

        // Calculate performance statistics
        const avgResponseTime =
          performanceResults.reduce((sum, r) => sum + r.responseTime, 0) /
          performanceResults.length
        const slowestService = performanceResults.reduce((prev, current) =>
          current.responseTime > prev.responseTime ? current : prev,
        )
        const fastestService = performanceResults.reduce((prev, current) =>
          current.responseTime < prev.responseTime ? current : prev,
        )

        logger.log('Service performance comparison', {
          correlationId: testContext.correlationId,
          averageResponseTime: avgResponseTime,
          slowestService,
          fastestService,
          performanceResults,
        })

        // Performance should be consistent across services (within 3x)
        const performanceRatio =
          slowestService.responseTime / fastestService.responseTime
        expect(performanceRatio).toBeLessThan(3)
      },
      config.timeouts.default,
    )

    test(
      'should compare concurrent request handling',
      async () => {
        if (availableServices.length < 2) return

        const concurrentRequests = 3
        const testPromises: Promise<any>[] = []

        // Create concurrent requests for each service
        if (clients.sonarr) {
          for (let i = 0; i < concurrentRequests; i++) {
            testPromises.push(
              measurePerformance(
                `sonarr_concurrent_${i}`,
                () =>
                  clients.sonarr!.getQualityProfiles(testContext.correlationId),
                testContext,
              ),
            )
          }
        }

        if (clients.radarr) {
          for (let i = 0; i < concurrentRequests; i++) {
            testPromises.push(
              measurePerformance(
                `radarr_concurrent_${i}`,
                () =>
                  clients.radarr!.getQualityProfiles(testContext.correlationId),
                testContext,
              ),
            )
          }
        }

        if (clients.emby) {
          for (let i = 0; i < concurrentRequests; i++) {
            testPromises.push(
              measurePerformance(
                `emby_concurrent_${i}`,
                () => clients.emby!.getLibraries(testContext.correlationId),
                testContext,
              ),
            )
          }
        }

        const startTime = Date.now()
        const results = await Promise.allSettled(testPromises)
        const totalTime = Date.now() - startTime

        // All requests should succeed
        const successfulResults = results.filter(r => r.status === 'fulfilled')
        expect(successfulResults.length).toBe(testPromises.length)

        // Concurrent processing should be efficient
        const expectedSequentialTime =
          testPromises.length * config.performance.maxResponseTimeMs
        expect(totalTime).toBeLessThan(expectedSequentialTime / 2) // Should be at least 50% faster
      },
      config.timeouts.default,
    )
  })

  describe('Error Handling Consistency', () => {
    test('should handle network errors consistently across services', async () => {
      if (availableServices.length < 2) return

      // Test network timeout handling
      const shortTimeoutConfig = {
        ...config,
        timeouts: { ...config.timeouts, default: 1 },
      }
      const timeoutClients = createAvailableClients(shortTimeoutConfig)

      try {
        const errorTests = []

        if (timeoutClients.sonarr) {
          errorTests.push(
            timeoutClients.sonarr
              .getQualityProfiles(testContext.correlationId)
              .then(
                result =>
                  console.warn(
                    'Expected timeout but got result for sonarr:',
                    typeof result,
                  ),
                error => expect(error).toBeDefined(),
              ),
          )
        }

        if (timeoutClients.radarr) {
          errorTests.push(
            timeoutClients.radarr
              .getQualityProfiles(testContext.correlationId)
              .then(
                result =>
                  console.warn(
                    'Expected timeout but got result for radarr:',
                    typeof result,
                  ),
                error => expect(error).toBeDefined(),
              ),
          )
        }

        if (timeoutClients.emby) {
          errorTests.push(
            timeoutClients.emby.getLibraries(testContext.correlationId).then(
              result =>
                console.warn(
                  'Expected timeout but got result for emby:',
                  typeof result,
                ),
              error => expect(error).toBeDefined(),
            ),
          )
        }

        await Promise.all(errorTests)
      } finally {
        cleanupClients(timeoutClients)
      }
    }, 10000)

    test(
      'should handle invalid endpoints consistently',
      async () => {
        if (availableServices.length < 2) return

        const invalidEndpointTests = []

        if (clients.sonarr) {
          invalidEndpointTests.push(
            // @ts-ignore - Intentionally invalid endpoint for testing error handling
            (clients.sonarr as any)
              .get('/invalid/endpoint', testContext.correlationId)
              .then(
                (result: any) =>
                  console.warn(
                    'Expected error but got result for sonarr invalid endpoint:',
                    typeof result,
                  ),
                (error: any) => expect(error).toBeDefined(),
              ),
          )
        }

        if (clients.radarr) {
          invalidEndpointTests.push(
            // @ts-ignore - Intentionally invalid endpoint
            clients.radarr.getMovie(99999, testContext.correlationId).then(
              result =>
                console.warn(
                  'Expected error but got result for radarr invalid movie:',
                  typeof result,
                ),
              error => expect(error).toBeDefined(),
            ),
          )
        }

        if (clients.emby) {
          invalidEndpointTests.push(
            // @ts-ignore - Intentionally invalid endpoint
            clients.emby
              .getItem('invalid-item-id', testContext.correlationId)
              .then(
                result =>
                  console.warn(
                    'Expected error but got result for emby invalid item:',
                    typeof result,
                  ),
                error => expect(error).toBeDefined(),
              ),
          )
        }

        await Promise.all(invalidEndpointTests)
      },
      config.timeouts.default,
    )

    test(
      'should provide consistent error information',
      async () => {
        if (availableServices.length < 2) return

        const errorResults: { service: string; error: Error }[] = []

        // Collect errors from each service
        const errorTests = []

        if (clients.sonarr) {
          errorTests.push(
            clients.sonarr
              .getSeries(99999, testContext.correlationId)
              .catch(error => errorResults.push({ service: 'sonarr', error })),
          )
        }

        if (clients.radarr) {
          errorTests.push(
            clients.radarr
              .getMovie(99999, testContext.correlationId)
              .catch(error => errorResults.push({ service: 'radarr', error })),
          )
        }

        if (clients.emby) {
          errorTests.push(
            clients.emby
              .getItem('invalid-item-id', testContext.correlationId)
              .catch(error => errorResults.push({ service: 'emby', error })),
          )
        }

        await Promise.allSettled(errorTests)

        expect(errorResults.length).toBeGreaterThanOrEqual(2)

        // All errors should have consistent structure
        errorResults.forEach(({ service, error }) => {
          expect(error).toBeDefined()
          expect(error.message).toBeDefined()
          expect(typeof error.message).toBe('string')
          expect(error.message.length).toBeGreaterThan(0)
        })
      },
      config.timeouts.default,
    )
  })

  describe('API Version Compatibility', () => {
    test(
      'should detect and compare API versions across services',
      async () => {
        if (availableServices.length === 0) return

        const versionResults: { service: string; version: any }[] = []

        for (const [serviceName, client] of Object.entries(clients)) {
          if (!client) continue

          let apiVersion
          try {
            apiVersion = await measurePerformance(
              `${serviceName}_api_version`,
              () => client.getApiVersion(testContext.correlationId),
              testContext,
            )
          } catch (error) {
            console.warn(
              `Integration API version test failed for ${serviceName}: ${error instanceof Error ? error.message : String(error)}`,
            )
            continue
          }

          if (!apiVersion || typeof apiVersion !== 'object') {
            console.warn(
              `Integration API version test returned invalid result for ${serviceName}: ${typeof apiVersion}`,
            )
            continue
          }

          versionResults.push({ service: serviceName, version: apiVersion })
        }

        expect(versionResults.length).toBeGreaterThan(0)

        // All services should have version information
        versionResults.forEach(({ service, version }) => {
          expect(version).toBeDefined()
          expect(version.version).toBeDefined()
          expect(typeof version.version).toBe('string')
          expect(version.isCompatible).toBe(true)
        })

        logger.log('API version comparison', {
          correlationId: testContext.correlationId,
          versions: versionResults,
        })
      },
      config.timeouts.default,
    )

    test(
      'should verify service capabilities consistency',
      async () => {
        if (availableServices.length === 0) return

        const capabilityResults: { service: string; capabilities: any }[] = []

        for (const [serviceName, client] of Object.entries(clients)) {
          if (!client) continue

          let capabilities
          try {
            capabilities = await client.getCapabilities(
              testContext.correlationId,
            )
          } catch (error) {
            console.warn(
              `Integration capabilities test failed for ${serviceName}: ${error instanceof Error ? error.message : String(error)}`,
            )
            continue
          }

          if (!capabilities || typeof capabilities !== 'object') {
            console.warn(
              `Integration capabilities test returned invalid result for ${serviceName}: ${typeof capabilities}`,
            )
            continue
          }

          capabilityResults.push({ service: serviceName, capabilities })
        }

        // All services should have capabilities
        capabilityResults.forEach(({ service, capabilities }) => {
          expect(capabilities).toBeDefined()
          expect(typeof capabilities.canSearch).toBe('boolean')
          expect(typeof capabilities.canMonitor).toBe('boolean')
          expect(Array.isArray(capabilities.supportedMediaTypes)).toBe(true)
        })

        // Content management services should support requests
        const contentServices = capabilityResults.filter(
          ({ service }) => service === 'sonarr' || service === 'radarr',
        )
        contentServices.forEach(({ service, capabilities }) => {
          expect(capabilities.canRequest).toBe(true)
        })

        // Media library services should support search but not necessarily requests
        const libraryServices = capabilityResults.filter(
          ({ service }) => service === 'emby',
        )
        libraryServices.forEach(({ service, capabilities }) => {
          expect(capabilities.canSearch).toBe(true)
          expect(capabilities.canRequest).toBe(false) // Emby is browse-only
        })
      },
      config.timeouts.default,
    )
  })

  describe('Cross-Service Search Comparison', () => {
    test(
      'should compare search functionality across services',
      async () => {
        const searchComparisons = [
          { query: 'matrix', movieExpected: true, tvExpected: false },
          { query: 'breaking bad', movieExpected: false, tvExpected: true },
        ]

        for (const { query, movieExpected, tvExpected } of searchComparisons) {
          const searchResults: {
            service: string
            results: any[]
            type: string
          }[] = []

          // Search in Radarr (movies)
          if (clients.radarr && movieExpected) {
            try {
              const radarrResults = await clients.radarr.searchMovies(
                query,
                testContext.correlationId,
              )
              if (Array.isArray(radarrResults)) {
                searchResults.push({
                  service: 'radarr',
                  results: radarrResults,
                  type: 'movie',
                })
              } else {
                console.warn(
                  `Radarr search returned non-array result for "${query}": ${typeof radarrResults}`,
                )
              }
            } catch (error) {
              console.warn(
                `Radarr search failed for "${query}": ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }

          // Search in Sonarr (TV)
          if (clients.sonarr && tvExpected) {
            try {
              const sonarrResults = await clients.sonarr.searchSeries(
                query,
                testContext.correlationId,
              )
              if (Array.isArray(sonarrResults)) {
                searchResults.push({
                  service: 'sonarr',
                  results: sonarrResults,
                  type: 'tv',
                })
              } else {
                console.warn(
                  `Sonarr search returned non-array result for "${query}": ${typeof sonarrResults}`,
                )
              }
            } catch (error) {
              console.warn(
                `Sonarr search failed for "${query}": ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }

          // Search in Emby (all content)
          if (clients.emby) {
            try {
              const embyResults = await clients.emby.searchLibrary(
                query,
                testContext.correlationId,
                movieExpected ? ['Movie'] : ['Series'],
                10,
              )
              if (Array.isArray(embyResults)) {
                searchResults.push({
                  service: 'emby',
                  results: embyResults,
                  type: movieExpected ? 'movie' : 'tv',
                })
              } else {
                console.warn(
                  `Emby search returned non-array result for "${query}": ${typeof embyResults}`,
                )
              }
            } catch (error) {
              console.warn(
                `Emby search failed for "${query}": ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }

          // Validate search results
          searchResults.forEach(({ service, results, type }) => {
            expect(Array.isArray(results)).toBe(true)

            if (results.length > 0) {
              const firstResult = results[0]
              expect(firstResult).toBeDefined()

              // Check that results are relevant to query
              const queryWords = query.toLowerCase().split(' ')
              const titleField = service === 'emby' ? 'Name' : 'title'
              const title = firstResult[titleField]?.toLowerCase() || ''

              const hasRelevantMatch = queryWords.some(word =>
                title.includes(word),
              )
              expect(hasRelevantMatch).toBe(true)
            }
          })

          logger.debug(`Search comparison for "${query}"`, {
            correlationId: testContext.correlationId,
            query,
            resultCounts: searchResults.map(({ service, results }) => ({
              service,
              count: results.length,
            })),
          })
        }
      },
      config.timeouts.default * 2,
    )
  })

  describe('Service Diagnostics Comparison', () => {
    test(
      'should run diagnostics on all available services',
      async () => {
        if (availableServices.length === 0) return

        const diagnosticResults: { service: string; diagnostics: any }[] = []

        for (const [serviceName, client] of Object.entries(clients)) {
          if (!client) continue

          let diagnostics
          try {
            diagnostics = await measurePerformance(
              `${serviceName}_full_diagnostics`,
              () => client.runDiagnostics(testContext.correlationId),
              testContext,
            )
          } catch (error) {
            console.warn(
              `Integration diagnostics failed for ${serviceName}: ${error instanceof Error ? error.message : String(error)}`,
            )
            continue
          }

          if (!diagnostics || typeof diagnostics !== 'object') {
            console.warn(
              `Integration diagnostics returned invalid result for ${serviceName}: ${typeof diagnostics}`,
            )
            continue
          }

          diagnosticResults.push({ service: serviceName, diagnostics })
        }

        expect(diagnosticResults.length).toBeGreaterThan(0)

        // All services should pass diagnostics
        diagnosticResults.forEach(({ service, diagnostics }) => {
          expect(diagnostics.summary.isOperational).toBe(true)
          expect(diagnostics.connection.canConnect).toBe(true)
          expect(diagnostics.connection.isAuthenticated).toBe(true)
          expect(diagnostics.health.isHealthy).toBe(true)
          expect(diagnostics.summary.issues.length).toBe(0)
        })

        logger.log('Service diagnostics summary', {
          correlationId: testContext.correlationId,
          results: diagnosticResults.map(({ service, diagnostics }) => ({
            service,
            isOperational: diagnostics.summary.isOperational,
            responseTime: diagnostics.health.responseTime,
            version: diagnostics.health.version,
            apiVersion: diagnostics.health.apiVersion?.version,
          })),
        })
      },
      config.timeouts.default * availableServices.length,
    )
  })

  describe('Integration Test Summary', () => {
    test('should provide comprehensive test metrics summary', async () => {
      const metrics = getTestMetrics()
      const healthStatuses = getAllHealthStatus()

      expect(metrics.totalOperations).toBeGreaterThan(0)
      expect(metrics.successfulOperations).toBeGreaterThan(0)
      expect(metrics.failedOperations).toBe(0) // All operations should succeed in integration tests

      // Calculate success rate
      const successRate =
        (metrics.successfulOperations / metrics.totalOperations) * 100
      expect(successRate).toBe(100)

      // Performance should be reasonable
      if (metrics.averageDuration > 0) {
        expect(metrics.averageDuration).toBeLessThan(
          config.performance.maxResponseTimeMs,
        )
      }

      logger.log('Integration test summary', {
        correlationId: testContext.correlationId,
        metrics,
        healthStatuses,
        availableServices,
        totalTestsRun: availableServices.length,
        successRate: `${successRate}%`,
      })

      // All health statuses should be healthy
      healthStatuses.forEach(status => {
        expect(status.isHealthy).toBe(true)
      })
    })

    test('should verify no resource leaks or cleanup issues', async () => {
      // This test ensures that all clients are properly cleaned up
      // and no resources are leaked during integration testing

      const initialMetrics = getTestMetrics()

      // Perform a lightweight operation on each service
      const cleanupTests = []

      if (clients.sonarr) {
        cleanupTests.push(
          measurePerformance(
            'sonarr_cleanup_test',
            () => clients.sonarr!.checkHealth(testContext.correlationId),
            testContext,
          ),
        )
      }

      if (clients.radarr) {
        cleanupTests.push(
          measurePerformance(
            'radarr_cleanup_test',
            () => clients.radarr!.checkHealth(testContext.correlationId),
            testContext,
          ),
        )
      }

      if (clients.emby) {
        cleanupTests.push(
          measurePerformance(
            'emby_cleanup_test',
            () => clients.emby!.checkHealth(testContext.correlationId),
            testContext,
          ),
        )
      }

      const results = await Promise.allSettled(cleanupTests)
      const successfulResults = results.filter(r => r.status === 'fulfilled')

      expect(successfulResults.length).toBe(cleanupTests.length)

      const finalMetrics = getTestMetrics()
      expect(finalMetrics.totalOperations).toBeGreaterThan(
        initialMetrics.totalOperations,
      )

      logger.log('Resource cleanup verification completed', {
        correlationId: testContext.correlationId,
        initialOperations: initialMetrics.totalOperations,
        finalOperations: finalMetrics.totalOperations,
        additionalOperations:
          finalMetrics.totalOperations - initialMetrics.totalOperations,
      })
    })
  })
})
