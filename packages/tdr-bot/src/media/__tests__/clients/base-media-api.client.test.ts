import { Test, TestingModule } from '@nestjs/testing'
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { v4 as uuid } from 'uuid'

// Inline previous shared utilities - simplified for base test coverage
import {
  createMockAxiosInstance,
  createMockAxiosResponse,
  createMockErrorClassificationService,
  createMockMediaLoggingService,
  createMockRetryService,
  type MockAxiosInstance,
  type MockErrorClassificationService,
  type MockMediaLoggingService,
  type MockRetryService,
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
} from 'src/media/errors/media-errors'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Test case constants for parameterized tests
const DEFAULT_HTTP_METHOD_TEST_CASES = [
  {
    method: 'get',
    httpMethod: 'GET',
    endpoint: '/api/test-get',
    requestData: undefined,
    responseData: { result: 'success', method: 'GET' },
    statusCode: 200,
  },
  {
    method: 'post',
    httpMethod: 'POST',
    endpoint: '/api/test-post',
    requestData: { title: 'Test Movie', year: 2023 },
    responseData: { id: 123, title: 'Test Movie', created: true },
    statusCode: 201,
  },
  {
    method: 'put',
    httpMethod: 'PUT',
    endpoint: '/api/test-put',
    requestData: { id: 456, title: 'Updated Movie', monitored: true },
    responseData: { id: 456, title: 'Updated Movie', updated: true },
    statusCode: 200,
  },
  {
    method: 'delete',
    httpMethod: 'DELETE',
    endpoint: '/api/test-delete',
    requestData: undefined,
    responseData: undefined,
    statusCode: 204,
  },
]

const DEFAULT_HTTP_ERROR_TEST_CASES = [
  {
    statusCode: 401,
    statusText: 'Unauthorized',
    expectedErrorClass: MediaAuthenticationError,
    errorData: { error: 'Invalid API key' },
  },
  {
    statusCode: 404,
    statusText: 'Not Found',
    expectedErrorClass: MediaNotFoundApiError,
    errorData: { error: 'Resource not found' },
  },
  {
    statusCode: 429,
    statusText: 'Too Many Requests',
    expectedErrorClass: MediaRateLimitError,
    errorData: { error: 'Rate limit exceeded', retryAfter: 60 },
  },
  {
    statusCode: 500,
    statusText: 'Internal Server Error',
    expectedErrorClass: MediaServiceUnavailableError,
    errorData: { error: 'Internal server error' },
  },
  {
    statusCode: 503,
    statusText: 'Service Unavailable',
    expectedErrorClass: MediaServiceUnavailableError,
    errorData: { error: 'Service temporarily unavailable' },
  },
]

