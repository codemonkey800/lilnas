import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

// Mock SDK module BEFORE any imports that reference it
jest.mock('@lilnas/media/sonarr', () => ({
  deleteApiV3QueueBulk: jest.fn(),
  deleteApiV3SeriesById: jest.fn(),
  getApiV3Episode: jest.fn(),
  getApiV3Queue: jest.fn(),
  getApiV3Series: jest.fn(),
  getApiV3SeriesById: jest.fn(),
  getApiV3SeriesLookup: jest.fn(),
  putApiV3EpisodeMonitor: jest.fn(),
  putApiV3SeriesById: jest.fn(),
}))

import {
  deleteApiV3QueueBulk,
  deleteApiV3SeriesById,
  getApiV3Episode,
  getApiV3Queue,
  getApiV3Series,
  getApiV3SeriesById,
  getApiV3SeriesLookup,
  putApiV3EpisodeMonitor,
  putApiV3SeriesById,
} from '@lilnas/media/sonarr'

import { RetryConfigService } from 'src/config/retry.config'
import { SONARR_CLIENT } from 'src/media/clients'
import {
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
    determineUnmonitoringStrategy: jest.fn(),
    hasEpisodeSelections: jest.fn(),
    validateUnmonitoringSelection: jest.fn(),
    extractUnmonitoringOperationSummary: jest.fn(),
    toSonarrSeriesResourceArray: jest.fn((arr: unknown[]) => arr),
    toSonarrSeriesResource: jest.fn((r: unknown) => r),
    toSonarrSeries: jest.fn((r: unknown) => r),
    toSonarrSeriesArray: jest.fn((arr: unknown[]) => arr),
    toEpisodeResourceArray: jest.fn((arr: unknown[]) => arr),
  }
})

import {
  toSonarrSeries,
  transformToSearchResults,
} from 'src/media/utils/sonarr.utils'

const mockTransformToSearchResults =
  transformToSearchResults as jest.MockedFunction<
    typeof transformToSearchResults
  >
const mockToSonarrSeries = toSonarrSeries as jest.MockedFunction<
  typeof toSonarrSeries
>
const { toSonarrSeries: realToSonarrSeries } = jest.requireActual<{
  toSonarrSeries: typeof toSonarrSeries
}>('src/media/utils/sonarr.utils')

// Shorthands for SDK mocks
const mockGetApiV3SeriesLookup = getApiV3SeriesLookup as jest.Mock
const mockGetApiV3Series = getApiV3Series as jest.Mock
const mockGetApiV3SeriesById = getApiV3SeriesById as jest.Mock
const mockPutApiV3SeriesById = putApiV3SeriesById as jest.Mock
const mockGetApiV3Episode = getApiV3Episode as jest.Mock

