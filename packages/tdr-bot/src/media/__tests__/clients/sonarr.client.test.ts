import { Test, TestingModule } from '@nestjs/testing'
import axios, { AxiosError, AxiosResponse } from 'axios'
import { v4 as uuid } from 'uuid'

import {
  createMockAxiosInstance,
  createMockErrorClassificationService,
  createMockMediaConfigValidationService,
  createMockMediaLoggingService,
  createMockRequestValidationUtils,
  createMockRetryService,
  createMockSonarrConfig,
  MockErrorClassificationService,
  MockMediaConfigValidationService,
  MockMediaLoggingService,
  MockRequestValidationUtils,
  MockRetryService,
} from 'src/media/__tests__/types/test-mocks.types'
import { SonarrClient } from 'src/media/clients/sonarr.client'
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

// Test data interfaces matching SonarrClient
interface SonarrSeason {
  seasonNumber: number
  monitored: boolean
  statistics?: {
    episodeFileCount: number
    episodeCount: number
    totalEpisodeCount: number
    sizeOnDisk: number
  }
}

interface SonarrSeries {
  id?: number
  title: string
  titleSlug: string
  year: number
  tvdbId: number
  imdbId?: string
  overview?: string
  posterUrl?: string
  monitored: boolean
  qualityProfileId: number
  languageProfileId: number
  rootFolderPath: string
  status: 'continuing' | 'ended' | 'upcoming'
  seasons: SonarrSeason[]
  statistics?: {
    seasonCount: number
    episodeFileCount: number
    episodeCount: number
    totalEpisodeCount: number
    sizeOnDisk: number
  }
}

interface SonarrEpisode {
  id: number
  episodeFileId: number
  seriesId: number
  seasonNumber: number
  episodeNumber: number
  title: string
  overview: string
  airDate: string
  monitored: boolean
  hasFile: boolean
}

interface SonarrSeriesRequest {
  title: string
  year: number
  tvdbId: number
  qualityProfileId: number
  languageProfileId: number
  rootFolderPath: string
  monitored: boolean
  seasons: Array<{
    seasonNumber: number
    monitored: boolean
  }>
  addOptions: {
    searchForMissingEpisodes: boolean
    searchForCutoffUnmetEpisodes: boolean
  }
}

interface SonarrQueueItem {
  id: number
  seriesId: number
  episodeId: number
  series: SonarrSeries
  episode: SonarrEpisode
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

interface EpisodeSpecification {
  seasons: Array<{
    seasonNumber: number
    episodes?: number[]
  }>
  totalEpisodes: number
}

describe('SonarrClient', () => {
  let client: SonarrClient
  let module: TestingModule
  let mockRetryService: MockRetryService
  let mockErrorClassifier: MockErrorClassificationService
  let mockMediaLoggingService: MockMediaLoggingService
  let mockConfigService: MockMediaConfigValidationService
  let mockRequestValidationUtils: MockRequestValidationUtils

  const mockSonarrConfig = createMockSonarrConfig({
    url: 'http://sonarr.test:8989',
    apiKey: 'test-sonarr-api-key-123456',
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
    mockConfigService.getServiceConfig.mockReturnValue(mockSonarrConfig)

    // Setup RequestValidationUtils static methods
    MockedRequestValidationUtils.validateSonarrSeriesRequest =
      mockRequestValidationUtils.validateSonarrSeriesRequest as any

    // Mock axios instance creation
    const mockAxiosInstance = createMockAxiosInstance()
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any)

    module = await Test.createTestingModule({
      providers: [
        SonarrClient,
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

    client = module.get<SonarrClient>(SonarrClient)
  })

  afterEach(async () => {
    if (module) {
      await module.close()
    }
  })

  describe('Initialization', () => {
    it('should initialize with correct Sonarr configuration', () => {
      expect(mockConfigService.getServiceConfig).toHaveBeenCalledWith('sonarr')

      const serviceInfo = client.getServiceInfo()
      expect(serviceInfo.serviceName).toBe('sonarr')
      expect(serviceInfo.baseURL).toBe('http://sonarr.test:8989')
      expect(serviceInfo.timeout).toBe(30000)
      expect(serviceInfo.maxRetries).toBe(3)
    })

    it('should create axios instance with correct Sonarr configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://sonarr.test:8989',
          timeout: 30000,
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'TDR-Bot/sonarr-client/1.0.0',
            'X-Client-Name': 'TDR-Bot-Media-Client',
          }),
        }),
      )
    })