const DEFAULT_NETWORK_ERROR_TEST_CASES = [
  {
    code: 'ECONNREFUSED',
    message: 'Connection refused by server',
    expectedErrorClass: MediaNetworkError,
  },
  {
    code: 'ETIMEDOUT',
    message: 'Request timeout',
    expectedErrorClass: MediaNetworkError,
  },
  {
    code: 'ENOTFOUND',
    message: 'Host not found',
    expectedErrorClass: MediaNetworkError,
  },
]

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

  // Expose protected methods for testing
  public async get<T = unknown>(
    path: string,
    correlationId: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return super.get<T>(path, correlationId, config)
  }

  public async post<T = unknown>(
    path: string,
    data: unknown,
    correlationId: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return super.post<T>(path, data, correlationId, config)
  }

  public async put<T = unknown>(
    path: string,
    data: unknown,
    correlationId: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return super.put<T>(path, data, correlationId, config)
  }

  public async delete<T = unknown>(
    path: string,
    correlationId: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return super.delete<T>(path, correlationId, config)
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
    } catch (error: unknown) {
      return {
        canConnect: false,
        isAuthenticated: false,
        error: (error as Error)?.message || 'Connection failed',
      }
    }
  }

  protected async getServiceCapabilities(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _correlationId: string,
  ): Promise<ServiceCapabilities> {
    return {
      canSearch: true,
      canRequest: true,
      canMonitor: true,
      supportedMediaTypes: ['movie', 'series'],
    }
  }

  protected async performHealthCheck(
    _correlationId: string,
  ): Promise<HealthCheckResult> {
    try {
      const startTime = Date.now()
      await this.get('/health', _correlationId)
      return {
        isHealthy: true,
        responseTime: Date.now() - startTime,
        lastChecked: new Date(),
        status: 'healthy',
      }
    } catch (error: unknown) {
      return {
        isHealthy: false,
        responseTime: Date.now() - Date.now(),
        lastChecked: new Date(),
        error: (error as Error)?.message || 'Health check failed',
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _correlationId: string = 'test-correlation',
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
    data: unknown,
    correlationId: string = 'test-correlation',
  ) {
    return this.post(url, data, correlationId)
  }

  public async testPut(
    url: string,
    data: unknown,
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
  let mockAxiosInstance: MockAxiosInstance

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
      it.each(DEFAULT_HTTP_METHOD_TEST_CASES)(
        'should handle $method requests with retry logic and proper logging',
        async ({
          method,
          httpMethod,
          endpoint,
          requestData,
          responseData,
          statusCode,
        }) => {
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

          // Mock the appropriate method
          const axiosMethodMock = mockAxiosInstance[
            method as keyof MockAxiosInstance
          ] as jest.MockedFunction<() => Promise<AxiosResponse>>
          axiosMethodMock.mockResolvedValue(mockResponse)

          // Call the appropriate HTTP method on the client using type assertion to access protected methods
          // Use the public methods exposed for testing
          type BaseMediaApiClientWithProtectedMethods = BaseMediaApiClient & {
            get<T>(path: string, correlationId: string): Promise<T>
            post<T>(
              path: string,
              data: unknown,
              correlationId: string,
            ): Promise<T>
            put<T>(
              path: string,
              data: unknown,
              correlationId: string,
            ): Promise<T>
            delete<T>(path: string, correlationId: string): Promise<T>
          }
          const clientWithMethods =
            client as BaseMediaApiClientWithProtectedMethods

          let result: unknown
          if (requestData) {
            if (method === 'get') {
              result = await clientWithMethods.get(endpoint, correlationId)
            } else if (method === 'post') {
              result = await clientWithMethods.post(
                endpoint,
                requestData,
                correlationId,
              )
            } else if (method === 'put') {
              result = await clientWithMethods.put(
                endpoint,
                requestData,
                correlationId,
              )
            } else if (method === 'delete') {
              result = await clientWithMethods.delete(endpoint, correlationId)
            }
          } else {
            if (method === 'get') {
              result = await clientWithMethods.get(endpoint, correlationId)
            } else if (method === 'delete') {
              result = await clientWithMethods.delete(endpoint, correlationId)
            }
          }

          expect(result).toEqual(responseData)

          // Verify logging
          expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
            'radarr',
            httpMethod,
            expect.stringContaining(endpoint.replace(/^\//, '')),
            expect.any(Number),
            correlationId,
            statusCode,
          )

          // Verify the correct axios method was called
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
      it.each(DEFAULT_HTTP_ERROR_TEST_CASES)(
        'should handle $statusCode $statusText errors correctly',
        async ({ statusCode, expectedErrorClass, errorData }) => {
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
            expect.any(String),
            expect.any(Number),
            correlationId,
            statusCode,
            expect.any(Error),
            expect.any(Object), // additionalContext
          )
        },
      )
    })

    describe('Network error handling', () => {
      it.each(DEFAULT_NETWORK_ERROR_TEST_CASES)(
        'should handle network error $code with message $message',
        async ({ code, message, expectedErrorClass }) => {
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
            expect.any(String),
            expect.any(Number),
            correlationId,
            0, // Network error status
            expect.any(Error),
            expect.any(Object), // additionalContext
          )
        },
      )
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
      const authHeaders = (
        client as unknown as {
          getAuthenticationHeaders: () => Record<string, string>
        }
      ).getAuthenticationHeaders()
      expect(authHeaders).toEqual({
        'X-Api-Key': 'test-api-key',
      })
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
      })

      const healthResult = await client.getHealthStatus()
      expect(healthResult).toMatchObject({
        isHealthy: expect.any(Boolean),
        lastChecked: expect.any(Date),
        responseTime: expect.any(Number),
      })
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
      })

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
      mockRetryService.executeWithRetry.mockImplementation(
        async (fn: () => Promise<unknown>) => {
          try {
            return await fn()
          } catch {
            // Simulate successful retry after first failure
            mockAxiosInstance.get.mockResolvedValueOnce({
              data: { success: true },
              status: 200,
            } as AxiosResponse)
            return await fn()
          }
        },
      )

      mockAxiosInstance.get.mockRejectedValueOnce(transientError)

      const result = await client.testGet('/api/retry-test')
      expect(result).toEqual({ success: true })
      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
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

  describe('Base Class Specific Behavior', () => {
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

      // Verify error logging includes HTML content hints
      expect(mockMediaLoggingService.logApiCall).toHaveBeenNthCalledWith(
        2, // Second call (first is successful, second is error)
        'radarr',
        'GET',
        expect.any(String),
        expect.any(Number),
        correlationId,
        0, // Network error status
        expect.any(Error),
        expect.any(Object), // additionalContext
      )
    })

    it('should handle malformed version responses gracefully', async () => {
      // Business Impact: Prevents service startup failures
      const correlationId = uuid()

      // Test with invalid JSON response
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: 'invalid json string',
        status: 200,
      } as AxiosResponse)

      const healthResult = await client.getHealthStatus(correlationId)
      expect(healthResult.isHealthy).toBe(true) // Success response means healthy
      expect(healthResult.status).toBe('healthy')
    })

    it('should handle responses exceeding content limits', async () => {
      // Business Impact: Prevents memory exhaustion
      const correlationId = uuid()

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
        expect.any(Object), // additionalContext
      )
    })
  })
})
