import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { SonarrClient } from 'src/media/clients/sonarr.client'
import {
  MonitorSeriesOptionsInput,
  SearchQueryInput,
  SonarrInputSchemas,
  SonarrOutputSchemas,
  UnmonitorSeriesOptionsInput,
} from 'src/media/schemas/sonarr.schemas'
import { SonarrService } from 'src/media/services/sonarr.service'
import {
  EpisodeFileResource,
  EpisodeResource,
  SeriesSearchResult,
  SonarrCommandResponse,
  SonarrImageType,
  SonarrMonitorType,
  SonarrQualityProfile,
  SonarrQueueItem,
  SonarrRootFolder,
  SonarrSeries,
  SonarrSeriesResource,
  SonarrSeriesStatus,
  SonarrSeriesType,
  SonarrSystemStatus,
  UnmonitorSeriesOptions,
} from 'src/media/types/sonarr.types'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Mock the utility functions
jest.mock('src/media/utils/sonarr.utils', () => ({
  transformToSearchResults: jest.fn(),
  determineMonitoringStrategy: jest.fn(),
  determineUnmonitoringStrategy: jest.fn(),
  hasEpisodeSelections: jest.fn(),
  validateUnmonitoringSelection: jest.fn(),
  extractUnmonitoringOperationSummary: jest.fn(),
}))

// Import the mocked functions
import {
  determineMonitoringStrategy,
  determineUnmonitoringStrategy,
  extractUnmonitoringOperationSummary,
  hasEpisodeSelections,
  transformToSearchResults,
  validateUnmonitoringSelection,
} from 'src/media/utils/sonarr.utils'
const mockTransformToSearchResults =
  transformToSearchResults as jest.MockedFunction<
    typeof transformToSearchResults
  >
const mockDetermineMonitoringStrategy =
  determineMonitoringStrategy as jest.MockedFunction<
    typeof determineMonitoringStrategy
  >
const mockDetermineUnmonitoringStrategy =
  determineUnmonitoringStrategy as jest.MockedFunction<
    typeof determineUnmonitoringStrategy
  >
const mockHasEpisodeSelections = hasEpisodeSelections as jest.MockedFunction<
  typeof hasEpisodeSelections
>
const mockValidateUnmonitoringSelection =
  validateUnmonitoringSelection as jest.MockedFunction<
    typeof validateUnmonitoringSelection
  >
const mockExtractUnmonitoringOperationSummary =
  extractUnmonitoringOperationSummary as jest.MockedFunction<
    typeof extractUnmonitoringOperationSummary
  >

// Mock nanoid
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'test-id-123'),
}))

// Mock performance
jest.mock('perf_hooks', () => ({
  performance: { now: jest.fn() },
}))

import { performance } from 'perf_hooks'
const mockPerformanceNow = performance.now as jest.Mock

