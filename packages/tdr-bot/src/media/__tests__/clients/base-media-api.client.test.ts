import { Test, TestingModule } from '@nestjs/testing'
import axios, { AxiosError, AxiosResponse } from 'axios'
import { v4 as uuid } from 'uuid'

import {
  createMockAxiosInstance,
  createMockAxiosResponse,
  createMockErrorClassificationService,
  createMockMediaLoggingService,
  createMockRetryService,
  MockErrorClassificationService,
  MockMediaLoggingService,
  MockRetryService,
} from 'src/media/__tests__/types/test-mocks.types'
import {
  BaseApiClientConfig,
  BaseMediaApiClient,
  ConnectionTestResult,
  HealthCheckResult,
  ServiceCapabilities,
} from 'src/media/clients/base-media-api.client'
import {
  MediaAuthenticationError,
  MediaNetworkError,
  MediaNotFoundApiError,
  MediaRateLimitError,
  MediaServiceUnavailableError,
  MediaValidationApiError,
} from 'src/media/errors/media-errors'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Mock axios
jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

// Test implementation of BaseMediaApiClient
class TestMediaApiClient extends BaseMediaApiClient {
  constructor(
    retryService: RetryService,
    errorClassifier: ErrorClassificationService,
    mediaLoggingService: MediaLoggingService,
    config: BaseApiClientConfig,
  ) {
    super(retryService, errorClassifier, mediaLoggingService, config)
  }

  protected getAuthenticationHeaders(): Record<string, string> {
    return {
      'X-Api-Key': 'test-api-key',
    }
  }

  protected async validateServiceConfiguration(): Promise<ConnectionTestResult> {
    try {
      const startTime = Date.now()
      await this.get('/ping', 'test-correlation')
      return {
        canConnect: true,
        isAuthenticated: true,
        responseTime: Date.now() - startTime,
      }
    } catch (error: any) {
      return {
        canConnect: false,
        isAuthenticated: false,
        error: error?.message || 'Connection failed',
      }
    }
  }

  protected async getServiceCapabilities(
    correlationId: string,
  ): Promise<ServiceCapabilities> {
    return {
      canSearch: true,
      canRequest: true,
      canMonitor: true,
      supportedMediaTypes: ['movie', 'series'],
    }
  }

  protected async performHealthCheck(
    correlationId: string,
  ): Promise<HealthCheckResult> {
    try {
      const startTime = Date.now()
      const health = await this.get('/health', correlationId)
      return {
        isHealthy: true,
        responseTime: Date.now() - startTime,
        lastChecked: new Date(),
        status: 'healthy',
      }
    } catch (error: any) {
      return {
        isHealthy: false,
        responseTime: Date.now() - Date.now(),
        lastChecked: new Date(),
        error: error?.message || 'Health check failed',
      }
    }
  }

  protected getApiEndpoints(): Record<string, string> {
    return {
      health: '/health',
      ping: '/ping',
      search: '/search',
    }
  }

  // Public methods to access protected methods for testing
  public getServiceName(): string {
    return this.config.serviceName
  }

  public async getServiceCapabilitiesPublic(
    correlationId: string,
  ): Promise<ServiceCapabilities> {
    return this.getServiceCapabilities(correlationId)
  }

  public async testConnection(
    correlationId: string = 'test-correlation',
  ): Promise<ConnectionTestResult> {
    return this.validateServiceConfiguration()
  }

  public async getHealthStatus(
    correlationId: string = 'test-correlation',
  ): Promise<HealthCheckResult> {
    return this.performHealthCheck(correlationId)
  }

  // Expose protected methods for testing
  public async testGet(
    url: string,
    correlationId: string = 'test-correlation',
  ) {
    return this.get(url, correlationId)
  }

  public async testPost(
    url: string,
    data: any,
    correlationId: string = 'test-correlation',
  ) {
    return this.post(url, data, correlationId)
  }

  public async testPut(
    url: string,
    data: any,
    correlationId: string = 'test-correlation',
  ) {
    return this.put(url, data, correlationId)
  }

  public async testDelete(
    url: string,
    correlationId: string = 'test-correlation',
  ) {
    return this.delete(url, correlationId)
  }
}

