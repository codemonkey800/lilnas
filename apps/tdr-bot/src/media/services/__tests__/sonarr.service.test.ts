import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

// Mock SDK module BEFORE any imports that reference it
jest.mock('@lilnas/media/sonarr', () => ({
  deleteApiV3QueueById: jest.fn(),
  deleteApiV3SeriesById: jest.fn(),
  getApiV3Episode: jest.fn(),
  getApiV3Qualityprofile: jest.fn(),
  getApiV3Queue: jest.fn(),
  getApiV3Rootfolder: jest.fn(),
  getApiV3Series: jest.fn(),
  getApiV3SeriesById: jest.fn(),
  getApiV3SeriesLookup: jest.fn(),
  postApiV3Command: jest.fn(),
  postApiV3Series: jest.fn(),
  putApiV3EpisodeMonitor: jest.fn(),
  putApiV3SeriesById: jest.fn(),
}))

import {
  deleteApiV3QueueById,
  deleteApiV3SeriesById,
  getApiV3Episode,
  getApiV3Qualityprofile,
  getApiV3Queue,
  getApiV3Rootfolder,
  getApiV3Series,
  getApiV3SeriesById,
  getApiV3SeriesLookup,
  postApiV3Command,
  postApiV3Series,
  putApiV3EpisodeMonitor,
  putApiV3SeriesById,
} from '@lilnas/media/sonarr'

import { RetryConfigService } from 'src/config/retry.config'
import { SONARR_CLIENT } from 'src/media/clients'
import {
  MonitorSeriesOptionsInput,
  SearchQueryInput,
  SonarrInputSchemas,
  SonarrOutputSchemas,
  UnmonitorSeriesOptionsInput,
} from 'src/media/schemas/sonarr.schemas'
import { SonarrService } from 'src/media/services/sonarr.service'
import {
  EpisodeResource,
  SeriesSearchResult,
  SonarrImageType,
  SonarrMonitorType,
  SonarrQualityProfile,
  SonarrRootFolder,
  SonarrSeries,
  SonarrSeriesResource,
  SonarrSeriesStatus,
  SonarrSeriesType,
} from 'src/media/types/sonarr.types'
import { RetryService } from 'src/utils/retry.service'

// Mock utility functions
jest.mock('src/media/utils/sonarr.utils', () => {
  // Use real toDownloadingSeries: it maps SDK QueueResource → DownloadingSeries
  // (different input/output shapes) and must run for tests to observe the
  // correct output fields (e.g. seriesTitle).
  const actual = jest.requireActual('src/media/utils/sonarr.utils')
  return {
    ...actual,
    transformToSearchResults: jest.fn(),
    determineMonitoringStrategy: jest.fn(),
    determineUnmonitoringStrategy: jest.fn(),
    hasEpisodeSelections: jest.fn(),
    validateUnmonitoringSelection: jest.fn(),
    extractUnmonitoringOperationSummary: jest.fn(),
    toSonarrSeriesResourceArray: jest.fn((arr: unknown[]) => arr),
    toSonarrSeriesResource: jest.fn((r: unknown) => r),
    toSonarrSeries: jest.fn((r: unknown) => r),
    toSonarrSeriesArray: jest.fn((arr: unknown[]) => arr),
    toEpisodeResource: jest.fn((r: unknown) => r),
    toEpisodeResourceArray: jest.fn((arr: unknown[]) => arr),
  }
})

import {
  determineMonitoringStrategy,
  transformToSearchResults,
} from 'src/media/utils/sonarr.utils'

const mockTransformToSearchResults =
  transformToSearchResults as jest.MockedFunction<
    typeof transformToSearchResults
  >
const mockDetermineMonitoringStrategy =
  determineMonitoringStrategy as jest.MockedFunction<
    typeof determineMonitoringStrategy
  >

// Shorthands for SDK mocks
const mockGetApiV3SeriesLookup = getApiV3SeriesLookup as jest.Mock
const mockGetApiV3Series = getApiV3Series as jest.Mock
const mockGetApiV3SeriesById = getApiV3SeriesById as jest.Mock
const mockGetApiV3Qualityprofile = getApiV3Qualityprofile as jest.Mock
const mockGetApiV3Rootfolder = getApiV3Rootfolder as jest.Mock
const mockPostApiV3Series = postApiV3Series as jest.Mock
const mockPutApiV3SeriesById = putApiV3SeriesById as jest.Mock
const mockGetApiV3Episode = getApiV3Episode as jest.Mock