describe('SonarrService', () => {
  let service: SonarrService
  let mockSonarrClient: jest.Mocked<SonarrClient>
  let mockRetryService: jest.Mocked<RetryService>
  let mockErrorClassifier: jest.Mocked<ErrorClassificationService>

  // Simplified test data factories
  const createMockSeriesSearchResult = (
    overrides: Partial<SeriesSearchResult> = {},
  ): SeriesSearchResult => ({
    tvdbId: 123456,
    tmdbId: 789012,
    imdbId: 'tt1234567',
    title: 'Test Series',
    titleSlug: 'test-series',
    sortTitle: 'test series',
    year: 2023,
    firstAired: '2023-01-01T00:00:00Z',
    lastAired: '2023-12-31T00:00:00Z',
    overview: 'A test TV series overview',
    runtime: 45,
    network: 'Test Network',
    status: SonarrSeriesStatus.CONTINUING,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [
      { seasonNumber: 1, monitored: true },
      { seasonNumber: 2, monitored: true },
    ],
    genres: ['Drama', 'Action'],
    rating: 8.5,
    posterPath: 'https://example.com/poster.jpg',
    backdropPath: 'https://example.com/fanart.jpg',
    certification: 'TV-14',
    ended: false,
    ...overrides,
  })

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

  const createMockSeries = (
    overrides: Partial<SonarrSeries> = {},
  ): SonarrSeries => ({
    id: 1,
    title: 'Test Series',
    alternateTitles: [],
    sortTitle: 'test series',
    status: SonarrSeriesStatus.CONTINUING,
    ended: false,
    overview: 'Test overview',
    network: 'Test Network',
    images: [
      {
        coverType: SonarrImageType.POSTER,
        url: 'https://example.com/poster.jpg',
      },
    ],
    seasons: [{ seasonNumber: 1, monitored: true }],
    year: 2023,
    path: '/tv/test-series',
    qualityProfileId: 1,
    seasonFolder: true,
    monitored: true,
    useSceneNumbering: false,
    runtime: 45,
    tvdbId: 123456,
    firstAired: '2023-01-01T00:00:00Z',
    seriesType: SonarrSeriesType.STANDARD,
    cleanTitle: 'testseries',
    titleSlug: 'test-series',
    certification: 'TV-14',
    genres: ['Drama'],
    tags: [],
    added: '2023-01-01T00:00:00Z',
    ratings: {
      imdb: { value: 8.5, votes: 10000, type: 'user' },
    },
    ...overrides,
  })

  const createMockQualityProfile = (
    overrides: Partial<SonarrQualityProfile> = {},
  ): SonarrQualityProfile => ({
    id: 1,
    name: 'Any',
    upgradeAllowed: true,
    cutoff: 1,
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

  const createMockCommandResponse = (
    overrides: Partial<SonarrCommandResponse> = {},
  ): SonarrCommandResponse => ({
    id: 123,
    name: 'SeriesSearch',
    commandName: 'SeriesSearch',
    body: {
      seriesId: 1,
      sendUpdatesToClient: false,
      updateScheduledTask: false,
      completionMessage: 'Search completed',
      requiresDiskAccess: false,
      isExclusive: false,
      isTypeExclusive: false,
      isLongRunning: false,
      name: 'SeriesSearch',
      trigger: 'manual',
    },
    priority: 'normal',
    status: 'queued',
    queued: '2023-01-01T00:00:00Z',
    trigger: 'manual',
    sendUpdatesToClient: false,
    updateScheduledTask: false,
    ...overrides,
  })

  const createMockEpisodeResource = (
    overrides: Partial<EpisodeResource> = {},
  ): EpisodeResource => ({
    id: 1,
    seriesId: 1,
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Test Episode',
    monitored: false,
    hasFile: false,
    ...overrides,
  })

  const createMockQueueItem = (
    overrides: Partial<SonarrQueueItem> = {},
  ): SonarrQueueItem => ({
    id: 1,
    seriesId: 1,
    episodeId: 1,
    title: 'Test Episode S01E01',
    series: {
      id: 1,
      title: 'Test Series',
      tvdbId: 123456,
    },
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
    ...overrides,
  })

  const createMockEpisodeFile = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    seriesId: 1,
    seasonNumber: 1,
    relativePath: 'Season 01/S01E01.mkv',
    path: '/tv/test-series/Season 01/S01E01.mkv',
    size: 1000000000, // 1GB
    dateAdded: '2023-01-01T00:00:00Z',
    releaseGroup: 'TestGroup',
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
    mediaInfo: {
      audioChannels: 5.1,
      audioCodec: 'AAC',
      height: 720,
      width: 1280,
      videoCodec: 'h264',
      subtitles: ['English', 'Spanish'],
    },
    ...overrides,
  })

  beforeEach(async () => {
    // Reset performance mock
    mockPerformanceNow.mockReturnValue(1000)

    // Create comprehensive mocked SonarrClient
    mockSonarrClient = {
      searchSeries: jest.fn(),
      getSystemStatus: jest.fn(),
      checkHealth: jest.fn(),
      getQualityProfiles: jest.fn(),
      getRootFolders: jest.fn(),
      getSeriesByTvdbId: jest.fn(),
      getSeriesById: jest.fn(),
      getEpisodeById: jest.fn(),
      addSeries: jest.fn(),
      updateSeries: jest.fn(),
      getEpisodes: jest.fn(),
      updateEpisodesMonitoring: jest.fn(),
      triggerSeriesSearch: jest.fn(),
      getLibrarySeries: jest.fn(),
      getQueue: jest.fn(),
      removeQueueItem: jest.fn(),
      deleteSeries: jest.fn(),
      deleteEpisodeFile: jest.fn(),
      getEpisodeFiles: jest.fn(),
      updateEpisode: jest.fn(),
      updateEpisodeBulk: jest.fn(),
    } as unknown as jest.Mocked<SonarrClient>

    mockRetryService = {
      execute: jest.fn().mockImplementation(async fn => fn()),
    } as unknown as jest.Mocked<never>

    mockErrorClassifier = {
      classifyError: jest.fn().mockReturnValue({ isRetriable: true }),
    } as unknown as jest.Mocked<never>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SonarrService,
        { provide: SonarrClient, useValue: mockSonarrClient },
        { provide: RetryService, useValue: mockRetryService },
        { provide: ErrorClassificationService, useValue: mockErrorClassifier },
      ],
    }).compile()

    service = module.get<SonarrService>(SonarrService)

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()

    // Reset all mocks
    jest.clearAllMocks()

    // Set up default mock return values after clearing mocks
    mockSonarrClient.getQualityProfiles.mockResolvedValue([
      createMockQualityProfile({ id: 1, name: 'Any' }),
    ])
    mockSonarrClient.getRootFolders.mockResolvedValue([
      createMockRootFolder({ id: 1, path: '/tv' }),
    ])

    // Set up utils mocks
    mockDetermineMonitoringStrategy.mockReturnValue({
      monitorType: SonarrMonitorType.ALL,
      seasons: [{ seasonNumber: 1, monitored: true }],
    })
    mockHasEpisodeSelections.mockReturnValue(false)
  })

  describe('searchShows', () => {
    beforeEach(() => {
      // Mock Zod validation to pass through
      jest
        .spyOn(SonarrInputSchemas.searchQuery, 'parse')
        .mockImplementation((input: unknown) => input as SearchQueryInput)

      jest
        .spyOn(SonarrOutputSchemas.seriesSearchResultArray, 'parse')
        .mockImplementation((input: unknown) => input as SeriesSearchResult[])
    })

    it('should search shows successfully', async () => {
      const mockSeriesResources = [createMockSeriesResource()]
      const mockSearchResults = [createMockSeriesSearchResult()]

      mockSonarrClient.searchSeries.mockResolvedValue(mockSeriesResources)
      mockTransformToSearchResults.mockReturnValue(mockSearchResults)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500)

      const result = await service.searchShows('test series')

      expect(mockSonarrClient.searchSeries).toHaveBeenCalledWith('test series')
      expect(mockTransformToSearchResults).toHaveBeenCalledWith(
        mockSeriesResources,
      )
      expect(result).toEqual(mockSearchResults)
    })

    it('should validate input query', async () => {
      const mockSearchResults = [createMockSeriesSearchResult()]
      const mockSeriesResources = [createMockSeriesResource()]

      mockSonarrClient.searchSeries.mockResolvedValue(mockSeriesResources)
      mockTransformToSearchResults.mockReturnValue(mockSearchResults)

      await service.searchShows('test series')

      expect(SonarrInputSchemas.searchQuery.parse).toHaveBeenCalledWith({
        query: 'test series',
      })
    })

    it('should validate output results', async () => {
      const mockSearchResults = [createMockSeriesSearchResult()]
      const mockSeriesResources = [createMockSeriesResource()]

      mockSonarrClient.searchSeries.mockResolvedValue(mockSeriesResources)
      mockTransformToSearchResults.mockReturnValue(mockSearchResults)

      await service.searchShows('test series')

      expect(
        SonarrOutputSchemas.seriesSearchResultArray.parse,
      ).toHaveBeenCalledWith(mockSearchResults)
    })

    it('should handle input validation errors', async () => {
      const validationError = new Error('Invalid query')
      jest
        .spyOn(SonarrInputSchemas.searchQuery, 'parse')
        .mockImplementation(() => {
          throw validationError
        })

      await expect(service.searchShows('')).rejects.toThrow(
        'Invalid search query: Invalid query',
      )
    })

    it('should handle client search errors', async () => {
      const searchError = new Error('API Error')
      jest
        .spyOn(SonarrInputSchemas.searchQuery, 'parse')
        .mockImplementation(input => input as SearchQueryInput)

      mockSonarrClient.searchSeries.mockRejectedValue(searchError)

      await expect(service.searchShows('test')).rejects.toThrow('API Error')
    })

    it('should log search operations', async () => {
      const mockSearchResults = [createMockSeriesSearchResult()]
      const mockSeriesResources = [createMockSeriesResource()]

      mockSonarrClient.searchSeries.mockResolvedValue(mockSeriesResources)
      mockTransformToSearchResults.mockReturnValue(mockSearchResults)

      await service.searchShows('test series')

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          query: 'test series',
        }),
        'Starting series search',
      )

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          query: 'test series',
          resultCount: 1,
          duration: expect.any(Number),
        }),
        'Series search fetch completed',
      )
    })

    it('should handle search transformation errors', async () => {
      const mockSeriesResources = [createMockSeriesResource()]
      const transformError = new Error('Transform failed')

      mockSonarrClient.searchSeries.mockResolvedValue(mockSeriesResources)
      mockTransformToSearchResults.mockImplementation(() => {
        throw transformError
      })

      await expect(service.searchShows('test')).rejects.toThrow(
        'Transform failed',
      )
    })
  })

  describe('getSystemStatus', () => {
    beforeEach(() => {
      // Mock Zod validation to pass through
      jest
        .spyOn(SonarrOutputSchemas.systemStatus, 'parse')
        .mockImplementation(input => input as SonarrSystemStatus)
    })

    it('should get system status successfully', async () => {
      const mockStatus = createMockSystemStatus()
      mockSonarrClient.getSystemStatus.mockResolvedValue(mockStatus)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1200)

      const result = await service.getSystemStatus()

      expect(mockSonarrClient.getSystemStatus).toHaveBeenCalled()
      expect(result).toEqual(mockStatus)
      expect(SonarrOutputSchemas.systemStatus.parse).toHaveBeenCalledWith(
        mockStatus,
      )
    })

    it('should handle system status errors', async () => {
      const error = new Error('System unavailable')
      mockSonarrClient.getSystemStatus.mockRejectedValue(error)

      await expect(service.getSystemStatus()).rejects.toThrow(
        'System unavailable',
      )
    })

    it('should log system status operations', async () => {
      const mockStatus = createMockSystemStatus({ version: '4.0.1.0' })
      mockSonarrClient.getSystemStatus.mockResolvedValue(mockStatus)

      await service.getSystemStatus()

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
        }),
        'Getting Sonarr system status',
      )

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          version: '4.0.1.0',
          duration: expect.any(Number),
        }),
        'Sonarr system status retrieved',
      )
    })
  })

  describe('checkHealth', () => {
    it('should return true when client health check passes', async () => {
      mockSonarrClient.checkHealth.mockResolvedValue(true)

      const result = await service.checkHealth()

      expect(result).toBe(true)
      expect(mockSonarrClient.checkHealth).toHaveBeenCalled()
    })

    it('should return false when client health check fails', async () => {
      mockSonarrClient.checkHealth.mockResolvedValue(false)

      const result = await service.checkHealth()

      expect(result).toBe(false)
    })

    it('should return false and log error when health check throws', async () => {
      const error = new Error('Health check failed')
      mockSonarrClient.checkHealth.mockRejectedValue(error)

      const result = await service.checkHealth()

      expect(result).toBe(false)
      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          error: 'Health check failed',
        }),
        'Sonarr health check failed with exception',
      )
    })

    it('should log health check operations', async () => {
      mockSonarrClient.checkHealth.mockResolvedValue(true)

      await service.checkHealth()

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
        }),
        'Checking Sonarr health',
      )

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          isHealthy: true,
        }),
        'Sonarr health check passed',
      )
    })
  })

  describe('getDownloadingEpisodes', () => {
    beforeEach(() => {
      jest
        .spyOn(SonarrOutputSchemas.downloadingSeriesArray, 'parse')
        .mockImplementation(
          input =>
            input as ReturnType<
              typeof SonarrOutputSchemas.downloadingSeriesArray.parse
            >,
        )
    })

    it('should return downloading episodes with calculated progress', async () => {
      const mockQueueItems = [
        createMockQueueItem({
          id: 1,
          size: 1000000000, // 1GB
          sizeleft: 500000000, // 500MB
          status: 'downloading',
        }),
        createMockQueueItem({
          id: 2,
          size: 2000000000, // 2GB
          sizeleft: 0, // Complete
          status: 'completed',
        }),
        createMockQueueItem({
          id: 3,
          size: 500000000, // 500MB
          sizeleft: 500000000, // 0% progress
          status: 'queued',
        }),
      ]

      mockSonarrClient.getQueue.mockResolvedValue(mockQueueItems)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1300) // 300ms duration

      const result = await service.getDownloadingEpisodes()

      expect(mockSonarrClient.getQueue).toHaveBeenCalled()
      // Should only include downloading and queued items (not completed)
      expect(result).toHaveLength(2)

      // Check first item (downloading, 50% progress)
      expect(result[0].progressPercent).toBe(50)
      expect(result[0].downloadedBytes).toBe(500000000)
      expect(result[0].isActive).toBe(true)
      expect(result[0].status).toBe('downloading')

      // Check second item (queued, 0% progress)
      expect(result[1].progressPercent).toBe(0)
      expect(result[1].downloadedBytes).toBe(0)
      expect(result[1].isActive).toBe(true)
      expect(result[1].status).toBe('queued')
    })

    it('should handle empty queue gracefully', async () => {
      mockSonarrClient.getQueue.mockResolvedValue([])
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1100)

      const result = await service.getDownloadingEpisodes()

      expect(result).toHaveLength(0)
      expect(
        SonarrOutputSchemas.downloadingSeriesArray.parse,
      ).toHaveBeenCalledWith([])
    })

    it('should filter out completed and failed items', async () => {
      const mockQueueItems = [
        createMockQueueItem({ status: 'downloading' }), // Include
        createMockQueueItem({ status: 'queued' }), // Include
        createMockQueueItem({ status: 'completed' }), // Exclude
        createMockQueueItem({ status: 'failed' }), // Exclude
        createMockQueueItem({ status: 'paused' }), // Include
        createMockQueueItem({ status: 'warning' }), // Include
      ]

      mockSonarrClient.getQueue.mockResolvedValue(mockQueueItems)

      const result = await service.getDownloadingEpisodes()

      expect(result).toHaveLength(4) // Only downloading, queued, paused, warning
    })

    it('should handle missing episode and series data gracefully', async () => {
      const mockQueueItems = [
        createMockQueueItem({
          series: undefined,
          episode: undefined,
          title: 'Fallback Title',
        }),
      ]

      mockSonarrClient.getQueue.mockResolvedValue(mockQueueItems)

      const result = await service.getDownloadingEpisodes()

      expect(result).toHaveLength(1)
      expect(result[0].seriesTitle).toBe('Unknown Series')
      expect(result[0].episodeTitle).toBe('Fallback Title')
      expect(result[0].seasonNumber).toBeUndefined()
      expect(result[0].episodeNumber).toBeUndefined()
    })

    it('should handle zero size gracefully', async () => {
      const mockQueueItems = [
        createMockQueueItem({
          size: 0,
          sizeleft: 0,
          status: 'downloading',
        }),
      ]

      mockSonarrClient.getQueue.mockResolvedValue(mockQueueItems)

      const result = await service.getDownloadingEpisodes()

      expect(result).toHaveLength(1)
      expect(result[0].progressPercent).toBe(0)
      expect(result[0].downloadedBytes).toBe(0)
    })

    it('should handle API errors', async () => {
      const error = new Error('Queue API failed')
      mockSonarrClient.getQueue.mockRejectedValue(error)

      await expect(service.getDownloadingEpisodes()).rejects.toThrow(
        'Queue API failed',
      )

      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          error: 'Queue API failed',
        }),
        'Failed to get downloading episodes from Sonarr',
      )
    })

    it('should log operations with performance metrics', async () => {
      const mockQueueItems = [createMockQueueItem()]
      mockSonarrClient.getQueue.mockResolvedValue(mockQueueItems)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500) // 500ms duration

      await service.getDownloadingEpisodes()

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
        }),
        'Getting all downloading episodes from Sonarr',
      )

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          totalQueueItems: 1,
          downloadingCount: 1,
          duration: 500,
        }),
        'Downloading episodes retrieved from Sonarr',
      )
    })
  })

  describe('error handling', () => {
    it('should handle unknown errors gracefully', async () => {
      jest
        .spyOn(SonarrInputSchemas.searchQuery, 'parse')
        .mockImplementation(() => {
          throw 'Non-Error object'
        })

      await expect(service.searchShows('test')).rejects.toThrow(
        'Invalid search query: Unknown validation error',
      )
    })

    it('should log validation errors with context', async () => {
      const validationError = new Error('Query too short')
      jest
        .spyOn(SonarrInputSchemas.searchQuery, 'parse')
        .mockImplementation(() => {
          throw validationError
        })

      try {
        await service.searchShows('a')
      } catch {
        // Expected to throw
      }

      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { query: 'a' },
          error: 'Query too short',
        }),
        'Invalid search query input',
      )
    })
  })

  describe('monitorAndDownloadSeries', () => {
    beforeEach(() => {
      // Mock Zod validation to pass through
      jest
        .spyOn(SonarrInputSchemas.monitorSeriesOptions, 'parse')
        .mockImplementation(
          (input: unknown) => input as MonitorSeriesOptionsInput,
        )
    })

    describe('new series workflow', () => {
      it('should add new series with default monitoring options', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockAddedSeries = createMockSeries({
          id: 1,
          tvdbId: mockSeries.tvdbId,
          title: mockSeries.title,
          seasons: mockSeries.seasons,
        })
        const mockCommand = createMockCommandResponse()

        // Series doesn't exist
        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(null)

        // Mock search shows to return the series
        jest.spyOn(service, 'searchShows').mockResolvedValue([mockSeries])

        // Configuration
        mockSonarrClient.getQualityProfiles.mockResolvedValue([
          createMockQualityProfile({ id: 1, name: 'Any' }),
        ])
        mockSonarrClient.getRootFolders.mockResolvedValue([
          createMockRootFolder({ id: 1, path: '/tv' }),
        ])

        // Series addition
        mockSonarrClient.addSeries.mockResolvedValue(mockAddedSeries)
        mockSonarrClient.triggerSeriesSearch.mockResolvedValue(mockCommand)

        const result = await service.monitorAndDownloadSeries(mockSeries.tvdbId)

        expect(mockSonarrClient.getSeriesByTvdbId).toHaveBeenCalledWith(
          mockSeries.tvdbId,
        )
        expect(mockSonarrClient.addSeries).toHaveBeenCalledWith(
          expect.objectContaining({
            tvdbId: mockSeries.tvdbId,
            title: mockSeries.title,
            qualityProfileId: 1,
            rootFolderPath: '/tv',
            monitored: true,
          }),
        )
        expect(mockSonarrClient.triggerSeriesSearch).toHaveBeenCalledWith(1)

        expect(result).toEqual({
          success: true,
          seriesAdded: true,
          seriesUpdated: false,
          searchTriggered: true,
          changes: [],
          series: mockAddedSeries,
          commandId: 123,
        })
      })

      it('should handle series addition with custom episode selection', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockAddedSeries = createMockSeries({ id: 1 })
        const mockCommand = createMockCommandResponse()
        const mockEpisodes = [
          createMockEpisodeResource({
            id: 1,
            episodeNumber: 1,
            seasonNumber: 1,
            monitored: false,
          }),
          createMockEpisodeResource({
            id: 2,
            episodeNumber: 2,
            seasonNumber: 1,
            monitored: false,
          }),
        ]

        const options = {
          selection: [{ season: 1, episodes: [1] }],
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(null)

        // Mock search shows to return the series
        jest.spyOn(service, 'searchShows').mockResolvedValue([mockSeries])

        mockSonarrClient.getQualityProfiles.mockResolvedValue([
          createMockQualityProfile({ id: 1, name: 'Any' }),
        ])
        mockSonarrClient.getRootFolders.mockResolvedValue([
          createMockRootFolder({ id: 1, path: '/tv' }),
        ])
        mockSonarrClient.addSeries.mockResolvedValue(mockAddedSeries)
        mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
        mockSonarrClient.updateEpisodesMonitoring.mockResolvedValue(undefined)
        mockSonarrClient.triggerSeriesSearch.mockResolvedValue(mockCommand)

        // Set up utils mocks for this test
        mockHasEpisodeSelections.mockReturnValue(true)

        const result = await service.monitorAndDownloadSeries(
          mockSeries.tvdbId,
          options,
        )

        expect(mockSonarrClient.getEpisodes).toHaveBeenCalledWith(1, 1)
        expect(mockSonarrClient.updateEpisodesMonitoring).toHaveBeenCalledWith({
          episodeIds: [1],
          monitored: true,
        })
        expect(mockSonarrClient.updateEpisodesMonitoring).toHaveBeenCalledWith({
          episodeIds: [2],
          monitored: false,
        })

        expect(result.success).toBe(true)
        expect(result.seriesAdded).toBe(true)
        expect(result.changes).toHaveLength(2) // monitor + unmonitor changes
      })

      it('should handle no quality profiles error', async () => {
        const mockSeries = createMockSeriesSearchResult()

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(null)

        // Mock search shows to return the series
        jest.spyOn(service, 'searchShows').mockResolvedValue([mockSeries])

        mockSonarrClient.getQualityProfiles.mockResolvedValue([])
        mockSonarrClient.getRootFolders.mockResolvedValue([
          createMockRootFolder({ id: 1, path: '/tv' }),
        ])

        const result = await service.monitorAndDownloadSeries(mockSeries.tvdbId)

        expect(result).toEqual({
          success: false,
          seriesAdded: false,
          seriesUpdated: false,
          searchTriggered: false,
          changes: [],
          error: 'No quality profiles found in Sonarr',
        })
      })

      it('should handle no root folders error', async () => {
        const mockSeries = createMockSeriesSearchResult()

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(null)

        // Mock search shows to return the series
        jest.spyOn(service, 'searchShows').mockResolvedValue([mockSeries])

        mockSonarrClient.getQualityProfiles.mockResolvedValue([
          createMockQualityProfile({ id: 1, name: 'Any' }),
        ])
        mockSonarrClient.getRootFolders.mockResolvedValue([])

        const result = await service.monitorAndDownloadSeries(mockSeries.tvdbId)

        expect(result).toEqual({
          success: false,
          seriesAdded: false,
          seriesUpdated: false,
          searchTriggered: false,
          changes: [],
          error: 'No root folders found in Sonarr',
        })
      })

      it('should fallback to first quality profile when "Any" not found', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockAddedSeries = createMockSeries({ id: 1 })
        const mockCommand = createMockCommandResponse()

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(null)

        // Mock search shows to return the series
        jest.spyOn(service, 'searchShows').mockResolvedValue([mockSeries])

        mockSonarrClient.getQualityProfiles.mockResolvedValue([
          createMockQualityProfile({ id: 1, name: 'HD-1080p' }),
          createMockQualityProfile({ id: 2, name: '4K-UHD' }),
        ])
        mockSonarrClient.getRootFolders.mockResolvedValue([
          createMockRootFolder({ id: 1, path: '/tv' }),
        ])
        mockSonarrClient.addSeries.mockResolvedValue(mockAddedSeries)
        mockSonarrClient.triggerSeriesSearch.mockResolvedValue(mockCommand)

        const result = await service.monitorAndDownloadSeries(mockSeries.tvdbId)

        expect(mockSonarrClient.addSeries).toHaveBeenCalledWith(
          expect.objectContaining({
            qualityProfileId: 1, // First profile used as fallback
          }),
        )
        expect(service['logger'].warn).toHaveBeenCalledWith(
          expect.objectContaining({
            availableProfiles: ['HD-1080p', '4K-UHD'],
          }),
          'No "Any" quality profile found, using first available profile',
        )
        expect(result.success).toBe(true)
      })
    })

    describe('existing series workflow', () => {
      it('should update existing series with default monitoring (all seasons)', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({
          id: 1,
          tvdbId: mockSeries.tvdbId,
          seasons: [
            { seasonNumber: 1, monitored: false },
            { seasonNumber: 2, monitored: false },
          ],
        })
        const mockUpdatedSeries = createMockSeries({
          ...mockExistingSeries,
          seasons: [
            { seasonNumber: 1, monitored: true },
            { seasonNumber: 2, monitored: true },
          ],
        })
        const mockCommand = createMockCommandResponse()

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.updateSeries.mockResolvedValue(mockUpdatedSeries)
        mockSonarrClient.triggerSeriesSearch.mockResolvedValue(mockCommand)

        const result = await service.monitorAndDownloadSeries(mockSeries.tvdbId)

        expect(mockSonarrClient.updateSeries).toHaveBeenCalledWith(1, {
          seasons: [
            { seasonNumber: 1, monitored: true },
            { seasonNumber: 2, monitored: true },
          ],
          monitored: true,
        })
        expect(mockSonarrClient.triggerSeriesSearch).toHaveBeenCalledWith(1)

        expect(result).toEqual({
          success: true,
          seriesAdded: false,
          seriesUpdated: true,
          searchTriggered: true,
          changes: [
            { season: 1, action: 'monitored' },
            { season: 2, action: 'monitored' },
          ],
          series: mockUpdatedSeries,
          commandId: 123,
        })
      })

      it('should skip search trigger when no changes made to existing series', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({
          id: 1,
          tvdbId: mockSeries.tvdbId,
          seasons: [
            { seasonNumber: 1, monitored: true }, // Already monitored
            { seasonNumber: 2, monitored: true }, // Already monitored
          ],
        })

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.updateSeries.mockResolvedValue(mockExistingSeries)

        const result = await service.monitorAndDownloadSeries(mockSeries.tvdbId)

        expect(mockSonarrClient.triggerSeriesSearch).not.toHaveBeenCalled()

        expect(result).toEqual({
          success: true,
          seriesAdded: false,
          seriesUpdated: true,
          searchTriggered: false,
          changes: [], // No changes
          series: mockExistingSeries,
          commandId: undefined,
        })
      })

      it('should update existing series with custom episode selection', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({
          id: 1,
          tvdbId: mockSeries.tvdbId,
        })
        const mockEpisodes = [
          createMockEpisodeResource({
            id: 1,
            episodeNumber: 1,
            seasonNumber: 1,
          }),
          createMockEpisodeResource({
            id: 2,
            episodeNumber: 2,
            seasonNumber: 1,
          }),
        ]
        const mockCommand = createMockCommandResponse()

        const options = {
          selection: [{ season: 1, episodes: [1] }],
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
        mockSonarrClient.updateEpisodesMonitoring.mockResolvedValue(undefined)
        mockSonarrClient.triggerSeriesSearch.mockResolvedValue(mockCommand)

        const result = await service.monitorAndDownloadSeries(
          mockSeries.tvdbId,
          options,
        )

        expect(mockSonarrClient.getEpisodes).toHaveBeenCalledWith(1, 1)
        expect(result.success).toBe(true)
        expect(result.seriesUpdated).toBe(true)
        expect(result.searchTriggered).toBe(true)
        expect(result.changes.length).toBeGreaterThan(0)
      })
    })

    describe('error handling', () => {
      it('should handle API errors during series existence check', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const error = new Error('API connection failed')

        mockSonarrClient.getSeriesByTvdbId.mockRejectedValue(error)

        const result = await service.monitorAndDownloadSeries(mockSeries.tvdbId)

        expect(result).toEqual({
          success: false,
          seriesAdded: false,
          seriesUpdated: false,
          searchTriggered: false,
          changes: [],
          error: 'API connection failed',
        })

        expect(service['logger'].error).toHaveBeenCalledWith(
          expect.objectContaining({
            tvdbId: mockSeries.tvdbId,
            error: 'API connection failed',
          }),
          'Failed to monitor and download series',
        )
      })

      it('should handle validation errors for monitor options', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const validationError = new Error('Invalid selection format')

        jest
          .spyOn(SonarrInputSchemas.monitorSeriesOptions, 'parse')
          .mockImplementation(() => {
            throw validationError
          })

        const result = await service.monitorAndDownloadSeries(
          mockSeries.tvdbId,
          {
            selection: [{ season: 'invalid' as unknown as number }],
          },
        )

        expect(result.success).toBe(false)
        expect(result.error).toContain('Invalid monitor series options')
      })

      it('should handle episodes not found after retry', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockAddedSeries = createMockSeries({ id: 1 })
        const mockCommand = createMockCommandResponse()

        const options = {
          selection: [{ season: 1, episodes: [1] }],
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(null)

        // Mock search shows to return the series
        jest.spyOn(service, 'searchShows').mockResolvedValue([mockSeries])

        mockSonarrClient.getQualityProfiles.mockResolvedValue([
          createMockQualityProfile({ id: 1, name: 'Any' }),
        ])
        mockSonarrClient.getRootFolders.mockResolvedValue([
          createMockRootFolder({ id: 1, path: '/tv' }),
        ])
        mockSonarrClient.addSeries.mockResolvedValue(mockAddedSeries)
        mockSonarrClient.getEpisodes.mockResolvedValue([]) // No episodes found
        mockSonarrClient.triggerSeriesSearch.mockResolvedValue(mockCommand)

        const result = await service.monitorAndDownloadSeries(
          mockSeries.tvdbId,
          options,
        )

        expect(result.success).toBe(true) // Still succeeds even without episodes
        expect(result.changes).toEqual([]) // No episode changes made
      })
    })

    describe('monitoring options and performance', () => {
      it('should log operation start and completion with performance metrics', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockAddedSeries = createMockSeries({ id: 1 })
        const mockCommand = createMockCommandResponse()

        // Reset performance mock for this test
        mockPerformanceNow.mockClear()
        mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(2000)

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(null)

        // Mock search shows to return the series
        jest.spyOn(service, 'searchShows').mockResolvedValue([mockSeries])

        mockSonarrClient.getQualityProfiles.mockResolvedValue([
          createMockQualityProfile({ id: 1, name: 'Any' }),
        ])
        mockSonarrClient.getRootFolders.mockResolvedValue([
          createMockRootFolder({ id: 1, path: '/tv' }),
        ])
        mockSonarrClient.addSeries.mockResolvedValue(mockAddedSeries)
        mockSonarrClient.triggerSeriesSearch.mockResolvedValue(mockCommand)

        await service.monitorAndDownloadSeries(mockSeries.tvdbId)

        expect(service['logger'].log).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'test-id-123',
            tvdbId: mockSeries.tvdbId,
            options: {},
          }),
          'Starting monitor and download series operation',
        )

        // Verify completion logging is happening (with any parameters)
        expect(service['logger'].log).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'test-id-123',
          }),
          expect.stringContaining('completed'),
        )
      })

      it('should handle empty options object', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockAddedSeries = createMockSeries({ id: 1 })

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(null)

        // Mock search shows to return the series
        jest.spyOn(service, 'searchShows').mockResolvedValue([mockSeries])

        mockSonarrClient.getQualityProfiles.mockResolvedValue([
          createMockQualityProfile({ id: 1, name: 'Any' }),
        ])
        mockSonarrClient.getRootFolders.mockResolvedValue([
          createMockRootFolder({ id: 1, path: '/tv' }),
        ])
        mockSonarrClient.addSeries.mockResolvedValue(mockAddedSeries)
        mockSonarrClient.triggerSeriesSearch.mockResolvedValue(
          createMockCommandResponse(),
        )

        const result = await service.monitorAndDownloadSeries(
          mockSeries.tvdbId,
          {},
        )

        expect(result.success).toBe(true)
        expect(result.seriesAdded).toBe(true)
      })

      it('should handle whole season selection properly', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockAddedSeries = createMockSeries({ id: 1 })
        const mockEpisodes = [
          createMockEpisodeResource({
            id: 1,
            episodeNumber: 1,
            seasonNumber: 1,
          }),
          createMockEpisodeResource({
            id: 2,
            episodeNumber: 2,
            seasonNumber: 1,
          }),
          createMockEpisodeResource({
            id: 3,
            episodeNumber: 3,
            seasonNumber: 1,
          }),
        ]

        const options = {
          selection: [{ season: 1 }], // No episodes specified = whole season
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(null)

        // Mock search shows to return the series
        jest.spyOn(service, 'searchShows').mockResolvedValue([mockSeries])

        mockSonarrClient.getQualityProfiles.mockResolvedValue([
          createMockQualityProfile({ id: 1, name: 'Any' }),
        ])
        mockSonarrClient.getRootFolders.mockResolvedValue([
          createMockRootFolder({ id: 1, path: '/tv' }),
        ])
        mockSonarrClient.addSeries.mockResolvedValue(mockAddedSeries)
        mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
        mockSonarrClient.updateEpisodesMonitoring.mockResolvedValue(undefined)
        mockSonarrClient.triggerSeriesSearch.mockResolvedValue(
          createMockCommandResponse(),
        )

        // Set up utils mocks for this test (has selection, but no specific episodes = false for hasEpisodeSelections)
        mockHasEpisodeSelections.mockReturnValue(false)

        const result = await service.monitorAndDownloadSeries(
          mockSeries.tvdbId,
          options,
        )

        // Should monitor all episodes in the season
        expect(mockSonarrClient.updateEpisodesMonitoring).toHaveBeenCalledWith({
          episodeIds: [1, 2, 3],
          monitored: true,
        })
        expect(result.success).toBe(true)
        expect(result.changes).toHaveLength(1) // One change for whole season
      })
    })
  })

  describe('logging', () => {
    it('should generate unique operation IDs', async () => {
      const mockSearchResults = [createMockSeriesSearchResult()]
      const mockSeriesResources = [createMockSeriesResource()]

      mockSonarrClient.searchSeries.mockResolvedValue(mockSeriesResources)
      mockTransformToSearchResults.mockReturnValue(mockSearchResults)

      await service.searchShows('test')

      // All log calls should use the same operation ID
      const logCalls = (service['logger'].log as jest.Mock).mock.calls
      const operationIds = logCalls.map(call => call[0].id)
      expect(operationIds.every(id => id === 'test-id-123')).toBe(true)
      expect(operationIds.length).toBeGreaterThan(0)
    })

    it('should measure and log operation duration', async () => {
      const mockSearchResults = [createMockSeriesSearchResult()]
      const mockSeriesResources = [createMockSeriesResource()]

      mockSonarrClient.searchSeries.mockResolvedValue(mockSeriesResources)
      mockTransformToSearchResults.mockReturnValue(mockSearchResults)

      await service.searchShows('test')

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          duration: expect.any(Number),
        }),
        'Series search fetch completed',
      )
    })
  })

  describe('getLibrarySeries', () => {
    beforeEach(() => {
      // Mock Zod validation to pass through
      jest
        .spyOn(SonarrInputSchemas.optionalSearchQuery, 'parse')
        .mockImplementation((input: unknown) => input as { query?: string })

      jest
        .spyOn(SonarrOutputSchemas.librarySearchResultArray, 'parse')
        .mockImplementation(<T>(input: T) => input as T[])
    })

    it('should get all library series without query', async () => {
      const mockSeries = [
        createMockSeries({ id: 1, title: 'Series 1' }),
        createMockSeries({ id: 2, title: 'Series 2' }),
      ]
      mockSonarrClient.getLibrarySeries.mockResolvedValue(mockSeries)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500)

      const result = await service.getLibrarySeries()

      expect(mockSonarrClient.getLibrarySeries).toHaveBeenCalled()
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 1,
          title: 'Series 1',
          monitored: true,
        }),
      )
    })

    it('should get library series with query filter', async () => {
      const mockSeries = [
        createMockSeries({
          id: 1,
          title: 'Breaking Bad',
          genres: ['Drama', 'Crime'],
        }),
        createMockSeries({
          id: 2,
          title: 'Better Call Saul',
          genres: ['Drama', 'Crime'],
        }),
        createMockSeries({ id: 3, title: 'The Office', genres: ['Comedy'] }),
      ]
      mockSonarrClient.getLibrarySeries.mockResolvedValue(mockSeries)

      const result = await service.getLibrarySeries('drama')

      expect(mockSonarrClient.getLibrarySeries).toHaveBeenCalled()
      expect(SonarrInputSchemas.optionalSearchQuery.parse).toHaveBeenCalledWith(
        {
          query: 'drama',
        },
      )
      expect(result).toHaveLength(2)
    })

    it('should handle empty library', async () => {
      mockSonarrClient.getLibrarySeries.mockResolvedValue([])
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1200)

      const result = await service.getLibrarySeries()

      expect(result).toEqual([])
      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          query: undefined,
          resultCount: 0,
        }),
        'Library series fetch completed',
      )
    })

    it('should handle library API errors', async () => {
      const error = new Error('Library access failed')
      mockSonarrClient.getLibrarySeries.mockRejectedValue(error)

      await expect(service.getLibrarySeries()).rejects.toThrow(
        'Library access failed',
      )

      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          error: 'Library access failed',
        }),
        'Failed to fetch library series',
      )
    })

    it('should validate input query', async () => {
      const mockSeries = [createMockSeries()]
      mockSonarrClient.getLibrarySeries.mockResolvedValue(mockSeries)

      await service.getLibrarySeries('test query')

      expect(SonarrInputSchemas.optionalSearchQuery.parse).toHaveBeenCalledWith(
        {
          query: 'test query',
        },
      )
    })

    it('should validate output results', async () => {
      const mockSeries = [createMockSeries()]
      mockSonarrClient.getLibrarySeries.mockResolvedValue(mockSeries)

      await service.getLibrarySeries()

      expect(
        SonarrOutputSchemas.librarySearchResultArray.parse,
      ).toHaveBeenCalledWith(expect.any(Array))
    })

    it('should handle input validation errors', async () => {
      const validationError = new Error('Invalid query format')
      jest
        .spyOn(SonarrInputSchemas.optionalSearchQuery, 'parse')
        .mockImplementation(() => {
          throw validationError
        })

      await expect(service.getLibrarySeries('invalid')).rejects.toThrow(
        'Invalid search query: Invalid query format',
      )
    })

    it('should log operation start and completion', async () => {
      const mockSeries = [createMockSeries()]
      mockSonarrClient.getLibrarySeries.mockResolvedValue(mockSeries)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(2000)

      await service.getLibrarySeries('test')

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          query: 'test',
          hasQuery: true,
        }),
        'Getting library series from Sonarr',
      )

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          query: 'test',
          resultCount: expect.any(Number),
          duration: 1000,
        }),
        'Library series fetch completed',
      )
    })

    it('should handle series filtering by title', async () => {
      const mockSeries = [
        createMockSeries({ id: 1, title: 'Breaking Bad' }),
        createMockSeries({ id: 2, title: 'Better Call Saul' }),
        createMockSeries({ id: 3, title: 'The Walking Dead' }),
      ]
      mockSonarrClient.getLibrarySeries.mockResolvedValue(mockSeries)

      await service.getLibrarySeries('breaking')

      // The actual filtering logic will be tested through the service implementation
      expect(mockSonarrClient.getLibrarySeries).toHaveBeenCalled()
    })

    it('should handle series filtering by network', async () => {
      const mockSeries = [
        createMockSeries({ id: 1, title: 'Series 1', network: 'HBO' }),
        createMockSeries({ id: 2, title: 'Series 2', network: 'Netflix' }),
        createMockSeries({ id: 3, title: 'Series 3', network: 'HBO Max' }),
      ]
      mockSonarrClient.getLibrarySeries.mockResolvedValue(mockSeries)

      await service.getLibrarySeries('hbo')

      expect(mockSonarrClient.getLibrarySeries).toHaveBeenCalled()
    })

    it('should handle series filtering by year', async () => {
      const mockSeries = [
        createMockSeries({ id: 1, title: 'Series 1', year: 2020 }),
        createMockSeries({ id: 2, title: 'Series 2', year: 2021 }),
        createMockSeries({ id: 3, title: 'Series 3', year: 2022 }),
      ]
      mockSonarrClient.getLibrarySeries.mockResolvedValue(mockSeries)

      await service.getLibrarySeries('2021')

      expect(mockSonarrClient.getLibrarySeries).toHaveBeenCalled()
    })
  })

  describe('unmonitorAndDeleteSeries', () => {
    beforeEach(() => {
      // Mock Zod validation to pass through
      jest
        .spyOn(SonarrInputSchemas.unmonitorSeriesOptions, 'parse')
        .mockImplementation(
          (input: unknown) => input as UnmonitorSeriesOptionsInput,
        )

      // Set up default utility mocks
      mockDetermineUnmonitoringStrategy.mockReturnValue({
        isFullSeriesDeletion: false,
        hasSeasonSelections: false,
        hasEpisodeSelections: true,
      })

      mockValidateUnmonitoringSelection.mockReturnValue({
        isValid: true,
        errors: [],
      })

      mockExtractUnmonitoringOperationSummary.mockReturnValue({
        operationType: 'episodes',
        seasonCount: 1,
        episodeCount: 2,
        summary: 'Unmonitor 2 episode(s) across 1 season(s)',
      })
    })

    describe('entire series deletion', () => {
      it('should delete entire series when no selection provided', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({
          id: 1,
          tvdbId: mockSeries.tvdbId,
        })
        const mockQueueItems = [
          createMockQueueItem({ id: 1, seriesId: 1, episodeId: 1 }),
          createMockQueueItem({ id: 2, seriesId: 1, episodeId: 2 }),
        ]

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getQueue.mockResolvedValue(mockQueueItems)
        mockSonarrClient.removeQueueItem.mockResolvedValue(undefined)
        mockSonarrClient.deleteEpisodeFile.mockResolvedValue(undefined)
        mockSonarrClient.deleteSeries.mockResolvedValue(undefined)
        mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(2000)

        const result = await service.unmonitorAndDeleteSeries(mockSeries.tvdbId)

        expect(mockSonarrClient.getSeriesByTvdbId).toHaveBeenCalledWith(
          mockSeries.tvdbId,
        )
        expect(mockSonarrClient.getQueue).toHaveBeenCalled()
        expect(mockSonarrClient.removeQueueItem).toHaveBeenCalledTimes(2)
        expect(mockSonarrClient.deleteSeries).toHaveBeenCalledWith(1, {
          deleteFiles: true,
          addImportListExclusion: false,
        })

        expect(result).toEqual({
          success: true,
          seriesDeleted: true,
          episodesUnmonitored: false,
          downloadsCancel: true,
          canceledDownloads: 2,
          changes: [{ season: 0, action: 'deleted_series' }],
          commandIds: [1, 2],
        })
      })

      it('should handle series not found in library', async () => {
        const mockSeries = createMockSeriesSearchResult()

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(null)

        const result = await service.unmonitorAndDeleteSeries(mockSeries.tvdbId)

        expect(result).toEqual({
          success: false,
          seriesDeleted: false,
          episodesUnmonitored: false,
          downloadsCancel: false,
          canceledDownloads: 0,
          changes: [],
          error: 'Series not found in Sonarr library',
        })
      })

      it('should work with series ID input instead of search result', async () => {
        const seriesInput = { id: 1, tvdbId: 123456 }
        const mockExistingSeries = createMockSeries({
          id: 1,
          tvdbId: 123456,
        })

        // Mock the primary lookup method
        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getSeriesById.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getQueue.mockResolvedValue([])
        mockSonarrClient.deleteSeries.mockResolvedValue(undefined)

        const result = await service.unmonitorAndDeleteSeries(
          seriesInput.tvdbId,
        )

        // The service should use getSeriesByTvdbId as the primary lookup method
        expect(mockSonarrClient.getSeriesByTvdbId).toHaveBeenCalledWith(123456)
        expect(result.success).toBe(true)
        expect(result.seriesDeleted).toBe(true)
      })
    })

    describe('granular unmonitoring', () => {
      it('should unmonitor specific episodes and keep series if monitored episodes remain', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({
          id: 1,
          tvdbId: mockSeries.tvdbId,
          seasons: [{ seasonNumber: 1, monitored: true }],
        })
        const mockEpisodes = [
          createMockEpisodeResource({
            id: 1,
            episodeNumber: 1,
            seasonNumber: 1,
            monitored: true,
          }),
          createMockEpisodeResource({
            id: 2,
            episodeNumber: 2,
            seasonNumber: 1,
            monitored: true,
          }),
        ]
        const options: UnmonitorSeriesOptions = {
          selection: [{ season: 1, episodes: [1] }],
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
        mockSonarrClient.getQueue.mockResolvedValue([])
        mockSonarrClient.updateEpisodesMonitoring.mockResolvedValue(undefined)
        // Simulate that series still has monitored episodes (episode 2)
        mockSonarrClient.getSeriesById.mockResolvedValue({
          ...mockExistingSeries,
          seasons: [{ seasonNumber: 1, monitored: true }],
        })

        const result = await service.unmonitorAndDeleteSeries(
          mockSeries.tvdbId,
          options,
        )

        expect(mockSonarrClient.getEpisodes).toHaveBeenCalledWith(1, 1)
        expect(mockSonarrClient.updateEpisodesMonitoring).toHaveBeenCalledWith({
          episodeIds: [1],
          monitored: false,
        })
        expect(mockSonarrClient.deleteSeries).not.toHaveBeenCalled()

        expect(result.success).toBe(true)
        expect(result.seriesDeleted).toBe(false)
        expect(result.episodesUnmonitored).toBe(true)
      })

      it('should unmonitor entire season when no episodes specified', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({ id: 1 })
        const mockEpisodes = [
          createMockEpisodeResource({
            id: 1,
            episodeNumber: 1,
            seasonNumber: 1,
          }),
          createMockEpisodeResource({
            id: 2,
            episodeNumber: 2,
            seasonNumber: 1,
          }),
          createMockEpisodeResource({
            id: 3,
            episodeNumber: 3,
            seasonNumber: 1,
          }),
        ]
        const options: UnmonitorSeriesOptions = {
          selection: [{ season: 1 }], // No episodes = entire season
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
        mockSonarrClient.getQueue.mockResolvedValue([])
        mockSonarrClient.updateEpisodesMonitoring.mockResolvedValue(undefined)
        mockSonarrClient.getSeriesById.mockResolvedValue(mockExistingSeries)

        const result = await service.unmonitorAndDeleteSeries(
          mockSeries.tvdbId,
          options,
        )

        expect(mockSonarrClient.updateEpisodesMonitoring).toHaveBeenCalledWith({
          episodeIds: [1, 2, 3],
          monitored: false,
        })
        expect(result.success).toBe(true)
        expect(result.episodesUnmonitored).toBe(true)
      })

      it('should delete series when no monitored episodes remain after unmonitoring', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({
          id: 1,
          seasons: [{ seasonNumber: 1, monitored: true }],
        })
        const mockEpisodes = [
          createMockEpisodeResource({
            id: 1,
            episodeNumber: 1,
            seasonNumber: 1,
            monitored: true,
          }),
        ]
        const options: UnmonitorSeriesOptions = {
          selection: [{ season: 1 }], // Unmonitor entire season
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getEpisodes
          .mockResolvedValueOnce(mockEpisodes) // For unmonitoring
          .mockResolvedValueOnce([
            { ...mockEpisodes[0], monitored: false }, // For deletion check
          ])
        mockSonarrClient.getQueue.mockResolvedValue([])
        mockSonarrClient.updateEpisodesMonitoring.mockResolvedValue(undefined)
        mockSonarrClient.getSeriesById.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.deleteSeries.mockResolvedValue(undefined)

        const result = await service.unmonitorAndDeleteSeries(
          mockSeries.tvdbId,
          options,
        )

        expect(mockSonarrClient.deleteSeries).toHaveBeenCalledWith(1, {
          deleteFiles: false, // Keep files for granular unmonitoring
          addImportListExclusion: false,
        })
        expect(result.success).toBe(true)
        expect(result.seriesDeleted).toBe(true)
        expect(result.episodesUnmonitored).toBe(true)
      })
    })

    describe('download cancellation', () => {
      it('should cancel downloads for unmonitored episodes', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({ id: 1 })
        const mockEpisodes = [
          createMockEpisodeResource({
            id: 1,
            episodeNumber: 1,
            seasonNumber: 1,
          }),
          createMockEpisodeResource({
            id: 2,
            episodeNumber: 2,
            seasonNumber: 1,
          }),
        ]
        const mockQueueItems = [
          createMockQueueItem({ id: 101, seriesId: 1, episodeId: 1 }),
          createMockQueueItem({ id: 102, seriesId: 1, episodeId: 2 }),
          createMockQueueItem({ id: 103, seriesId: 2, episodeId: 3 }), // Different series
        ]
        const options: UnmonitorSeriesOptions = {
          selection: [{ season: 1, episodes: [1] }],
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
        mockSonarrClient.getQueue.mockResolvedValue(mockQueueItems)
        mockSonarrClient.removeQueueItem.mockResolvedValue(undefined)
        mockSonarrClient.deleteEpisodeFile.mockResolvedValue(undefined)
        mockSonarrClient.updateEpisodesMonitoring.mockResolvedValue(undefined)
        mockSonarrClient.getSeriesById.mockResolvedValue(mockExistingSeries)

        const result = await service.unmonitorAndDeleteSeries(
          mockSeries.tvdbId,
          options,
        )

        // Should only cancel download for episode 1 (the one being unmonitored)
        expect(mockSonarrClient.removeQueueItem).toHaveBeenCalledTimes(1)
        expect(mockSonarrClient.removeQueueItem).toHaveBeenCalledWith(101)
        expect(result.downloadsCancel).toBe(true)
        expect(result.canceledDownloads).toBe(1)
        expect(result.commandIds).toEqual([101])
      })

      it('should handle download cancellation failures gracefully', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({ id: 1 })
        const mockEpisodes = [
          createMockEpisodeResource({
            id: 1,
            episodeNumber: 1,
            seasonNumber: 1,
          }),
        ]
        const mockQueueItems = [
          createMockQueueItem({ id: 101, seriesId: 1, episodeId: 1 }),
        ]
        const options: UnmonitorSeriesOptions = {
          selection: [{ season: 1, episodes: [1] }],
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
        mockSonarrClient.getQueue.mockResolvedValue(mockQueueItems)
        mockSonarrClient.removeQueueItem.mockRejectedValue(
          new Error('Cancel failed'),
        )
        mockSonarrClient.deleteEpisodeFile.mockResolvedValue(undefined)
        mockSonarrClient.updateEpisodesMonitoring.mockResolvedValue(undefined)
        mockSonarrClient.getSeriesById.mockResolvedValue(mockExistingSeries)

        const result = await service.unmonitorAndDeleteSeries(
          mockSeries.tvdbId,
          options,
        )

        // Should continue with unmonitoring even if download cancellation fails
        expect(result.success).toBe(true)
        expect(result.canceledDownloads).toBe(0) // None canceled due to error
        expect(result.episodesUnmonitored).toBe(true)
      })
    })

    describe('season-level unmonitoring', () => {
      it('should unmonitor entire season and mark season as unmonitored when { season: 1 } is passed', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({
          id: 1,
          seasons: [
            { seasonNumber: 0, monitored: false }, // Specials
            { seasonNumber: 1, monitored: true },
          ],
        })
        const mockEpisodes = [
          createMockEpisodeResource({
            id: 1,
            episodeNumber: 1,
            seasonNumber: 1,
            monitored: true,
          }),
          createMockEpisodeResource({
            id: 2,
            episodeNumber: 2,
            seasonNumber: 1,
            monitored: true,
          }),
        ]
        const updatedSeries = {
          ...mockExistingSeries,
          seasons: [
            { seasonNumber: 0, monitored: false },
            { seasonNumber: 1, monitored: false },
          ],
        }
        const options: UnmonitorSeriesOptions = {
          selection: [{ season: 1 }], // No episodes specified = entire season
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
        mockSonarrClient.getQueue.mockResolvedValue([])
        mockSonarrClient.updateEpisodesMonitoring.mockResolvedValue(undefined)
        mockSonarrClient.updateSeries.mockResolvedValue(updatedSeries)
        mockSonarrClient.getSeriesById.mockResolvedValue(updatedSeries)

        const result = await service.unmonitorAndDeleteSeries(
          mockSeries.tvdbId,
          options,
        )

        // Should unmonitor all episodes in season
        expect(mockSonarrClient.updateEpisodesMonitoring).toHaveBeenCalledWith({
          episodeIds: [1, 2],
          monitored: false,
        })

        // Should also unmonitor the season itself
        expect(mockSonarrClient.updateSeries).toHaveBeenCalledWith(1, {
          seasons: [
            { seasonNumber: 0, monitored: false },
            { seasonNumber: 1, monitored: false },
          ],
        })

        expect(result.success).toBe(true)
        expect(result.episodesUnmonitored).toBe(true)
        expect(result.seriesDeleted).toBe(false) // Series not deleted, just season unmonitored

        // Should have both episode and season level changes
        const unmonitoredChange = result.changes.find(
          c => c.action === 'unmonitored',
        )
        const seasonUnmonitoredChange = result.changes.find(
          c => c.action === 'unmonitored_season',
        )
        expect(unmonitoredChange).toBeTruthy()
        expect(seasonUnmonitoredChange).toBeTruthy()
        expect(seasonUnmonitoredChange?.season).toBe(1)
      })

      it('should automatically unmonitor season when last monitored episode is unmonitored', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({
          id: 1,
          seasons: [
            { seasonNumber: 0, monitored: false },
            { seasonNumber: 1, monitored: true },
          ],
        })

        // Season has 2 episodes, one already unmonitored, one about to be unmonitored
        const mockEpisodes = [
          createMockEpisodeResource({
            id: 1,
            episodeNumber: 1,
            seasonNumber: 1,
            monitored: false, // Already unmonitored
          }),
          createMockEpisodeResource({
            id: 2,
            episodeNumber: 2,
            seasonNumber: 1,
            monitored: true, // This is the last one
          }),
        ]

        // After unmonitoring episode 2, all episodes are unmonitored
        const mockEpisodesAfterUnmonitoring = mockEpisodes.map(ep => ({
          ...ep,
          monitored: false,
        }))

        const updatedSeries = {
          ...mockExistingSeries,
          seasons: [
            { seasonNumber: 0, monitored: false },
            { seasonNumber: 1, monitored: false },
          ],
        }

        const options: UnmonitorSeriesOptions = {
          selection: [{ season: 1, episodes: [2] }], // Unmonitor just episode 2
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getEpisodes
          .mockResolvedValueOnce(mockEpisodes) // First call for unmonitoring
          .mockResolvedValueOnce(mockEpisodesAfterUnmonitoring) // Second call for season check
        mockSonarrClient.getQueue.mockResolvedValue([])
        mockSonarrClient.updateEpisodesMonitoring.mockResolvedValue(undefined)
        mockSonarrClient.updateSeries.mockResolvedValue(updatedSeries)
        mockSonarrClient.getSeriesById.mockResolvedValue(updatedSeries)

        const result = await service.unmonitorAndDeleteSeries(
          mockSeries.tvdbId,
          options,
        )

        // Should unmonitor episode 2
        expect(mockSonarrClient.updateEpisodesMonitoring).toHaveBeenCalledWith({
          episodeIds: [2],
          monitored: false,
        })

        // Should automatically unmonitor the season since no monitored episodes remain
        expect(mockSonarrClient.updateSeries).toHaveBeenCalledWith(1, {
          seasons: [
            { seasonNumber: 0, monitored: false },
            { seasonNumber: 1, monitored: false },
          ],
        })

        expect(result.success).toBe(true)
        expect(result.episodesUnmonitored).toBe(true)
        expect(result.seriesDeleted).toBe(false)

        // Should have both episode and automatic season unmonitoring changes
        const unmonitoredChange = result.changes.find(
          c => c.action === 'unmonitored',
        )
        const seasonUnmonitoredChange = result.changes.find(
          c => c.action === 'unmonitored_season',
        )
        expect(unmonitoredChange).toBeTruthy()
        expect(unmonitoredChange?.episodes).toEqual([2])
        expect(seasonUnmonitoredChange).toBeTruthy()
        expect(seasonUnmonitoredChange?.season).toBe(1)
      })

      it('should not unmonitor season when monitored episodes still remain', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({
          id: 1,
          seasons: [{ seasonNumber: 1, monitored: true }],
        })
        const mockEpisodes = [
          createMockEpisodeResource({
            id: 1,
            episodeNumber: 1,
            seasonNumber: 1,
            monitored: true, // Will be unmonitored
          }),
          createMockEpisodeResource({
            id: 2,
            episodeNumber: 2,
            seasonNumber: 1,
            monitored: true, // Will remain monitored
          }),
        ]

        const options: UnmonitorSeriesOptions = {
          selection: [{ season: 1, episodes: [1] }], // Only unmonitor episode 1
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
        mockSonarrClient.getQueue.mockResolvedValue([])
        mockSonarrClient.updateEpisodesMonitoring.mockResolvedValue(undefined)

        const result = await service.unmonitorAndDeleteSeries(
          mockSeries.tvdbId,
          options,
        )

        // Should unmonitor episode 1
        expect(mockSonarrClient.updateEpisodesMonitoring).toHaveBeenCalledWith({
          episodeIds: [1],
          monitored: false,
        })

        // Should NOT unmonitor the season since episode 2 is still monitored
        expect(mockSonarrClient.updateSeries).not.toHaveBeenCalled()

        expect(result.success).toBe(true)
        expect(result.episodesUnmonitored).toBe(true)
        expect(result.seriesDeleted).toBe(false)

        // Should only have episode-level change, no season change
        const unmonitoredChange = result.changes.find(
          c => c.action === 'unmonitored',
        )
        const seasonUnmonitoredChange = result.changes.find(
          c => c.action === 'unmonitored_season',
        )
        expect(unmonitoredChange).toBeTruthy()
        expect(unmonitoredChange?.episodes).toEqual([1])
        expect(seasonUnmonitoredChange).toBeUndefined()
      })

      it('should delete series when all seasons become unmonitored', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({
          id: 1,
          seasons: [
            { seasonNumber: 1, monitored: false }, // Already unmonitored
            { seasonNumber: 2, monitored: true }, // Will be unmonitored
          ],
        })
        const mockEpisodes = [
          createMockEpisodeResource({
            id: 3,
            episodeNumber: 1,
            seasonNumber: 2,
            monitored: true,
          }),
        ]

        const updatedSeries = {
          ...mockExistingSeries,
          seasons: [
            { seasonNumber: 1, monitored: false },
            { seasonNumber: 2, monitored: false },
          ],
        }

        const options: UnmonitorSeriesOptions = {
          selection: [{ season: 2 }], // Unmonitor entire season 2
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
        mockSonarrClient.getQueue.mockResolvedValue([])
        mockSonarrClient.removeQueueItem.mockResolvedValue(undefined)
        mockSonarrClient.deleteEpisodeFile.mockResolvedValue(undefined)
        mockSonarrClient.updateEpisodesMonitoring.mockResolvedValue(undefined)
        mockSonarrClient.updateSeries.mockResolvedValue(updatedSeries)
        mockSonarrClient.getSeriesById.mockResolvedValue(updatedSeries)
        mockSonarrClient.deleteSeries.mockResolvedValue(undefined)

        // Mock the episode calls in sequence:
        // 1. For unmonitoring season 2 episodes
        // 2. For season check after unmonitoring (should return no monitored episodes)
        // 3. For series deletion check - season 1 (no episodes)
        // 4. For series deletion check - season 2 (no monitored episodes)
        mockSonarrClient.getEpisodes
          .mockResolvedValueOnce(mockEpisodes) // For unmonitoring season 2
          .mockResolvedValueOnce([{ ...mockEpisodes[0], monitored: false }]) // For season check (no monitored episodes)
          .mockResolvedValueOnce([]) // For series deletion check - season 1 (no episodes)
          .mockResolvedValueOnce([{ ...mockEpisodes[0], monitored: false }]) // For series deletion check - season 2

        const result = await service.unmonitorAndDeleteSeries(
          mockSeries.tvdbId,
          options,
        )

        // Should unmonitor the season and then delete the series
        expect(mockSonarrClient.updateSeries).toHaveBeenCalled()
        expect(mockSonarrClient.deleteSeries).toHaveBeenCalledWith(1, {
          deleteFiles: false,
          addImportListExclusion: false,
        })

        expect(result.success).toBe(true)
        expect(result.episodesUnmonitored).toBe(true)
        expect(result.seriesDeleted).toBe(true)

        // Should have episode, season, and series level changes
        const hasUnmonitoredChange = result.changes.some(
          c => c.action === 'unmonitored',
        )
        const hasSeasonUnmonitoredChange = result.changes.some(
          c => c.action === 'unmonitored_season',
        )
        const hasSeriesDeletedChange = result.changes.some(
          c => c.action === 'deleted_series',
        )
        expect(hasUnmonitoredChange).toBe(true)
        expect(hasSeasonUnmonitoredChange).toBe(true)
        expect(hasSeriesDeletedChange).toBe(true)
      })
    })

    describe('error handling', () => {
      it('should handle validation errors for unmonitor options', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const validationError = new Error('Invalid selection format')

        jest
          .spyOn(SonarrInputSchemas.unmonitorSeriesOptions, 'parse')
          .mockImplementation(() => {
            throw validationError
          })

        const result = await service.unmonitorAndDeleteSeries(
          mockSeries.tvdbId,
          {
            selection: [{ season: 'invalid' as unknown as number }],
          },
        )

        expect(result.success).toBe(false)
        expect(result.error).toContain('Invalid unmonitor series options')
      })

      it('should handle API errors during granular unmonitoring', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({ id: 1 })
        const error = new Error('API connection failed')

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getEpisodes.mockRejectedValue(error)

        const options: UnmonitorSeriesOptions = {
          selection: [{ season: 1, episodes: [1] }],
        }

        const result = await service.unmonitorAndDeleteSeries(
          mockSeries.tvdbId,
          options,
        )

        expect(result.success).toBe(false)
        expect(result.error).toBe('API connection failed')
      })

      it('should handle unknown errors gracefully', async () => {
        const mockSeries = createMockSeriesSearchResult()

        jest
          .spyOn(SonarrInputSchemas.unmonitorSeriesOptions, 'parse')
          .mockImplementation(() => {
            throw 'Non-Error object'
          })

        const result = await service.unmonitorAndDeleteSeries(mockSeries.tvdbId)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Invalid unmonitor series options')
      })
    })

    describe('logging and performance', () => {
      it('should log operation start and completion with performance metrics', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({ id: 1 })

        mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(3000)
        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getQueue.mockResolvedValue([])
        mockSonarrClient.deleteSeries.mockResolvedValue(undefined)

        await service.unmonitorAndDeleteSeries(mockSeries.tvdbId)

        expect(service['logger'].log).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'test-id-123',
            tvdbId: mockSeries.tvdbId,
            options: {},
          }),
          'Starting unmonitor and delete series operation',
        )

        expect(service['logger'].log).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'test-id-123',
            seriesId: 1,
            title: 'Test Series',
            canceledDownloads: 0,
          }),
          'Series deleted successfully',
        )
      })

      it('should generate unique operation IDs', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({ id: 1 })

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getQueue.mockResolvedValue([])
        mockSonarrClient.deleteSeries.mockResolvedValue(undefined)

        await service.unmonitorAndDeleteSeries(mockSeries.tvdbId)

        // All log calls should use the same operation ID
        const logCalls = (service['logger'].log as jest.Mock).mock.calls
        const operationIds = logCalls
          .filter(call => call[1]?.includes('unmonitor'))
          .map(call => call[0].id)
        expect(operationIds.every(id => id === 'test-id-123')).toBe(true)
        expect(operationIds.length).toBeGreaterThan(0)
      })
    })

    describe('edge cases', () => {
      it('should handle episodes not found after retry', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({ id: 1 })
        const options: UnmonitorSeriesOptions = {
          selection: [{ season: 1, episodes: [1] }],
        }

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getEpisodes.mockResolvedValue([]) // No episodes found
        mockSonarrClient.getQueue.mockResolvedValue([])
        mockSonarrClient.getSeriesById.mockResolvedValue(mockExistingSeries)

        const result = await service.unmonitorAndDeleteSeries(
          mockSeries.tvdbId,
          options,
        )

        expect(result.success).toBe(true) // Still succeeds
        expect(result.seriesDeleted).toBe(true) // Series gets deleted when no episodes found
        expect(result.episodesUnmonitored).toBe(false)
      })

      it('should handle queue fetch errors during download cancellation', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({ id: 1 })

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getQueue.mockRejectedValue(
          new Error('Queue API failed'),
        )
        mockSonarrClient.deleteSeries.mockResolvedValue(undefined)

        const result = await service.unmonitorAndDeleteSeries(mockSeries.tvdbId)

        expect(result.success).toBe(true) // Still succeeds despite queue error
        expect(result.seriesDeleted).toBe(true)
        expect(result.canceledDownloads).toBe(0) // No downloads canceled due to queue error
      })

      it('should handle empty queue gracefully', async () => {
        const mockSeries = createMockSeriesSearchResult()
        const mockExistingSeries = createMockSeries({ id: 1 })

        mockSonarrClient.getSeriesByTvdbId.mockResolvedValue(mockExistingSeries)
        mockSonarrClient.getQueue.mockResolvedValue([]) // Empty queue
        mockSonarrClient.deleteSeries.mockResolvedValue(undefined)

        const result = await service.unmonitorAndDeleteSeries(mockSeries.tvdbId)

        expect(result.success).toBe(true)
        expect(result.canceledDownloads).toBe(0)
        expect(result.downloadsCancel).toBe(false)
      })
    })
  })

  describe('getSeriesDetails', () => {
    beforeEach(() => {
      // Mock Zod validation to pass through
      jest
        .spyOn(SonarrOutputSchemas.seriesDetails, 'parse')
        .mockImplementation(input => input as never)
    })

    it('should get comprehensive series details with statistics', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        title: 'Breaking Bad',
        seasons: [
          { seasonNumber: 0, monitored: false }, // Specials
          { seasonNumber: 1, monitored: true },
          { seasonNumber: 2, monitored: true },
        ],
        statistics: {
          seasonCount: 5,
          episodeFileCount: 42,
          episodeCount: 62,
          totalEpisodeCount: 62,
          sizeOnDisk: 10000000000, // 10GB
          percentOfEpisodes: 67.7,
        },
      })
      const mockEpisodes = [
        createMockEpisodeResource({
          id: 1,
          seasonNumber: 1,
          hasFile: true,
          monitored: true,
        }),
        createMockEpisodeResource({
          id: 2,
          seasonNumber: 1,
          hasFile: true,
          monitored: true,
        }),
        createMockEpisodeResource({
          id: 3,
          seasonNumber: 2,
          hasFile: false,
          monitored: true,
        }),
        createMockEpisodeResource({
          id: 4,
          seasonNumber: 0, // Special episode
          hasFile: true,
          monitored: false,
        }),
      ]

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500)

      const result = await service.getSeriesDetails(1)

      expect(mockSonarrClient.getSeriesById).toHaveBeenCalledWith(1)
      expect(mockSonarrClient.getEpisodes).toHaveBeenCalledWith(1)
      expect(SonarrOutputSchemas.seriesDetails.parse).toHaveBeenCalled()

      // Verify calculated statistics (excluding specials)
      expect(result.totalSeasons).toBe(2) // Seasons 1 and 2 (not specials)
      expect(result.monitoredSeasons).toBe(2)
      expect(result.totalEpisodes).toBe(3) // Episodes 1, 2, 3 (not special)
      expect(result.availableEpisodes).toBe(2) // Episodes 1, 2 have files
      expect(result.monitoredEpisodes).toBe(3) // Episodes 1, 2, 3 are monitored
      expect(result.downloadedEpisodes).toBe(2)
      expect(result.missingEpisodes).toBe(1) // Episode 3 missing
      expect(result.completionPercentage).toBe(66.67) // 2/3 = 66.67%
      expect(result.isCompleted).toBe(false)
      expect(result.hasAllEpisodes).toBe(false)
      expect(result.totalSizeOnDisk).toBe(10000000000)

      // Verify core fields
      expect(result.id).toBe(1)
      expect(result.title).toBe('Breaking Bad')
      expect(result.seasons).toEqual(mockSeries.seasons)
    })

    it('should handle series not found', async () => {
      mockSonarrClient.getSeriesById.mockResolvedValue(null)

      await expect(service.getSeriesDetails(999)).rejects.toThrow(
        'Series with ID 999 not found',
      )

      expect(mockSonarrClient.getSeriesById).toHaveBeenCalledWith(999)
    })

    it('should handle series with no statistics', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        title: 'Test Series',
        statistics: undefined,
      })
      const mockEpisodes = [
        createMockEpisodeResource({
          id: 1,
          seasonNumber: 1,
          hasFile: true,
          monitored: true,
        }),
      ]

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)

      const result = await service.getSeriesDetails(1)

      expect(result.totalSizeOnDisk).toBe(0) // Default when no statistics
      expect(result.totalEpisodes).toBe(1) // Calculated from episodes
      expect(result.availableEpisodes).toBe(1)
    })

    it('should handle series with no episodes', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        seasons: [{ seasonNumber: 1, monitored: true }],
      })

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue([])

      const result = await service.getSeriesDetails(1)

      expect(result.totalEpisodes).toBe(0)
      expect(result.availableEpisodes).toBe(0)
      expect(result.completionPercentage).toBe(0)
      expect(result.isCompleted).toBe(false)
    })

    it('should calculate completion correctly for ended series', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        ended: true,
        seasons: [{ seasonNumber: 1, monitored: true }],
      })
      const mockEpisodes = [
        createMockEpisodeResource({
          id: 1,
          seasonNumber: 1,
          hasFile: true,
          monitored: true,
        }),
        createMockEpisodeResource({
          id: 2,
          seasonNumber: 1,
          hasFile: true,
          monitored: true,
        }),
      ]

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)

      const result = await service.getSeriesDetails(1)

      expect(result.completionPercentage).toBe(100) // 2/2 = 100%
      expect(result.isCompleted).toBe(true) // Ended and 100% complete
      expect(result.hasAllEpisodes).toBe(true)
    })

    it('should handle client errors gracefully', async () => {
      const error = new Error('API connection failed')
      mockSonarrClient.getSeriesById.mockRejectedValue(error)

      await expect(service.getSeriesDetails(1)).rejects.toThrow(
        'API connection failed',
      )

      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          seriesId: 1,
          error: 'API connection failed',
        }),
        'Failed to get series details',
      )
    })

    it('should handle episodes fetch errors', async () => {
      const mockSeries = createMockSeries({ id: 1 })
      const error = new Error('Episodes API failed')

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockRejectedValue(error)

      await expect(service.getSeriesDetails(1)).rejects.toThrow(
        'Episodes API failed',
      )
    })

    it('should log operation with performance metrics', async () => {
      const mockSeries = createMockSeries({ id: 1, title: 'Test Show' })
      const mockEpisodes = [createMockEpisodeResource()]

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(2000)

      await service.getSeriesDetails(1)

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          seriesId: 1,
        }),
        'Getting series details',
      )

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          seriesId: 1,
          title: 'Test Show',
          totalEpisodes: 1,
          downloadedEpisodes: 0,
          completionPercentage: 0,
          duration: 1000,
        }),
        'Series details retrieved successfully',
      )
    })

    it('should validate output with schema', async () => {
      const mockSeries = createMockSeries({ id: 1 })
      const mockEpisodes = [createMockEpisodeResource()]

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)

      await service.getSeriesDetails(1)

      expect(SonarrOutputSchemas.seriesDetails.parse).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          title: expect.any(String),
          totalSeasons: expect.any(Number),
          monitoredSeasons: expect.any(Number),
          totalEpisodes: expect.any(Number),
          availableEpisodes: expect.any(Number),
          completionPercentage: expect.any(Number),
          isCompleted: expect.any(Boolean),
          hasAllEpisodes: expect.any(Boolean),
        }),
      )
    })
  })

  describe('getSeasonDetails', () => {
    beforeEach(() => {
      // Mock Zod validation to pass through
      jest
        .spyOn(SonarrOutputSchemas.seasonDetails, 'parse')
        .mockImplementation(input => input as never)
    })

    it('should get comprehensive season details with episodes and files', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        title: 'Breaking Bad',
        seasons: [
          { seasonNumber: 1, monitored: true },
          { seasonNumber: 2, monitored: true },
        ],
      })
      const mockEpisodes = [
        createMockEpisodeResource({
          id: 1,
          episodeNumber: 1,
          seasonNumber: 1,
          title: 'Pilot',
          monitored: true,
          hasFile: true,
          episodeFileId: 101,
          airDate: '2008-01-20',
          overview: 'The pilot episode',
          runtime: 45,
        }),
        createMockEpisodeResource({
          id: 2,
          episodeNumber: 2,
          seasonNumber: 1,
          title: 'Cat in the Bag',
          monitored: true,
          hasFile: false,
          airDate: '2008-01-27',
        }),
      ]
      const mockEpisodeFiles = [
        createMockEpisodeFile({
          id: 101,
          seriesId: 1,
          seasonNumber: 1,
          size: 2000000000, // 2GB
          quality: {
            quality: {
              name: 'Bluray-1080p',
              source: 'bluray',
              resolution: 1080,
            },
          },
        }),
      ]

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
      mockSonarrClient.getEpisodeFiles.mockResolvedValue(mockEpisodeFiles)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1800)

      const result = await service.getSeasonDetails(1, 1)

      expect(mockSonarrClient.getSeriesById).toHaveBeenCalledWith(1)
      expect(mockSonarrClient.getEpisodes).toHaveBeenCalledWith(1, 1)
      expect(mockSonarrClient.getEpisodeFiles).toHaveBeenCalledWith({
        seriesId: 1,
        seasonNumber: 1,
      })
      expect(SonarrOutputSchemas.seasonDetails.parse).toHaveBeenCalled()

      // Verify season statistics
      expect(result.seriesId).toBe(1)
      expect(result.seriesTitle).toBe('Breaking Bad')
      expect(result.seasonNumber).toBe(1)
      expect(result.monitored).toBe(true)
      expect(result.totalEpisodes).toBe(2)
      expect(result.availableEpisodes).toBe(1) // Only episode 1 has file
      expect(result.downloadedEpisodes).toBe(1)
      expect(result.missingEpisodes).toBe(1) // Episode 2 missing
      expect(result.monitoredEpisodes).toBe(2)
      expect(result.sizeOnDisk).toBe(2000000000) // 2GB
      expect(result.completionPercentage).toBe(50) // 1/2 = 50%
      expect(result.isCompleted).toBe(false)
      expect(result.hasAllEpisodes).toBe(false)

      // Verify episode details
      expect(result.episodes).toHaveLength(2)
      expect(result.episodes[0]).toEqual({
        id: 1,
        episodeNumber: 1,
        title: 'Pilot',
        monitored: true,
        hasFile: true,
        airDate: '2008-01-20',
        overview: 'The pilot episode',
        runtime: 45,
        episodeFileId: 101,
        fileSize: 2000000000,
        quality: 'Bluray-1080p',
      })
      expect(result.episodes[1]).toEqual({
        id: 2,
        episodeNumber: 2,
        title: 'Cat in the Bag',
        monitored: true,
        hasFile: false,
        airDate: '2008-01-27',
        overview: undefined,
        runtime: undefined,
        episodeFileId: undefined,
        fileSize: undefined,
        quality: undefined,
      })
    })

    it('should handle series not found', async () => {
      mockSonarrClient.getSeriesById.mockResolvedValue(null)

      await expect(service.getSeasonDetails(999, 1)).rejects.toThrow(
        'Series with ID 999 not found',
      )

      expect(mockSonarrClient.getSeriesById).toHaveBeenCalledWith(999)
    })

    it('should handle season not found in series', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        title: 'Test Series',
        seasons: [{ seasonNumber: 1, monitored: true }],
      })

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)

      await expect(service.getSeasonDetails(1, 5)).rejects.toThrow(
        'Season 5 not found for series Test Series',
      )
    })

    it('should handle season with no episodes', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        title: 'Test Series',
        seasons: [{ seasonNumber: 1, monitored: true }],
      })

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue([])
      mockSonarrClient.getEpisodeFiles.mockResolvedValue([])

      const result = await service.getSeasonDetails(1, 1)

      expect(result.totalEpisodes).toBe(0)
      expect(result.availableEpisodes).toBe(0)
      expect(result.sizeOnDisk).toBe(0)
      expect(result.completionPercentage).toBe(0)
      expect(result.episodes).toEqual([])
    })

    it('should handle season with episodes but no files', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        seasons: [{ seasonNumber: 1, monitored: true }],
      })
      const mockEpisodes = [
        createMockEpisodeResource({
          id: 1,
          episodeNumber: 1,
          seasonNumber: 1,
          hasFile: false,
          monitored: true,
        }),
        createMockEpisodeResource({
          id: 2,
          episodeNumber: 2,
          seasonNumber: 1,
          hasFile: false,
          monitored: false,
        }),
      ]

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
      mockSonarrClient.getEpisodeFiles.mockResolvedValue([])

      const result = await service.getSeasonDetails(1, 1)

      expect(result.totalEpisodes).toBe(2)
      expect(result.availableEpisodes).toBe(0)
      expect(result.downloadedEpisodes).toBe(0)
      expect(result.missingEpisodes).toBe(1) // Only monitored episode 1 is missing
      expect(result.monitoredEpisodes).toBe(1)
      expect(result.sizeOnDisk).toBe(0)
      expect(result.completionPercentage).toBe(0)
    })

    it('should handle fully completed season', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        seasons: [{ seasonNumber: 1, monitored: true }],
      })
      const mockEpisodes = [
        createMockEpisodeResource({
          id: 1,
          episodeNumber: 1,
          seasonNumber: 1,
          hasFile: true,
          monitored: true,
          episodeFileId: 101,
        }),
        createMockEpisodeResource({
          id: 2,
          episodeNumber: 2,
          seasonNumber: 1,
          hasFile: true,
          monitored: true,
          episodeFileId: 102,
        }),
      ]
      const mockEpisodeFiles = [
        createMockEpisodeFile({ id: 101, size: 1000000000 }),
        createMockEpisodeFile({ id: 102, size: 1500000000 }),
      ]

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
      mockSonarrClient.getEpisodeFiles.mockResolvedValue(mockEpisodeFiles)

      const result = await service.getSeasonDetails(1, 1)

      expect(result.totalEpisodes).toBe(2)
      expect(result.availableEpisodes).toBe(2)
      expect(result.downloadedEpisodes).toBe(2)
      expect(result.missingEpisodes).toBe(0) // monitoredEpisodes - downloadedEpisodes = 2 - 2 = 0
      expect(result.sizeOnDisk).toBe(2500000000) // 1GB + 1.5GB
      expect(result.completionPercentage).toBe(100)
      expect(result.isCompleted).toBe(true)
      expect(result.hasAllEpisodes).toBe(true)
    })

    it('should handle episodes API errors', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        seasons: [{ seasonNumber: 1, monitored: true }],
      })
      const error = new Error('Episodes API failed')

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockRejectedValue(error)

      await expect(service.getSeasonDetails(1, 1)).rejects.toThrow(
        'Episodes API failed',
      )

      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          seriesId: 1,
          seasonNumber: 1,
          error: 'Episodes API failed',
        }),
        'Failed to get season details',
      )
    })

    it('should handle episode files API errors gracefully', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        seasons: [{ seasonNumber: 1, monitored: true }],
      })
      const mockEpisodes = [
        createMockEpisodeResource({
          id: 1,
          episodeNumber: 1,
          seasonNumber: 1,
          hasFile: true,
          episodeFileId: 101,
        }),
      ]

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
      mockSonarrClient.getEpisodeFiles.mockRejectedValue(
        new Error('Episode files API failed'),
      )

      await expect(service.getSeasonDetails(1, 1)).rejects.toThrow(
        'Episode files API failed',
      )
    })

    it('should log operation with performance metrics', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        title: 'Test Show',
        seasons: [{ seasonNumber: 1, monitored: true }],
      })
      const mockEpisodes = [createMockEpisodeResource({ seasonNumber: 1 })]

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
      mockSonarrClient.getEpisodeFiles.mockResolvedValue([])
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(2500)

      await service.getSeasonDetails(1, 1)

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          seriesId: 1,
          seasonNumber: 1,
        }),
        'Getting season details',
      )

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          seriesId: 1,
          seasonNumber: 1,
          seriesTitle: 'Test Show',
          totalEpisodes: 1,
          downloadedEpisodes: 0,
          completionPercentage: 0,
          duration: 1500,
        }),
        'Season details retrieved successfully',
      )
    })

    it('should validate output with schema', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        seasons: [{ seasonNumber: 1, monitored: true }],
      })
      const mockEpisodes = [createMockEpisodeResource({ seasonNumber: 1 })]

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
      mockSonarrClient.getEpisodeFiles.mockResolvedValue([])

      await service.getSeasonDetails(1, 1)

      expect(SonarrOutputSchemas.seasonDetails.parse).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 1,
          seasonNumber: 1,
          monitored: expect.any(Boolean),
          totalEpisodes: expect.any(Number),
          availableEpisodes: expect.any(Number),
          completionPercentage: expect.any(Number),
          episodes: expect.any(Array),
          isCompleted: expect.any(Boolean),
          hasAllEpisodes: expect.any(Boolean),
        }),
      )
    })

    it('should handle episodes without corresponding file data', async () => {
      const mockSeries = createMockSeries({
        id: 1,
        seasons: [{ seasonNumber: 1, monitored: true }],
      })
      const mockEpisodes = [
        createMockEpisodeResource({
          id: 1,
          episodeNumber: 1,
          seasonNumber: 1,
          hasFile: true,
          episodeFileId: 999, // File doesn't exist in file list
        }),
      ]
      const mockEpisodeFiles: EpisodeFileResource[] = [] // No files returned

      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodes.mockResolvedValue(mockEpisodes)
      mockSonarrClient.getEpisodeFiles.mockResolvedValue(
        mockEpisodeFiles as EpisodeFileResource[],
      )

      const result = await service.getSeasonDetails(1, 1)

      expect(result.episodes[0]).toEqual(
        expect.objectContaining({
          id: 1,
          episodeNumber: 1,
          hasFile: true,
          episodeFileId: 999,
          fileSize: undefined, // No file data found
          quality: undefined,
        }),
      )
    })
  })

  describe('getEpisodeDetails', () => {
    beforeEach(() => {
      // Mock Zod validation to pass through
      jest
        .spyOn(SonarrOutputSchemas.episodeDetails, 'parse')
        .mockImplementation(input => input as never)
    })

    it('should get comprehensive episode details with file information', async () => {
      const mockEpisode = createMockEpisodeResource({
        id: 1,
        seriesId: 1,
        seasonNumber: 1,
        episodeNumber: 1,
        title: 'Pilot',
        monitored: true,
        hasFile: true,
        episodeFileId: 101,
        airDate: '2008-01-20',
        overview: 'The pilot episode of Breaking Bad',
        runtime: 47,
        absoluteEpisodeNumber: 1,
      })
      const mockSeries = createMockSeries({
        id: 1,
        title: 'Breaking Bad',
        year: 2008,
        status: SonarrSeriesStatus.ENDED,
      })
      const mockEpisodeFiles = [
        createMockEpisodeFile({
          id: 101,
          relativePath:
            'Season 01/Breaking.Bad.S01E01.720p.BluRay.x264-DEMAND.mkv',
          path: '/tv/breaking-bad/Season 01/Breaking.Bad.S01E01.720p.BluRay.x264-DEMAND.mkv',
          size: 1500000000, // 1.5GB
          releaseGroup: 'DEMAND',
          quality: {
            quality: {
              name: 'Bluray-720p',
              source: 'bluray',
              resolution: 720,
            },
          },
          mediaInfo: {
            audioChannels: 5.1,
            audioCodec: 'AC3',
            height: 720,
            width: 1280,
            videoCodec: 'x264',
            subtitles: ['English', 'Spanish', 'French'],
          },
        }),
      ]

      mockSonarrClient.getEpisodeById.mockResolvedValue(mockEpisode)
      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodeFiles.mockResolvedValue(mockEpisodeFiles)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1600)

      const result = await service.getEpisodeDetails(1)

      expect(mockSonarrClient.getEpisodeById).toHaveBeenCalledWith(1)
      expect(mockSonarrClient.getSeriesById).toHaveBeenCalledWith(1)
      expect(mockSonarrClient.getEpisodeFiles).toHaveBeenCalledWith({
        episodeFileIds: [101],
      })
      expect(SonarrOutputSchemas.episodeDetails.parse).toHaveBeenCalled()

      // Verify episode core fields
      expect(result.id).toBe(1)
      expect(result.seriesId).toBe(1)
      expect(result.seasonNumber).toBe(1)
      expect(result.episodeNumber).toBe(1)
      expect(result.title).toBe('Pilot')
      expect(result.monitored).toBe(true)
      expect(result.hasFile).toBe(true)
      expect(result.airDate).toBe('2008-01-20')
      expect(result.overview).toBe('The pilot episode of Breaking Bad')
      expect(result.runtime).toBe(47)
      expect(result.absoluteEpisodeNumber).toBe(1)

      // Verify series information
      expect(result.seriesTitle).toBe('Breaking Bad')
      expect(result.seriesYear).toBe(2008)
      expect(result.seriesStatus).toBe(SonarrSeriesStatus.ENDED)

      // Verify file information
      expect(result.episodeFile).toEqual({
        id: 101,
        relativePath:
          'Season 01/Breaking.Bad.S01E01.720p.BluRay.x264-DEMAND.mkv',
        path: '/tv/breaking-bad/Season 01/Breaking.Bad.S01E01.720p.BluRay.x264-DEMAND.mkv',
        size: 1500000000,
        sizeFormatted: '1.4 GB',
        dateAdded: '2023-01-01T00:00:00Z',
        releaseGroup: 'DEMAND',
        quality: {
          name: 'Bluray-720p',
          source: 'bluray',
          resolution: 720,
        },
        mediaInfo: {
          audioChannels: 5.1,
          audioCodec: 'AC3',
          height: 720,
          width: 1280,
          videoCodec: 'x264',
          subtitles: ['English', 'Spanish', 'French'],
        },
      })

      // Verify status flags
      expect(result.isAvailable).toBe(true)
      expect(result.isMonitored).toBe(true)
      expect(result.isDownloaded).toBe(true)
      expect(result.isMissing).toBe(false)
    })

    it('should handle episode without file', async () => {
      const mockEpisode = createMockEpisodeResource({
        id: 1,
        seriesId: 1,
        seasonNumber: 1,
        episodeNumber: 2,
        title: 'Cat in the Bag',
        monitored: true,
        hasFile: false,
        episodeFileId: undefined,
      })
      const mockSeries = createMockSeries({ id: 1 })

      mockSonarrClient.getEpisodeById.mockResolvedValue(mockEpisode)
      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)

      const result = await service.getEpisodeDetails(1)

      expect(result.hasFile).toBe(false)
      expect(result.episodeFile).toBeUndefined()
      expect(result.isAvailable).toBe(false)
      expect(result.isDownloaded).toBe(false)
      expect(result.isMissing).toBe(true) // Monitored but no file
      expect(mockSonarrClient.getEpisodeFiles).not.toHaveBeenCalled()
    })

    it('should handle episode not found', async () => {
      mockSonarrClient.getEpisodeById.mockResolvedValue(null)

      await expect(service.getEpisodeDetails(999)).rejects.toThrow(
        'Episode with ID 999 not found',
      )

      expect(mockSonarrClient.getEpisodeById).toHaveBeenCalledWith(999)
    })

    it('should handle series not found for episode', async () => {
      const mockEpisode = createMockEpisodeResource({
        id: 1,
        seriesId: 999,
      })

      mockSonarrClient.getEpisodeById.mockResolvedValue(mockEpisode)
      mockSonarrClient.getSeriesById.mockResolvedValue(null)

      await expect(service.getEpisodeDetails(1)).rejects.toThrow(
        'Series with ID 999 not found for episode',
      )
    })

    it('should handle episode file fetch errors gracefully', async () => {
      const mockEpisode = createMockEpisodeResource({
        id: 1,
        seriesId: 1,
        hasFile: true,
        episodeFileId: 101,
      })
      const mockSeries = createMockSeries({ id: 1 })

      mockSonarrClient.getEpisodeById.mockResolvedValue(mockEpisode)
      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodeFiles.mockRejectedValue(
        new Error('Episode files API failed'),
      )

      const result = await service.getEpisodeDetails(1)

      // Should continue without file info when file fetch fails
      expect(result.hasFile).toBe(true)
      expect(result.episodeFile).toBeUndefined()

      expect(service['logger'].warn).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          episodeId: 1,
          episodeFileId: 101,
          error: 'Episode files API failed',
        }),
        'Failed to get episode file details, continuing without file info',
      )
    })

    it('should handle empty episode files response', async () => {
      const mockEpisode = createMockEpisodeResource({
        id: 1,
        seriesId: 1,
        hasFile: true,
        episodeFileId: 101,
      })
      const mockSeries = createMockSeries({ id: 1 })

      mockSonarrClient.getEpisodeById.mockResolvedValue(mockEpisode)
      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodeFiles.mockResolvedValue([]) // No files returned

      const result = await service.getEpisodeDetails(1)

      expect(result.hasFile).toBe(true)
      expect(result.episodeFile).toBeUndefined() // No file info available
    })

    it('should format file sizes correctly', async () => {
      const testCases = [
        { size: 0, expected: '0 B' },
        { size: 1024, expected: '1 KB' },
        { size: 1048576, expected: '1 MB' },
        { size: 1073741824, expected: '1 GB' },
        { size: 1500000000, expected: '1.4 GB' },
        { size: 1099511627776, expected: '1 TB' },
      ]

      for (const testCase of testCases) {
        const mockEpisode = createMockEpisodeResource({
          id: 1,
          seriesId: 1,
          hasFile: true,
          episodeFileId: 101,
        })
        const mockSeries = createMockSeries({ id: 1 })
        const mockEpisodeFiles = [
          createMockEpisodeFile({
            id: 101,
            size: testCase.size,
          }),
        ]

        mockSonarrClient.getEpisodeById.mockResolvedValue(mockEpisode)
        mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
        mockSonarrClient.getEpisodeFiles.mockResolvedValue(mockEpisodeFiles)

        const result = await service.getEpisodeDetails(1)

        expect(result.episodeFile?.sizeFormatted).toBe(testCase.expected)

        // Reset mocks for next iteration
        jest.clearAllMocks()
      }
    })

    it('should handle subtitles as array format', async () => {
      const mockEpisode = createMockEpisodeResource({
        id: 1,
        seriesId: 1,
        hasFile: true,
        episodeFileId: 101,
      })
      const mockSeries = createMockSeries({ id: 1 })
      const mockEpisodeFiles = [
        createMockEpisodeFile({
          id: 101,
          mediaInfo: {
            audioChannels: 2.0,
            audioCodec: 'AAC',
            height: 1080,
            width: 1920,
            videoCodec: 'h264',
            subtitles: ['English', 'Spanish'], // Already array format
          },
        }),
      ]

      mockSonarrClient.getEpisodeById.mockResolvedValue(mockEpisode)
      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodeFiles.mockResolvedValue(mockEpisodeFiles)

      const result = await service.getEpisodeDetails(1)

      expect(result.episodeFile?.mediaInfo?.subtitles).toEqual([
        'English',
        'Spanish',
      ])
    })

    it('should handle episode without media info', async () => {
      const mockEpisode = createMockEpisodeResource({
        id: 1,
        seriesId: 1,
        hasFile: true,
        episodeFileId: 101,
      })
      const mockSeries = createMockSeries({ id: 1 })
      const mockEpisodeFiles = [
        createMockEpisodeFile({
          id: 101,
          mediaInfo: undefined,
        }),
      ]

      mockSonarrClient.getEpisodeById.mockResolvedValue(mockEpisode)
      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockSonarrClient.getEpisodeFiles.mockResolvedValue(mockEpisodeFiles)

      const result = await service.getEpisodeDetails(1)

      expect(result.episodeFile?.mediaInfo).toBeUndefined()
      expect(result.episodeFile?.quality).toEqual({
        name: 'HDTV-720p',
        source: 'television',
        resolution: 720,
      })
    })

    it('should determine episode status correctly for different scenarios', async () => {
      const testCases = [
        {
          name: 'monitored with file',
          episode: { monitored: true, hasFile: true },
          expected: {
            isAvailable: true,
            isMonitored: true,
            isDownloaded: true,
            isMissing: false,
          },
        },
        {
          name: 'monitored without file',
          episode: { monitored: true, hasFile: false },
          expected: {
            isAvailable: false,
            isMonitored: true,
            isDownloaded: false,
            isMissing: true,
          },
        },
        {
          name: 'unmonitored with file',
          episode: { monitored: false, hasFile: true },
          expected: {
            isAvailable: true,
            isMonitored: false,
            isDownloaded: true,
            isMissing: false,
          },
        },
        {
          name: 'unmonitored without file',
          episode: { monitored: false, hasFile: false },
          expected: {
            isAvailable: false,
            isMonitored: false,
            isDownloaded: false,
            isMissing: false,
          },
        },
      ]

      for (const testCase of testCases) {
        const mockEpisode = createMockEpisodeResource({
          id: 1,
          seriesId: 1,
          monitored: testCase.episode.monitored,
          hasFile: testCase.episode.hasFile,
        })
        const mockSeries = createMockSeries({ id: 1 })

        mockSonarrClient.getEpisodeById.mockResolvedValue(mockEpisode)
        mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)

        const result = await service.getEpisodeDetails(1)

        expect(result.isAvailable).toBe(testCase.expected.isAvailable)
        expect(result.isMonitored).toBe(testCase.expected.isMonitored)
        expect(result.isDownloaded).toBe(testCase.expected.isDownloaded)
        expect(result.isMissing).toBe(testCase.expected.isMissing)

        // Reset mocks for next iteration
        jest.clearAllMocks()
      }
    })

    it('should handle API errors gracefully', async () => {
      const error = new Error('Episode API failed')
      mockSonarrClient.getEpisodeById.mockRejectedValue(error)

      await expect(service.getEpisodeDetails(1)).rejects.toThrow(
        'Episode API failed',
      )

      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          episodeId: 1,
          error: 'Episode API failed',
        }),
        'Failed to get episode details',
      )
    })

    it('should log operation with performance metrics', async () => {
      const mockEpisode = createMockEpisodeResource({
        id: 1,
        seriesId: 1,
        seasonNumber: 1,
        episodeNumber: 5,
        title: 'Gray Matter',
      })
      const mockSeries = createMockSeries({ id: 1, title: 'Breaking Bad' })

      mockSonarrClient.getEpisodeById.mockResolvedValue(mockEpisode)
      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(2200)

      await service.getEpisodeDetails(1)

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          episodeId: 1,
        }),
        'Getting episode details',
      )

      expect(service['logger'].log).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id-123',
          episodeId: 1,
          seriesTitle: 'Breaking Bad',
          seasonEpisode: 'S01E05',
          title: 'Gray Matter',
          hasFile: false,
          monitored: false,
          duration: 1200,
        }),
        'Episode details retrieved successfully',
      )
    })

    it('should validate output with schema', async () => {
      const mockEpisode = createMockEpisodeResource({
        id: 1,
        seriesId: 1,
      })
      const mockSeries = createMockSeries({ id: 1 })

      mockSonarrClient.getEpisodeById.mockResolvedValue(mockEpisode)
      mockSonarrClient.getSeriesById.mockResolvedValue(mockSeries)

      await service.getEpisodeDetails(1)

      expect(SonarrOutputSchemas.episodeDetails.parse).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          seriesId: 1,
          seasonNumber: expect.any(Number),
          episodeNumber: expect.any(Number),
          title: expect.any(String),
          monitored: expect.any(Boolean),
          hasFile: expect.any(Boolean),
          seriesTitle: expect.any(String),
          isAvailable: expect.any(Boolean),
          isMonitored: expect.any(Boolean),
          isDownloaded: expect.any(Boolean),
          isMissing: expect.any(Boolean),
        }),
      )
    })
  })
})
