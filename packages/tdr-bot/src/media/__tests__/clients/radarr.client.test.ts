import { Test, TestingModule } from '@nestjs/testing'
import axios, { AxiosError, AxiosResponse } from 'axios'
import { v4 as uuid } from 'uuid'

import {
  createMockAxiosInstance,
  createMockErrorClassificationService,
  createMockMediaConfigValidationService,
  createMockMediaLoggingService,
  createMockRadarrConfig,
  createMockRequestValidationUtils,
  createMockRetryService,
  MockErrorClassificationService,
  MockMediaConfigValidationService,
  MockMediaLoggingService,
  MockRequestValidationUtils,
  MockRetryService,
} from 'src/media/__tests__/types/test-mocks.types'
import { RadarrClient } from 'src/media/clients/radarr.client'
import { MediaConfigValidationService } from 'src/media/config/media-config.validation'
import {
  MediaAuthenticationError,
  MediaNetworkError,
  MediaNotFoundApiError,
  MediaRateLimitError,
  MediaServiceUnavailableError,
  MediaValidationApiError,
} from 'src/media/errors/media-errors'
import { RequestValidationUtils } from 'src/media/schemas/request-validation.schemas'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Mock axios
jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

// Mock RequestValidationUtils
jest.mock('src/media/schemas/request-validation.schemas', () => ({
  RequestValidationUtils: jest.fn(),
}))
const MockedRequestValidationUtils =
  RequestValidationUtils as unknown as jest.MockedClass<
    typeof RequestValidationUtils
  >

// Test data interfaces matching RadarrClient
interface RadarrMovie {
  id?: number
  title: string
  titleSlug: string
  year: number
  tmdbId: number
  imdbId?: string
  overview?: string
  posterUrl?: string
  monitored: boolean
  qualityProfileId: number
  rootFolderPath: string
  downloaded: boolean
  status: 'wanted' | 'downloaded' | 'available'
}

interface RadarrQueueItem {
  id: number
  movieId: number
  movie: RadarrMovie
  status: 'queued' | 'downloading' | 'importing' | 'completed' | 'failed'
  percentage: number
  timeleft: string
  size: number
  sizeleft: number
  eta: string
  downloadId: string
  indexer: string
  priority: string
}

interface RadarrHealthItem {
  Type: string
  Message: string
  WikiUrl?: string
}

interface RadarrMovieRequest {
  title: string
  year: number
  tmdbId: number
  qualityProfileId: number
  rootFolderPath: string
  monitored: boolean
  addOptions: {
    searchForMovie: boolean
  }
}