    it('should set correct service name for Sonarr', () => {
      const serviceInfo = client.getServiceInfo()
      expect(serviceInfo.serviceName).toBe('sonarr')
    })
  })

  describe('Abstract Method Implementation Tests', () => {
    describe('getAuthenticationHeaders', () => {
      it('should return X-Api-Key authentication header', () => {
        const headers = client['getAuthenticationHeaders']()
        expect(headers).toEqual({
          'X-Api-Key': 'test-sonarr-api-key-123456',
        })
      })
    })

    describe('validateServiceConfiguration', () => {
      it('should successfully validate service configuration', async () => {
        const mockHealthResponse: AxiosResponse = {
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
          'Check if Sonarr service is running',
          'Verify SONARR_URL is correct and accessible',
          'Check SONARR_API_KEY is valid',
          'Ensure network connectivity between services',
          'Verify Sonarr is using v3 API endpoints',
        ])
      })
    })

    describe('getServiceCapabilities', () => {
      it('should return Sonarr service capabilities with TV support', async () => {
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
          supportedMediaTypes: ['tv'],
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
          supportedMediaTypes: ['tv'],
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
        const mockHealthData = { version: '3.0.2.4552' }
        const mockHealthResponse: AxiosResponse<{ version?: string }> = {
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
        expect(result.version).toBe('3.0.2.4552')
        expect(result.status).toBe('healthy')
        expect(result.responseTime).toBeGreaterThanOrEqual(0)
        expect(result.apiVersion).toBe(mockApiVersion)
      })

      it('should use API version when health response lacks version', async () => {
        const mockHealthData = {}
        const mockHealthResponse: AxiosResponse<{ version?: string }> = {
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
      })

      it('should handle health check failures', async () => {
        const axiosError = new AxiosError('Health check failed')
        mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

        const result = await client.checkHealth(correlationId)

        expect(result.isHealthy).toBe(false)
        expect(result.error).toContain(
          'SONARR network error during GET /api/v3/health',
        )
        expect(result.responseTime).toBeGreaterThanOrEqual(0)
      })
    })

    describe('getApiEndpoints', () => {
      it('should return correct Sonarr API endpoints', () => {
        const endpoints = client.getEndpoints()

        expect(endpoints).toEqual({
          health: '/api/v3/health',
          series: '/api/v3/series',
          seriesLookup: '/api/v3/series/lookup',
          search: '/api/v3/series/lookup',
          episode: '/api/v3/episode',
          queue: '/api/v3/queue',
          qualityProfile: '/api/v3/qualityprofile',
          languageProfile: '/api/v3/languageprofile',
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
      `sonarr_${method}_${path}`,
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
      await client['get']('/api/v3/series', correlationId)

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'sonarr',
        'GET',
        'http://sonarr.test:8989/api/v3/series',
        expect.any(Number),
        correlationId,
        200,
      )
    })

    it('should execute POST requests with data and validation', async () => {
      const seriesData = {
        title: 'Test Series',
        year: 2023,
        tvdbId: 12345,
        qualityProfileId: 1,
        languageProfileId: 1,
        rootFolderPath: '/tv',
        monitored: true,
        seasons: [{ seasonNumber: 1, monitored: true }],
        addOptions: {
          searchForMissingEpisodes: true,
          searchForCutoffUnmetEpisodes: false,
        },
      }

      await client['post']('/api/v3/series', seriesData, correlationId)

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'sonarr',
        'POST',
        'http://sonarr.test:8989/api/v3/series',
        expect.any(Number),
        correlationId,
        200,
      )
    })

    it('should execute PUT requests with data', async () => {
      const updateData = { monitored: false }
      await client['put']('/api/v3/series/1', updateData, correlationId)

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'sonarr',
        'PUT',
        'http://sonarr.test:8989/api/v3/series/1',
        expect.any(Number),
        correlationId,
        200,
      )
    })

    it('should execute DELETE requests', async () => {
      await client['delete']('/api/v3/series/1', correlationId)

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'sonarr',
        'DELETE',
        'http://sonarr.test:8989/api/v3/series/1',
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
        client['get']('/api/v3/series', correlationId),
      ).rejects.toThrow(MediaAuthenticationError)

      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'sonarr',
        'GET',
        'http://sonarr.test:8989/api/v3/series',
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
        client['get']('/api/v3/series', correlationId),
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
        client['get']('/api/v3/series/999', correlationId),
      ).rejects.toThrow(MediaNotFoundApiError)
    })

    it('should handle validation errors (400)', async () => {
      const axiosError = new AxiosError('Bad Request')
      axiosError.response = {
        status: 400,
        statusText: 'Bad Request',
        data: { message: 'Invalid series data' },
        headers: {} as any,
        config: { headers: {} as any },
      }
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(
        client['post']('/api/v3/series', {}, correlationId),
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
        client['get']('/api/v3/series', correlationId),
      ).rejects.toThrow(MediaServiceUnavailableError)
    })

    it('should handle network errors (no response)', async () => {
      const axiosError = new AxiosError('Network Error')
      axiosError.code = 'ECONNREFUSED'
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(
        client['get']('/api/v3/series', correlationId),
      ).rejects.toThrow(MediaNetworkError)
    })
  })

  describe('Episode Specification Parser Tests', () => {
    describe('parseEpisodeSpecification', () => {
      it('should parse full season specification (S1)', () => {
        const result = client.parseEpisodeSpecification('S1')

        expect(result).toEqual({
          seasons: [{ seasonNumber: 1 }],
          totalEpisodes: 20, // Estimated 20 episodes per season
        })
      })

      it('should parse single episode specification (S2E5)', () => {
        const result = client.parseEpisodeSpecification('S2E5')

        expect(result).toEqual({
          seasons: [{ seasonNumber: 2, episodes: [5] }],
          totalEpisodes: 1,
        })
      })

      it('should parse episode range specification (S3E1-10)', () => {
        const result = client.parseEpisodeSpecification('S3E1-10')

        expect(result).toEqual({
          seasons: [
            { seasonNumber: 3, episodes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
          ],
          totalEpisodes: 10,
        })
      })

      it('should parse multiple seasons (S1,S2)', () => {
        const result = client.parseEpisodeSpecification('S1,S2')

        expect(result).toEqual({
          seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
          totalEpisodes: 40, // 20 episodes per season * 2 seasons
        })
      })

      it('should parse mixed specification (S2E1-5,S3E1)', () => {
        const result = client.parseEpisodeSpecification('S2E1-5,S3E1')

        expect(result).toEqual({
          seasons: [
            { seasonNumber: 2, episodes: [1, 2, 3, 4, 5] },
            { seasonNumber: 3, episodes: [1] },
          ],
          totalEpisodes: 6,
        })
      })

      it('should merge seasons with same season number (S1E1,S1E2)', () => {
        const result = client.parseEpisodeSpecification('S1E1,S1E2')

        expect(result).toEqual({
          seasons: [{ seasonNumber: 1, episodes: [1, 2] }],
          totalEpisodes: 2,
        })
      })

      it('should merge full season with specific episodes (S1,S1E5)', () => {
        const result = client.parseEpisodeSpecification('S1,S1E5')

        expect(result).toEqual({
          seasons: [{ seasonNumber: 1 }], // Full season overrides specific episodes
          totalEpisodes: 20,
        })
      })

      it('should handle case insensitive input', () => {
        const result = client.parseEpisodeSpecification('s1e5')

        expect(result).toEqual({
          seasons: [{ seasonNumber: 1, episodes: [5] }],
          totalEpisodes: 1,
        })
      })

      it('should throw error for invalid format (X1)', () => {
        expect(() => client.parseEpisodeSpecification('X1')).toThrow(
          'Invalid episode specification format: X1',
        )
      })

      it('should throw error for incomplete episode format (S1E)', () => {
        expect(() => client.parseEpisodeSpecification('S1E')).toThrow(
          'Invalid episode specification format: S1E',
        )
      })

      it('should throw error for invalid episode range (S2E5-3)', () => {
        expect(() => client.parseEpisodeSpecification('S2E5-3')).toThrow(
          'Invalid episode range: E5-3',
        )
      })

      it('should handle complex mixed specification', () => {
        const result = client.parseEpisodeSpecification('S1E1-3,S2,S3E5-7,S4E1')

        expect(result).toEqual({
          seasons: [
            { seasonNumber: 1, episodes: [1, 2, 3] },
            { seasonNumber: 2 }, // Full season
            { seasonNumber: 3, episodes: [5, 6, 7] },
            { seasonNumber: 4, episodes: [1] },
          ],
          totalEpisodes: 27, // 3 + 20 + 3 + 1 = 27
        })
      })
    })
  })

  describe('Sonarr-Specific Methods', () => {
    describe('searchSeries', () => {
      it('should search for series with proper query encoding', async () => {
        const mockSeries: SonarrSeries[] = [
          {
            id: 1,
            title: 'Breaking Bad',
            titleSlug: 'breaking-bad',
            year: 2008,
            tvdbId: 81189,
            imdbId: 'tt0903747',
            monitored: true,
            qualityProfileId: 1,
            languageProfileId: 1,
            rootFolderPath: '/tv',
            status: 'ended',
            seasons: [
              { seasonNumber: 1, monitored: true },
              { seasonNumber: 2, monitored: true },
            ],
          },
        ]
        const mockResponse: AxiosResponse<SonarrSeries[]> = {
          data: mockSeries,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.searchSeries('breaking bad', correlationId)

        expect(result).toEqual(mockSeries)
        expectRetryServiceCall(
          'GET',
          '/api/v3/series/lookup?term=breaking%20bad',
        )
      })
    })

    describe('addSeries', () => {
      it('should add series with request validation', async () => {
        const seriesRequest: SonarrSeriesRequest = {
          title: 'Breaking Bad',
          year: 2008,
          tvdbId: 81189,
          qualityProfileId: 1,
          languageProfileId: 1,
          rootFolderPath: '/tv',
          monitored: true,
          seasons: [
            { seasonNumber: 1, monitored: true },
            { seasonNumber: 2, monitored: true },
          ],
          addOptions: {
            searchForMissingEpisodes: true,
            searchForCutoffUnmetEpisodes: false,
          },
        }

        const mockSeries: SonarrSeries = {
          id: 1,
          title: 'Breaking Bad',
          titleSlug: 'breaking-bad',
          year: 2008,
          tvdbId: 81189,
          monitored: true,
          qualityProfileId: 1,
          languageProfileId: 1,
          rootFolderPath: '/tv',
          status: 'ended',
          seasons: [
            { seasonNumber: 1, monitored: true },
            { seasonNumber: 2, monitored: true },
          ],
        }

        mockRequestValidationUtils.validateSonarrSeriesRequest.mockReturnValue(
          seriesRequest,
        )
        const mockResponse: AxiosResponse<SonarrSeries> = {
          data: mockSeries,
          status: 201,
          statusText: 'Created',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.addSeries(seriesRequest, correlationId)

        expect(
          mockRequestValidationUtils.validateSonarrSeriesRequest,
        ).toHaveBeenCalledWith(seriesRequest, correlationId)
        expect(result).toEqual(mockSeries)
        expectRetryServiceCall('POST', '/api/v3/series')
      })
    })

    describe('getQueue', () => {
      it('should get queue with records parsing', async () => {
        const mockQueueItems: SonarrQueueItem[] = [
          {
            id: 1,
            seriesId: 1,
            episodeId: 101,
            series: {
              id: 1,
              title: 'Test Series',
              titleSlug: 'test-series',
              year: 2023,
              tvdbId: 12345,
              monitored: true,
              qualityProfileId: 1,
              languageProfileId: 1,
              rootFolderPath: '/tv',
              status: 'continuing',
              seasons: [{ seasonNumber: 1, monitored: true }],
            },
            episode: {
              id: 101,
              episodeFileId: 0,
              seriesId: 1,
              seasonNumber: 1,
              episodeNumber: 5,
              title: 'Test Episode',
              overview: 'Test episode description',
              airDate: '2023-01-05',
              monitored: true,
              hasFile: false,
            },
            status: 'downloading',
            percentage: 65,
            timeleft: '00:10:30',
            size: 500000,
            sizeleft: 175000,
            eta: '2023-01-01T12:10:30Z',
            downloadId: 'def456',
            indexer: 'Test TV Indexer',
            priority: 'normal',
          },
        ]

        const mockResponse: AxiosResponse<{ records: SonarrQueueItem[] }> = {
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
        const mockResponse: AxiosResponse<{ records?: SonarrQueueItem[] }> = {
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

    describe('getAllSeries', () => {
      it('should get all series', async () => {
        const mockSeries: SonarrSeries[] = [
          {
            id: 1,
            title: 'Series 1',
            titleSlug: 'series-1',
            year: 2020,
            tvdbId: 123,
            monitored: true,
            qualityProfileId: 1,
            languageProfileId: 1,
            rootFolderPath: '/tv',
            status: 'continuing',
            seasons: [{ seasonNumber: 1, monitored: true }],
          },
          {
            id: 2,
            title: 'Series 2',
            titleSlug: 'series-2',
            year: 2021,
            tvdbId: 456,
            monitored: false,
            qualityProfileId: 2,
            languageProfileId: 1,
            rootFolderPath: '/tv',
            status: 'ended',
            seasons: [
              { seasonNumber: 1, monitored: true },
              { seasonNumber: 2, monitored: false },
            ],
          },
        ]
        const mockResponse: AxiosResponse<SonarrSeries[]> = {
          data: mockSeries,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getAllSeries(correlationId)

        expect(result).toEqual(mockSeries)
      })
    })

    describe('getSeries', () => {
      it('should get specific series by ID', async () => {
        const mockSeries: SonarrSeries = {
          id: 1,
          title: 'Test Series',
          titleSlug: 'test-series',
          year: 2023,
          tvdbId: 12345,
          monitored: true,
          qualityProfileId: 1,
          languageProfileId: 1,
          rootFolderPath: '/tv',
          status: 'continuing',
          seasons: [{ seasonNumber: 1, monitored: true }],
        }
        const mockResponse: AxiosResponse<SonarrSeries> = {
          data: mockSeries,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getSeries(1, correlationId)

        expect(result).toEqual(mockSeries)
        expectRetryServiceCall('GET', '/api/v3/series/1')
      })
    })

    describe('getSeriesEpisodes', () => {
      it('should get episodes for a specific series', async () => {
        const mockEpisodes: SonarrEpisode[] = [
          {
            id: 101,
            episodeFileId: 1001,
            seriesId: 1,
            seasonNumber: 1,
            episodeNumber: 1,
            title: 'Pilot',
            overview: 'The first episode',
            airDate: '2023-01-01',
            monitored: true,
            hasFile: true,
          },
          {
            id: 102,
            episodeFileId: 0,
            seriesId: 1,
            seasonNumber: 1,
            episodeNumber: 2,
            title: 'Episode 2',
            overview: 'The second episode',
            airDate: '2023-01-08',
            monitored: true,
            hasFile: false,
          },
        ]
        const mockResponse: AxiosResponse<SonarrEpisode[]> = {
          data: mockEpisodes,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getSeriesEpisodes(1, correlationId)

        expect(result).toEqual(mockEpisodes)
        expectRetryServiceCall('GET', '/api/v3/episode?seriesId=1')
      })
    })

    describe('updateSeriesMonitoring', () => {
      it('should update series monitoring settings', async () => {
        const existingSeries: SonarrSeries = {
          id: 1,
          title: 'Test Series',
          titleSlug: 'test-series',
          year: 2023,
          tvdbId: 12345,
          monitored: true,
          qualityProfileId: 1,
          languageProfileId: 1,
          rootFolderPath: '/tv',
          status: 'continuing',
          seasons: [
            { seasonNumber: 1, monitored: true },
            { seasonNumber: 2, monitored: true },
          ],
        }

        const updatedSeries: SonarrSeries = {
          ...existingSeries,
          seasons: [
            { seasonNumber: 1, monitored: false }, // Updated
            { seasonNumber: 2, monitored: true },
          ],
        }

        mockRetryService.executeWithRetry
          .mockResolvedValueOnce({
            data: existingSeries,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: { headers: {} as any },
          })
          .mockResolvedValueOnce({
            data: updatedSeries,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: { headers: {} as any },
          })

        const result = await client.updateSeriesMonitoring(
          1,
          [{ seasonNumber: 1, monitored: false }],
          correlationId,
        )

        expect(result).toEqual(updatedSeries)
        expectRetryServiceCall('PUT', '/api/v3/series/1')
      })
    })

    describe('deleteSeries', () => {
      it('should delete series without files', async () => {
        const mockResponse: AxiosResponse = {
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        await client.deleteSeries(1, false, correlationId)

        expectRetryServiceCall('DELETE', '/api/v3/series/1?deleteFiles=false')
      })

      it('should delete series with files', async () => {
        const mockResponse: AxiosResponse = {
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        await client.deleteSeries(1, true, correlationId)

        expectRetryServiceCall('DELETE', '/api/v3/series/1?deleteFiles=true')
      })
    })

    describe('getQualityProfiles', () => {
      it('should get quality profiles', async () => {
        const mockProfiles = [
          { id: 1, name: 'HD-720p', upgradeAllowed: true },
          { id: 2, name: 'HD-1080p', upgradeAllowed: false },
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

    describe('getLanguageProfiles', () => {
      it('should get language profiles', async () => {
        const mockProfiles = [
          { id: 1, name: 'English' },
          { id: 2, name: 'Spanish' },
        ]
        const mockResponse: AxiosResponse<typeof mockProfiles> = {
          data: mockProfiles,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getLanguageProfiles(correlationId)

        expect(result).toEqual(mockProfiles)
        expectRetryServiceCall('GET', '/api/v3/languageprofile')
      })
    })

    describe('getRootFolders', () => {
      it('should get root folders', async () => {
        const mockFolders = [
          {
            id: 1,
            path: '/tv',
            accessible: true,
            freeSpace: 2000000000,
          },
          {
            id: 2,
            path: '/tv-4k',
            accessible: true,
            freeSpace: 1000000000,
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
  })

  describe('Service Integration Tests', () => {
    it('should run comprehensive diagnostics when service is operational', async () => {
      const mockHealthResponse: AxiosResponse = {
        data: { version: '3.0.2.4552' },
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
      expect(diagnostics.capabilities.supportedMediaTypes).toEqual(['tv'])
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