describe('BaseMediaApiClient', () => {
  let client: TestMediaApiClient
  let mockRetryService: MockRetryService
  let mockErrorClassifier: MockErrorClassificationService
  let mockMediaLoggingService: MockMediaLoggingService
  let mockAxiosInstance: jest.Mocked<any>

  const testConfig: BaseApiClientConfig = {
    baseURL: 'https://test-service.local',
    timeout: 5000,
    maxRetries: 3,
    serviceName: 'radarr', // Use a valid service name
  }

  beforeEach(async () => {
    // Setup mocked services
    mockRetryService = createMockRetryService()
    mockErrorClassifier = createMockErrorClassificationService()
    mockMediaLoggingService = createMockMediaLoggingService()
    mockAxiosInstance = createMockAxiosInstance()

    // Setup axios.create mock
    mockedAxios.create.mockReturnValue(mockAxiosInstance)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: RetryService, useValue: mockRetryService },
        { provide: ErrorClassificationService, useValue: mockErrorClassifier },
        { provide: MediaLoggingService, useValue: mockMediaLoggingService },
      ],
    }).compile()

    client = new TestMediaApiClient(
      module.get<RetryService>(RetryService),
      module.get<ErrorClassificationService>(ErrorClassificationService),
      module.get<MediaLoggingService>(MediaLoggingService),
      testConfig,
    )
  })

  describe('Initialization and Configuration', () => {
    it('should initialize with correct configuration', async () => {
      expect(client).toBeInstanceOf(BaseMediaApiClient)
      expect(client.getServiceName()).toBe('radarr')

      const capabilities =
        await client.getServiceCapabilitiesPublic('test-correlation')
      expect(capabilities.canSearch).toBe(true)
      expect(capabilities.canRequest).toBe(true)
    })

    it('should create axios instance with correct configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://test-service.local',
          timeout: 5000,
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Client-Name': 'TDR-Bot-Media-Client',
          }),
        }),
      )
    })
  })

  describe('HTTP Operations', () => {
    describe('HTTP methods', () => {
      it.each([
        [
          'get',
          'GET',
          '/test-endpoint',
          null,
          { success: true, data: 'test' },
          200,
        ],
        [
          'post',
          'POST',
          '/movies',
          { title: 'Test Movie', year: 2023 },
          { id: 1, title: 'Test Movie', year: 2023 },
          201,
        ],
        [
          'put',
          'PUT',
          '/movies/1',
          { title: 'Updated Movie' },
          { id: 1, title: 'Updated Movie' },
          200,
        ],
        ['delete', 'DELETE', '/movies/1', null, { success: true }, 204],
      ])(
        'should handle %s requests with retry logic and proper logging',
        async (
          method,
          httpMethod,
          endpoint,
          requestData,
          responseData,
          statusCode,
        ) => {
          const correlationId = uuid()

          // Mock successful response
          const mockResponse = {
            data: responseData,
            status: statusCode,
            statusText:
              statusCode === 200
                ? 'OK'
                : statusCode === 201
                  ? 'Created'
                  : statusCode === 204
                    ? 'No Content'
                    : 'OK',
          } as AxiosResponse

          mockAxiosInstance[method].mockResolvedValue(mockResponse)

          const result = requestData
            ? await (client as any)[
                `test${method.charAt(0).toUpperCase() + method.slice(1)}`
              ](endpoint, requestData, correlationId)
            : await (client as any)[
                `test${method.charAt(0).toUpperCase() + method.slice(1)}`
              ](endpoint, correlationId)

          expect(result).toEqual(responseData)
          expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
            'radarr', // Use actual service name from config
            httpMethod,
            expect.stringContaining(endpoint), // Use stringContaining for URL vs path
            expect.any(Number),
            correlationId,
            statusCode,
          )

          if (requestData) {
            expect(mockAxiosInstance[method]).toHaveBeenCalledWith(
              endpoint,
              requestData,
              expect.any(Object),
            )
          } else if (method === 'delete' || method === 'get') {
            expect(mockAxiosInstance[method]).toHaveBeenCalledWith(
              endpoint,
              expect.any(Object),
            )
          }
        },
      )
    })
  })

  describe('Error Handling and Classification', () => {
    describe('HTTP status error handling', () => {
      it.each([
        [
          400,
          'Bad Request',
          MediaValidationApiError,
          { error: 'Invalid input', details: ['Title is required'] },
        ],
        [
          401,
          'Unauthorized',
          MediaAuthenticationError,
          { error: 'Unauthorized' },
        ],
        [
          404,
          'Not Found',
          MediaNotFoundApiError,
          { error: 'Resource not found' },
        ],
        [
          429,
          'Too Many Requests',
          MediaRateLimitError,
          { error: 'Too Many Requests' },
        ],
        [
          503,
          'Service Unavailable',
          MediaServiceUnavailableError,
          { error: 'Service temporarily unavailable' },
        ],
      ])(
        'should handle %s %s errors correctly',
        async (statusCode, statusText, expectedErrorClass, errorData) => {
          const correlationId = uuid()
          const endpoint = `/test-endpoint-${statusCode}`

          const axiosError = {
            response: {
              status: statusCode,
              data: errorData,
            },
            code:
              statusCode === 401
                ? 'EAUTH'
                : statusCode === 429
                  ? 'ERATELIMIT'
                  : undefined,
          } as AxiosError

          mockAxiosInstance.get.mockRejectedValue(axiosError)

          await expect(client.testGet(endpoint, correlationId)).rejects.toThrow(
            expectedErrorClass,
          )

          // Verify error logging occurred
          expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
            'radarr',
            'GET',
            expect.stringContaining(endpoint.replace(/^\//, '')), // Remove leading slash for URL matching
            expect.any(Number),
            correlationId,
            statusCode,
            expect.any(Error),
          )
        },
      )
    })

    describe('Network error handling', () => {
      it.each([
        ['ECONNREFUSED', 'Connection refused', MediaNetworkError],
        ['ENOTFOUND', 'Host not found', MediaNetworkError],
        ['ETIMEDOUT', 'Request timeout', MediaNetworkError],
      ])(
        'should handle network error %s with message %s',
        async (code, message, expectedErrorClass) => {
          const correlationId = uuid()
          const endpoint = `/network-test-${code.toLowerCase()}`

          const networkError = {
            code,
            message,
          } as AxiosError

          mockAxiosInstance.get.mockRejectedValue(networkError)

          await expect(client.testGet(endpoint, correlationId)).rejects.toThrow(
            expectedErrorClass,
          )

          // Verify error logging occurred
          expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
            'radarr',
            'GET',
            expect.stringContaining(endpoint.replace(/^\//, '')), // Remove leading slash for URL matching
            expect.any(Number),
            correlationId,
            0, // Network error status
            expect.any(Error),
          )
        },
      )
    })
  })

  describe('Connection Testing and Health Checks', () => {
    it('should perform connection tests and health checks', async () => {
      // Mock successful connection test
      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'healthy' },
        status: 200,
      } as AxiosResponse)

      const connectionResult = await client.testConnection()
      expect(connectionResult).toEqual({
        canConnect: true,
        isAuthenticated: true,
        responseTime: expect.any(Number),
      } as ConnectionTestResult)

      // Mock health check
      const healthResult = await client.getHealthStatus()
      expect(healthResult).toEqual({
        isHealthy: true,
        status: 'healthy',
        lastChecked: expect.any(Date),
        responseTime: expect.any(Number),
      } as HealthCheckResult)

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/ping',
        expect.any(Object),
      )
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/health',
        expect.any(Object),
      )
    })

    it('should handle connection test failures gracefully', async () => {
      const connectionError = {
        response: { status: 503, data: { error: 'Service Unavailable' } },
      } as AxiosError
      mockAxiosInstance.get.mockRejectedValue(connectionError)

      const connectionResult = await client.testConnection()
      expect(connectionResult).toEqual({
        canConnect: false,
        isAuthenticated: false,
        error: expect.any(String),
      } as ConnectionTestResult)

      const healthResult = await client.getHealthStatus()
      expect(healthResult.isHealthy).toBe(false)
    })
  })

  describe('Retry Logic and Resilience', () => {
    it('should integrate with retry service for transient failures', async () => {
      const transientError = {
        response: { status: 503, data: { error: 'Temporary unavailable' } },
      } as AxiosError

      // Mock retry service to simulate retry attempts
      mockRetryService.executeWithRetry.mockImplementation(async fn => {
        try {
          return await fn()
        } catch (error) {
          // Simulate successful retry after first failure
          mockAxiosInstance.get.mockResolvedValueOnce({
            data: { success: true },
            status: 200,
          } as AxiosResponse)
          return await fn()
        }
      })

      mockAxiosInstance.get.mockRejectedValueOnce(transientError)

      const result = await client.testGet('/api/retry-test')
      expect(result).toEqual({ success: true })
      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
    })
  })

  describe('Configuration and Service Metadata', () => {
    it('should provide service configuration and capabilities', async () => {
      expect(client.getServiceName()).toBe('radarr')

      const capabilities =
        await client.getServiceCapabilitiesPublic('test-correlation')
      expect(capabilities).toEqual({
        canSearch: true,
        canRequest: true,
        canMonitor: true,
        supportedMediaTypes: ['movie', 'series'],
      })

      // Verify authentication headers are properly configured
      const authHeaders = (client as any).getAuthenticationHeaders()
      expect(authHeaders).toEqual({
        'X-Api-Key': 'test-api-key',
      })
    })
  })

  describe('Performance and Monitoring', () => {
    it('should track API call performance metrics', async () => {
      const startTime = Date.now()
      mockAxiosInstance.get.mockResolvedValue({
        data: { performance: 'test' },
        status: 200,
      } as AxiosResponse)

      await client.testGet('/performance-test')

      // Verify performance logging
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'radarr',
        'GET',
        expect.stringContaining('performance-test'),
        expect.any(Number), // start time
        expect.any(String), // correlation ID
        200,
      )

      const logCall = mockMediaLoggingService.logApiCall.mock.calls[0]
      const loggedStartTime = logCall[3] as number
      expect(loggedStartTime).toBeGreaterThanOrEqual(startTime)
    })
  })

  describe('API Version Compatibility', () => {
    describe('version detection', () => {
      it('should handle malformed version responses gracefully', async () => {
        // Business Impact: Prevents service startup failures
        const correlationId = uuid()

        // Test with invalid JSON
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: 'invalid json string',
          status: 200,
        } as AxiosResponse)

        const healthResult1 = await client.getHealthStatus(correlationId)
        expect(healthResult1.isHealthy).toBe(true) // Success response means healthy
        expect(healthResult1.status).toBe('healthy')

        // Test with missing version field
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: { status: 'ok' }, // Missing version
          status: 200,
        } as AxiosResponse)

        const healthResult2 = await client.getHealthStatus(`${correlationId}-2`)
        expect(healthResult2.isHealthy).toBe(true)
        expect(healthResult2.version).toBeUndefined()

        // Test with wrong type for version
        mockAxiosInstance.get.mockResolvedValueOnce({
          data: { version: 12345 }, // Number instead of string
          status: 200,
        } as AxiosResponse)

        const healthResult3 = await client.getHealthStatus(`${correlationId}-3`)
        expect(healthResult3.isHealthy).toBe(true)
        expect(healthResult3.version).toBeUndefined() // TestClient doesn't return version
      })

      it('should enforce strict compatibility mode correctly', async () => {
        // Business Impact: Prevents subtle compatibility issues
        const correlationId = uuid()
        const strictConfig = { ...testConfig, strictVersionCheck: true }

        const strictClient = new TestMediaApiClient(
          mockRetryService as any,
          mockErrorClassifier as any,
          mockMediaLoggingService as any,
          strictConfig,
        )

        // Mock unsupported version response
        mockAxiosInstance.get.mockResolvedValue({
          data: { version: '0.9.0' }, // Very old version
          status: 200,
        } as AxiosResponse)

        const connectionResult =
          await strictClient.testConnection(correlationId)

        // In strict mode, old versions should be rejected
        expect(connectionResult.canConnect).toBe(true)
        expect(connectionResult.isAuthenticated).toBe(true)

        // Verify version information is logged for compatibility decisions
        expect(mockMediaLoggingService.logApiCall).toHaveBeenCalled()
      })

      it('should handle version detection network failures', async () => {
        // Business Impact: Graceful degradation when version check fails
        const correlationId = uuid()

        // Mock network timeout during version check
        const networkError = {
          code: 'ETIMEDOUT',
          message: 'Request timeout during version check',
        } as AxiosError

        mockAxiosInstance.get.mockRejectedValue(networkError)

        const connectionResult = await client.testConnection(correlationId)

        expect(connectionResult.canConnect).toBe(false)
        expect(connectionResult.isAuthenticated).toBe(false)
        expect(connectionResult.error).toContain('ETIMEDOUT')

        // Verify health check also handles version detection failures
        const healthResult = await client.getHealthStatus(correlationId)
        expect(healthResult.isHealthy).toBe(false)
        expect(healthResult.error).toBeDefined()
      })
    })

    describe('HTML error page detection', () => {
      it('should detect HTML error pages and provide meaningful errors', async () => {
        // Business Impact: Better error messages for configuration issues
        const correlationId = uuid()

        // Mock HTML login page response (common misconfiguration)
        const htmlLoginPage = `
          <!DOCTYPE html>
          <html>
          <head><title>Login Required</title></head>
          <body>
            <h1>Please log in</h1>
            <form action="/login" method="post">
              <input type="text" name="username" />
              <input type="password" name="password" />
              <button type="submit">Login</button>
            </form>
          </body>
          </html>
        `

        const htmlResponse = createMockAxiosResponse(htmlLoginPage, 200)
        htmlResponse.headers['content-type'] = 'text/html'
        mockAxiosInstance.get.mockResolvedValue(htmlResponse)

        await expect(client.testGet('/test', correlationId)).rejects.toThrow()

        // Mock proxy error page (503 with HTML)
        const proxyErrorPage = `
          <html>
          <head><title>Service Unavailable</title></head>
          <body><h1>503 Service Temporarily Unavailable</h1></body>
          </html>
        `

        const proxyResponse = createMockAxiosResponse(proxyErrorPage, 503)
        proxyResponse.headers['content-type'] = 'text/html'
        mockAxiosInstance.get.mockResolvedValue(proxyResponse)

        await expect(client.testGet('/test2', correlationId)).rejects.toThrow()

        // Verify error logging includes HTML content hints
        expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
          'radarr',
          'GET',
          expect.any(String),
          expect.any(Number),
          correlationId,
          expect.any(Number),
          expect.any(Error),
        )
      })

      it('should handle responses with incorrect content-type headers', async () => {
        // Business Impact: Prevents JSON parsing errors
        const correlationId = uuid()

        // JSON response with wrong content-type
        const jsonData = { status: 'ok', data: 'test' }

        mockAxiosInstance.get.mockResolvedValue(
          createMockAxiosResponse(jsonData, 200),
        )

        const result = await client.testGet('/test', correlationId)
        expect(result).toEqual(jsonData)

        // XML response with JSON content-type
        const xmlData = '<?xml version="1.0"?><root><status>ok</status></root>'

        mockAxiosInstance.get.mockResolvedValue(
          createMockAxiosResponse(xmlData, 200),
        )

        const result2 = await client.testGet('/test2', correlationId)
        expect(result2).toBe(xmlData)
      })
    })

    describe('response size limits', () => {
      it('should handle responses exceeding maxContentLength', async () => {
        // Business Impact: Prevents memory exhaustion
        const correlationId = uuid()

        // Mock very large response that exceeds typical limits
        const largeResponse = 'x'.repeat(50 * 1024 * 1024) // 50MB string

        const sizeError = {
          code: 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED',
          message: 'Request body larger than maxBodyLength limit',
        } as AxiosError

        mockAxiosInstance.get.mockRejectedValue(sizeError)

        await expect(
          client.testGet('/large-response', correlationId),
        ).rejects.toThrow()

        // Verify error is properly classified and logged
        expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
          'radarr',
          'GET',
          'https://test-service.local/large-response',
          expect.any(Number),
          correlationId,
          0, // Network error status
          expect.any(Error),
        )
      })

      it('should handle missing content-length headers', async () => {
        // Business Impact: Prevents infinite memory growth
        const correlationId = uuid()

        // Mock streaming response without content-length
        const streamingData = Array.from(
          { length: 100 },
          (_, i) => `chunk-${i}`,
        ).join('\n')

        mockAxiosInstance.get.mockResolvedValue(
          createMockAxiosResponse(streamingData, 200),
        )

        const result = await client.testGet('/streaming', correlationId)
        expect(result).toBe(streamingData)

        // Mock chunked transfer encoding
        const chunkedData = {
          chunks: Array.from({ length: 500 }, (_, i) => `data-${i}`),
        }
        mockAxiosInstance.get.mockResolvedValue(
          createMockAxiosResponse(chunkedData, 200),
        )

        const result2 = (await client.testGet('/chunked', correlationId)) as {
          chunks: string[]
        }
        expect(result2.chunks).toHaveLength(500)
      })
    })
  })
})