describe('RadarrClient', () => {
  let client: RadarrClient
  let module: TestingModule
  let mockRetryService: MockRetryService
  let mockErrorClassifier: MockErrorClassificationService
  let mockMediaLoggingService: MockMediaLoggingService
  let mockConfigService: MockMediaConfigValidationService
  let mockRequestValidationUtils: MockRequestValidationUtils

  const mockRadarrConfig = createMockRadarrConfig({
    url: 'http://radarr.test:7878',
    apiKey: 'test-radarr-api-key-789012',
    timeout: 30000,
    maxRetries: 3,
  })

  const correlationId = uuid()

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks()

    // Create mock services
    mockRetryService = createMockRetryService()
    mockErrorClassifier = createMockErrorClassificationService()
    mockMediaLoggingService = createMockMediaLoggingService()
    mockConfigService = createMockMediaConfigValidationService()
    mockRequestValidationUtils = createMockRequestValidationUtils()

    // Setup config service mock
    mockConfigService.getServiceConfig.mockReturnValue(mockRadarrConfig)

    // Setup RequestValidationUtils static methods
    MockedRequestValidationUtils.validateRadarrMovieRequest =
      mockRequestValidationUtils.validateRadarrMovieRequest as any

    // Mock axios instance creation
    const mockAxiosInstance = createMockAxiosInstance()
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any)

    module = await Test.createTestingModule({
      providers: [
        RadarrClient,
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
        {
          provide: MediaConfigValidationService,
          useValue: mockConfigService,
        },
      ],
    }).compile()

    client = module.get<RadarrClient>(RadarrClient)
  })

  afterEach(async () => {
    if (module) {
      await module.close()
    }
  })

  describe('Initialization', () => {
    it('should initialize with correct Radarr configuration', () => {
      expect(mockConfigService.getServiceConfig).toHaveBeenCalledWith('radarr')

      const serviceInfo = client.getServiceInfo()
      expect(serviceInfo.serviceName).toBe('radarr')
      expect(serviceInfo.baseURL).toBe('http://radarr.test:7878')
      expect(serviceInfo.timeout).toBe(30000)
      expect(serviceInfo.maxRetries).toBe(3)
    })

    it('should create axios instance with correct Radarr configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://radarr.test:7878',
          timeout: 30000,
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'TDR-Bot/radarr-client/1.0.0',
            'X-Client-Name': 'TDR-Bot-Media-Client',
          }),
        }),
      )
    })

    it('should set correct service name for Radarr', () => {
      const serviceInfo = client.getServiceInfo()
      expect(serviceInfo.serviceName).toBe('radarr')
    })
  })

  describe('Abstract Method Implementation Tests', () => {
    describe('getAuthenticationHeaders', () => {
      it('should return X-Api-Key authentication header', () => {
        const headers = client['getAuthenticationHeaders']()
        expect(headers).toEqual({
          'X-Api-Key': 'test-radarr-api-key-789012',
        })
      })
    })

    describe('validateServiceConfiguration', () => {
      it('should successfully validate service configuration', async () => {
        const mockHealthResponse: AxiosResponse<RadarrHealthItem[]> = {
          data: [{ Type: 'info', Message: 'All systems operational' }],
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockHealthResponse)

        const result = await client.testConnection(correlationId)

        expect(result.canConnect).toBe(true)
        expect(result.isAuthenticated).toBe(true)
        expect(result.responseTime).toBeGreaterThanOrEqual(0)
        expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      })

      it('should handle connection failures with appropriate suggestions', async () => {
        const axiosError = new AxiosError('Connection failed')
        axiosError.code = 'ECONNREFUSED'
        mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

        const result = await client.testConnection(correlationId)

        expect(result.canConnect).toBe(false)
        expect(result.isAuthenticated).toBe(false)
        expect(result.error).toBeDefined()
        expect(result.suggestions).toEqual([
          'Check if Radarr service is running',
          'Verify RADARR_URL is correct and accessible',
          'Check RADARR_API_KEY is valid',
          'Ensure network connectivity between services',
          'Verify Radarr is using v3 API endpoints',
        ])
      })
    })

    describe('getServiceCapabilities', () => {
      it('should return Radarr service capabilities with movie support', async () => {
        // Mock API version detection
        const mockApiVersion = {
          version: '3.0.0',
          detected: true,
          isSupported: true,
          isCompatible: true,
        }
        jest.spyOn(client, 'getApiVersion').mockResolvedValue(mockApiVersion)

        const capabilities = await client.getCapabilities(correlationId)

        expect(capabilities).toEqual({
          canSearch: true,
          canRequest: true,
          canMonitor: true,
          supportedMediaTypes: ['movie'],
          version: '3.0.0',
          apiVersion: mockApiVersion,
          featureLimitations: [],
        })
      })

      it('should return fallback capabilities when API version detection fails', async () => {
        const apiError = new Error('API version detection failed')
        jest.spyOn(client, 'getApiVersion').mockRejectedValue(apiError)

        const capabilities = await client.getCapabilities(correlationId)

        expect(capabilities).toEqual({
          canSearch: true,
          canRequest: true,
          canMonitor: false,
          supportedMediaTypes: ['movie'],
          version: '3.0.0',
          apiVersion: {
            version: '3.0.0',
            detected: false,
            isSupported: false,
            isCompatible: false,
            error: 'API version detection failed',
          },
          featureLimitations: [
            'Could not determine API version',
            'Using fallback capabilities with limited monitoring',
            'API version detection failed',
          ],
        })
      })
    })

    describe('performHealthCheck', () => {
      it('should perform successful health check', async () => {
        const mockHealthData: RadarrHealthItem[] = [
          { Type: 'info', Message: 'All systems operational' },
        ]
        const mockHealthResponse: AxiosResponse<RadarrHealthItem[]> = {
          data: mockHealthData,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockHealthResponse)

        const mockApiVersion = {
          version: '3.0.0',
          detected: true,
          isSupported: true,
          isCompatible: true,
        }
        jest.spyOn(client, 'getApiVersion').mockResolvedValue(mockApiVersion)

        const result = await client.checkHealth(correlationId)

        expect(result.isHealthy).toBe(true)
        expect(result.version).toBe('3.0.0')
        expect(result.status).toBe('healthy')
        expect(result.responseTime).toBeGreaterThanOrEqual(0)
        expect(result.apiVersion).toBe(mockApiVersion)
      })

      it('should detect unhealthy status from error-type health issues', async () => {
        const mockHealthData: RadarrHealthItem[] = [
          { Type: 'error', Message: 'Database connection failed' },
        ]
        const mockHealthResponse: AxiosResponse<RadarrHealthItem[]> = {
          data: mockHealthData,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockHealthResponse)

        const mockApiVersion = {
          version: '3.0.0',
          detected: true,
          isSupported: true,
          isCompatible: true,
        }
        jest.spyOn(client, 'getApiVersion').mockResolvedValue(mockApiVersion)

        const result = await client.checkHealth(correlationId)

        expect(result.isHealthy).toBe(false)
        expect(result.status).toBe('unhealthy')
        expect(result.version).toBe('3.0.0')
      })

      it('should handle health check failures', async () => {
        const axiosError = new AxiosError('Health check failed')
        mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

        const result = await client.checkHealth(correlationId)

        expect(result.isHealthy).toBe(false)
        expect(result.error).toContain(
          'RADARR network error during GET /api/v3/health',
        )
        expect(result.responseTime).toBeGreaterThanOrEqual(0)
      })
    })

    describe('getApiEndpoints', () => {
      it('should return correct Radarr API endpoints', () => {
        const endpoints = client.getEndpoints()

        expect(endpoints).toEqual({
          health: '/api/v3/health',
          movie: '/api/v3/movie',
          movies: '/api/v3/movie',
          movieLookup: '/api/v3/movie/lookup',
          search: '/api/v3/movie/lookup',
          queue: '/api/v3/queue',
          qualityProfile: '/api/v3/qualityprofile',
          rootFolder: '/api/v3/rootfolder',
          system: '/api/v3/system/status',
        })
      })
    })
  })

  // Helper function to verify executeWithRetry calls
  const expectRetryServiceCall = (method: string, path: string) => {
    // Determine if this is a quick operation (GET with /lookup or /health)
    const isHealthCheck =
      path.includes('/health') || path.includes('/system/status')
    const isQuickOperation =
      method === 'GET' && (isHealthCheck || path.includes('/lookup'))

    const expectedConfig = isQuickOperation
      ? {
          maxAttempts: 2,
          baseDelay: 250,
          maxDelay: 2000,
          backoffFactor: 1.5,
          jitter: true,
          timeout: 30000, // Quick operations don't override the base timeout
          logRetryAttempts: false,
          logRetryDelays: false,
        }
      : {
          maxAttempts: 3,
          baseDelay: 500,
          maxDelay: 10000,
          backoffFactor: 1.5,
          jitter: true,
          timeout: 15000,
          logRetryAttempts: false,
          logRetryDelays: false,
        }

    expect(mockRetryService.executeWithRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining(expectedConfig),
      `radarr_${method}_${path}`,
      'media_api',
    )
  }

  describe('HTTP Method Tests', () => {
    const mockResponse: AxiosResponse = {
      data: { success: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: { headers: {} as any },
    }

    beforeEach(() => {
      mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)
    })

    it('should execute GET requests with proper headers and logging', async () => {
      await client['get']('/api/v3/movie', correlationId)

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'radarr',
        'GET',
        'http://radarr.test:7878/api/v3/movie',
        expect.any(Number),
        correlationId,
        200,
      )
    })

    it('should execute POST requests with data and validation', async () => {
      const movieData = {
        title: 'Test Movie',
        year: 2023,
        tmdbId: 12345,
        qualityProfileId: 1,
        rootFolderPath: '/movies',
        monitored: true,
        addOptions: { searchForMovie: true },
      }

      await client['post']('/api/v3/movie', movieData, correlationId)

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'radarr',
        'POST',
        'http://radarr.test:7878/api/v3/movie',
        expect.any(Number),
        correlationId,
        200,
      )
    })

    it('should execute PUT requests with data', async () => {
      const updateData = { monitored: false }
      await client['put']('/api/v3/movie/1', updateData, correlationId)

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'radarr',
        'PUT',
        'http://radarr.test:7878/api/v3/movie/1',
        expect.any(Number),
        correlationId,
        200,
      )
    })

    it('should execute DELETE requests', async () => {
      await client['delete']('/api/v3/movie/1', correlationId)

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'radarr',
        'DELETE',
        'http://radarr.test:7878/api/v3/movie/1',
        expect.any(Number),
        correlationId,
        200,
      )
    })
  })

  describe('Error Handling Tests', () => {
    it('should handle authentication errors (401)', async () => {
      const axiosError = new AxiosError('Unauthorized')
      axiosError.response = {
        status: 401,
        statusText: 'Unauthorized',
        data: {},
        headers: {} as any,
        config: { headers: {} as any },
      }
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(
        client['get']('/api/v3/movie', correlationId),
      ).rejects.toThrow(MediaAuthenticationError)

      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'radarr',
        'GET',
        'http://radarr.test:7878/api/v3/movie',
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
        config: { headers: {} as any },
      }
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(
        client['get']('/api/v3/movie', correlationId),
      ).rejects.toThrow(MediaRateLimitError)
    })

    it('should handle not found errors (404)', async () => {
      const axiosError = new AxiosError('Not Found')
      axiosError.response = {
        status: 404,
        statusText: 'Not Found',
        data: {},
        headers: {} as any,
        config: { headers: {} as any },
      }
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(
        client['get']('/api/v3/movie/999', correlationId),
      ).rejects.toThrow(MediaNotFoundApiError)
    })

    it('should handle validation errors (400)', async () => {
      const axiosError = new AxiosError('Bad Request')
      axiosError.response = {
        status: 400,
        statusText: 'Bad Request',
        data: { message: 'Invalid movie data' },
        headers: {} as any,
        config: { headers: {} as any },
      }
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(
        client['post']('/api/v3/movie', {}, correlationId),
      ).rejects.toThrow(MediaValidationApiError)
    })

    it('should handle service unavailable errors (503)', async () => {
      const axiosError = new AxiosError('Service Unavailable')
      axiosError.response = {
        status: 503,
        statusText: 'Service Unavailable',
        data: {},
        headers: {} as any,
        config: { headers: {} as any },
      }
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(
        client['get']('/api/v3/movie', correlationId),
      ).rejects.toThrow(MediaServiceUnavailableError)
    })

    it('should handle network errors (no response)', async () => {
      const axiosError = new AxiosError('Network Error')
      axiosError.code = 'ECONNREFUSED'
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(
        client['get']('/api/v3/movie', correlationId),
      ).rejects.toThrow(MediaNetworkError)
    })
  })

  describe('Radarr-Specific Methods', () => {
    describe('searchMovies', () => {
      it('should search for movies with proper query encoding', async () => {
        const mockMovies: RadarrMovie[] = [
          {
            id: 1,
            title: 'Fight Club',
            titleSlug: 'fight-club-1999',
            year: 1999,
            tmdbId: 550,
            imdbId: 'tt0137523',
            monitored: true,
            qualityProfileId: 1,
            rootFolderPath: '/movies',
            downloaded: false,
            status: 'wanted',
          },
        ]
        const mockResponse: AxiosResponse<RadarrMovie[]> = {
          data: mockMovies,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.searchMovies('fight club', correlationId)

        expect(result).toEqual(mockMovies)
        expectRetryServiceCall('GET', '/api/v3/movie/lookup?term=fight%20club')
      })
    })

    describe('addMovie', () => {
      it('should add movie with request validation', async () => {
        const movieRequest: RadarrMovieRequest = {
          title: 'Fight Club',
          year: 1999,
          tmdbId: 550,
          qualityProfileId: 1,
          rootFolderPath: '/movies',
          monitored: true,
          addOptions: { searchForMovie: true },
        }

        const mockMovie: RadarrMovie = {
          id: 1,
          title: 'Fight Club',
          titleSlug: 'fight-club-1999',
          year: 1999,
          tmdbId: 550,
          monitored: true,
          qualityProfileId: 1,
          rootFolderPath: '/movies',
          downloaded: false,
          status: 'wanted',
        }

        mockRequestValidationUtils.validateRadarrMovieRequest.mockReturnValue(
          movieRequest,
        )
        const mockResponse: AxiosResponse<RadarrMovie> = {
          data: mockMovie,
          status: 201,
          statusText: 'Created',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.addMovie(movieRequest, correlationId)

        expect(
          mockRequestValidationUtils.validateRadarrMovieRequest,
        ).toHaveBeenCalledWith(movieRequest, correlationId)
        expect(result).toEqual(mockMovie)
        expectRetryServiceCall('POST', '/api/v3/movie')
      })
    })

    describe('getQueue', () => {
      it('should get queue with records parsing', async () => {
        const mockQueueItems: RadarrQueueItem[] = [
          {
            id: 1,
            movieId: 1,
            movie: {
              id: 1,
              title: 'Test Movie',
              titleSlug: 'test-movie',
              year: 2023,
              tmdbId: 12345,
              monitored: true,
              qualityProfileId: 1,
              rootFolderPath: '/movies',
              downloaded: false,
              status: 'wanted',
            },
            status: 'downloading',
            percentage: 45,
            timeleft: '00:15:30',
            size: 1000000,
            sizeleft: 550000,
            eta: '2023-01-01T12:15:30Z',
            downloadId: 'abc123',
            indexer: 'Test Indexer',
            priority: 'normal',
          },
        ]

        const mockResponse: AxiosResponse<{ records: RadarrQueueItem[] }> = {
          data: { records: mockQueueItems },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getQueue(correlationId)

        expect(result).toEqual(mockQueueItems)
        expectRetryServiceCall('GET', '/api/v3/queue')
      })

      it('should handle empty queue response', async () => {
        const mockResponse: AxiosResponse<{ records?: RadarrQueueItem[] }> = {
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getQueue(correlationId)

        expect(result).toEqual([])
      })
    })

    describe('getAllMovies', () => {
      it('should get all movies', async () => {
        const mockMovies: RadarrMovie[] = [
          {
            id: 1,
            title: 'Movie 1',
            titleSlug: 'movie-1',
            year: 2020,
            tmdbId: 123,
            monitored: true,
            qualityProfileId: 1,
            rootFolderPath: '/movies',
            downloaded: true,
            status: 'downloaded',
          },
          {
            id: 2,
            title: 'Movie 2',
            titleSlug: 'movie-2',
            year: 2021,
            tmdbId: 456,
            monitored: false,
            qualityProfileId: 2,
            rootFolderPath: '/movies',
            downloaded: false,
            status: 'wanted',
          },
        ]
        const mockResponse: AxiosResponse<RadarrMovie[]> = {
          data: mockMovies,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getAllMovies(correlationId)

        expect(result).toEqual(mockMovies)
      })
    })

    describe('getMovie', () => {
      it('should get specific movie by ID', async () => {
        const mockMovie: RadarrMovie = {
          id: 1,
          title: 'Test Movie',
          titleSlug: 'test-movie',
          year: 2023,
          tmdbId: 12345,
          monitored: true,
          qualityProfileId: 1,
          rootFolderPath: '/movies',
          downloaded: false,
          status: 'wanted',
        }
        const mockResponse: AxiosResponse<RadarrMovie> = {
          data: mockMovie,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getMovie(1, correlationId)

        expect(result).toEqual(mockMovie)
        expectRetryServiceCall('GET', '/api/v3/movie/1')
      })
    })

    describe('updateMovie', () => {
      it('should update movie settings', async () => {
        const mockMovie: RadarrMovie = {
          id: 1,
          title: 'Test Movie',
          titleSlug: 'test-movie',
          year: 2023,
          tmdbId: 12345,
          monitored: false, // Updated
          qualityProfileId: 1,
          rootFolderPath: '/movies',
          downloaded: false,
          status: 'wanted',
        }
        const mockResponse: AxiosResponse<RadarrMovie> = {
          data: mockMovie,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.updateMovie(mockMovie, correlationId)

        expect(result).toEqual(mockMovie)
        expectRetryServiceCall('PUT', '/api/v3/movie/1')
      })
    })

    describe('deleteMovie', () => {
      it('should delete movie without files', async () => {
        const mockResponse: AxiosResponse = {
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        await client.deleteMovie(1, false, correlationId)

        expectRetryServiceCall('DELETE', '/api/v3/movie/1?deleteFiles=false')
      })

      it('should delete movie with files', async () => {
        const mockResponse: AxiosResponse = {
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        await client.deleteMovie(1, true, correlationId)

        expectRetryServiceCall('DELETE', '/api/v3/movie/1?deleteFiles=true')
      })
    })

    describe('getQualityProfiles', () => {
      it('should get quality profiles', async () => {
        const mockProfiles = [
          { id: 1, name: 'HD-1080p', upgradeAllowed: true },
          { id: 2, name: '4K', upgradeAllowed: false },
        ]
        const mockResponse: AxiosResponse<typeof mockProfiles> = {
          data: mockProfiles,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getQualityProfiles(correlationId)

        expect(result).toEqual(mockProfiles)
        expectRetryServiceCall('GET', '/api/v3/qualityprofile')
      })
    })

    describe('getRootFolders', () => {
      it('should get root folders', async () => {
        const mockFolders = [
          {
            id: 1,
            path: '/movies',
            accessible: true,
            freeSpace: 1000000000,
          },
          {
            id: 2,
            path: '/movies-4k',
            accessible: true,
            freeSpace: 500000000,
          },
        ]
        const mockResponse: AxiosResponse<typeof mockFolders> = {
          data: mockFolders,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getRootFolders(correlationId)

        expect(result).toEqual(mockFolders)
        expectRetryServiceCall('GET', '/api/v3/rootfolder')
      })
    })

    describe('getSystemStatus', () => {
      it('should get system status information', async () => {
        const mockStatus = {
          version: '3.0.2.4552',
          buildTime: '2023-01-15T10:30:00Z',
          isDebug: false,
          isProduction: true,
          isAdmin: false,
          isUserInteractive: false,
          startTime: '2023-01-01T00:00:00Z',
          appData: '/config',
          osName: 'Ubuntu',
          osVersion: '20.04',
        }
        const mockResponse: AxiosResponse<typeof mockStatus> = {
          data: mockStatus,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getSystemStatus(correlationId)

        expect(result).toEqual(mockStatus)
        expectRetryServiceCall('GET', '/api/v3/system/status')
      })
    })
  })

  describe('Service Integration Tests', () => {
    it('should run comprehensive diagnostics when service is operational', async () => {
      const mockHealthResponse: AxiosResponse = {
        data: [{ Type: 'info', Message: 'All systems operational' }],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: {} as any },
      }
      mockRetryService.executeWithRetry.mockResolvedValue(mockHealthResponse)

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
      expect(diagnostics.capabilities.supportedMediaTypes).toEqual(['movie'])
      expect(diagnostics.endpoints).toBeDefined()
      expect(diagnostics.summary.isOperational).toBe(true)
      expect(diagnostics.summary.issues).toHaveLength(0)
    })

    it('should identify issues when service has problems', async () => {
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
})
