import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

/**
 * Characterization tests for SonarrService.
 *
 * These tests use the REAL sonarr.utils transformation functions and REAL Zod
 * schema validation (no mocking of those layers). They document the exact output
 * shape that downstream consumers depend on.
 */

// Mock SDK module BEFORE any imports
jest.mock('@lilnas/media/sonarr', () => ({
  deleteApiV3EpisodefileById: jest.fn(),
  deleteApiV3QueueById: jest.fn(),
  deleteApiV3SeriesById: jest.fn(),
  getApiV3Episode: jest.fn(),
  getApiV3EpisodeById: jest.fn(),
  getApiV3Episodefile: jest.fn(),
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
  getApiV3Queue,
  getApiV3Series,
  getApiV3SeriesLookup,
} from '@lilnas/media/sonarr'

import { RetryConfigService } from 'src/config/retry.config'
import { SONARR_CLIENT } from 'src/media/clients'
import { SonarrService } from 'src/media/services/sonarr.service'
import {
  SonarrImageType,
  SonarrSeason,
  SonarrSeries,
  SonarrSeriesResource,
  SonarrSeriesStatus,
  SonarrSeriesType,
} from 'src/media/types/sonarr.types'
import { RetryService } from 'src/utils/retry.service'

jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'test-id-123'),
}))

jest.mock('perf_hooks', () => ({
  performance: { now: jest.fn(() => 1000) },
}))

// Shorthands
const mockGetApiV3SeriesLookup = getApiV3SeriesLookup as jest.Mock
const mockGetApiV3Series = getApiV3Series as jest.Mock
const mockGetApiV3Queue = getApiV3Queue as jest.Mock

// ─── Factories ────────────────────────────────────────────────────────────────

const createMockSeason = (
  overrides: Partial<SonarrSeason> = {},
): SonarrSeason => ({
  seasonNumber: 1,
  monitored: true,
  statistics: {
    episodeFileCount: 10,
    episodeCount: 10,
    totalEpisodeCount: 10,
    sizeOnDisk: 1073741824,
    percentOfEpisodes: 100,
  },
  ...overrides,
})

const createMockSeriesResource = (
  overrides: Partial<SonarrSeriesResource> = {},
): SonarrSeriesResource => ({
  tvdbId: 81189,
  tmdbId: 1396,
  imdbId: 'tt0903747',
  title: 'Breaking Bad',
  titleSlug: 'breaking-bad',
  sortTitle: 'breaking bad',
  year: 2008,
  firstAired: '2008-01-20T00:00:00Z',
  lastAired: '2013-09-29T00:00:00Z',
  overview: 'A high school chemistry teacher...',
  runtime: 45,
  network: 'AMC',
  status: SonarrSeriesStatus.ENDED,
  seriesType: SonarrSeriesType.STANDARD,
  seasons: [
    createMockSeason({ seasonNumber: 0, monitored: false }),
    createMockSeason({ seasonNumber: 1, monitored: true }),
    createMockSeason({ seasonNumber: 2, monitored: true }),
  ],
  genres: ['Crime', 'Drama', 'Thriller'],
  ratings: {
    imdb: { value: 9.5, votes: 2000000, type: 'user' },
    theMovieDb: { value: 8.8, votes: 100000, type: 'user' },
    tvdb: { value: 9.0, votes: 50000, type: 'user' },
    rottenTomatoes: { value: 96, votes: 1000, type: 'user' },
  },
  images: [
    {
      coverType: SonarrImageType.POSTER,
      url: 'https://cdn.sonarr.com/poster.jpg',
      remoteUrl: 'https://img.sonarr.tv/poster.jpg',
    },
    {
      coverType: SonarrImageType.FANART,
      url: 'https://cdn.sonarr.com/fanart.jpg',
      remoteUrl: 'https://img.sonarr.tv/fanart.jpg',
    },
  ],
  certification: 'TV-MA',
  ended: true,
  monitored: true,
  useSceneNumbering: false,
  cleanTitle: 'breakingbad',
  seasonFolder: true,
  tags: [],
  added: '2023-01-01T00:00:00Z',
  ...overrides,
})