const mockPutApiV3EpisodeMonitor = putApiV3EpisodeMonitor as jest.Mock
const mockPostApiV3Command = postApiV3Command as jest.Mock
const mockGetApiV3Queue = getApiV3Queue as jest.Mock
const mockDeleteApiV3QueueById = deleteApiV3QueueById as jest.Mock
const mockDeleteApiV3SeriesById = deleteApiV3SeriesById as jest.Mock

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

// ─── Factories ────────────────────────────────────────────────────────────────

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
  ratings: { imdb: { value: 8.5, votes: 10000, type: 'user' } },
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
  ratings: { imdb: { value: 8.5, votes: 10000, type: 'user' } },
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SonarrService', () => {
  let service: SonarrService
  let mockRetryService: jest.Mocked<RetryService>
  let mockRetryConfigService: { getSonarrConfig: jest.Mock }

  beforeEach(async () => {
    mockPerformanceNow.mockReturnValue(1000)

    mockRetryService = {
      executeWithCircuitBreaker: jest
        .fn()
        .mockImplementation(async (fn: () => Promise<unknown>) => fn()),
    } as unknown as jest.Mocked<RetryService>

    mockRetryConfigService = {
      getSonarrConfig: jest.fn().mockReturnValue({
        maxAttempts: 1,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffFactor: 2,
        jitter: false,
        timeout: 15000,
        logRetryAttempts: false,
        logSuccessfulRetries: false,
        logFailedRetries: false,
        logRetryDelays: false,
        logErrorDetails: false,
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SonarrService,
        { provide: SONARR_CLIENT, useValue: {} },
        { provide: RetryService, useValue: mockRetryService },
        { provide: RetryConfigService, useValue: mockRetryConfigService },
      ],
    }).compile()

    service = module.get<SonarrService>(SonarrService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()

    jest.clearAllMocks()

    // Re-apply pass-through after clearAllMocks
    mockRetryService.executeWithCircuitBreaker.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    )

    // Default config mocks
    mockGetApiV3Qualityprofile.mockResolvedValue({
      data: [createMockQualityProfile({ id: 1, name: 'Any' })],
    })
    mockGetApiV3Rootfolder.mockResolvedValue({
      data: [createMockRootFolder({ id: 1, path: '/tv' })],
    })

    mockDetermineMonitoringStrategy.mockReturnValue({
      monitorType: SonarrMonitorType.ALL,
      seasons: [{ seasonNumber: 1, monitored: true }],
    })
  })

  describe('searchShows', () => {
    beforeEach(() => {
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

      mockGetApiV3SeriesLookup.mockResolvedValue({ data: mockSeriesResources })
      mockTransformToSearchResults.mockReturnValue(mockSearchResults)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1100)

      const result = await service.searchShows('test series')

      expect(getApiV3SeriesLookup).toHaveBeenCalledWith(
        expect.objectContaining({ query: { term: 'test series' } }),
      )
      expect(mockTransformToSearchResults).toHaveBeenCalledWith(
        mockSeriesResources,
      )
      expect(SonarrInputSchemas.searchQuery.parse).toHaveBeenCalledWith({
        query: 'test series',
      })
      expect(
        SonarrOutputSchemas.seriesSearchResultArray.parse,
      ).toHaveBeenCalledWith(mockSearchResults)
      expect(result).toEqual(mockSearchResults)
    })

    it('should handle input validation errors', async () => {
      const validationError = new Error('Invalid input')
      jest
        .spyOn(SonarrInputSchemas.searchQuery, 'parse')
        .mockImplementation(() => {
          throw validationError
        })

      await expect(service.searchShows('')).rejects.toThrow(
        'Invalid search query: Invalid input',
      )
    })

    it('should handle SDK errors', async () => {
      jest
        .spyOn(SonarrInputSchemas.searchQuery, 'parse')
        .mockReturnValue({ query: 'test' })
      mockGetApiV3SeriesLookup.mockRejectedValue(new Error('API Error'))

      await expect(service.searchShows('test')).rejects.toThrow('API Error')
    })
  })

  describe('getLibrarySeries', () => {
    beforeEach(() => {
      jest
        .spyOn(SonarrInputSchemas.optionalSearchQuery, 'parse')
        .mockImplementation(
          input =>
            input as ReturnType<
              typeof SonarrInputSchemas.optionalSearchQuery.parse
            >,
        )
      jest
        .spyOn(SonarrOutputSchemas.librarySearchResultArray, 'parse')
        .mockImplementation(
          input =>
            input as ReturnType<
              typeof SonarrOutputSchemas.librarySearchResultArray.parse
            >,
        )
    })

    it('should get all library series without query', async () => {
      const mockSeries = [
        createMockSeries({ id: 1, title: 'Drama Series' }),
        createMockSeries({ id: 2, title: 'Action Series' }),
      ]
      mockGetApiV3Series.mockResolvedValue({ data: mockSeries })
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1200)

      const result = await service.getLibrarySeries()

      expect(getApiV3Series).toHaveBeenCalled()
      expect(SonarrInputSchemas.optionalSearchQuery.parse).toHaveBeenCalledWith(
        { query: undefined },
      )
      expect(result).toHaveLength(2)
    })

    it('should filter library series by query', async () => {
      const mockSeries = [
        createMockSeries({ id: 1, title: 'Drama Series', genres: ['Drama'] }),
        createMockSeries({ id: 2, title: 'Action Series', genres: ['Action'] }),
      ]
      mockGetApiV3Series.mockResolvedValue({ data: mockSeries })

      const result = await service.getLibrarySeries('drama')

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Drama Series')
    })

    it('should handle API errors', async () => {
      mockGetApiV3Series.mockRejectedValue(new Error('API Error'))

      await expect(service.getLibrarySeries()).rejects.toThrow('API Error')
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

    it('should get downloading episodes successfully', async () => {
      const mockQueueItems = [
        {
          id: 1,
          seriesId: 1,
          episodeId: 1,
          title: 'Test Episode S01E01',
          series: { title: 'Test Series' },
          episode: { title: 'Test Episode', seasonNumber: 1, episodeNumber: 1 },
          status: 'downloading',
          protocol: 'torrent',
          downloadClient: 'TestClient',
          size: 1000000000,
          sizeleft: 500000000,
        },
        {
          id: 2,
          seriesId: 1,
          episodeId: 2,
          title: 'Test Episode S01E02',
          series: { title: 'Test Series' },
          episode: {
            title: 'Test Episode 2',
            seasonNumber: 1,
            episodeNumber: 2,
          },
          status: 'completed',
          protocol: 'torrent',
          size: 1000000000,
          sizeleft: 0,
        },
      ]

      mockGetApiV3Queue.mockResolvedValue({ data: { records: mockQueueItems } })
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1300)

      const result = await service.getDownloadingEpisodes()

      expect(getApiV3Queue).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            includeEpisode: true,
            includeSeries: true,
          }),
        }),
      )

      // Only 'downloading' status items
      expect(result).toHaveLength(1)
      expect(result[0].seriesTitle).toBe('Test Series')
      expect(result[0].seasonNumber).toBe(1)
      expect(result[0].episodeNumber).toBe(1)
    })

    it('should filter out non-active queue items', async () => {
      const mockQueueItems = [
        {
          id: 1,
          status: 'downloading',
          protocol: 'torrent',
          size: 1000000000,
          sizeleft: 500000000,
          series: { title: 'S1' },
          episode: {},
        },
        {
          id: 2,
          status: 'queued',
          protocol: 'torrent',
          size: 1000000000,
          sizeleft: 1000000000,
          series: { title: 'S2' },
          episode: {},
        },
        {
          id: 3,
          status: 'completed',
          protocol: 'torrent',
          size: 1000000000,
          sizeleft: 0,
          series: { title: 'S3' },
          episode: {},
        },
        {
          id: 4,
          status: 'failed',
          protocol: 'torrent',
          size: 1000000000,
          sizeleft: 1000000000,
          series: { title: 'S4' },
          episode: {},
        },
      ]

      mockGetApiV3Queue.mockResolvedValue({ data: { records: mockQueueItems } })

      const result = await service.getDownloadingEpisodes()

      expect(result).toHaveLength(2) // downloading + queued
    })

    it('should handle API errors', async () => {
      mockGetApiV3Queue.mockRejectedValue(new Error('Queue error'))

      await expect(service.getDownloadingEpisodes()).rejects.toThrow(
        'Queue error',
      )
    })
  })

  describe('monitorAndDownloadSeries', () => {
    beforeEach(() => {
      jest
        .spyOn(SonarrInputSchemas.monitorSeriesOptions, 'parse')
        .mockImplementation(input => input as MonitorSeriesOptionsInput)
    })

    it('should add a new series successfully', async () => {
      const mockSearchResult = createMockSeriesSearchResult()
      const addedSeries = createMockSeries({
        id: 10,
        tvdbId: mockSearchResult.tvdbId,
      })
      const episodes = [
        createMockEpisodeResource({ id: 1, seasonNumber: 1, episodeNumber: 1 }),
        createMockEpisodeResource({ id: 2, seasonNumber: 1, episodeNumber: 2 }),
      ]

      // Series not in library
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      // Search finds it
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [createMockSeriesResource({ tvdbId: mockSearchResult.tvdbId })],
      })
      jest
        .spyOn(SonarrOutputSchemas.seriesSearchResultArray, 'parse')
        .mockImplementation(input => input as SeriesSearchResult[])
      mockTransformToSearchResults.mockReturnValue([mockSearchResult])
      jest
        .spyOn(SonarrInputSchemas.searchQuery, 'parse')
        .mockReturnValue({ query: String(mockSearchResult.tvdbId) })

      // Add series
      mockPostApiV3Series.mockResolvedValue({ data: addedSeries })
      // Get episodes (for monitoring)
      mockGetApiV3Episode.mockResolvedValue({ data: episodes })
      // Monitor episodes
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: undefined })
      // Trigger search
      mockPostApiV3Command.mockResolvedValue({
        data: { id: 123, name: 'SeriesSearch' },
      })

      const result = await service.monitorAndDownloadSeries(
        mockSearchResult.tvdbId,
      )

      expect(getApiV3Series).toHaveBeenCalled()
      expect(postApiV3Series).toHaveBeenCalled()
      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'SeriesSearch', seriesId: 10 },
        }),
      )
      expect(result.success).toBe(true)
      expect(result.seriesAdded).toBe(true)
      expect(result.searchTriggered).toBe(true)
    })

    it('should update monitoring for an existing series', async () => {
      const existingSeries = createMockSeries({
        id: 5,
        tvdbId: 123456,
        seasons: [
          { seasonNumber: 1, monitored: false },
          { seasonNumber: 2, monitored: false },
        ],
      })
      const updatedSeries = { ...existingSeries, monitored: true }

      // Series is in library
      mockGetApiV3Series.mockResolvedValue({ data: [existingSeries] })
      // For updateSeries: fetch + put
      mockGetApiV3SeriesById.mockResolvedValue({ data: existingSeries })
      mockPutApiV3SeriesById.mockResolvedValue({ data: updatedSeries })
      // Get episodes for monitoring
      mockGetApiV3Episode.mockResolvedValue({ data: [] })
      // Trigger search (no changes in episodes so no search)
      mockPostApiV3Command.mockResolvedValue({
        data: { id: 99, name: 'SeriesSearch' },
      })

      const result = await service.monitorAndDownloadSeries(123456)

      expect(getApiV3Series).toHaveBeenCalled()
      expect(putApiV3SeriesById).toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(result.seriesAdded).toBe(false)
      expect(result.seriesUpdated).toBe(true)
    })

    it('should handle series not found in search', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      mockGetApiV3SeriesLookup.mockResolvedValue({ data: [] })
      jest
        .spyOn(SonarrInputSchemas.searchQuery, 'parse')
        .mockReturnValue({ query: '999999' })
      jest
        .spyOn(SonarrOutputSchemas.seriesSearchResultArray, 'parse')
        .mockReturnValue([])
      mockTransformToSearchResults.mockReturnValue([])

      const result = await service.monitorAndDownloadSeries(999999)

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should handle input validation errors', async () => {
      const validationError = new Error('Invalid options')
      jest
        .spyOn(SonarrInputSchemas.monitorSeriesOptions, 'parse')
        .mockImplementation(() => {
          throw validationError
        })

      const result = await service.monitorAndDownloadSeries(123456)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid monitor series options')
    })
  })

  describe('unmonitorAndDeleteSeries', () => {
    beforeEach(() => {
      jest
        .spyOn(SonarrInputSchemas.unmonitorSeriesOptions, 'parse')
        .mockImplementation(input => input as UnmonitorSeriesOptionsInput)
    })

    it('should delete entire series when no selection provided', async () => {
      const existingSeries = createMockSeries({ id: 1, tvdbId: 123456 })

      mockGetApiV3Series.mockResolvedValue({ data: [existingSeries] })
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [] } })
      mockDeleteApiV3SeriesById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteSeries(123456)

      expect(deleteApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 1 },
          query: expect.objectContaining({ deleteFiles: true }),
        }),
      )
      expect(result.success).toBe(true)
      expect(result.seriesDeleted).toBe(true)
    })

    it('should cancel downloads before deleting series', async () => {
      const existingSeries = createMockSeries({ id: 1, tvdbId: 123456 })
      const queueItems = [{ id: 10, seriesId: 1, title: 'Download 1' }]

      mockGetApiV3Series.mockResolvedValue({ data: [existingSeries] })
      mockGetApiV3Queue.mockResolvedValue({ data: { records: queueItems } })
      mockDeleteApiV3QueueById.mockResolvedValue({ data: undefined })
      mockDeleteApiV3SeriesById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteSeries(123456)

      expect(deleteApiV3QueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 10 } }),
      )
      expect(result.canceledDownloads).toBe(1)
      expect(result.downloadsCancel).toBe(true)
    })

    it('should handle series not found in library', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })

      const result = await service.unmonitorAndDeleteSeries(999999)

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
      expect(result.seriesDeleted).toBe(false)
    })

    it('should handle deletion failures', async () => {
      const existingSeries = createMockSeries({ id: 1, tvdbId: 123456 })

      mockGetApiV3Series.mockResolvedValue({ data: [existingSeries] })
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [] } })
      mockDeleteApiV3SeriesById.mockRejectedValue(new Error('Delete failed'))

      const result = await service.unmonitorAndDeleteSeries(123456)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Delete failed')
    })

    it('should apply granular unmonitoring when selection is provided', async () => {
      const existingSeries = createMockSeries({ id: 1, tvdbId: 123456 })
      const episodes = [
        createMockEpisodeResource({
          id: 1,
          seasonNumber: 1,
          episodeNumber: 1,
          hasFile: false,
        }),
        createMockEpisodeResource({
          id: 2,
          seasonNumber: 1,
          episodeNumber: 2,
          hasFile: false,
          monitored: true,
        }),
      ]

      mockGetApiV3Series.mockResolvedValue({ data: [existingSeries] })
      mockGetApiV3Episode.mockResolvedValue({ data: episodes })
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [] } })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: undefined })
      mockGetApiV3SeriesById.mockResolvedValue({ data: existingSeries })
      mockPutApiV3SeriesById.mockResolvedValue({ data: existingSeries })

      const result = await service.unmonitorAndDeleteSeries(123456, {
        selection: [{ season: 1, episodes: [1] }],
      })

      expect(putApiV3EpisodeMonitor).toHaveBeenCalled()
      expect(result.success).toBe(true)
    }, 15000)
  })

  describe('error handling', () => {
    it('should handle network timeout errors gracefully', async () => {
      jest
        .spyOn(SonarrInputSchemas.searchQuery, 'parse')
        .mockReturnValue({ query: 'test' })

      const timeoutError = new Error('Request timeout')
      timeoutError.name = 'TimeoutError'
      mockGetApiV3SeriesLookup.mockRejectedValue(timeoutError)

      await expect(service.searchShows('test')).rejects.toThrow(
        'Request timeout',
      )
    })

    it('should handle connection refused errors gracefully', async () => {
      const connectionError = new Error('ECONNREFUSED')
      connectionError.name = 'ConnectionError'
      mockGetApiV3Series.mockRejectedValue(connectionError)

      await expect(service.getLibrarySeries()).rejects.toThrow('ECONNREFUSED')
    })

    it('should handle malformed response errors', async () => {
      const parseError = new Error('Unexpected token < in JSON at position 0')
      parseError.name = 'SyntaxError'
      mockGetApiV3Queue.mockRejectedValue(parseError)

      await expect(service.getDownloadingEpisodes()).rejects.toThrow(
        'Unexpected token < in JSON at position 0',
      )
    })
  })
})
