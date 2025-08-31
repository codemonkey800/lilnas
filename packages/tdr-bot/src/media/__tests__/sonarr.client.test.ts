import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { RetryConfigService } from 'src/config/retry.config'
import { SonarrClient } from 'src/media/clients/sonarr.client'
import {
  AddSeriesRequest,
  SonarrImageType,
  SonarrMonitorType,
  SonarrQualityProfile,
  SonarrRootFolder,
  SonarrSeriesResource,
  SonarrSeriesStatus,
  SonarrSeriesType,
  SonarrSystemStatus,
} from 'src/media/types/sonarr.types'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Mock the env utility
jest.mock('@lilnas/utils/env', () => ({
  env: jest.fn((key: string) => {
    if (key === 'SONARR_URL') return 'http://localhost:8989'
    if (key === 'SONARR_API_KEY') return 'test-api-key'
    return undefined
  }),
}))

// Mock the base client methods
const mockGet = jest.fn()
const mockPost = jest.fn()
const mockDelete = jest.fn()

jest.mock('src/media/clients/base-media-api.client', () => ({
  BaseMediaApiClient: class {
    protected logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() }
    protected get = mockGet
    protected post = mockPost
    protected delete = mockDelete
  },
}))

describe('SonarrClient', () => {
  let client: SonarrClient
  let mockRetryService: jest.Mocked<RetryService>
  let mockErrorClassifier: jest.Mocked<ErrorClassificationService>
  let mockRetryConfigService: jest.Mocked<RetryConfigService>

  // Simplified test data factories
  const createMockSeriesResource = (
    overrides: Partial<SonarrSeriesResource> = {},
  ): SonarrSeriesResource => ({
    tvdbId: 123456,
    tmdbId: 789012,
    imdbId: 'tt1234567',
    title: 'Test Series',
    sortTitle: 'test series',
    year: 2023,
    overview: 'A test TV series overview',
    runtime: 45,
    genres: ['Drama', 'Action'],
    status: SonarrSeriesStatus.CONTINUING,
    ended: false,
    seriesType: SonarrSeriesType.STANDARD,
    network: 'Test Network',
    seasonFolder: true,
    useSceneNumbering: false,
    seasons: [
      { seasonNumber: 1, monitored: true },
      { seasonNumber: 2, monitored: true },
    ],
    images: [
      {
        coverType: SonarrImageType.POSTER,
        url: 'https://example.com/poster.jpg',
      },
      {
        coverType: SonarrImageType.FANART,
        url: 'https://example.com/fanart.jpg',
      },
    ],
    firstAired: '2023-01-01T00:00:00Z',
    lastAired: '2023-12-31T00:00:00Z',
    certification: 'TV-14',
    cleanTitle: 'testseries',
    titleSlug: 'test-series',
    ratings: {
      imdb: { value: 8.5, votes: 10000, type: 'user' },
    },
    ...overrides,
  })

  const createMockSystemStatus = (
    overrides: Partial<SonarrSystemStatus> = {},
  ): SonarrSystemStatus => ({
    appName: 'Sonarr',
    version: '4.0.0.0',
    buildTime: '2023-01-01T00:00:00Z',
    isDebug: false,
    isProduction: true,
    isAdmin: true,
    isUserInteractive: false,
    startupPath: '/app',
    appData: '/config',
    osName: 'Linux',
    osVersion: '5.4.0',
    isMonoRuntime: false,
    isMono: false,
    isLinux: true,
    isOsx: false,
    isWindows: false,
    branch: 'master',
    authentication: 'none',
    sqliteVersion: '3.36.0',
    urlBase: '',
    runtimeVersion: '6.0.0',
    runtimeName: '.NET',
    migrationVersion: 200,
    startTime: '2023-01-01T00:00:00Z',
    ...overrides,
  })

  const createMockQualityProfile = (
    overrides: Partial<SonarrQualityProfile> = {},
  ): SonarrQualityProfile => ({
    id: 1,
    name: 'HD-1080p',
    upgradeAllowed: true,
    cutoff: 4,
    items: [],
    minFormatScore: 0,
    cutoffFormatScore: 0,
    formatItems: [],
    language: { id: 1, name: 'English' },
    ...overrides,
  })

  const createMockRootFolder = (
    overrides: Partial<SonarrRootFolder> = {},
  ): SonarrRootFolder => ({
    id: 1,
    path: '/tv',
    accessible: true,
    freeSpace: 1000000000,
    totalSpace: 2000000000,
    unmappedFolders: [],
    ...overrides,
  })

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks()
    mockGet.mockReset()
    mockPost.mockReset()
    mockDelete.mockReset()

    // Create mocked services
    mockRetryService = {
      execute: jest.fn().mockImplementation(async fn => fn()),
    } as unknown as jest.Mocked<RetryService>

    mockErrorClassifier = {
      classifyError: jest.fn().mockReturnValue({ isRetriable: true }),
    } as unknown as jest.Mocked<ErrorClassificationService>

    mockRetryConfigService = {
      getSonarrConfig: jest.fn().mockReturnValue({
        maxRetries: 3,
        baseDelay: 1000,
      }),
    } as unknown as jest.Mocked<RetryConfigService>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SonarrClient,
        { provide: RetryService, useValue: mockRetryService },
        { provide: ErrorClassificationService, useValue: mockErrorClassifier },
        { provide: RetryConfigService, useValue: mockRetryConfigService },
      ],
    }).compile()

    client = module.get<SonarrClient>(SonarrClient)

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  describe('constructor', () => {
    it.each([
      ['http://localhost:8989', 'http://localhost:8989/api/v3'],
      ['http://localhost:8989/', 'http://localhost:8989/api/v3'],
      ['http://localhost:8989/api/v3', 'http://localhost:8989/api/v3'],
    ])('should correctly format base URL from %s to %s', (input, expected) => {
      const { env: envMock } = jest.requireMock('@lilnas/utils/env') as {
        env: jest.Mock
      }
      envMock.mockReturnValueOnce(input)

      const newClient = new SonarrClient(
        mockRetryService,
        mockErrorClassifier,
        mockRetryConfigService,
      )
      expect(newClient['baseUrl']).toBe(expected)
    })

    it('should initialize with correct API key', () => {
      expect(client['apiKey']).toBe('test-api-key')
    })
  })

  describe('searchSeries', () => {
    it('should search series successfully', async () => {
      const mockSeries = [createMockSeriesResource()]
      mockGet.mockResolvedValue(mockSeries)

      const result = await client.searchSeries('test series')

      expect(mockGet).toHaveBeenCalledWith('/series/lookup?term=test+series')
      expect(result).toEqual(mockSeries)
    })

    it('should throw error for empty query', async () => {
      await expect(client.searchSeries('')).rejects.toThrow(
        'Search query is required',
      )
      await expect(client.searchSeries('   ')).rejects.toThrow(
        'Search query is required',
      )
    })

    it('should throw error for query less than 2 characters', async () => {
      await expect(client.searchSeries('a')).rejects.toThrow(
        'Search query must be at least 2 characters',
      )
    })

    it('should trim query whitespace', async () => {
      const mockSeries = [createMockSeriesResource()]
      mockGet.mockResolvedValue(mockSeries)

      await client.searchSeries('  test series  ')

      expect(mockGet).toHaveBeenCalledWith('/series/lookup?term=test+series')
    })

    it('should handle API errors', async () => {
      const error = new Error('API Error')
      mockGet.mockRejectedValue(error)

      await expect(client.searchSeries('test')).rejects.toThrow('API Error')
    })

    it('should handle special characters in query', async () => {
      const mockSeries = [createMockSeriesResource()]
      mockGet.mockResolvedValue(mockSeries)

      await client.searchSeries('test & series: season 1')

      expect(mockGet).toHaveBeenCalledWith(
        '/series/lookup?term=test+%26+series%3A+season+1',
      )
    })
  })

  describe('getSystemStatus', () => {
    it('should get system status successfully', async () => {
      const mockStatus = createMockSystemStatus()
      mockGet.mockResolvedValue(mockStatus)

      const result = await client.getSystemStatus()

      expect(mockGet).toHaveBeenCalledWith('/system/status')
      expect(result).toEqual(mockStatus)
    })

    it('should handle system status API errors', async () => {
      const error = new Error('System unavailable')
      mockGet.mockRejectedValue(error)

      await expect(client.getSystemStatus()).rejects.toThrow(
        'System unavailable',
      )
    })
  })

  describe('checkHealth', () => {
    it('should return true when system status is accessible', async () => {
      const mockStatus = createMockSystemStatus()
      mockGet.mockResolvedValue(mockStatus)

      const result = await client.checkHealth()

      expect(result).toBe(true)
    })

    it('should return false when system status fails', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'))

      const result = await client.checkHealth()

      expect(result).toBe(false)
    })
  })

  describe('getQualityProfiles', () => {
    it('should get quality profiles successfully', async () => {
      const mockProfiles = [
        createMockQualityProfile({ id: 1, name: 'HD-1080p' }),
        createMockQualityProfile({ id: 2, name: '4K' }),
      ]
      mockGet.mockResolvedValue(mockProfiles)

      const result = await client.getQualityProfiles()

      expect(mockGet).toHaveBeenCalledWith('/qualityprofile')
      expect(result).toEqual(mockProfiles)
    })

    it('should handle quality profiles API errors', async () => {
      mockGet.mockRejectedValue(new Error('Profiles not found'))

      await expect(client.getQualityProfiles()).rejects.toThrow(
        'Profiles not found',
      )
    })
  })

  describe('getRootFolders', () => {
    it('should get root folders successfully', async () => {
      const mockFolders = [
        createMockRootFolder({ id: 1, path: '/tv' }),
        createMockRootFolder({ id: 2, path: '/tv2', accessible: false }),
      ]
      mockGet.mockResolvedValue(mockFolders)

      const result = await client.getRootFolders()

      expect(mockGet).toHaveBeenCalledWith('/rootfolder')
      expect(result).toEqual(mockFolders)
    })

    it('should handle root folders API errors', async () => {
      mockGet.mockRejectedValue(new Error('Folders not found'))

      await expect(client.getRootFolders()).rejects.toThrow('Folders not found')
    })
  })

  describe('getRetryConfig', () => {
    it('should get retry configuration', () => {
      const result = client['getRetryConfig']()

      expect(mockRetryConfigService.getSonarrConfig).toHaveBeenCalled()
      expect(result).toEqual({ maxRetries: 3, baseDelay: 1000 })
    })
  })

  describe('error handling and logging', () => {
    it('should handle and re-throw errors appropriately', async () => {
      const error = new Error('Test error')
      mockGet.mockRejectedValue(error)

      await expect(client.searchSeries('test')).rejects.toThrow('Test error')
    })

    it('should log search requests and responses', async () => {
      const mockSeries = [createMockSeriesResource()]
      mockGet.mockResolvedValue(mockSeries)

      await client.searchSeries('test series')

      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'test series' }),
        'Searching series via Sonarr API',
      )
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'test series',
          resultCount: 1,
        }),
        'Series search completed successfully',
      )
    })

    it('should log errors during search', async () => {
      const error = new Error('Search failed')
      mockGet.mockRejectedValue(error)

      try {
        await client.searchSeries('test')
      } catch {
        // Expected to throw
      }

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'test',
          error: 'Search failed',
        }),
        'Failed to search series',
      )
    })
  })

  describe('addSeries', () => {
    it('should add series successfully', async () => {
      const mockRequest = {
        tvdbId: 123456,
        title: 'Test Series',
        titleSlug: 'test-series',
        qualityProfileId: 1,
        rootFolderPath: '/tv',
        monitored: true,
        monitor: SonarrMonitorType.ALL,
        seasonFolder: true,
        useSceneNumbering: false,
        seriesType: SonarrSeriesType.STANDARD,
        searchForMissingEpisodes: true,
        searchForCutoffUnmetEpisodes: true,
        seasons: [{ seasonNumber: 1, monitored: true }],
      }
      const mockSeries = createMockSeriesResource({
        id: 1,
        tvdbId: 123456,
        title: 'Test Series',
      })
      mockPost.mockResolvedValue(mockSeries)

      const result = await client.addSeries(mockRequest)

      expect(mockPost).toHaveBeenCalledWith('/series', mockRequest)
      expect(result).toEqual(mockSeries)
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ tvdbId: 123456, title: 'Test Series' }),
        'Adding series to Sonarr',
      )
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ seriesId: 1, title: 'Test Series' }),
        'Series added successfully',
      )
    })

    it('should handle series addition errors', async () => {
      const mockRequest = {
        tvdbId: 123456,
        title: 'Test Series',
        titleSlug: 'test-series',
        qualityProfileId: 1,
        rootFolderPath: '/tv',
        monitored: true,
        monitor: SonarrMonitorType.ALL,
        seasonFolder: true,
        useSceneNumbering: false,
        seriesType: SonarrSeriesType.STANDARD,
        searchForMissingEpisodes: true,
        searchForCutoffUnmetEpisodes: true,
      }
      const error = new Error('Series already exists')
      mockPost.mockRejectedValue(error)

      await expect(client.addSeries(mockRequest)).rejects.toThrow(
        'Series already exists',
      )

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          tvdbId: 123456,
          title: 'Test Series',
          error: 'Series already exists',
        }),
        'Failed to add series',
      )
    })

    it('should handle missing required fields', async () => {
      const incompleteRequest = {
        tvdbId: 123456,
        // Missing required fields
      }

      const error = new Error('Missing required field: title')
      mockPost.mockRejectedValue(error)

      await expect(
        client.addSeries(incompleteRequest as AddSeriesRequest),
      ).rejects.toThrow('Missing required field: title')
    })
  })

  describe('updateSeries', () => {
    it('should update series successfully', async () => {
      const existingSeries = createMockSeriesResource({
        id: 1,
        title: 'Existing Series',
        monitored: false,
      })
      const updatedSeries = createMockSeriesResource({
        id: 1,
        title: 'Updated Series',
        monitored: true,
      })
      const updates = {
        monitored: true,
        seasons: [{ seasonNumber: 1, monitored: true }],
      }

      // Mock the get call for getSeriesById
      mockGet.mockResolvedValueOnce(existingSeries)

      // Mock put method for BaseMediaApiClient
      const mockPut = jest.fn().mockResolvedValue(updatedSeries)
      ;(client as unknown as { put: jest.Mock }).put = mockPut

      const result = await client.updateSeries(1, updates)

      expect(mockGet).toHaveBeenCalledWith('/series/1')
      expect(mockPut).toHaveBeenCalledWith('/series/1', {
        ...existingSeries,
        ...updates,
        id: 1,
      })
      expect(result).toEqual(updatedSeries)
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ seriesId: 1 }),
        'Updating series in Sonarr',
      )
    })

    it('should handle series not found error', async () => {
      // Mock getSeriesById to return null (series not found)
      const error = new Error('Series not found')
      mockGet.mockRejectedValueOnce(error)

      const updates = { monitored: true }

      await expect(client.updateSeries(999, updates)).rejects.toThrow(
        'Series with ID 999 not found',
      )

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 999,
          error: 'Series with ID 999 not found',
        }),
        'Failed to update series',
      )
    })

    it('should handle API update errors', async () => {
      const existingSeries = createMockSeriesResource({ id: 1 })
      mockGet.mockResolvedValueOnce(existingSeries)

      const mockPut = jest.fn().mockRejectedValue(new Error('API error'))
      ;(client as unknown as { put: jest.Mock }).put = mockPut

      const updates = { monitored: true }

      await expect(client.updateSeries(1, updates)).rejects.toThrow('API error')

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 1,
          error: 'API error',
        }),
        'Failed to update series',
      )
    })

    it('should handle partial updates', async () => {
      const existingSeries = createMockSeriesResource({
        id: 1,
        monitored: true,
        title: 'Original Title',
      })
      const updatedSeries = createMockSeriesResource({
        id: 1,
        monitored: false,
        title: 'Original Title',
      })

      mockGet.mockResolvedValueOnce(existingSeries)

      const mockPut = jest.fn().mockResolvedValue(updatedSeries)
      ;(client as unknown as { put: jest.Mock }).put = mockPut

      const partialUpdates = { monitored: false }

      const result = await client.updateSeries(1, partialUpdates)

      expect(mockPut).toHaveBeenCalledWith('/series/1', {
        ...existingSeries,
        monitored: false,
        id: 1,
      })
      expect(result).toEqual(updatedSeries)
    })
  })

  describe('getSeriesByTvdbId', () => {
    it('should find existing series by TVDB ID', async () => {
      const mockSeries = [
        createMockSeriesResource({ tvdbId: 123456, title: 'Series 1' }),
        createMockSeriesResource({ tvdbId: 789012, title: 'Series 2' }),
        createMockSeriesResource({ tvdbId: 345678, title: 'Series 3' }),
      ]
      mockGet.mockResolvedValue(mockSeries)

      const result = await client.getSeriesByTvdbId(789012)

      expect(mockGet).toHaveBeenCalledWith('/series')
      expect(result).toEqual(mockSeries[1]) // Found series
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ tvdbId: 789012, found: true }),
        'Series found in library',
      )
    })

    it('should return null when series not found', async () => {
      const mockSeries = [
        createMockSeriesResource({ tvdbId: 123456, title: 'Series 1' }),
        createMockSeriesResource({ tvdbId: 789012, title: 'Series 2' }),
      ]
      mockGet.mockResolvedValue(mockSeries)

      const result = await client.getSeriesByTvdbId(999999)

      expect(mockGet).toHaveBeenCalledWith('/series')
      expect(result).toBeNull()
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ tvdbId: 999999, found: false }),
        'Series not found in library',
      )
    })

    it('should handle empty library', async () => {
      mockGet.mockResolvedValue([])

      const result = await client.getSeriesByTvdbId(123456)

      expect(result).toBeNull()
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ tvdbId: 123456, found: false }),
        'Series not found in library',
      )
    })

    it('should handle API errors during lookup', async () => {
      const error = new Error('Database connection failed')
      mockGet.mockRejectedValue(error)

      await expect(client.getSeriesByTvdbId(123456)).rejects.toThrow(
        'Database connection failed',
      )

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          tvdbId: 123456,
          error: 'Database connection failed',
        }),
        'Failed to check if series exists',
      )
    })
  })

  describe('getEpisodes', () => {
    it('should get all episodes for a series', async () => {
      const mockEpisodes = [
        {
          id: 1,
          seriesId: 1,
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'Episode 1',
        },
        {
          id: 2,
          seriesId: 1,
          seasonNumber: 1,
          episodeNumber: 2,
          title: 'Episode 2',
        },
        {
          id: 3,
          seriesId: 1,
          seasonNumber: 2,
          episodeNumber: 1,
          title: 'Episode 3',
        },
      ]
      mockGet.mockResolvedValue(mockEpisodes)

      const result = await client.getEpisodes(1)

      expect(mockGet).toHaveBeenCalledWith('/episode?seriesId=1')
      expect(result).toEqual(mockEpisodes)
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 1,
          seasonNumber: undefined,
          episodeCount: 3,
        }),
        'Episodes retrieved successfully',
      )
    })

    it('should get episodes for specific season', async () => {
      const mockEpisodes = [
        {
          id: 1,
          seriesId: 1,
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'Episode 1',
        },
        {
          id: 2,
          seriesId: 1,
          seasonNumber: 1,
          episodeNumber: 2,
          title: 'Episode 2',
        },
      ]
      mockGet.mockResolvedValue(mockEpisodes)

      const result = await client.getEpisodes(1, 1)

      expect(mockGet).toHaveBeenCalledWith('/episode?seriesId=1&seasonNumber=1')
      expect(result).toEqual(mockEpisodes)
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 1,
          seasonNumber: 1,
          episodeCount: 2,
        }),
        'Episodes retrieved successfully',
      )
    })

    it('should handle empty episode list', async () => {
      mockGet.mockResolvedValue([])

      const result = await client.getEpisodes(1, 1)

      expect(result).toEqual([])
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 1,
          seasonNumber: 1,
          episodeCount: 0,
        }),
        'Episodes retrieved successfully',
      )
    })

    it('should handle API errors', async () => {
      const error = new Error('Season not found')
      mockGet.mockRejectedValue(error)

      await expect(client.getEpisodes(1, 999)).rejects.toThrow(
        'Season not found',
      )

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 1,
          seasonNumber: 999,
          error: 'Season not found',
        }),
        'Failed to get episodes',
      )
    })
  })

  describe('updateEpisode', () => {
    it('should update single episode successfully', async () => {
      const mockEpisode = { id: 1, monitored: true, hasFile: false }
      const mockPut = jest.fn().mockResolvedValue(mockEpisode)
      ;(client as unknown as { put: jest.Mock }).put = mockPut

      const updates = { monitored: true }

      const result = await client.updateEpisode(1, updates)

      expect(mockPut).toHaveBeenCalledWith('/episode/1', { id: 1, ...updates })
      expect(result).toEqual(mockEpisode)
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ episodeId: 1, monitored: true }),
        'Updating episode',
      )
    })

    it('should handle episode update errors', async () => {
      const mockPut = jest
        .fn()
        .mockRejectedValue(new Error('Episode not found'))
      ;(client as unknown as { put: jest.Mock }).put = mockPut

      const updates = { monitored: false }

      await expect(client.updateEpisode(999, updates)).rejects.toThrow(
        'Episode not found',
      )

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          episodeId: 999,
          error: 'Episode not found',
        }),
        'Failed to update episode',
      )
    })
  })

  describe('updateEpisodeBulk', () => {
    it('should bulk update episodes successfully', async () => {
      const mockPut = jest.fn().mockResolvedValue(undefined)
      ;(client as unknown as { put: jest.Mock }).put = mockPut

      const request = { episodeIds: [1, 2, 3], monitored: true }

      await client.updateEpisodeBulk(request)

      expect(mockPut).toHaveBeenCalledWith('/episode/bulk', request)
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ episodeCount: 3, monitored: true }),
        'Episodes bulk updated successfully',
      )
    })

    it('should handle bulk update errors', async () => {
      const mockPut = jest
        .fn()
        .mockRejectedValue(new Error('Bulk update failed'))
      ;(client as unknown as { put: jest.Mock }).put = mockPut

      const request = { episodeIds: [1, 2], monitored: false }

      await expect(client.updateEpisodeBulk(request)).rejects.toThrow(
        'Bulk update failed',
      )

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          episodeCount: 2,
          error: 'Bulk update failed',
        }),
        'Failed to bulk update episodes',
      )
    })

    it('should handle empty episode list', async () => {
      const mockPut = jest.fn().mockResolvedValue(undefined)
      ;(client as unknown as { put: jest.Mock }).put = mockPut

      const request = { episodeIds: [], monitored: true }

      await client.updateEpisodeBulk(request)

      expect(mockPut).toHaveBeenCalledWith('/episode/bulk', request)
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ episodeCount: 0 }),
        'Episodes bulk updated successfully',
      )
    })
  })

  describe('updateEpisodesMonitoring', () => {
    it('should update episode monitoring successfully', async () => {
      const mockPut = jest.fn().mockResolvedValue(undefined)
      ;(client as unknown as { put: jest.Mock }).put = mockPut

      const request = { episodeIds: [1, 2, 3, 4], monitored: true }

      await client.updateEpisodesMonitoring(request)

      expect(mockPut).toHaveBeenCalledWith('/episode/monitor', request)
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ episodeCount: 4, monitored: true }),
        'Episode monitoring bulk updated successfully',
      )
    })

    it('should handle monitoring update errors', async () => {
      const mockPut = jest
        .fn()
        .mockRejectedValue(new Error('Monitoring update failed'))
      ;(client as unknown as { put: jest.Mock }).put = mockPut

      const request = { episodeIds: [1, 2], monitored: false }

      await expect(client.updateEpisodesMonitoring(request)).rejects.toThrow(
        'Monitoring update failed',
      )

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          episodeCount: 2,
          error: 'Monitoring update failed',
        }),
        'Failed to bulk update episode monitoring',
      )
    })

    it('should handle large batch monitoring updates', async () => {
      const mockPut = jest.fn().mockResolvedValue(undefined)
      ;(client as unknown as { put: jest.Mock }).put = mockPut

      const largeEpisodeList = Array.from({ length: 100 }, (_, i) => i + 1)
      const request = { episodeIds: largeEpisodeList, monitored: true }

      await client.updateEpisodesMonitoring(request)

      expect(mockPut).toHaveBeenCalledWith('/episode/monitor', request)
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ episodeCount: 100 }),
        'Episode monitoring bulk updated successfully',
      )
    })
  })

  describe('triggerSeriesSearch', () => {
    it('should trigger series search successfully', async () => {
      const mockCommand = { id: 123, name: 'SeriesSearch', status: 'queued' }
      mockPost.mockResolvedValue(mockCommand)

      const result = await client.triggerSeriesSearch(1)

      expect(mockPost).toHaveBeenCalledWith('/command', {
        name: 'SeriesSearch',
        seriesId: 1,
      })
      expect(result).toEqual(mockCommand)
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ seriesId: 1, commandId: 123 }),
        'Series search triggered successfully',
      )
    })

    it('should handle search trigger errors', async () => {
      const error = new Error('Search queue full')
      mockPost.mockRejectedValue(error)

      await expect(client.triggerSeriesSearch(1)).rejects.toThrow(
        'Search queue full',
      )

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 1,
          error: 'Search queue full',
        }),
        'Failed to trigger series search',
      )
    })

    it('should handle invalid series ID', async () => {
      const error = new Error('Series not found')
      mockPost.mockRejectedValue(error)

      await expect(client.triggerSeriesSearch(999)).rejects.toThrow(
        'Series not found',
      )

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 999,
          error: 'Series not found',
        }),
        'Failed to trigger series search',
      )
    })
  })

  describe('getEpisodeFiles', () => {
    it('should get episode files for a series', async () => {
      const mockEpisodeFiles = [
        {
          id: 1,
          seriesId: 1,
          seasonNumber: 1,
          relativePath: 'Season 01/S01E01.mkv',
          path: '/tv/test-series/Season 01/S01E01.mkv',
          size: 1000000000,
          dateAdded: '2023-01-01T00:00:00Z',
          quality: {
            quality: {
              id: 1,
              name: 'HDTV-720p',
              source: 'television',
              resolution: 720,
            },
            revision: { version: 1, real: 0, isRepack: false },
          },
          languages: [{ id: 1, name: 'English' }],
        },
      ]
      mockGet.mockResolvedValue(mockEpisodeFiles)

      const result = await client.getEpisodeFiles({ seriesId: 1 })

      expect(mockGet).toHaveBeenCalledWith('/episodefile?seriesId=1')
      expect(result).toEqual(mockEpisodeFiles)
    })

    it('should get episode files with season filter', async () => {
      const mockEpisodeFiles = [
        {
          id: 1,
          seriesId: 1,
          seasonNumber: 1,
          relativePath: 'Season 01/S01E01.mkv',
          path: '/tv/test-series/Season 01/S01E01.mkv',
          size: 1000000000,
          dateAdded: '2023-01-01T00:00:00Z',
          quality: {
            quality: {
              id: 1,
              name: 'HDTV-720p',
              source: 'television',
              resolution: 720,
            },
            revision: { version: 1, real: 0, isRepack: false },
          },
          languages: [{ id: 1, name: 'English' }],
        },
        {
          id: 2,
          seriesId: 1,
          seasonNumber: 2,
          relativePath: 'Season 02/S02E01.mkv',
          path: '/tv/test-series/Season 02/S02E01.mkv',
          size: 1000000000,
          dateAdded: '2023-01-01T00:00:00Z',
          quality: {
            quality: {
              id: 1,
              name: 'HDTV-720p',
              source: 'television',
              resolution: 720,
            },
            revision: { version: 1, real: 0, isRepack: false },
          },
          languages: [{ id: 1, name: 'English' }],
        },
      ]
      mockGet.mockResolvedValue(mockEpisodeFiles)

      const result = await client.getEpisodeFiles({
        seriesId: 1,
        seasonNumber: 1,
      })

      expect(mockGet).toHaveBeenCalledWith('/episodefile?seriesId=1')
      expect(result).toHaveLength(1)
      expect(result[0].seasonNumber).toBe(1)
    })

    it('should get episode files by episode file IDs', async () => {
      const mockEpisodeFiles = [
        {
          id: 1,
          seriesId: 1,
          seasonNumber: 1,
          relativePath: 'Season 01/S01E01.mkv',
          path: '/tv/test-series/Season 01/S01E01.mkv',
          size: 1000000000,
          dateAdded: '2023-01-01T00:00:00Z',
          quality: {
            quality: {
              id: 1,
              name: 'HDTV-720p',
              source: 'television',
              resolution: 720,
            },
            revision: { version: 1, real: 0, isRepack: false },
          },
          languages: [{ id: 1, name: 'English' }],
        },
      ]
      mockGet.mockResolvedValue(mockEpisodeFiles)

      const result = await client.getEpisodeFiles({ episodeFileIds: [1, 2] })

      expect(mockGet).toHaveBeenCalledWith(
        '/episodefile?episodeFileIds=1&episodeFileIds=2',
      )
      expect(result).toEqual(mockEpisodeFiles)
    })

    it('should get all episode files when no options provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockEpisodeFiles: any[] = []
      mockGet.mockResolvedValue(mockEpisodeFiles)

      const result = await client.getEpisodeFiles()

      expect(mockGet).toHaveBeenCalledWith('/episodefile')
      expect(result).toEqual(mockEpisodeFiles)
    })

    it('should handle episode files API errors', async () => {
      const error = new Error('Episode files not found')
      mockGet.mockRejectedValue(error)

      await expect(client.getEpisodeFiles({ seriesId: 999 })).rejects.toThrow(
        'Episode files not found',
      )
    })

    it('should filter by season number correctly', async () => {
      const mockEpisodeFiles = [
        {
          id: 1,
          seriesId: 1,
          seasonNumber: 1,
          relativePath: 'Season 01/S01E01.mkv',
          path: '/tv/test-series/Season 01/S01E01.mkv',
          size: 1000000000,
          dateAdded: '2023-01-01T00:00:00Z',
          quality: {
            quality: {
              id: 1,
              name: 'HDTV-720p',
              source: 'television',
              resolution: 720,
            },
            revision: { version: 1, real: 0, isRepack: false },
          },
          languages: [{ id: 1, name: 'English' }],
        },
        {
          id: 2,
          seriesId: 1,
          seasonNumber: 2,
          relativePath: 'Season 02/S02E01.mkv',
          path: '/tv/test-series/Season 02/S02E01.mkv',
          size: 1000000000,
          dateAdded: '2023-01-01T00:00:00Z',
          quality: {
            quality: {
              id: 1,
              name: 'HDTV-720p',
              source: 'television',
              resolution: 720,
            },
            revision: { version: 1, real: 0, isRepack: false },
          },
          languages: [{ id: 1, name: 'English' }],
        },
      ]
      mockGet.mockResolvedValue(mockEpisodeFiles)

      const result = await client.getEpisodeFiles({
        seriesId: 1,
        seasonNumber: 2,
      })

      expect(result).toHaveLength(1)
      expect(result[0].seasonNumber).toBe(2)
    })

    it('should handle empty episode files response', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const emptyFiles: any[] = []
      mockGet.mockResolvedValue(emptyFiles)

      const result = await client.getEpisodeFiles({ seriesId: 1 })

      expect(result).toEqual(emptyFiles)
    })
  })

  describe('deleteEpisodeFile', () => {
    it('should delete episode file successfully', async () => {
      mockDelete.mockResolvedValue(undefined)

      await client.deleteEpisodeFile(1)

      expect(mockDelete).toHaveBeenCalledWith('/episodefile/1')
    })

    it('should handle episode file deletion errors', async () => {
      const error = new Error('Episode file not found')
      mockDelete.mockRejectedValue(error)

      await expect(client.deleteEpisodeFile(999)).rejects.toThrow(
        'Episode file not found',
      )
    })

    it('should log episode file deletion', async () => {
      mockDelete.mockResolvedValue(undefined)

      await client.deleteEpisodeFile(123)

      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ episodeFileId: 123 }),
        'Deleting episode file from Sonarr',
      )
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ episodeFileId: 123 }),
        'Episode file deleted successfully',
      )
    })

    it('should log episode file deletion errors', async () => {
      const error = new Error('File deletion failed')
      mockDelete.mockRejectedValue(error)

      try {
        await client.deleteEpisodeFile(123)
      } catch {
        // Expected to throw
      }

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          episodeFileId: 123,
          error: 'File deletion failed',
        }),
        'Failed to delete episode file',
      )
    })
  })

  describe('getSeriesById', () => {
    it('should get series by ID successfully', async () => {
      const mockSeries = createMockSeriesResource({
        id: 1,
        title: 'Test Series',
      })
      mockGet.mockResolvedValue(mockSeries)

      const result = await client.getSeriesById(1)

      expect(mockGet).toHaveBeenCalledWith('/series/1')
      expect(result).toEqual(mockSeries)
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ seriesId: 1 }),
        'Getting series by ID from Sonarr',
      )
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ seriesId: 1, title: 'Test Series' }),
        'Series retrieved successfully',
      )
    })

    it('should return null when series not found', async () => {
      const error = new Error('Series not found')
      mockGet.mockRejectedValue(error)

      const result = await client.getSeriesById(999)

      expect(result).toBeNull()
      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 999,
          error: 'Series not found',
        }),
        'Failed to get series by ID',
      )
    })

    it('should handle API errors gracefully', async () => {
      const error = new Error('Database connection failed')
      mockGet.mockRejectedValue(error)

      const result = await client.getSeriesById(1)

      expect(result).toBeNull()
    })
  })

  describe('getLibrarySeries', () => {
    it('should get all series from library successfully', async () => {
      const mockSeries = [
        createMockSeriesResource({ id: 1, title: 'Series 1' }),
        createMockSeriesResource({ id: 2, title: 'Series 2' }),
      ]
      mockGet.mockResolvedValue(mockSeries)

      const result = await client.getLibrarySeries()

      expect(mockGet).toHaveBeenCalledWith('/series')
      expect(result).toEqual(mockSeries)
      expect(client['logger'].log).toHaveBeenCalledWith(
        'Getting all series from Sonarr library',
      )
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ seriesCount: 2 }),
        'Successfully retrieved all library series',
      )
    })

    it('should handle empty library', async () => {
      mockGet.mockResolvedValue([])

      const result = await client.getLibrarySeries()

      expect(result).toEqual([])
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ seriesCount: 0 }),
        'Successfully retrieved all library series',
      )
    })

    it('should handle API errors', async () => {
      const error = new Error('Library access failed')
      mockGet.mockRejectedValue(error)

      await expect(client.getLibrarySeries()).rejects.toThrow(
        'Library access failed',
      )

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Library access failed',
        }),
        'Failed to get library series',
      )
    })
  })

  describe('getQueue', () => {
    it('should get queue items successfully', async () => {
      const mockQueueResponse = {
        records: [
          {
            id: 1,
            seriesId: 1,
            episodeId: 1,
            title: 'Test Episode S01E01',
            series: { id: 1, title: 'Test Series', tvdbId: 123456 },
            episode: {
              id: 1,
              episodeNumber: 1,
              seasonNumber: 1,
              title: 'Test Episode',
            },
            status: 'downloading',
            trackedDownloadStatus: 'downloading',
            protocol: 'torrent',
            downloadClient: 'TestClient',
            size: 1000000000,
            sizeleft: 500000000,
          },
          {
            id: 2,
            seriesId: 2,
            episodeId: 2,
            title: 'Another Episode S01E01',
            series: { id: 2, title: 'Another Series', tvdbId: 789012 },
            episode: {
              id: 2,
              episodeNumber: 1,
              seasonNumber: 1,
              title: 'Another Episode',
            },
            status: 'queued',
            trackedDownloadStatus: 'queued',
            protocol: 'usenet',
            downloadClient: 'TestClient2',
            size: 800000000,
            sizeleft: 800000000,
          },
        ],
      }
      mockGet.mockResolvedValue(mockQueueResponse)

      const result = await client.getQueue()

      expect(mockGet).toHaveBeenCalledWith('/queue')
      expect(result).toEqual(mockQueueResponse.records)
      expect(client['logger'].log).toHaveBeenCalledWith(
        'Getting Sonarr download queue',
      )
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ queueCount: 2 }),
        'Queue retrieved successfully',
      )
    })

    it('should handle empty queue response', async () => {
      mockGet.mockResolvedValue({ records: [] })

      const result = await client.getQueue()

      expect(result).toEqual([])
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ queueCount: 0 }),
        'Queue retrieved successfully',
      )
    })

    it('should handle queue response without records property', async () => {
      mockGet.mockResolvedValue({})

      const result = await client.getQueue()

      expect(result).toEqual([])
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ queueCount: 0 }),
        'Queue retrieved successfully',
      )
    })

    it('should handle queue API errors', async () => {
      const error = new Error('Queue service unavailable')
      mockGet.mockRejectedValue(error)

      await expect(client.getQueue()).rejects.toThrow(
        'Queue service unavailable',
      )

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Queue service unavailable',
        }),
        'Failed to get queue',
      )
    })
  })

  describe('removeQueueItem', () => {
    it('should remove queue item successfully', async () => {
      mockDelete.mockResolvedValue(undefined)

      await client.removeQueueItem(123)

      expect(mockDelete).toHaveBeenCalledWith('/queue/123')
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ queueId: 123 }),
        'Removing queue item',
      )
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ queueId: 123 }),
        'Queue item removed successfully',
      )
    })

    it('should handle queue item removal errors', async () => {
      const error = new Error('Queue item not found')
      mockDelete.mockRejectedValue(error)

      await expect(client.removeQueueItem(999)).rejects.toThrow(
        'Queue item not found',
      )

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          queueId: 999,
          error: 'Queue item not found',
        }),
        'Failed to remove queue item',
      )
    })

    it('should handle invalid queue item IDs', async () => {
      const error = new Error('Invalid queue item ID')
      mockDelete.mockRejectedValue(error)

      await expect(client.removeQueueItem(-1)).rejects.toThrow(
        'Invalid queue item ID',
      )

      expect(mockDelete).toHaveBeenCalledWith('/queue/-1')
    })
  })

  describe('deleteSeries', () => {
    it('should delete series with default options', async () => {
      mockDelete.mockResolvedValue(undefined)

      await client.deleteSeries(1)

      expect(mockDelete).toHaveBeenCalledWith('/series/1')
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 1,
          deleteFiles: undefined,
          addImportListExclusion: undefined,
        }),
        'Deleting series from Sonarr',
      )
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ seriesId: 1 }),
        'Series deleted successfully',
      )
    })

    it('should delete series with deleteFiles=true', async () => {
      mockDelete.mockResolvedValue(undefined)

      await client.deleteSeries(1, { deleteFiles: true })

      expect(mockDelete).toHaveBeenCalledWith('/series/1?deleteFiles=true')
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 1,
          deleteFiles: true,
          addImportListExclusion: undefined,
        }),
        'Deleting series from Sonarr',
      )
    })

    it('should delete series with addImportListExclusion=true', async () => {
      mockDelete.mockResolvedValue(undefined)

      await client.deleteSeries(1, { addImportListExclusion: true })

      expect(mockDelete).toHaveBeenCalledWith(
        '/series/1?addImportListExclusion=true',
      )
    })

    it('should delete series with both options', async () => {
      mockDelete.mockResolvedValue(undefined)

      await client.deleteSeries(1, {
        deleteFiles: false,
        addImportListExclusion: true,
      })

      expect(mockDelete).toHaveBeenCalledWith(
        '/series/1?deleteFiles=false&addImportListExclusion=true',
      )
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 1,
          deleteFiles: false,
          addImportListExclusion: true,
        }),
        'Deleting series from Sonarr',
      )
    })

    it('should handle series deletion errors', async () => {
      const error = new Error('Series deletion failed')
      mockDelete.mockRejectedValue(error)

      await expect(
        client.deleteSeries(1, { deleteFiles: true }),
      ).rejects.toThrow('Series deletion failed')

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 1,
          error: 'Series deletion failed',
        }),
        'Failed to delete series',
      )
    })

    it('should handle series not found during deletion', async () => {
      const error = new Error('Series with ID 999 not found')
      mockDelete.mockRejectedValue(error)

      await expect(client.deleteSeries(999)).rejects.toThrow(
        'Series with ID 999 not found',
      )

      expect(mockDelete).toHaveBeenCalledWith('/series/999')
    })

    it('should handle permission errors', async () => {
      const error = new Error('Insufficient permissions')
      mockDelete.mockRejectedValue(error)

      await expect(
        client.deleteSeries(1, { deleteFiles: true }),
      ).rejects.toThrow('Insufficient permissions')

      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Insufficient permissions',
        }),
        'Failed to delete series',
      )
    })
  })

  describe('getEpisodeById', () => {
    it('should get episode by ID successfully', async () => {
      const mockEpisode = {
        id: 1,
        seriesId: 1,
        seasonNumber: 1,
        episodeNumber: 1,
        title: 'Pilot',
        monitored: true,
        hasFile: true,
        airDate: '2008-01-20',
        overview: 'The pilot episode',
        runtime: 47,
        absoluteEpisodeNumber: 1,
        episodeFileId: 101,
      }
      mockGet.mockResolvedValue(mockEpisode)

      const result = await client.getEpisodeById(1)

      expect(mockGet).toHaveBeenCalledWith('/episode/1')
      expect(result).toEqual(mockEpisode)
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ episodeId: 1 }),
        'Getting episode by ID from Sonarr',
      )
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ episodeId: 1, title: 'Pilot' }),
        'Episode retrieved successfully',
      )
    })

    it('should return null when episode not found', async () => {
      const error = new Error('Episode not found')
      mockGet.mockRejectedValue(error)

      const result = await client.getEpisodeById(999)

      expect(result).toBeNull()
      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          episodeId: 999,
          error: 'Episode not found',
        }),
        'Failed to get episode by ID',
      )
    })

    it('should handle API errors gracefully', async () => {
      const error = new Error('Database connection failed')
      mockGet.mockRejectedValue(error)

      const result = await client.getEpisodeById(1)

      expect(result).toBeNull()
      expect(client['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          episodeId: 1,
          error: 'Database connection failed',
        }),
        'Failed to get episode by ID',
      )
    })

    it('should handle network timeout errors', async () => {
      const error = new Error('Request timeout')
      mockGet.mockRejectedValue(error)

      const result = await client.getEpisodeById(1)

      expect(result).toBeNull()
      expect(mockGet).toHaveBeenCalledWith('/episode/1')
    })

    it('should handle invalid episode IDs', async () => {
      const error = new Error('Invalid episode ID format')
      mockGet.mockRejectedValue(error)

      const result = await client.getEpisodeById(-1)

      expect(result).toBeNull()
      expect(mockGet).toHaveBeenCalledWith('/episode/-1')
    })

    it('should log episode retrieval operations', async () => {
      const mockEpisode = {
        id: 123,
        seriesId: 5,
        seasonNumber: 2,
        episodeNumber: 10,
        title: 'Season Finale',
        monitored: true,
        hasFile: false,
      }
      mockGet.mockResolvedValue(mockEpisode)

      await client.getEpisodeById(123)

      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ episodeId: 123 }),
        'Getting episode by ID from Sonarr',
      )
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({ episodeId: 123, title: 'Season Finale' }),
        'Episode retrieved successfully',
      )
    })

    it('should handle malformed API response', async () => {
      const malformedResponse = { invalidData: true }
      mockGet.mockResolvedValue(malformedResponse)

      const result = await client.getEpisodeById(1)

      expect(result).toEqual(malformedResponse) // Returns whatever API returns
      expect(client['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          episodeId: 1,
          title: undefined, // No title in malformed response
        }),
        'Episode retrieved successfully',
      )
    })
  })

  describe('service configuration', () => {
    it('should have correct service name', () => {
      expect(client['serviceName']).toBe('Sonarr')
    })

    it('should have correct circuit breaker key', () => {
      expect(client['circuitBreakerKey']).toBe('sonarr-api')
    })
  })
})