const mockPutApiV3EpisodeMonitor = putApiV3EpisodeMonitor as jest.Mock
const mockGetApiV3Queue = getApiV3Queue as jest.Mock
const mockDeleteApiV3QueueBulk = deleteApiV3QueueBulk as jest.Mock
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
  ratings: { votes: 10000, value: 8.5 },
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
  ratings: { votes: 10000, value: 8.5 },
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

    describe('Sonarr v5 path-like terms', () => {
      // Log calls that mention `term` - compared JSON-escaped, so a backslash
      // in the term matches its serialized form
      const loggedTerms = (term: string) =>
        [Logger.prototype.log, Logger.prototype.warn, Logger.prototype.error]
          .flatMap(spy => (spy as jest.Mock).mock.calls)
          .filter(call =>
            JSON.stringify(call).includes(JSON.stringify(term).slice(1, -1)),
          )

      it.each(['/mnt/tv', '\\\\nas\\tv', 'C:\\TV', '  /tv  '])(
        'returns no results for %j without calling Sonarr',
        async term => {
          const result = await service.searchShows(term)

          expect(result).toEqual([])
          expect(mockGetApiV3SeriesLookup).not.toHaveBeenCalled()
          expect(loggedTerms(term.trim())).toEqual([])
        },
      )

      it('still looks up a title that merely contains a slash', async () => {
        mockGetApiV3SeriesLookup.mockResolvedValue({ data: [] })
        mockTransformToSearchResults.mockReturnValue([])

        await service.searchShows('AC/DC Live')

        expect(mockGetApiV3SeriesLookup).toHaveBeenCalledWith(
          expect.objectContaining({ query: { term: 'AC/DC Live' } }),
        )
      })

      it('maps a lookup 400 to no results without logging the term', async () => {
        mockGetApiV3SeriesLookup.mockResolvedValue({
          error: { message: "Invalid search term 'tvdb:'" },
          response: { status: 400 },
        })

        const result = await service.searchShows('tvdb:')

        expect(result).toEqual([])
        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.objectContaining({ status: 400 }),
          'Sonarr rejected the lookup term - returning no results',
        )
        expect(
          (Logger.prototype.warn as jest.Mock).mock.calls.filter(call =>
            JSON.stringify(call).includes('tvdb:'),
          ),
        ).toEqual([])
        expect(Logger.prototype.error).not.toHaveBeenCalled()
      })

      it('still throws a lookup error that is not a 400', async () => {
        mockGetApiV3SeriesLookup.mockResolvedValue({
          error: 'Internal Server Error',
          response: { status: 500 },
        })

        await expect(service.searchShows('test')).rejects.toThrow(
          'Internal Server Error',
        )
      })
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

    it('should report a season pack as one download with its size counted once', async () => {
      const GB = 1024 ** 3
      const packRow = (episodeNumber: number) => ({
        id: 100 + episodeNumber,
        seriesId: 1,
        episodeId: 1000 + episodeNumber,
        seasonNumber: 1,
        downloadId: 'SABnzbd_nzo_pack',
        title: 'Test.Series.S01.1080p',
        series: { title: 'Test Series' },
        episode: {
          title: `Episode ${episodeNumber}`,
          seasonNumber: 1,
          episodeNumber,
        },
        status: 'downloading',
        protocol: 'usenet',
        // Sonarr repeats the whole pack's size on every row
        size: 10 * GB,
        sizeleft: 4 * GB,
      })
      const singleRow = {
        id: 200,
        seriesId: 2,
        episodeId: 2005,
        seasonNumber: 2,
        downloadId: 'SABnzbd_nzo_single',
        series: { title: 'Other Series' },
        episode: { title: 'Five', seasonNumber: 2, episodeNumber: 5 },
        status: 'warning',
        protocol: 'usenet',
        size: GB,
        sizeleft: GB,
      }

      mockGetApiV3Queue.mockResolvedValue({
        data: {
          records: [packRow(1), packRow(2), singleRow, packRow(3)],
        },
      })

      const result = await service.getDownloadingEpisodes()

      expect(result).toHaveLength(2)
      const [pack, single] = result
      expect(pack).toEqual(
        expect.objectContaining({
          id: 101,
          downloadId: 'SABnzbd_nzo_pack',
          seriesTitle: 'Test Series',
          seasonNumber: 1,
          episodeCount: 3,
          episodeLabel: 'S01E01–E03',
          size: 10 * GB,
          sizeleft: 4 * GB,
          progressPercent: 60,
        }),
      )
      expect(pack.episodeNumber).toBeUndefined()
      expect(single).toEqual(
        expect.objectContaining({
          id: 200,
          episodeCount: 1,
          episodeLabel: 'S02E05',
          episodeTitle: 'Five',
          size: GB,
        }),
      )
    })

    it('should label a season 0 pack', async () => {
      const specialsRow = (episodeNumber: number) => ({
        id: 300 + episodeNumber,
        episodeId: 3000 + episodeNumber,
        seasonNumber: 0,
        downloadId: 'specials',
        series: { title: 'Test Series' },
        episode: { seasonNumber: 0, episodeNumber },
        status: 'downloading',
        protocol: 'usenet',
        size: 2000,
        sizeleft: 1000,
      })
      mockGetApiV3Queue.mockResolvedValue({
        data: { records: [specialsRow(1), specialsRow(2)] },
      })

      const [pack] = await service.getDownloadingEpisodes()

      expect(pack.seasonNumber).toBe(0)
      expect(pack.episodeLabel).toBe('S00E01–E02')
      expect(pack.episodeCount).toBe(2)
    })

    it('should handle API errors', async () => {
      mockGetApiV3Queue.mockRejectedValue(new Error('Queue error'))

      await expect(service.getDownloadingEpisodes()).rejects.toThrow(
        'Queue error',
      )
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
      mockDeleteApiV3QueueBulk.mockResolvedValue({ data: undefined })
      mockDeleteApiV3SeriesById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteSeries(123456)

      expect(deleteApiV3QueueBulk).toHaveBeenCalledWith(
        expect.objectContaining({ body: { ids: [10] } }),
      )
      expect(result.canceledDownloads).toBe(1)
      expect(result.downloadsCancel).toBe(true)
    })

    it('should remove a season pack once when deleting the whole series', async () => {
      const existingSeries = createMockSeries({ id: 1, tvdbId: 123456 })
      const pack = (id: number, episodeId: number) => ({
        id,
        seriesId: 1,
        episodeId,
        downloadId: 'pack',
      })
      const queueItems = [
        pack(21, 101),
        pack(22, 102),
        { id: 30, seriesId: 1, episodeId: 104, downloadId: 'single' },
        // Pending release: no downloadId, handled per row
        { id: 40, seriesId: 1, episodeId: 105, status: 'delay' },
        pack(23, 103),
        { id: 50, seriesId: 2, episodeId: 201, downloadId: 'other-series' },
      ]

      mockGetApiV3Series.mockResolvedValue({ data: [existingSeries] })
      mockGetApiV3Queue.mockResolvedValue({ data: { records: queueItems } })
      mockDeleteApiV3QueueBulk.mockResolvedValue({ data: {} })
      mockDeleteApiV3SeriesById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteSeries(123456)

      expect(deleteApiV3QueueBulk).toHaveBeenCalledTimes(1)
      expect(deleteApiV3QueueBulk).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { ids: [21, 30, 40] },
          query: { removeFromClient: true, blocklist: false },
        }),
      )
      expect(result.canceledDownloads).toBe(3)
      expect(result.commandIds).toEqual([21, 30, 40])
      expect(result.keptPacks).toBeUndefined()
    })

    describe('season packs during a granular delete', () => {
      const existingSeries = createMockSeries({ id: 1, tvdbId: 123456 })
      const episodes = (monitored: boolean) =>
        [1, 2, 3].map(episodeNumber =>
          createMockEpisodeResource({
            id: 100 + episodeNumber,
            seasonNumber: 1,
            episodeNumber,
            monitored,
          }),
        )
      const packQueue = [1, 2, 3].map(episodeNumber => ({
        id: 20 + episodeNumber,
        seriesId: 1,
        episodeId: 100 + episodeNumber,
        seasonNumber: 1,
        downloadId: 'pack',
        title: 'Test.Series.S01.1080p',
        episode: { seasonNumber: 1, episodeNumber },
      }))

      const run = (selection: UnmonitorSeriesOptionsInput['selection']) =>
        service.unmonitorAndDeleteSeries(123456, { selection })

      beforeEach(() => {
        mockGetApiV3Series.mockResolvedValue({ data: [existingSeries] })
        mockGetApiV3Queue.mockResolvedValue({ data: { records: packQueue } })
        mockDeleteApiV3QueueBulk.mockResolvedValue({ data: {} })
        mockDeleteApiV3SeriesById.mockResolvedValue({ data: undefined })
        mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: undefined })
        mockGetApiV3SeriesById.mockResolvedValue({ data: existingSeries })
        mockPutApiV3SeriesById.mockResolvedValue({ data: existingSeries })
      })

      it('should keep a pack when only some of its episodes are selected', async () => {
        mockGetApiV3Episode.mockResolvedValue({ data: episodes(true) })

        const result = await run([{ season: 1, episodes: [3] }])

        expect(deleteApiV3QueueBulk).not.toHaveBeenCalled()
        expect(result.success).toBe(true)
        expect(result.seriesDeleted).toBe(false)
        expect(result.canceledDownloads).toBe(0)
        expect(result.keptPacks).toEqual([
          {
            downloadId: 'pack',
            title: 'Test.Series.S01.1080p',
            coveredEpisodes: 'S01E01–E03',
            unmonitoredEpisodes: 'S01E03',
          },
        ])
        expect(result.warnings).toEqual([
          'S01E01–E03 pack still downloading; S01E03 unmonitored',
        ])
      })

      it('should remove a pack once when every episode it covers is selected', async () => {
        mockGetApiV3Episode.mockResolvedValue({ data: episodes(true) })

        const result = await run([{ season: 1 }])

        expect(deleteApiV3QueueBulk).toHaveBeenCalledTimes(1)
        expect(deleteApiV3QueueBulk).toHaveBeenCalledWith(
          expect.objectContaining({ body: { ids: [21] } }),
        )
        expect(result.canceledDownloads).toBe(1)
        expect(result.keptPacks).toBeUndefined()
      })

      it('should remove a multi-season pack once when the selections together cover it', async () => {
        const seasonEpisodes = (seasonNumber: number) =>
          [1, 2].map(episodeNumber =>
            createMockEpisodeResource({
              id: seasonNumber * 100 + episodeNumber,
              seasonNumber,
              episodeNumber,
              monitored: true,
            }),
          )
        mockGetApiV3Episode.mockImplementation(
          async ({ query }: { query: { seasonNumber?: number } }) => ({
            data:
              query.seasonNumber != null
                ? seasonEpisodes(query.seasonNumber)
                : [...seasonEpisodes(1), ...seasonEpisodes(2)],
          }),
        )
        const multiSeasonPack = [1, 2].flatMap(seasonNumber =>
          [1, 2].map(episodeNumber => ({
            id: seasonNumber * 10 + episodeNumber,
            seriesId: 1,
            episodeId: seasonNumber * 100 + episodeNumber,
            seasonNumber,
            downloadId: 'complete-pack',
            episode: { seasonNumber, episodeNumber },
          })),
        )
        mockGetApiV3Queue.mockResolvedValue({
          data: { records: multiSeasonPack },
        })

        const result = await run([{ season: 1 }, { season: 2 }])

        expect(deleteApiV3QueueBulk).toHaveBeenCalledTimes(1)
        expect(deleteApiV3QueueBulk).toHaveBeenCalledWith(
          expect.objectContaining({ body: { ids: [11] } }),
        )
        expect(result.canceledDownloads).toBe(1)
        expect(result.keptPacks).toBeUndefined()
      })

      it('should cancel a kept pack when the delete ends up removing the series', async () => {
        // Nothing stays monitored, so the series itself is deleted
        mockGetApiV3Episode.mockResolvedValue({ data: episodes(false) })

        const result = await run([{ season: 1, episodes: [3] }])

        expect(result.seriesDeleted).toBe(true)
        expect(deleteApiV3QueueBulk).toHaveBeenCalledTimes(1)
        expect(deleteApiV3QueueBulk).toHaveBeenCalledWith(
          expect.objectContaining({ body: { ids: [21] } }),
        )
        expect(result.canceledDownloads).toBe(1)
        expect(result.keptPacks).toBeUndefined()
      })
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
    })
  })

  describe('updating a series', () => {
    const seasonStats = {
      episodeFileCount: 2,
      episodeCount: 2,
      totalEpisodeCount: 2,
      sizeOnDisk: 1024,
      percentOfEpisodes: 100,
    }

    // The raw SDK series as Sonarr returns it, including fields the bot's
    // schema doesn't model: those must come back untouched in the PUT.
    const rawSeries = (overrides: Partial<SonarrSeries> = {}) => ({
      ...createMockSeries({ id: 5, tvdbId: 123456, ...overrides }),
      monitorNewItems: 'none',
      futureSonarrField: { keep: ['me'] },
      seasons: [
        { seasonNumber: 0, monitored: false, statistics: seasonStats },
        {
          seasonNumber: 1,
          monitored: true,
          statistics: seasonStats,
          images: [{ coverType: 'poster', url: '/s1.jpg' }],
        },
        { seasonNumber: 2, monitored: false, statistics: seasonStats },
      ],
    })

    const putBody = () => mockPutApiV3SeriesById.mock.calls[0][0].body

    beforeEach(() => {
      // Parse through the real schema, which drops the fields it doesn't
      // model — exactly what the PUT body must not be built from.
      mockToSonarrSeries.mockImplementation(realToSonarrSeries)
      jest
        .spyOn(SonarrInputSchemas.unmonitorSeriesOptions, 'parse')
        .mockImplementation(input => input as UnmonitorSeriesOptionsInput)
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [] } })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: undefined })
      mockPutApiV3SeriesById.mockImplementation(
        async ({ body }: { body: unknown }) => ({ data: body }),
      )
    })

    afterEach(() => {
      mockToSonarrSeries.mockImplementation(r => r as SonarrSeries)
    })

    it('should change only the unmonitored season, keeping season 0 and unknown fields', async () => {
      const raw = rawSeries()
      mockGetApiV3Series.mockResolvedValue({ data: [raw] })
      mockGetApiV3SeriesById.mockResolvedValue({ data: raw })
      // Season 2 keeps a monitored episode, so the series stays
      mockGetApiV3Episode.mockImplementation(
        async ({ query }: { query: { seasonNumber?: number } }) => ({
          data: [
            createMockEpisodeResource({
              id: (query.seasonNumber ?? 0) * 100 + 1,
              seasonNumber: query.seasonNumber,
              monitored: query.seasonNumber === 2,
            }),
          ],
        }),
      )

      const result = await service.unmonitorAndDeleteSeries(123456, {
        selection: [{ season: 1 }],
      })

      expect(result.success).toBe(true)
      expect(result.seriesDeleted).toBe(false)
      expect(putApiV3SeriesById).toHaveBeenCalledTimes(1)
      expect(putBody()).toEqual({
        ...raw,
        seasons: [
          raw.seasons[0],
          { ...raw.seasons[1], monitored: false },
          raw.seasons[2],
        ],
      })
    })
  })

  describe('deciding whether to delete after a granular delete', () => {
    let setTimeoutSpy: jest.SpyInstance

    const series = createMockSeries({
      id: 1,
      tvdbId: 123456,
      seasons: [
        { seasonNumber: 0, monitored: true },
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
      ],
    })

    // Sonarr's state right after the PUT /episode/monitor for season 1
    const episodesAfterUnmonitor = (monitoredSeasons: number[]) =>
      mockGetApiV3Episode.mockImplementation(
        async ({ query }: { query: { seasonNumber?: number } }) => ({
          data: [
            createMockEpisodeResource({
              id: (query.seasonNumber ?? 0) * 100 + 1,
              seasonNumber: query.seasonNumber,
              monitored: monitoredSeasons.includes(query.seasonNumber ?? -1),
            }),
          ],
        }),
      )

    beforeEach(() => {
      setTimeoutSpy = jest.spyOn(global, 'setTimeout')
      jest
        .spyOn(SonarrInputSchemas.unmonitorSeriesOptions, 'parse')
        .mockImplementation(input => input as UnmonitorSeriesOptionsInput)
      mockGetApiV3Series.mockResolvedValue({ data: [series] })
      mockGetApiV3SeriesById.mockResolvedValue({ data: series })
      mockPutApiV3SeriesById.mockResolvedValue({ data: series })
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [] } })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: undefined })
      mockDeleteApiV3SeriesById.mockResolvedValue({ data: undefined })
    })

    afterEach(() => {
      setTimeoutSpy.mockRestore()
    })

    it('should delete the series without waiting when nothing but specials stays monitored', async () => {
      episodesAfterUnmonitor([0])

      const result = await service.unmonitorAndDeleteSeries(123456, {
        selection: [{ season: 1 }, { season: 2 }],
      })

      expect(result.seriesDeleted).toBe(true)
      expect(deleteApiV3SeriesById).toHaveBeenCalledTimes(1)
      expect(setTimeoutSpy).not.toHaveBeenCalled()
    })

    it('should keep the series without waiting or re-reading when an episode stays monitored', async () => {
      episodesAfterUnmonitor([2])

      const result = await service.unmonitorAndDeleteSeries(123456, {
        selection: [{ season: 1 }],
      })

      expect(result.seriesDeleted).toBe(false)
      expect(deleteApiV3SeriesById).not.toHaveBeenCalled()
      expect(setTimeoutSpy).not.toHaveBeenCalled()
      // One series read for the decision, one for the season update
      expect(getApiV3SeriesById).toHaveBeenCalledTimes(2)
    })

    it('should not read specials when deciding', async () => {
      episodesAfterUnmonitor([0])

      await service.unmonitorAndDeleteSeries(123456, {
        selection: [{ season: 1 }, { season: 2 }],
      })

      const readSeasons = mockGetApiV3Episode.mock.calls.map(
        ([options]: [{ query: { seasonNumber?: number } }]) =>
          options.query.seasonNumber,
      )
      expect(readSeasons).not.toContain(0)
    })
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
