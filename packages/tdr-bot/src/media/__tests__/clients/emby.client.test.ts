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
  type MockAxiosInstance,
  type MockErrorClassificationService,
  type MockMediaConfigValidationService,
  type MockMediaLoggingService,
  type MockRetryService,
} from 'src/media/__tests__/types/test-mocks.types'
import { EmbyClient } from 'src/media/clients/emby.client'
import { MediaConfigValidationService } from 'src/media/config/media-config.validation'
import {
  MediaAuthenticationError,
  MediaNetworkError,
  MediaNotFoundApiError,
} from 'src/media/errors/media-errors'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Mock axios
jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

describe('EmbyClient', () => {
  let client: EmbyClient
  let mockRetryService: MockRetryService
  let mockErrorClassifier: MockErrorClassificationService
  let mockMediaLoggingService: MockMediaLoggingService
  let mockConfigValidationService: MockMediaConfigValidationService
  let mockAxiosInstance: MockAxiosInstance

  const testConfig = createMockEmbyConfig()

  beforeEach(async () => {
    // Setup mocked services
    mockRetryService = createMockRetryService()
    mockErrorClassifier = createMockErrorClassificationService()
    mockMediaLoggingService = createMockMediaLoggingService()
    mockConfigValidationService = createMockMediaConfigValidationService()
    mockAxiosInstance = createMockAxiosInstance()

    // Set up the mock config service to return testConfig BEFORE module compilation
    mockConfigValidationService.getServiceConfig.mockReturnValue(testConfig)

    mockedAxios.create.mockReturnValue(mockAxiosInstance)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbyClient,
        { provide: RetryService, useValue: mockRetryService },
        { provide: ErrorClassificationService, useValue: mockErrorClassifier },
        { provide: MediaLoggingService, useValue: mockMediaLoggingService },
        {
          provide: MediaConfigValidationService,
          useValue: mockConfigValidationService,
        },
      ],
    }).compile()

    client = module.get<EmbyClient>(EmbyClient)
  })

  describe('Service Configuration and Initialization', () => {
    describe('Service validation', () => {
      it('should validate service name configuration', () => {
        expect(client.getServiceInfo().serviceName).toBe('emby')
      })

      it('should validate base configuration', () => {
        expect(mockedAxios.create.mock.calls[0][0]).toEqual(
          expect.objectContaining({
            baseURL: testConfig.url,
            timeout: testConfig.timeout,
          }),
        )
      })

      it('should validate authentication headers', () => {
        expect(mockedAxios.create.mock.calls[0]?.[0]?.headers).toEqual(
          expect.objectContaining({
            'User-Agent': expect.stringContaining('TDR-Bot'),
            'X-Client-Name': 'TDR-Bot-Media-Client',
          }),
        )
      })
    })

    describe('Service capabilities', () => {
      it.each([
        ['canSearch', true],
        ['canRequest', false], // EmbyClient correctly returns false since it doesn't handle requests
        ['canMonitor', true],
      ])(
        'should have %s capability set to %s',
        async (capability, expectedValue) => {
          const capabilities = await client.getCapabilities(uuid())
          expect(capabilities[capability as keyof typeof capabilities]).toBe(
            expectedValue,
          )
        },
      )
    })
  })

  describe('Library Management', () => {
    it('should retrieve library information', async () => {
      const mockLibraryResponse = {
        Items: [
          {
            Id: '1',
            Name: 'Movies',
            CollectionType: 'movies',
            Path: '/media/movies',
          },
          {
            Id: '2',
            Name: 'TV Shows',
            CollectionType: 'tvshows',
            Path: '/media/tv',
          },
        ],
      }

      mockAxiosInstance.get.mockResolvedValue({
        data: mockLibraryResponse,
        status: 200,
      } as AxiosResponse)

      const correlationId = uuid()
      const libraries = await client.getLibraries(correlationId)

      expect(libraries).toHaveLength(2)
      expect(libraries[0]).toMatchObject({
        Id: '1',
        Name: 'Movies',
        CollectionType: 'movies',
        Path: '/media/movies',
      })

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('/Users/'),
        expect.any(Object),
      )
      expect(mockMediaLoggingService.logApiCall).toHaveBeenCalledWith(
        'emby',
        'GET',
        expect.stringContaining('/Users/'),
        expect.any(Number),
        correlationId,
        200,
      )
    })

    it('should search media in libraries', async () => {
      const mockSearchResponse = {
        Items: [
          {
            Id: 'movie123',
            Name: 'The Matrix',
            Overview:
              'A computer hacker learns about the true nature of reality.',
            ProductionYear: 1999,
            Type: 'Movie',
            ImageTags: {
              Primary: 'tag123',
            },
            UserData: {
              IsFavorite: false,
              PlayCount: 2,
            },
          },
        ],
        TotalRecordCount: 1,
      }

      mockAxiosInstance.get.mockResolvedValue({
        data: mockSearchResponse,
        status: 200,
      } as AxiosResponse)

      const correlationId = uuid()
      const searchResults = await client.searchLibrary(
        'The Matrix',
        correlationId,
      )

      expect(searchResults).toHaveLength(1)
      expect(searchResults[0]).toMatchObject({
        Id: 'movie123',
        Name: 'The Matrix',
        Overview: 'A computer hacker learns about the true nature of reality.',
        ProductionYear: 1999,
        Type: 'Movie',
      })

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('/Items?'),
        expect.any(Object),
      )
    })
  })

  describe('User Management', () => {
    it('should retrieve user information and preferences', async () => {
      const mockUserResponse = {
        Items: [
          {
            Id: 'user123',
            Name: 'TestUser',
            ServerId: 'server123',
            HasPassword: true,
            HasConfiguredPassword: true,
            HasConfiguredEasyPassword: false,
            EnableAutoLogin: false,
            LastLoginDate: '2023-01-01T00:00:00.000Z',
          },
        ],
      }

      mockAxiosInstance.get.mockResolvedValue({
        data: mockUserResponse,
        status: 200,
      } as AxiosResponse)

      const correlationId = uuid()
      const users = await client.getUsers(correlationId)

      expect(users).toHaveLength(1)
      expect(users[0]).toMatchObject({
        Id: 'user123',
        Name: 'TestUser',
        ServerId: 'server123',
      })

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('/Users'),
        expect.any(Object),
      )
    })

    it('should handle user authentication and session management', async () => {
      const mockAuthResponse = {
        User: {
          Id: 'user123',
          Name: 'TestUser',
        },
        AccessToken: 'auth_token_123',
        ServerId: 'server123',
      }

      mockAxiosInstance.post.mockResolvedValue({
        data: mockAuthResponse,
        status: 200,
      } as AxiosResponse)

      const correlationId = uuid()
      const authResult = await client.authenticateUser(
        'testuser',
        'password123',
        correlationId,
      )

      expect(authResult).toMatchObject({
        userId: 'user123',
        username: 'TestUser',
        accessToken: 'auth_token_123',
        serverId: 'server123',
      })

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.stringContaining('/Users/AuthenticateByName'),
        expect.objectContaining({
          Username: 'testuser',
          Pw: 'password123',
        }),
        expect.any(Object),
      )
    })
  })

  describe('Media Streaming and Playback', () => {
    it('should generate streaming URLs with proper parameters', async () => {
      const mediaId = 'movie123'
      const userId = 'user123'
      const correlationId = uuid()

      const streamingUrl = await client.getStreamingUrl(
        mediaId,
        userId,
        {
          maxBitrate: 8000000,
          audioCodec: 'aac',
          videoCodec: 'h264',
          container: 'mp4',
        },
        correlationId,
      )

      expect(streamingUrl).toContain(`/Videos/${mediaId}/stream`)
      expect(streamingUrl).toContain('MaxStreamingBitrate=8000000')
      expect(streamingUrl).toContain('AudioCodec=aac')
      expect(streamingUrl).toContain('VideoCodec=h264')
      expect(streamingUrl).toContain('Container=mp4')
    })

    it('should handle playback reporting and progress tracking', async () => {
      const playbackInfo = {
        itemId: 'movie123',
        userId: 'user123',
        positionTicks: 600000000, // 1 minute in ticks
        isPaused: false,
        isMuted: false,
        volumeLevel: 80,
      }

      mockAxiosInstance.post.mockResolvedValue({
        data: {},
        status: 204,
      } as AxiosResponse)

      const correlationId = uuid()
      await client.reportPlaybackProgress(playbackInfo, correlationId)

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.stringContaining('/Sessions/Playing/Progress'),
        expect.objectContaining({
          ItemId: 'movie123',
          PositionTicks: 600000000,
          IsPaused: false,
        }),
        expect.any(Object),
      )
    })
  })

  describe('Error Handling and Resilience', () => {
    it('should handle Emby-specific errors correctly', async () => {
      const correlationId = uuid()

      // Test authentication error
      const authError = {
        response: {
          status: 401,
          data: {
            ErrorCode: 'InvalidUser',
            Message: 'Invalid username or password',
          },
        },
      } as AxiosError
      mockAxiosInstance.get.mockRejectedValue(authError)

      await expect(client.getUsers(correlationId)).rejects.toThrow(
        MediaAuthenticationError,
      )

      // Test not found error
      const notFoundError = {
        response: {
          status: 404,
          data: { ErrorCode: 'ItemNotFound', Message: 'Item not found' },
        },
      } as AxiosError
      mockAxiosInstance.get.mockRejectedValue(notFoundError)

      await expect(client.getLibraries(correlationId)).rejects.toThrow(
        MediaNotFoundApiError,
      )
    })

    it('should handle network connectivity issues', async () => {
      const networkError = {
        code: 'ECONNREFUSED',
        message: 'Connection refused',
      } as AxiosError
      mockAxiosInstance.get.mockRejectedValue(networkError)

      const correlationId = uuid()
      await expect(client.getLibraries(correlationId)).rejects.toThrow(
        MediaNetworkError,
      )
    })
  })

  describe('Health Monitoring and Status', () => {
    it('should check service health and connectivity', async () => {
      const mockSystemInfo = {
        Id: 'server123',
        ServerName: 'Emby Server',
        Version: '4.7.0.0',
        OperatingSystem: 'Linux',
        SystemArchitecture: 'X64',
        IsShuttingDown: false,
        SupportsLibraryMonitor: true,
        WebSocketPortNumber: 8096,
      }

      mockAxiosInstance.get.mockResolvedValue({
        data: mockSystemInfo,
        status: 200,
      } as AxiosResponse)

      const healthResult = await client.getHealthStatus()

      expect(healthResult).toMatchObject({
        isHealthy: true,
        status: 'healthy',
        version: '4.7.0.0',
        uptime: undefined,
      })

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('/System/Info'),
        expect.any(Object),
      )
    })

    it('should perform connection tests with performance metrics', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          Version: '4.7.0.0',
          Id: 'server123',
          ServerName: 'Emby Server',
          IsShuttingDown: false,
          HasPendingRestart: false,
        },
        status: 200,
      } as AxiosResponse)

      const correlationId = uuid()
      const connectionResult = await client.testConnection(correlationId)

      expect(connectionResult).toMatchObject({
        canConnect: expect.any(Boolean),
        isAuthenticated: expect.any(Boolean),
        responseTime: expect.any(Number),
      })

      expect(connectionResult.responseTime).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Configuration Management', () => {
    it('should validate and update Emby configuration', async () => {
      const newConfig = {
        ...testConfig,
        timeout: 10000,
        maxRetries: 5,
      }

      await client.configure(newConfig)

      // Should have called configure method (implementation validates and updates config)
      expect(client.configure).toBeDefined()

      expect(
        mockConfigValidationService.validateEmbyConfig,
      ).toHaveBeenCalledWith(newConfig)
    })
  })
})
