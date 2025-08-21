import { Test, TestingModule } from '@nestjs/testing'
import axios, { AxiosError, AxiosResponse } from 'axios'
import { v4 as uuid } from 'uuid'

import {
  createMockAxiosInstance,
  createMockEmbyConfig,
  createMockErrorClassificationService,
  createMockMediaConfigValidationService,
  createMockMediaLoggingService,
  createMockRetryService,
  MockErrorClassificationService,
  MockMediaConfigValidationService,
  MockMediaLoggingService,
  MockRetryService,
} from 'src/media/__tests__/types/test-mocks.types'
import { EmbyClient } from 'src/media/clients/emby.client'
import { MediaConfigValidationService } from 'src/media/config/media-config.validation'
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

// Test data interfaces matching EmbyClient
interface EmbyItem {
  Id: string
  Name: string
  Type: 'Movie' | 'Series' | 'Season' | 'Episode' | 'Folder'
  Path?: string
  ServerId: string
  IsFolder: boolean
  ProductionYear?: number
  RunTimeTicks?: number
  Overview?: string
  Taglines?: string[]
  Genres?: string[]
  CommunityRating?: number
  OfficialRating?: string
  PremiereDate?: string
  DateCreated: string
  UserData?: {
    PlayedPercentage?: number
    Played: boolean
    IsFavorite: boolean
    LastPlayedDate?: string
    PlaybackPositionTicks: number
  }
  ImageTags?: {
    Primary?: string
    Backdrop?: string
    Logo?: string
  }
  BackdropImageTags?: string[]
  SeriesName?: string
  SeasonName?: string
  IndexNumber?: number
  ParentIndexNumber?: number
}

interface EmbyItemsResponse {
  Items: EmbyItem[]
  TotalRecordCount: number
  StartIndex: number
}

interface EmbySystemInfo {
  Version: string
  Id: string
  ServerName: string
  LocalAddress: string
  WanAddress?: string
  OperatingSystem: string
  SystemUpdateLevel: string
  HasPendingRestart: boolean
  IsShuttingDown: boolean
  CanSelfRestart: boolean
  CanSelfUpdate: boolean
  TranscodingTempPath?: string
  HttpServerPortNumber: number
  HttpsPortNumber: number
  SupportsHttps: boolean
  WebSocketPortNumber: number
  CompletedInstallations?: unknown[]
  InProgressInstallations?: unknown[]
}

interface EmbyPlaybackInfo {
  mediaId: string
  title: string
  type: 'Movie' | 'Series' | 'Episode'
  isAvailable: boolean
  playbackUrl?: string
  fileSize?: string
  quality?: string
  duration?: number
  posterUrl?: string
}

interface EmbyLink {
  playUrl: string
  mediaTitle: string
  mediaType: 'Movie' | 'Series' | 'Episode'
  duration?: number
  posterUrl?: string
  quality?: string
  fileSize?: string
  correlationId: string
}

