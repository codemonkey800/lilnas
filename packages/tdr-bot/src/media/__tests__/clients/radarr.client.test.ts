import { Test, TestingModule } from '@nestjs/testing'
import axios, { AxiosError, AxiosResponse } from 'axios'
import { v4 as uuid } from 'uuid'

import {
  createMockAxiosInstance,
  createMockErrorClassificationService,
  createMockMediaConfigValidationService,
  createMockMediaLoggingService,
  createMockRadarrConfig,
  createMockRetryService,
} from 'src/media/__tests__/types/test-mocks.types'
import { RadarrClient } from 'src/media/clients/radarr.client'
import { MediaConfigValidationService } from 'src/media/config/media-config.validation'
import {
  MediaAuthenticationError,
  MediaNotFoundApiError,
} from 'src/media/errors/media-errors'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Mock axios
jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

describe('RadarrClient', () => {
  let client: RadarrClient
  let mockAxiosInstance: jest.Mocked<any>
  const testConfig = createMockRadarrConfig()

  beforeEach(async () => {
    mockAxiosInstance = createMockAxiosInstance()
    mockedAxios.create.mockReturnValue(mockAxiosInstance)

    const mockConfigService = createMockMediaConfigValidationService()
    mockConfigService.getServiceConfig.mockReturnValue(testConfig)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadarrClient,
        { provide: RetryService, useValue: createMockRetryService() },
        {
          provide: ErrorClassificationService,
          useValue: createMockErrorClassificationService(),
        },
        {
          provide: MediaLoggingService,
          useValue: createMockMediaLoggingService(),
        },
        { provide: MediaConfigValidationService, useValue: mockConfigService },
      ],
    }).compile()

    client = module.get<RadarrClient>(RadarrClient)
  })

  describe('Service Configuration', () => {
    describe('Service validation', () => {
      it.each([
        ['service name', () => client.getServiceInfo().serviceName, 'radarr'],
        [
          'base configuration',
          () => mockedAxios.create.mock.calls[0][0],
          expect.objectContaining({
            baseURL: testConfig.url,
            timeout: testConfig.timeout,
          }),
        ],
      ])(
        'should validate %s configuration',
        (validationType, getter, expected) => {
          const result = getter()
          expect(result).toEqual(expected)
        },
      )
    })

    describe('Service capabilities', () => {
      it.each([
        ['canSearch', true],
        ['canRequest', true],
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

  describe('Movie Management', () => {
    it('should search and add movies to library', async () => {
      const mockSearchResponse = [
        {
          title: 'The Matrix',
          originalTitle: 'The Matrix',
          overview: 'A computer hacker learns about reality.',
          year: 1999,
          tmdbId: 603,
          imdbId: 'tt0133093',
          status: 'released',
          inCinemas: '1999-03-31T00:00:00Z',
          digitalRelease: '1999-09-21T00:00:00Z',
          genres: ['Action', 'Science Fiction'],
          runtime: 136,
          images: [{ coverType: 'poster', url: '/poster.jpg' }],
        },
      ]

      mockAxiosInstance.request.mockResolvedValue({
        data: mockSearchResponse,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        config: { headers: {} },
      } as unknown as AxiosResponse)

      const correlationId = uuid()
      const searchResults = await client.searchMovies(
        'The Matrix',
        correlationId,
      )

      expect(searchResults).toHaveLength(1)
      expect(searchResults[0]).toMatchObject({
        title: 'The Matrix',
        year: 1999,
        tmdbId: 603,
        status: 'released',
      })

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/api/v3/movie/lookup?term=The%20Matrix',
        }),
      )
    })

    it('should add movies to library with proper configuration', async () => {
      const movieData = {
        title: 'Test Movie',
        year: 2023,
        tmdbId: 12345,
        qualityProfileId: 1,
        rootFolderPath: '/movies',
        monitored: true,
        addOptions: {
          searchForMovie: true,
        },
      }

      const mockAddResponse = {
        id: 1,
        title: 'Test Movie',
        year: 2023,
        tmdbId: 12345,
        status: 'announced',
        monitored: true,
        hasFile: false,
      }

      mockAxiosInstance.request.mockResolvedValue({
        data: mockAddResponse,
        status: 201,
        statusText: 'Created',
        headers: { 'content-type': 'application/json' },
        config: { headers: {} },
      } as unknown as AxiosResponse)

      const correlationId = uuid()
      const addedMovie = await client.addMovie(movieData, correlationId)

      expect(addedMovie).toMatchObject({
        id: 1,
        title: 'Test Movie',
        year: 2023,
        monitored: true,
      })

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/api/v3/movie',
          data: movieData,
        }),
      )
    })
  })

  describe('Quality and Configuration Management', () => {
    it('should retrieve quality profiles and root folders', async () => {
      const mockQualityProfiles = [
        { id: 1, name: 'HD - 1080p', upgradeAllowed: true, cutoff: 7 },
        { id: 2, name: '4K - 2160p', upgradeAllowed: true, cutoff: 10 },
      ]

      const mockRootFolders = [
        { id: 1, path: '/movies', accessible: true, freeSpace: 1000000000000 },
        {
          id: 2,
          path: '/movies-4k',
          accessible: true,
          freeSpace: 500000000000,
        },
      ]

      mockAxiosInstance.request
        .mockResolvedValueOnce({
          data: mockQualityProfiles,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          config: { headers: {} },
        } as unknown as AxiosResponse)
        .mockResolvedValueOnce({
          data: mockRootFolders,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          config: { headers: {} },
        } as unknown as AxiosResponse)

      const correlationId = uuid()
      const [profiles, folders] = await Promise.all([
        client.getQualityProfiles(correlationId),
        client.getRootFolders(correlationId),
      ])

      expect(profiles).toHaveLength(2)
      expect(profiles[0]).toMatchObject({ id: 1, name: 'HD - 1080p' })

      expect(folders).toHaveLength(2)
      expect(folders[0]).toMatchObject({
        id: 1,
        path: '/movies',
        accessible: true,
      })
    })
  })

  describe('Download Management', () => {
    it('should manage download queue and history', async () => {
      const mockQueue = [
        {
          id: 1,
          title: 'Test Movie',
          size: 1073741824,
          sizeleft: 536870912,
          status: 'downloading',
          trackedDownloadStatus: 'ok',
          downloadId: 'download123',
          progress: 50.0,
        },
      ]

      mockAxiosInstance.request.mockResolvedValue({
        data: { records: mockQueue },
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        config: { headers: {} },
      } as unknown as AxiosResponse)

      const correlationId = uuid()
      const queueItems = await client.getQueue(correlationId)

      expect(queueItems).toHaveLength(1)
      expect(queueItems[0]).toMatchObject({
        id: 1,
        title: 'Test Movie',
        status: 'downloading',
        progress: 50.0,
      })
    })
  })

  describe('System Status and Health', () => {
    it('should check system status and perform health checks', async () => {
      const mockSystemStatus = {
        version: '4.7.5.7809',
        buildTime: '2023-08-15T10:30:00Z',
        isDebug: false,
        isProduction: true,
        isAdmin: true,
        isUserInteractive: false,
        startupPath: '/app/radarr',
        appData: '/config',
        osName: 'Ubuntu',
        osVersion: '20.04',
        isDocker: true,
      }

      // Mock health check - empty array means healthy (no errors)
      mockAxiosInstance.request.mockResolvedValue({
        data: [], // Empty health response means no errors
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        config: { headers: {} },
      } as unknown as AxiosResponse)

      const healthResult = await client.checkHealth(uuid())

      expect(healthResult).toMatchObject({
        isHealthy: true,
        responseTime: expect.any(Number),
        lastChecked: expect.any(Date),
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle Radarr-specific errors correctly', async () => {
      const correlationId = uuid()

      // Test authentication error
      const authError = {
        response: { status: 401, data: { message: 'Unauthorized' } },
      } as AxiosError
      mockAxiosInstance.get.mockRejectedValue(authError)

      await expect(client.getQualityProfiles(correlationId)).rejects.toThrow(
        MediaAuthenticationError,
      )

      // Test not found error
      const notFoundError = {
        response: { status: 404, data: { message: 'Movie not found' } },
      } as AxiosError
      mockAxiosInstance.get.mockRejectedValue(notFoundError)

      await expect(client.getMovie(999, correlationId)).rejects.toThrow(
        MediaNotFoundApiError,
      )
    })
  })
})