const createMockSeries = (
  overrides: Partial<SonarrSeries> = {},
): SonarrSeries => ({
  id: 1,
  tvdbId: 81189,
  tmdbId: 1396,
  imdbId: 'tt0903747',
  title: 'Breaking Bad',
  titleSlug: 'breaking-bad',
  sortTitle: 'breaking bad',
  year: 2008,
  firstAired: '2008-01-20T00:00:00Z',
  lastAired: '2013-09-29T00:00:00Z',
  overview: 'A high school chemistry teacher...',
  runtime: 45,
  network: 'AMC',
  status: SonarrSeriesStatus.ENDED,
  seriesType: SonarrSeriesType.STANDARD,
  seasons: [
    createMockSeason({ seasonNumber: 0, monitored: false }),
    createMockSeason({ seasonNumber: 1, monitored: true }),
    createMockSeason({ seasonNumber: 2, monitored: true }),
  ],
  genres: ['Crime', 'Drama', 'Thriller'],
  ratings: { imdb: { value: 9.5, votes: 2000000, type: 'user' } },
  images: [
    {
      coverType: SonarrImageType.POSTER,
      url: 'https://cdn.sonarr.com/poster.jpg',
      remoteUrl: 'https://img.sonarr.tv/poster.jpg',
    },
    {
      coverType: SonarrImageType.FANART,
      url: 'https://cdn.sonarr.com/fanart.jpg',
      remoteUrl: 'https://img.sonarr.tv/fanart.jpg',
    },
  ],
  certification: 'TV-MA',
  ended: true,
  monitored: true,
  path: '/tv/Breaking Bad',
  qualityProfileId: 1,
  seasonFolder: true,
  useSceneNumbering: false,
  cleanTitle: 'breakingbad',
  tags: [],
  added: '2023-01-01T00:00:00Z',
  statistics: {
    seasonCount: 2,
    episodeFileCount: 62,
    episodeCount: 62,
    totalEpisodeCount: 62,
    sizeOnDisk: 50000000000,
    percentOfEpisodes: 100,
  },
  ...overrides,
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SonarrService (characterization)', () => {
  let service: SonarrService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SonarrService,
        { provide: SONARR_CLIENT, useValue: {} },
        {
          provide: RetryService,
          useValue: {
            executeWithCircuitBreaker: jest
              .fn()
              .mockImplementation(async (fn: () => Promise<unknown>) => fn()),
          },
        },
        {
          provide: RetryConfigService,
          useValue: {
            getSonarrConfig: () => ({
              maxAttempts: 1,
              baseDelay: 0,
              maxDelay: 0,
              backoffFactor: 2,
              jitter: false,
              timeout: 15000,
            }),
          },
        },
      ],
    }).compile()

    service = module.get<SonarrService>(SonarrService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()

    jest.clearAllMocks()
    const retryService = module.get(RetryService)
    ;(retryService.executeWithCircuitBreaker as jest.Mock).mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    )
  })

  describe('searchShows — output shape', () => {
    it('should return correctly transformed SeriesSearchResult with all fields', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [createMockSeriesResource()],
      })

      const [result] = await service.searchShows('Breaking Bad')

      expect(result).toMatchObject({
        tvdbId: 81189,
        tmdbId: 1396,
        imdbId: 'tt0903747',
        title: 'Breaking Bad',
        titleSlug: 'breaking-bad',
        year: 2008,
        overview: expect.stringContaining('chemistry teacher'),
        runtime: 45,
        network: 'AMC',
        status: SonarrSeriesStatus.ENDED,
        seriesType: SonarrSeriesType.STANDARD,
        certification: 'TV-MA',
        ended: true,
      })
    })

    it('should calculate average rating across imdb, tmdb, tvdb, and rottenTomatoes', async () => {
      // imdb=9.5, tmdb=8.8, tvdb=9.0, rt=96/10=9.6 → avg = (9.5+8.8+9.0+9.6)/4 = 9.225
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [createMockSeriesResource()],
      })

      const [result] = await service.searchShows('Breaking Bad')

      expect(result.rating).toBeCloseTo(9.225, 2)
    })

    it('should use only available ratings for average calculation', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          createMockSeriesResource({
            ratings: { imdb: { value: 9.5, votes: 2000000, type: 'user' } },
          }),
        ],
      })

      const [result] = await service.searchShows('test')

      expect(result.rating).toBe(9.5)
    })

    it('should return undefined rating when no ratings are present', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [createMockSeriesResource({ ratings: undefined })],
      })

      const [result] = await service.searchShows('test')

      expect(result.rating).toBeUndefined()
    })

    it('should use remoteUrl for poster when available', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [createMockSeriesResource()],
      })

      const [result] = await service.searchShows('test')

      expect(result.posterPath).toBe('https://img.sonarr.tv/poster.jpg')
    })

    it('should fall back to url when remoteUrl is not present for poster', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          createMockSeriesResource({
            images: [
              {
                coverType: SonarrImageType.POSTER,
                url: 'https://cdn.sonarr.com/poster.jpg',
              },
            ],
          }),
        ],
      })

      const [result] = await service.searchShows('test')

      expect(result.posterPath).toBe('https://cdn.sonarr.com/poster.jpg')
    })

    it('should default seriesType to standard when not provided', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [createMockSeriesResource({ seriesType: undefined })],
      })

      const [result] = await service.searchShows('test')

      expect(result.seriesType).toBe('standard')
    })

    it('should generate titleSlug from title when series has no titleSlug', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          createMockSeriesResource({ titleSlug: undefined, title: 'My Show!' }),
        ],
      })

      const [result] = await service.searchShows('My Show')

      expect(result.titleSlug).toMatch(/^my-show/)
    })

    it('should return all seasons including specials (season 0)', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [createMockSeriesResource()],
      })

      const [result] = await service.searchShows('test')

      expect(result.seasons).toHaveLength(3)
      expect(result.seasons[0].seasonNumber).toBe(0)
    })
  })

  describe('getLibrarySeries — output shape', () => {
    it('should return correctly transformed LibrarySearchResult with all fields', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [createMockSeries()] })

      const [result] = await service.getLibrarySeries()

      expect(result).toMatchObject({
        tvdbId: 81189,
        title: 'Breaking Bad',
        year: 2008,
        id: 1,
        monitored: true,
        path: '/tv/Breaking Bad',
        added: '2023-01-01T00:00:00Z',
      })
    })

    it('should use remoteUrl for poster in library results', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [createMockSeries()] })

      const [result] = await service.getLibrarySeries()

      expect(result.posterPath).toBe('https://img.sonarr.tv/poster.jpg')
      expect(result.backdropPath).toBe('https://img.sonarr.tv/fanart.jpg')
    })

    it('should extract rating from imdb in library results', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [createMockSeries()] })

      const [result] = await service.getLibrarySeries()

      expect(result.rating).toBe(9.5)
    })

    it('should include statistics in library results', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [createMockSeries()] })

      const [result] = await service.getLibrarySeries()

      expect(result.statistics).toMatchObject({
        episodeFileCount: 62,
        sizeOnDisk: 50000000000,
      })
    })

    it('should return all series when no query is provided', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [
          createMockSeries({ id: 1, tvdbId: 81189 }),
          createMockSeries({ id: 2, tvdbId: 153021 }),
        ],
      })

      const results = await service.getLibrarySeries()

      expect(results).toHaveLength(2)
    })

    it('should filter series by title when query is provided', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [
          createMockSeries({ id: 1, title: 'Breaking Bad', tvdbId: 81189 }),
          createMockSeries({
            id: 2,
            title: 'Better Call Saul',
            tvdbId: 273181,
          }),
        ],
      })

      const results = await service.getLibrarySeries('breaking')

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Breaking Bad')
    })

    it('should filter series by network when query is provided', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [
          createMockSeries({ id: 1, title: 'Breaking Bad', network: 'AMC' }),
          createMockSeries({
            id: 2,
            title: 'Stranger Things',
            network: 'Netflix',
          }),
        ],
      })

      const results = await service.getLibrarySeries('netflix')

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Stranger Things')
    })

    it('should filter series by year when query is provided', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [
          createMockSeries({ id: 1, title: 'Breaking Bad', year: 2008 }),
          createMockSeries({ id: 2, title: 'Stranger Things', year: 2016 }),
        ],
      })

      const results = await service.getLibrarySeries('2016')

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Stranger Things')
    })
  })

  describe('getDownloadingEpisodes — output shape', () => {
    it('should correctly calculate progress at 50%', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: {
          records: [
            {
              id: 1,
              status: 'downloading',
              protocol: 'torrent',
              series: { title: 'Breaking Bad' },
              episode: { title: 'Pilot', seasonNumber: 1, episodeNumber: 1 },
              size: 2000000000,
              sizeleft: 1000000000,
            },
          ],
        },
      })

      const [result] = await service.getDownloadingEpisodes()

      expect(result.downloadedBytes).toBe(1000000000)
      expect(result.progressPercent).toBe(50)
    })

    it('should set progressPercent to 0 when size is 0', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: {
          records: [
            {
              id: 1,
              status: 'downloading',
              protocol: 'torrent',
              series: { title: 'S' },
              episode: {},
              size: 0,
              sizeleft: 0,
            },
          ],
        },
      })

      const [result] = await service.getDownloadingEpisodes()

      expect(result.progressPercent).toBe(0)
      expect(result.downloadedBytes).toBe(0)
    })

    it('should include only downloading, queued, paused, and warning items', async () => {
      const makeItem = (id: number, status: string) => ({
        id,
        status,
        protocol: 'torrent',
        series: { title: 'S' },
        episode: {},
        size: 1000000000,
        sizeleft: 500000000,
      })
      mockGetApiV3Queue.mockResolvedValue({
        data: {
          records: [
            makeItem(1, 'downloading'),
            makeItem(2, 'queued'),
            makeItem(3, 'paused'),
            makeItem(4, 'warning'),
            makeItem(5, 'completed'),
            makeItem(6, 'failed'),
          ],
        },
      })

      const results = await service.getDownloadingEpisodes()

      expect(results).toHaveLength(4)
      expect(results.map(r => r.id)).toEqual([1, 2, 3, 4])
    })

    it('should set isActive=true for downloading and queued, false for paused/warning', async () => {
      const makeItem = (id: number, status: string) => ({
        id,
        status,
        protocol: 'torrent',
        series: { title: 'S' },
        episode: {},
        size: 1000000000,
        sizeleft: 500000000,
      })
      mockGetApiV3Queue.mockResolvedValue({
        data: {
          records: [
            makeItem(1, 'downloading'),
            makeItem(2, 'queued'),
            makeItem(3, 'paused'),
          ],
        },
      })

      const results = await service.getDownloadingEpisodes()

      expect(results.find(r => r.id === 1)?.isActive).toBe(true)
      expect(results.find(r => r.id === 2)?.isActive).toBe(true)
      expect(results.find(r => r.id === 3)?.isActive).toBe(false)
    })

    it('should map series title from embedded series object', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: {
          records: [
            {
              id: 1,
              status: 'downloading',
              protocol: 'torrent',
              series: { id: 1, title: 'Breaking Bad', tvdbId: 81189 },
              episode: {
                id: 1001,
                episodeNumber: 1,
                seasonNumber: 1,
                title: 'Pilot',
              },
              size: 1000000000,
              sizeleft: 500000000,
            },
          ],
        },
      })

      const [result] = await service.getDownloadingEpisodes()

      expect(result.seriesTitle).toBe('Breaking Bad')
    })

    it('should map episode title from embedded episode object', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: {
          records: [
            {
              id: 1,
              status: 'downloading',
              protocol: 'torrent',
              series: { title: 'S' },
              episode: {
                id: 1001,
                episodeNumber: 1,
                seasonNumber: 1,
                title: 'Pilot',
              },
              size: 1000000000,
              sizeleft: 500000000,
            },
          ],
        },
      })

      const [result] = await service.getDownloadingEpisodes()

      expect(result.episodeTitle).toBe('Pilot')
      expect(result.seasonNumber).toBe(1)
      expect(result.episodeNumber).toBe(1)
    })
  })
})