describe('EmbyClient', () => {
  let client: EmbyClient
  let module: TestingModule
  let mockRetryService: MockRetryService
  let mockErrorClassifier: MockErrorClassificationService
  let mockMediaLoggingService: MockMediaLoggingService
  let mockConfigService: MockMediaConfigValidationService

  const mockEmbyConfig = createMockEmbyConfig({
    url: 'http://emby.test:8096',
    apiKey: 'test-emby-api-key-345678',
    userId: '12345678-1234-4678-9012-123456789012',
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

    // Setup config service mock
    mockConfigService.getServiceConfig.mockReturnValue(mockEmbyConfig)

    // Mock axios instance creation
    const mockAxiosInstance = createMockAxiosInstance()
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any)

    module = await Test.createTestingModule({
      providers: [
        EmbyClient,
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

    client = module.get<EmbyClient>(EmbyClient)
  })

  afterEach(async () => {
    if (module) {
      await module.close()
    }
  })

  describe('Initialization', () => {
    it('should initialize with correct Emby configuration', () => {
      expect(mockConfigService.getServiceConfig).toHaveBeenCalledWith('emby')

      const serviceInfo = client.getServiceInfo()
      expect(serviceInfo.serviceName).toBe('emby')
      expect(serviceInfo.baseURL).toBe('http://emby.test:8096')
      expect(serviceInfo.timeout).toBe(30000)
      expect(serviceInfo.maxRetries).toBe(3)
    })

    it('should create axios instance with correct Emby configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://emby.test:8096',
          timeout: 30000,
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'TDR-Bot/emby-client/1.0.0',
            'X-Client-Name': 'TDR-Bot-Media-Client',
          }),
        }),
      )
    })

    it('should set correct service name for Emby', () => {
      const serviceInfo = client.getServiceInfo()
      expect(serviceInfo.serviceName).toBe('emby')
    })

    it('should initialize with Emby-specific version configuration', () => {
      const serviceInfo = client.getServiceInfo()
      expect(serviceInfo.versionConfig?.supportedVersions).toEqual([
        '4.0.0',
        '4.1.0',
        '4.2.0',
        '4.3.0',
        '4.4.0',
        '4.5.0',
        '4.6.0',
        '4.7.0',
        '4.8.0',
        '4.8.11',
      ])
      expect(serviceInfo.versionConfig?.preferredVersion).toBe('4.8.11')
      expect(serviceInfo.versionConfig?.fallbackVersion).toBe('4.0.0')
    })
  })

  describe('Abstract Method Implementation Tests', () => {
    describe('getAuthenticationHeaders', () => {
      it('should return X-Emby-Token authentication header', () => {
        const headers = client['getAuthenticationHeaders']()
        expect(headers).toEqual({
          'X-Emby-Token': 'test-emby-api-key-345678',
        })
      })
    })

    describe('getAuthenticationParams', () => {
      it('should return api_key and userId query parameters', () => {
        const params = client['getAuthenticationParams']()
        expect(params).toEqual({
          api_key: 'test-emby-api-key-345678',
          userId: '12345678-1234-4678-9012-123456789012',
        })
      })
    })

    describe('validateServiceConfiguration', () => {
      it('should successfully validate service configuration with authenticated URL', async () => {
        const mockSystemInfo: EmbySystemInfo = {
          Version: '4.8.11.0',
          Id: 'test-server-id',
          ServerName: 'Test Emby Server',
          LocalAddress: 'http://emby.test:8096',
          OperatingSystem: 'Linux',
          SystemUpdateLevel: 'Release',
          HasPendingRestart: false,
          IsShuttingDown: false,
          CanSelfRestart: true,
          CanSelfUpdate: true,
          HttpServerPortNumber: 8096,
          HttpsPortNumber: 8920,
          SupportsHttps: false,
          WebSocketPortNumber: 8096,
        }
        const mockResponse: AxiosResponse<EmbySystemInfo> = {
          data: mockSystemInfo,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.testConnection(correlationId)

        expect(result.canConnect).toBe(true)
        expect(result.isAuthenticated).toBe(true)
        expect(result.responseTime).toBeGreaterThanOrEqual(0)
        expect(mockRetryService.executeWithRetry).toHaveBeenCalledWith(
          expect.any(Function),
          expect.any(Object),
          expect.stringContaining('emby_GET_/System/Info'),
          'media_api',
        )
      })

      it('should handle connection failures with Emby-specific suggestions', async () => {
        const axiosError = new AxiosError('Connection failed')
        axiosError.code = 'ECONNREFUSED'
        mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

        const result = await client.testConnection(correlationId)

        expect(result.canConnect).toBe(false)
        expect(result.isAuthenticated).toBe(false)
        expect(result.error).toBeDefined()
        expect(result.suggestions).toEqual([
          'Check if Emby server is running',
          'Verify EMBY_URL is correct and accessible',
          'Check EMBY_API_TOKEN is valid',
          'Verify EMBY_USER_ID is correct UUID format',
          'Ensure network connectivity between services',
          'Check Emby server is accessible via HTTP/HTTPS',
        ])
      })
    })

    describe('getServiceCapabilities', () => {
      it('should return Emby service capabilities with movie and TV support', async () => {
        const mockApiVersion = {
          version: '4.8.11',
          detected: true,
          isSupported: true,
          isCompatible: true,
        }
        jest.spyOn(client, 'getApiVersion').mockResolvedValue(mockApiVersion)

        const capabilities = await client.getCapabilities(correlationId)

        expect(capabilities).toEqual({
          canSearch: true,
          canRequest: false, // Emby doesn't handle requests, only library browsing
          canMonitor: true,
          supportedMediaTypes: ['movie', 'tv'],
          version: '4.8.11',
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
          canRequest: false,
          canMonitor: true,
          supportedMediaTypes: ['movie', 'tv'],
          version: '4.0.0',
          apiVersion: {
            version: '4.0.0',
            detected: false,
            isSupported: false,
            isCompatible: true,
            error: 'API version detection failed',
          },
          featureLimitations: [
            'Could not determine API version',
            'Using fallback capabilities',
            'API version detection failed',
          ],
        })
      })
    })

    describe('performHealthCheck', () => {
      it('should perform successful health check', async () => {
        const mockSystemInfo: EmbySystemInfo = {
          Version: '4.8.11.0',
          Id: 'test-server-id',
          ServerName: 'Test Emby Server',
          LocalAddress: 'http://emby.test:8096',
          OperatingSystem: 'Linux',
          SystemUpdateLevel: 'Release',
          HasPendingRestart: false,
          IsShuttingDown: false,
          CanSelfRestart: true,
          CanSelfUpdate: true,
          HttpServerPortNumber: 8096,
          HttpsPortNumber: 8920,
          SupportsHttps: false,
          WebSocketPortNumber: 8096,
        }
        const mockResponse: AxiosResponse<EmbySystemInfo> = {
          data: mockSystemInfo,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const mockApiVersion = {
          version: '4.8.11',
          detected: true,
          isSupported: true,
          isCompatible: true,
        }
        jest.spyOn(client, 'getApiVersion').mockResolvedValue(mockApiVersion)

        const result = await client.checkHealth(correlationId)

        expect(result.isHealthy).toBe(true)
        expect(result.version).toBe('4.8.11.0')
        expect(result.status).toBe('healthy')
        expect(result.responseTime).toBeGreaterThanOrEqual(0)
        expect(result.apiVersion).toBe(mockApiVersion)
      })

      it('should detect unhealthy status when server is shutting down', async () => {
        const mockSystemInfo: EmbySystemInfo = {
          Version: '4.8.11.0',
          Id: 'test-server-id',
          ServerName: 'Test Emby Server',
          LocalAddress: 'http://emby.test:8096',
          OperatingSystem: 'Linux',
          SystemUpdateLevel: 'Release',
          HasPendingRestart: false,
          IsShuttingDown: true, // Server is shutting down
          CanSelfRestart: true,
          CanSelfUpdate: true,
          HttpServerPortNumber: 8096,
          HttpsPortNumber: 8920,
          SupportsHttps: false,
          WebSocketPortNumber: 8096,
        }
        const mockResponse: AxiosResponse<EmbySystemInfo> = {
          data: mockSystemInfo,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const mockApiVersion = {
          version: '4.8.11',
          detected: true,
          isSupported: true,
          isCompatible: true,
        }
        jest.spyOn(client, 'getApiVersion').mockResolvedValue(mockApiVersion)

        const result = await client.checkHealth(correlationId)

        expect(result.isHealthy).toBe(false)
        expect(result.status).toBe('shutting_down')
        expect(result.version).toBe('4.8.11.0')
      })

      it('should handle health check failures', async () => {
        const axiosError = new AxiosError('Health check failed')
        mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

        const result = await client.checkHealth(correlationId)

        expect(result.isHealthy).toBe(false)
        expect(result.error).toContain(
          'EMBY network error during GET /System/Info',
        )
        expect(result.responseTime).toBeGreaterThanOrEqual(0)
      })
    })

    describe('getApiEndpoints', () => {
      it('should return correct Emby API endpoints', () => {
        const endpoints = client.getEndpoints()

        expect(endpoints).toEqual({
          health: '/System/Info',
          system: '/System/Info',
          items: '/Items',
          itemById: '/Items/{itemId}',
          playbackInfo: '/Items/{itemId}/PlaybackInfo',
          search: '/Items',
          libraries: '/Users/Views',
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
      `emby_${method}_${path}`,
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

    it('should execute GET requests with proper authentication params', async () => {
      await client['get'](
        '/Items?api_key=test-emby-api-key-345678&userId=12345678-1234-4678-9012-123456789012',
        correlationId,
      )

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'emby',
        'GET',
        expect.stringContaining(
          '/Items?api_key=test-emby-api-key-345678&userId=12345678-1234-4678-9012-123456789012',
        ),
        expect.any(Number),
        correlationId,
        200,
      )
    })

    it('should execute POST requests with authentication', async () => {
      await client['post'](
        '/Items?api_key=test-emby-api-key-345678&userId=12345678-1234-4678-9012-123456789012',
        { data: 'test' },
        correlationId,
      )

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'emby',
        'POST',
        expect.stringContaining(
          '/Items?api_key=test-emby-api-key-345678&userId=12345678-1234-4678-9012-123456789012',
        ),
        expect.any(Number),
        correlationId,
        200,
      )
    })

    it('should execute PUT requests with authentication', async () => {
      await client['put'](
        '/Items/123?api_key=test-emby-api-key-345678&userId=12345678-1234-4678-9012-123456789012',
        { data: 'test' },
        correlationId,
      )

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
    })

    it('should execute DELETE requests with authentication', async () => {
      await client['delete'](
        '/Items/123?api_key=test-emby-api-key-345678&userId=12345678-1234-4678-9012-123456789012',
        correlationId,
      )

      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
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
        client['get']('/System/Info', correlationId),
      ).rejects.toThrow(MediaAuthenticationError)

      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'emby',
        'GET',
        'http://emby.test:8096/System/Info',
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

      await expect(client['get']('/Items', correlationId)).rejects.toThrow(
        MediaRateLimitError,
      )
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
        client['get']('/Items/nonexistent', correlationId),
      ).rejects.toThrow(MediaNotFoundApiError)
    })

    it('should handle validation errors (400)', async () => {
      const axiosError = new AxiosError('Bad Request')
      axiosError.response = {
        status: 400,
        statusText: 'Bad Request',
        data: { message: 'Invalid request data' },
        headers: {} as any,
        config: { headers: {} as any },
      }
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(client['post']('/Items', {}, correlationId)).rejects.toThrow(
        MediaValidationApiError,
      )
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
        client['get']('/System/Info', correlationId),
      ).rejects.toThrow(MediaServiceUnavailableError)
    })

    it('should handle network errors (no response)', async () => {
      const axiosError = new AxiosError('Network Error')
      axiosError.code = 'ECONNREFUSED'
      mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

      await expect(
        client['get']('/System/Info', correlationId),
      ).rejects.toThrow(MediaNetworkError)
    })
  })

  describe('URL Building Tests', () => {
    describe('buildAuthenticatedUrl', () => {
      it('should build URL with authentication query parameters', () => {
        const url = client['buildAuthenticatedUrl']('/Items', {
          recursive: 'true',
          limit: '100',
        })

        expect(url).toBe(
          '/Items?api_key=test-emby-api-key-345678&userId=12345678-1234-4678-9012-123456789012&recursive=true&limit=100',
        )
      })

      it('should build URL with only authentication parameters when no additional params', () => {
        const url = client['buildAuthenticatedUrl']('/System/Info')

        expect(url).toBe(
          '/System/Info?api_key=test-emby-api-key-345678&userId=12345678-1234-4678-9012-123456789012',
        )
      })
    })

    describe('buildUserSpecificUrl', () => {
      it('should build user-specific URL with only api_key parameter', () => {
        const url = client['buildUserSpecificUrl'](
          '/Users/12345678-1234-4678-9012-123456789012/Views',
        )

        expect(url).toBe(
          '/Users/12345678-1234-4678-9012-123456789012/Views?api_key=test-emby-api-key-345678',
        )
      })

      it('should build user-specific URL with additional parameters', () => {
        const url = client['buildUserSpecificUrl'](
          '/Users/12345678-1234-4678-9012-123456789012/Views',
          {
            includeItemTypes: 'Movie',
          },
        )

        expect(url).toBe(
          '/Users/12345678-1234-4678-9012-123456789012/Views?api_key=test-emby-api-key-345678&includeItemTypes=Movie',
        )
      })
    })
  })

  describe('Emby-Specific Methods', () => {
    describe('getLibraryItems', () => {
      it('should get library items with proper authentication and parameters', async () => {
        const mockItems: EmbyItem[] = [
          {
            Id: 'item1',
            Name: 'Test Movie',
            Type: 'Movie',
            ServerId: 'server123',
            IsFolder: false,
            DateCreated: '2023-01-01T00:00:00Z',
            ProductionYear: 2023,
          },
          {
            Id: 'item2',
            Name: 'Test Series',
            Type: 'Series',
            ServerId: 'server123',
            IsFolder: true,
            DateCreated: '2023-01-01T00:00:00Z',
            ProductionYear: 2022,
          },
        ]
        const mockResponse: AxiosResponse<EmbyItemsResponse> = {
          data: {
            Items: mockItems,
            TotalRecordCount: 2,
            StartIndex: 0,
          },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getLibraryItems(
          correlationId,
          ['Movie', 'Series'],
          50,
          0,
        )

        expect(result).toEqual(mockItems)
        expect(mockRetryService.executeWithRetry).toHaveBeenCalledWith(
          expect.any(Function),
          expect.any(Object),
          expect.stringContaining('emby_GET_/Items'),
          'media_api',
        )
      })

      it('should handle empty library response', async () => {
        const mockResponse: AxiosResponse<EmbyItemsResponse> = {
          data: {
            Items: [],
            TotalRecordCount: 0,
            StartIndex: 0,
          },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getLibraryItems(correlationId)

        expect(result).toEqual([])
      })
    })

    describe('searchLibrary', () => {
      it('should search library with proper query encoding', async () => {
        const mockItems: EmbyItem[] = [
          {
            Id: 'search1',
            Name: 'Fight Club',
            Type: 'Movie',
            ServerId: 'server123',
            IsFolder: false,
            DateCreated: '2023-01-01T00:00:00Z',
            ProductionYear: 1999,
          },
        ]
        const mockResponse: AxiosResponse<EmbyItemsResponse> = {
          data: {
            Items: mockItems,
            TotalRecordCount: 1,
            StartIndex: 0,
          },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.searchLibrary(
          'fight club',
          correlationId,
          ['Movie'],
          25,
        )

        expect(result).toEqual(mockItems)
        expect(mockRetryService.executeWithRetry).toHaveBeenCalledWith(
          expect.any(Function),
          expect.any(Object),
          expect.stringContaining('emby_GET_/Items'),
          'media_api',
        )
      })
    })

    describe('getItem', () => {
      it('should get specific item by ID', async () => {
        const mockItem: EmbyItem = {
          Id: 'item123',
          Name: 'Test Movie',
          Type: 'Movie',
          ServerId: 'server123',
          IsFolder: false,
          DateCreated: '2023-01-01T00:00:00Z',
          ProductionYear: 2023,
          Path: '/media/movies/test-movie.mp4',
        }
        const mockResponse: AxiosResponse<EmbyItem> = {
          data: mockItem,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getItem('item123', correlationId)

        expect(result).toEqual(mockItem)
        expectRetryServiceCall('GET', '/Items/item123')
      })
    })

    describe('generatePlaybackLink', () => {
      it('should generate playback link for available media', async () => {
        const mockItem: EmbyItem = {
          Id: 'media123',
          Name: 'Fight Club',
          Type: 'Movie',
          ServerId: 'server123',
          IsFolder: false,
          DateCreated: '2023-01-01T00:00:00Z',
          ProductionYear: 1999,
          Path: '/media/movies/fight-club.mp4',
          RunTimeTicks: 1393980000000, // ~2.3 hours in ticks
          ImageTags: {
            Primary: 'poster123',
          },
        }

        const mockSystemInfo: EmbySystemInfo = {
          Version: '4.8.11.0',
          Id: 'emby-server-123',
          ServerName: 'Test Emby Server',
          LocalAddress: 'http://emby.test:8096',
          OperatingSystem: 'Linux',
          SystemUpdateLevel: 'Release',
          HasPendingRestart: false,
          IsShuttingDown: false,
          CanSelfRestart: true,
          CanSelfUpdate: true,
          HttpServerPortNumber: 8096,
          HttpsPortNumber: 8920,
          SupportsHttps: false,
          WebSocketPortNumber: 8096,
        }

        // Mock getItem call
        const mockItemResponse: AxiosResponse<EmbyItem> = {
          data: mockItem,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }

        // Mock getSystemInfo call
        const mockSystemResponse: AxiosResponse<EmbySystemInfo> = {
          data: mockSystemInfo,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }

        mockRetryService.executeWithRetry
          .mockResolvedValueOnce(mockItemResponse) // First call for getItem
          .mockResolvedValueOnce(mockSystemResponse) // Second call for getSystemInfo

        const result = await client.generatePlaybackLink(
          'media123',
          correlationId,
        )

        expect(result).toEqual({
          playUrl:
            'http://emby.test:8096/web/index.html#!/item?id=media123&serverId=emby-server-123',
          mediaTitle: 'Fight Club',
          mediaType: 'Movie',
          duration: 139398, // Converted from ticks to seconds
          posterUrl: 'http://emby.test:8096/Items/media123/Images/Primary',
          correlationId,
        })
      })

      it('should throw error for unavailable media', async () => {
        const mockItem: EmbyItem = {
          Id: 'media123',
          Name: 'Test Movie',
          Type: 'Movie',
          ServerId: 'server123',
          IsFolder: false,
          DateCreated: '2023-01-01T00:00:00Z',
          // No Path - media not available
        }

        const mockItemResponse: AxiosResponse<EmbyItem> = {
          data: mockItem,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockItemResponse)

        await expect(
          client.generatePlaybackLink('media123', correlationId),
        ).rejects.toThrow('Media item media123 is not available for playback')
      })
    })

    describe('validateMediaAvailability', () => {
      it('should validate media is available', async () => {
        const mockItem: EmbyItem = {
          Id: 'media123',
          Name: 'Test Movie',
          Type: 'Movie',
          ServerId: 'server123',
          IsFolder: false,
          DateCreated: '2023-01-01T00:00:00Z',
          Path: '/media/movies/test-movie.mp4',
        }
        const mockResponse: AxiosResponse<EmbyItem> = {
          data: mockItem,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.validateMediaAvailability(
          'media123',
          correlationId,
        )

        expect(result).toBe(true)
      })

      it('should return false for unavailable media', async () => {
        const mockItem: EmbyItem = {
          Id: 'media123',
          Name: 'Test Movie',
          Type: 'Movie',
          ServerId: 'server123',
          IsFolder: false,
          DateCreated: '2023-01-01T00:00:00Z',
          // No Path - media not available
        }
        const mockResponse: AxiosResponse<EmbyItem> = {
          data: mockItem,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.validateMediaAvailability(
          'media123',
          correlationId,
        )

        expect(result).toBe(false)
      })

      it('should return false when item not found', async () => {
        const axiosError = new AxiosError('Not Found')
        axiosError.response = {
          status: 404,
          statusText: 'Not Found',
          data: {},
          headers: {} as any,
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockRejectedValue(axiosError)

        const result = await client.validateMediaAvailability(
          'nonexistent',
          correlationId,
        )

        expect(result).toBe(false)
      })
    })

    describe('getMediaPlaybackInfo', () => {
      it('should get comprehensive playback information for available media', async () => {
        const mockItem: EmbyItem = {
          Id: 'media123',
          Name: 'Test Movie',
          Type: 'Movie',
          ServerId: 'server123',
          IsFolder: false,
          DateCreated: '2023-01-01T00:00:00Z',
          Path: '/media/movies/test-movie.mp4',
          RunTimeTicks: 7200000000, // 2 hours in ticks
        }

        const mockSystemInfo: EmbySystemInfo = {
          Version: '4.8.11.0',
          Id: 'emby-server-123',
          ServerName: 'Test Emby Server',
          LocalAddress: 'http://emby.test:8096',
          OperatingSystem: 'Linux',
          SystemUpdateLevel: 'Release',
          HasPendingRestart: false,
          IsShuttingDown: false,
          CanSelfRestart: true,
          CanSelfUpdate: true,
          HttpServerPortNumber: 8096,
          HttpsPortNumber: 8920,
          SupportsHttps: false,
          WebSocketPortNumber: 8096,
        }

        mockRetryService.executeWithRetry
          .mockResolvedValueOnce({
            data: mockItem,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: { headers: {} as any },
          })
          .mockResolvedValueOnce({
            data: mockItem,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: { headers: {} as any },
          })
          .mockResolvedValueOnce({
            data: mockSystemInfo,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: { headers: {} as any },
          })

        const result = await client.getMediaPlaybackInfo(
          'media123',
          correlationId,
        )

        expect(result).toEqual({
          mediaId: 'media123',
          title: 'Test Movie',
          type: 'Movie',
          isAvailable: true,
          playbackUrl:
            'http://emby.test:8096/web/index.html#!/item?id=media123&serverId=emby-server-123',
          duration: 720, // Converted from ticks to seconds
          posterUrl: undefined,
        })
      })

      it('should get playback information for unavailable media', async () => {
        const mockItem: EmbyItem = {
          Id: 'media123',
          Name: 'Test Movie',
          Type: 'Movie',
          ServerId: 'server123',
          IsFolder: false,
          DateCreated: '2023-01-01T00:00:00Z',
          // No Path - media not available
        }
        mockRetryService.executeWithRetry.mockResolvedValue({
          data: mockItem,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        })

        const result = await client.getMediaPlaybackInfo(
          'media123',
          correlationId,
        )

        expect(result).toEqual({
          mediaId: 'media123',
          title: 'Test Movie',
          type: 'Movie',
          isAvailable: false,
        })
      })
    })

    describe('getLibraries', () => {
      it('should get user libraries using user-specific URL pattern', async () => {
        const mockLibraries: EmbyItem[] = [
          {
            Id: 'lib1',
            Name: 'Movies',
            Type: 'Folder',
            ServerId: 'server123',
            IsFolder: true,
            DateCreated: '2023-01-01T00:00:00Z',
          },
          {
            Id: 'lib2',
            Name: 'TV Shows',
            Type: 'Folder',
            ServerId: 'server123',
            IsFolder: true,
            DateCreated: '2023-01-01T00:00:00Z',
          },
        ]
        const mockResponse: AxiosResponse<EmbyItemsResponse> = {
          data: {
            Items: mockLibraries,
            TotalRecordCount: 2,
            StartIndex: 0,
          },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getLibraries(correlationId)

        expect(result).toEqual(mockLibraries)
        expectRetryServiceCall(
          'GET',
          '/Users/12345678-1234-4678-9012-123456789012/Views',
        )
      })
    })

    describe('getLibraryItemsFromCollection', () => {
      it('should get items from specific library collection', async () => {
        const mockItems: EmbyItem[] = [
          {
            Id: 'movie1',
            Name: 'Movie 1',
            Type: 'Movie',
            ServerId: 'server123',
            IsFolder: false,
            DateCreated: '2023-01-01T00:00:00Z',
          },
          {
            Id: 'movie2',
            Name: 'Movie 2',
            Type: 'Movie',
            ServerId: 'server123',
            IsFolder: false,
            DateCreated: '2023-01-01T00:00:00Z',
          },
        ]
        const mockResponse: AxiosResponse<EmbyItemsResponse> = {
          data: {
            Items: mockItems,
            TotalRecordCount: 2,
            StartIndex: 0,
          },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getLibraryItemsFromCollection(
          'library123',
          correlationId,
          50,
          0,
        )

        expect(result).toEqual(mockItems)
        expect(mockRetryService.executeWithRetry).toHaveBeenCalledWith(
          expect.any(Function),
          expect.any(Object),
          expect.stringContaining('emby_GET_/Items'),
          'media_api',
        )
      })
    })

    describe('getSystemInfo', () => {
      it('should get system information with authentication', async () => {
        const mockSystemInfo: EmbySystemInfo = {
          Version: '4.8.11.0',
          Id: 'emby-server-123',
          ServerName: 'Test Emby Server',
          LocalAddress: 'http://emby.test:8096',
          WanAddress: 'https://external.example.com:8920',
          OperatingSystem: 'Linux',
          SystemUpdateLevel: 'Release',
          HasPendingRestart: false,
          IsShuttingDown: false,
          CanSelfRestart: true,
          CanSelfUpdate: true,
          TranscodingTempPath: '/tmp/emby-transcode',
          HttpServerPortNumber: 8096,
          HttpsPortNumber: 8920,
          SupportsHttps: true,
          WebSocketPortNumber: 8096,
          CompletedInstallations: [],
          InProgressInstallations: [],
        }
        const mockResponse: AxiosResponse<EmbySystemInfo> = {
          data: mockSystemInfo,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: {} as any },
        }
        mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

        const result = await client.getSystemInfo(correlationId)

        expect(result).toEqual(mockSystemInfo)
        expectRetryServiceCall('GET', '/System/Info')
      })
    })
  })

  describe('Service Integration Tests', () => {
    it('should run comprehensive diagnostics when service is operational', async () => {
      const mockSystemInfo: EmbySystemInfo = {
        Version: '4.8.11.0',
        Id: 'emby-server-123',
        ServerName: 'Test Emby Server',
        LocalAddress: 'http://emby.test:8096',
        OperatingSystem: 'Linux',
        SystemUpdateLevel: 'Release',
        HasPendingRestart: false,
        IsShuttingDown: false,
        CanSelfRestart: true,
        CanSelfUpdate: true,
        HttpServerPortNumber: 8096,
        HttpsPortNumber: 8920,
        SupportsHttps: false,
        WebSocketPortNumber: 8096,
      }
      const mockResponse: AxiosResponse<EmbySystemInfo> = {
        data: mockSystemInfo,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: {} as any },
      }
      mockRetryService.executeWithRetry.mockResolvedValue(mockResponse)

      const mockApiVersion = {
        version: '4.8.11',
        detected: true,
        isSupported: true,
        isCompatible: true,
      }
      jest.spyOn(client, 'getApiVersion').mockResolvedValue(mockApiVersion)

      const diagnostics = await client.runDiagnostics(correlationId)

      expect(diagnostics.connection.canConnect).toBe(true)
      expect(diagnostics.health.isHealthy).toBe(true)
      expect(diagnostics.capabilities.canSearch).toBe(true)
      expect(diagnostics.capabilities.canRequest).toBe(false) // Emby doesn't support requests
      expect(diagnostics.capabilities.supportedMediaTypes).toEqual([
        'movie',
        'tv',
      ])
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
