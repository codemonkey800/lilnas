import { Test, TestingModule } from '@nestjs/testing'
import axios, { AxiosError, AxiosResponse } from 'axios'
import { nanoid } from 'nanoid'

import {
  createMockAxiosInstance,
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
    const startTime = Date.now()

    try {
      await this.get('/health', 'test-correlation-id')
      return {
        canConnect: true,
        isAuthenticated: true,
        responseTime: Math.max(Date.now() - startTime, 1), // Ensure at least 1ms
      }
    } catch (error) {
      return {
        canConnect: false,
        isAuthenticated: false,
        responseTime: Math.max(Date.now() - startTime, 1), // Ensure at least 1ms
        error: error instanceof Error ? error.message : String(error),
        suggestions: [
          'Check if radarr service is running',
          'Verify RADARR_URL is correct',
          'Check API key configuration',
          'Ensure network connectivity between services',
        ],
      }
    }
  }

  protected async getServiceCapabilities(
    correlationId: string,
  ): Promise<ServiceCapabilities> {
    const apiVersion = await this.getApiVersion(correlationId)
    return {
      canSearch: true,
      canRequest: true,
      canMonitor: true,
      supportedMediaTypes: ['movie', 'tv'],
      version: '3.0.0',
      apiVersion,
    }
  }

  protected async performHealthCheck(
    correlationId: string,
  ): Promise<HealthCheckResult> {
    const startTime = Date.now()

    try {
      await this.get('/health', correlationId)
      return {
        isHealthy: true,
        responseTime: Math.max(Date.now() - startTime, 1), // Ensure at least 1ms
        lastChecked: new Date(),
        version: '3.0.0',
        status: 'healthy',
      }
    } catch (error) {
      return {
        isHealthy: false,
        responseTime: Math.max(Date.now() - startTime, 1), // Ensure at least 1ms
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  protected getApiEndpoints(): Record<string, string> {
    return {
      health: '/health',
      search: '/search',
      movies: '/movies',
      series: '/series',
    }
  }

  // Expose protected methods for testing
  public async testGet<T>(path: string, correlationId: string): Promise<T> {
    return this.get<T>(path, correlationId)
  }

  public async testPost<T>(
    path: string,
    data: unknown,
    correlationId: string,
  ): Promise<T> {
    return this.post<T>(path, data, correlationId)
  }

  public async testPut<T>(
    path: string,
    data: unknown,
    correlationId: string,
  ): Promise<T> {
    return this.put<T>(path, data, correlationId)
  }

  public async testDelete<T>(path: string, correlationId: string): Promise<T> {
    return this.delete<T>(path, correlationId)
  }
}

describe('BaseMediaApiClient', () => {
  let client: TestMediaApiClient
  let module: TestingModule
  let mockRetryService: MockRetryService
  let mockErrorClassifier: MockErrorClassificationService
  let mockMediaLoggingService: MockMediaLoggingService

  const testConfig: BaseApiClientConfig = {
    baseURL: 'http://test-service:8080',
    timeout: 30000,
    maxRetries: 3,
    serviceName: 'radarr',
  }

  const correlationId = nanoid()

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks()

    // Create mock services
    mockRetryService = createMockRetryService()
    mockErrorClassifier = createMockErrorClassificationService()
    mockMediaLoggingService = createMockMediaLoggingService()

    // Mock axios instance creation first
    const mockAxiosInstance = createMockAxiosInstance()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any)

    module = await Test.createTestingModule({
      providers: [
        {
          provide: RetryService,
          useValue: mockRetryService,
        },
        {
          provide: ErrorClassificationService,
          useValue: mockErrorClassifier,
        },
        {
          provide: MediaLoggingService,
          useValue: mockMediaLoggingService,
        },
      ],
    }).compile()

    client = new TestMediaApiClient(
      mockRetryService as unknown as RetryService,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockErrorClassifier as any,
      mockMediaLoggingService as unknown as MediaLoggingService,
      testConfig,
    )
  })

  afterEach(async () => {
    if (module) {
      await module.close()
    }
  })

  describe('Initialization', () => {
    it('should initialize with correct configuration', () => {
      const serviceInfo = client.getServiceInfo()

      expect(serviceInfo).toEqual({
        serviceName: 'radarr',
        baseURL: 'http://test-service:8080',
        timeout: 30000,
        maxRetries: 3,
        httpConfig: {
          maxSockets: 10,
          maxFreeSockets: 5,
          keepAliveTimeout: 5000,
          keepAlive: true,
          connectTimeout: 10000,
          maxContentLength: 10485760, // 10MB
          maxRedirects: 5,
        },
        versionConfig: {
          supportedVersions: ['3.0.0', '2.0.0'],
          preferredVersion: '3.0.0',
          fallbackVersion: '3.0.0',
          enableVersionDetection: true,
          compatibilityMode: 'fallback',
        },
        detectedApiVersion: undefined,
      })
    })

    it('should create axios instance with correct configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://test-service:8080',
          timeout: 30000,
          maxContentLength: 10485760, // 10MB
          maxBodyLength: 10485760,
          maxRedirects: 5,
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'TDR-Bot/radarr-client/1.0.0',
            'X-Client-Name': 'TDR-Bot-Media-Client',
          }),
          // HTTP agent is expected for connection pooling
          httpAgent: expect.any(Object),
          // validateStatus function should be present
          validateStatus: expect.any(Function),
        }),
      )
    })
  })

  describe('HTTP Methods', () => {
    const mockResponse: AxiosResponse = {
      data: { success: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        headers: {} as any,
      },
    }

    beforeEach(() => {
      mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)
    })

    it('should execute GET requests successfully', async () => {
      const result = await client.testGet('/test', correlationId)

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'radarr',
        'GET',
        'http://test-service:8080/test',
        expect.any(Number),
        correlationId,
        200,
      )
      expect(result).toEqual({ success: true })
    })

    it('should execute POST requests with data', async () => {
      const testData = { title: 'Test Movie' }
      await client.testPost('/movies', testData, correlationId)

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'radarr',
        'POST',
        'http://test-service:8080/movies',
        expect.any(Number),
        correlationId,
        200,
      )
    })

    it('should execute PUT requests with data', async () => {
      const testData = { monitored: true }
      await client.testPut('/movies/1', testData, correlationId)

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'radarr',
        'PUT',
        'http://test-service:8080/movies/1',
        expect.any(Number),
        correlationId,
        200,
      )
    })

    it('should execute DELETE requests', async () => {
      await client.testDelete('/movies/1', correlationId)

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'radarr',
        'DELETE',
        'http://test-service:8080/movies/1',
        expect.any(Number),
        correlationId,
        200,
      )
    })
  })

  describe('Error Handling', () => {
    it('should handle authentication errors (401)', async () => {
      const axiosError = new AxiosError('Unauthorized')
      axiosError.response = {
        status: 401,
        statusText: 'Unauthorized',
        data: {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        headers: {} as any,
        config: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          headers: {} as any,
        },
      }

      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(client.testGet('/test', correlationId)).rejects.toThrow(
        MediaAuthenticationError,
      )

      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'radarr',
        'GET',
        'http://test-service:8080/test',
        expect.any(Number),
        correlationId,
        401,
        expect.any(MediaAuthenticationError),
      )
    })

    it('should handle rate limit errors (429)', async () => {
      const axiosError = new AxiosError('Too Many Requests')
      axiosError.response = {
        status: 429,
        statusText: 'Too Many Requests',
        data: {},
        headers: { 'retry-after': '60' },
        config: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          headers: {} as any,
        },
      }

      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(client.testGet('/test', correlationId)).rejects.toThrow(
        MediaRateLimitError,
      )
    })

    it('should handle not found errors (404)', async () => {
      const axiosError = new AxiosError('Not Found')
      axiosError.response = {
        status: 404,
        statusText: 'Not Found',
        data: {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        headers: {} as any,
        config: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          headers: {} as any,
        },
      }

      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(
        client.testGet('/movies/999', correlationId),
      ).rejects.toThrow(MediaNotFoundApiError)
    })

    it('should handle validation errors (400)', async () => {
      const axiosError = new AxiosError('Bad Request')
      axiosError.response = {
        status: 400,
        statusText: 'Bad Request',
        data: { message: 'Invalid movie data' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        headers: {} as any,
        config: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          headers: {} as any,
        },
      }

      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(
        client.testPost('/movies', {}, correlationId),
      ).rejects.toThrow(MediaValidationApiError)
    })

    it('should handle service unavailable errors (503)', async () => {
      const axiosError = new AxiosError('Service Unavailable')
      axiosError.response = {
        status: 503,
        statusText: 'Service Unavailable',
        data: {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        headers: {} as any,
        config: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          headers: {} as any,
        },
      }

      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(client.testGet('/test', correlationId)).rejects.toThrow(
        MediaServiceUnavailableError,
      )
    })

    it('should handle network errors (no response)', async () => {
      const axiosError = new AxiosError('Network Error')
      axiosError.code = 'ECONNREFUSED'

      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(client.testGet('/test', correlationId)).rejects.toThrow(
        MediaNetworkError,
      )
    })
  })

  describe('Connection Testing', () => {
    it('should successfully test connection when service is healthy', async () => {
      const mockResponse: AxiosResponse = {
        data: { status: 'ok' },
        status: 200,
        statusText: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        headers: {} as any,
        config: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          headers: {} as any,
        },
      }
      mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

      const result = await client.testConnection(correlationId)

      expect(result.canConnect).toBe(true)
      expect(result.isAuthenticated).toBe(true)
      expect(result.responseTime).toBeGreaterThan(0)
      expect(mockMediaLoggingService.logOperation).toHaveBeenCalledWith(
        'connection_test',
        'Connection test for radarr: success',
        expect.objectContaining({
          correlationId,
          service: 'radarr',
          action: 'connection_test',
        }),
      )
    })

    it('should handle connection test failures', async () => {
      const axiosError = new AxiosError('Connection failed')
      axiosError.code = 'ECONNREFUSED'
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      const result = await client.testConnection(correlationId)

      expect(result.canConnect).toBe(false)
      expect(result.isAuthenticated).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.suggestions).toContain('Check if radarr service is running')
      expect(mockMediaLoggingService.logOperation).toHaveBeenCalledWith(
        'connection_test',
        'Connection test for radarr: failed',
        expect.objectContaining({
          correlationId,
          service: 'radarr',
          action: 'connection_test',
        }),
      )
    })
  })

  describe('Health Checks', () => {
    it('should perform successful health checks', async () => {
      const mockResponse: AxiosResponse = {
        data: { status: 'healthy', version: '3.0.0' },
        status: 200,
        statusText: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        headers: {} as any,
        config: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          headers: {} as any,
        },
      }
      mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

      const result = await client.checkHealth(correlationId)

      expect(result.isHealthy).toBe(true)
      expect(result.version).toBe('3.0.0')
      expect(result.status).toBe('healthy')
      expect(result.responseTime).toBeGreaterThan(0)
      expect(mockMediaLoggingService.logPerformance).toHaveBeenCalledWith(
        'radarr_health_check',
        expect.any(Number),
        correlationId,
        true,
        expect.objectContaining({
          service: 'radarr',
          version: '3.0.0',
          status: 'healthy',
        }),
      )
    })

    it('should handle health check failures', async () => {
      const axiosError = new AxiosError('Health check failed')
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      const result = await client.checkHealth(correlationId)

      expect(result.isHealthy).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.responseTime).toBeGreaterThan(0)
      expect(mockMediaLoggingService.logPerformance).toHaveBeenCalledWith(
        'radarr_health_check',
        expect.any(Number),
        correlationId,
        false,
        expect.objectContaining({
          service: 'radarr',
        }),
      )
    })
  })

  describe('Service Capabilities', () => {
    it('should return service capabilities', async () => {
      const capabilities = await client.getCapabilities('test-correlation-id')

      expect(capabilities).toEqual({
        canSearch: true,
        canRequest: true,
        canMonitor: true,
        supportedMediaTypes: ['movie', 'tv'],
        version: '3.0.0',
        apiVersion: expect.objectContaining({
          version: '3.0.0',
          detected: expect.any(Boolean),
          isSupported: expect.any(Boolean),
          isCompatible: expect.any(Boolean),
        }),
      })
    })
  })

  describe('API Endpoints', () => {
    it('should return API endpoints', () => {
      const endpoints = client.getEndpoints()

      expect(endpoints).toEqual({
        health: '/health',
        search: '/search',
        movies: '/movies',
        series: '/series',
      })
    })
  })

  describe('Comprehensive Diagnostics', () => {
    it('should run complete diagnostics when service is operational', async () => {
      const mockResponse: AxiosResponse = {
        data: { status: 'healthy' },
        status: 200,
        statusText: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        headers: {} as any,
        config: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          headers: {} as any,
        },
      }
      mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

      // Mock successful API version detection to prevent version-related issues
      const mockApiVersion = {
        version: '3.0.0',
        detected: true,
        isSupported: true,
        isCompatible: true,
      }
      jest.spyOn(client, 'getApiVersion').mockResolvedValue(mockApiVersion)

      const diagnostics = await client.runDiagnostics(correlationId)

      expect(diagnostics.connection.canConnect).toBe(true)
      expect(diagnostics.health.isHealthy).toBe(true)
      expect(diagnostics.capabilities.canSearch).toBe(true)
      expect(diagnostics.endpoints).toBeDefined()
      expect(diagnostics.summary.isOperational).toBe(true)
      expect(diagnostics.summary.issues).toHaveLength(0)

      expect(mockMediaLoggingService.logOperation).toHaveBeenCalledWith(
        'service_diagnostics',
        'Diagnostics for radarr completed',
        expect.objectContaining({
          correlationId,
          service: 'radarr',
          action: 'service_diagnostics',
        }),
      )
    })

    it('should identify issues when service has problems', async () => {
      // Mock connection failure
      const axiosError = new AxiosError('Connection failed')
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      const diagnostics = await client.runDiagnostics(correlationId)

      expect(diagnostics.summary.isOperational).toBe(false)
      expect(diagnostics.summary.issues.length).toBeGreaterThan(0)
      expect(diagnostics.summary.recommendations.length).toBeGreaterThan(0)
      expect(diagnostics.summary.issues).toContain('Cannot connect to service')
      expect(diagnostics.summary.issues).toContain(
        'Service health check failed',
      )
    })

    it('should detect slow response times', async () => {
      // Mock the connection result directly with a slow response time
      jest.spyOn(client, 'testConnection').mockResolvedValue({
        canConnect: true,
        isAuthenticated: true,
        responseTime: 6000, // Slow response time > 5000ms threshold
      })

      const diagnostics = await client.runDiagnostics(correlationId)

      expect(diagnostics.summary.issues).toContain(
        'Slow response time detected',
      )
      expect(diagnostics.summary.recommendations).toContain(
        'Check network connectivity and service performance',
      )
    })
  })

  describe('Retry Configuration', () => {
    it('should provide correct retry configuration', () => {
      const retryConfig = client['getRetryConfiguration']()

      expect(retryConfig).toEqual({
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        backoffFactor: 2,
        retryableErrorTypes: [
          'MediaRateLimitError',
          'MediaServiceUnavailableError',
          'MediaNotFoundApiError',
          'MediaNetworkError',
        ],
      })
    })
  })
})
