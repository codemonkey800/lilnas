import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

/**
 * Integration tests for SonarrService using @lilnas/media SDK functions.
 *
 * These tests wire up the real SonarrService with a pass-through RetryService,
 * mocking only at the SDK function level. They verify the full chain from
 * service method → SDK call → response transformation → final output, using
 * real Zod schemas and real utility transforms.
 */

// Mock SDK module BEFORE any imports
jest.mock('@lilnas/media/sonarr', () => ({
  deleteApiV3QueueBulk: jest.fn(),
  deleteApiV3SeriesById: jest.fn(),
  getApiV3Episode: jest.fn(),
  getApiV3Episodefile: jest.fn(),
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
  getApiV3Queue,
  getApiV3Series,
  getApiV3SeriesLookup,
} from '@lilnas/media/sonarr'

import { RetryConfigService } from 'src/config/retry.config'
import { SONARR_CLIENT } from 'src/media/clients'
import { SonarrService } from 'src/media/services/sonarr.service'
import {
  SonarrImageType,
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
const mockDeleteApiV3QueueBulk = deleteApiV3QueueBulk as jest.Mock
const mockDeleteApiV3SeriesById = deleteApiV3SeriesById as jest.Mock

// ─── Test data ────────────────────────────────────────────────────────────────

const seriesResource = {
  tvdbId: 81189,
  tmdbId: 1396,
  imdbId: 'tt0903747',
  title: 'Breaking Bad',
  titleSlug: 'breaking-bad',
  sortTitle: 'breaking bad',
  year: 2008,
  firstAired: '2008-01-20T00:00:00Z',
  overview: 'A high school chemistry teacher...',
  runtime: 45,
  network: 'AMC',
  status: SonarrSeriesStatus.ENDED,
  seriesType: SonarrSeriesType.STANDARD,
  seasons: [
    { seasonNumber: 0, monitored: false },
    { seasonNumber: 1, monitored: true },
  ],
  genres: ['Crime', 'Drama'],
  ratings: { votes: 2000000, value: 9.5 },
  images: [
    {
      coverType: SonarrImageType.POSTER,
      url: 'https://cdn.sonarr.com/poster.jpg',
      remoteUrl: 'https://img.sonarr.tv/poster.jpg',
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
}

const librarySeries = {
  id: 1,
  ...seriesResource,
  path: '/tv/Breaking Bad',
  qualityProfileId: 1,
  monitored: true,
  added: '2023-01-01T00:00:00Z',
  statistics: {
    seasonCount: 1,
    episodeFileCount: 7,
    episodeCount: 7,
    totalEpisodeCount: 7,
    sizeOnDisk: 10000000000,
    percentOfEpisodes: 100,
  },
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SonarrService integration (SDK mocked)', () => {
  let service: SonarrService
  let mockRetryService: { executeWithCircuitBreaker: jest.Mock }

  beforeEach(async () => {
    mockRetryService = {
      executeWithCircuitBreaker: jest
        .fn()
        .mockImplementation(async (fn: () => Promise<unknown>) => fn()),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SonarrService,
        { provide: SONARR_CLIENT, useValue: {} },
        { provide: RetryService, useValue: mockRetryService },
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
  })

  afterEach(() => {
    jest.clearAllMocks()

    mockRetryService.executeWithCircuitBreaker.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    )
  })

  describe('searchShows', () => {
    it('should call SDK with search term and return transformed results', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({ data: [seriesResource] })

      const results = await service.searchShows('Breaking Bad')

      expect(getApiV3SeriesLookup).toHaveBeenCalledWith(
        expect.objectContaining({ query: { term: 'Breaking Bad' } }),
      )
      expect(results).toHaveLength(1)
      expect(results[0].tvdbId).toBe(81189)
      expect(results[0].title).toBe('Breaking Bad')
      expect(results[0].posterPath).toBe('https://img.sonarr.tv/poster.jpg')
    })

    it('should propagate SDK errors', async () => {
      mockGetApiV3SeriesLookup.mockRejectedValue(
        new Error('Connection refused'),
      )

      await expect(service.searchShows('test')).rejects.toThrow(
        'Connection refused',
      )
    })
  })

  describe('getDownloadingEpisodes', () => {
    it('should call queue SDK and return transformed downloading episodes', async () => {
      const queueResponse = {
        records: [
          {
            id: 1,
            seriesId: 1,
            episodeId: 1001,
            title: 'Breaking Bad - S01E01',
            series: { id: 1, title: 'Breaking Bad', tvdbId: 81189 },
            episode: {
              id: 1001,
              episodeNumber: 1,
              seasonNumber: 1,
              title: 'Pilot',
            },
            status: 'downloading',
            trackedDownloadStatus: 'ok',
            protocol: 'torrent',
            downloadClient: 'qBittorrent',
            size: 2000000000,
            sizeleft: 1000000000,
          },
        ],
      }

      mockGetApiV3Queue.mockResolvedValue({ data: queueResponse })

      const results = await service.getDownloadingEpisodes()

      expect(getApiV3Queue).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            includeEpisode: true,
            includeSeries: true,
          }),
        }),
      )
      expect(results).toHaveLength(1)
      expect(results[0].seriesTitle).toBe('Breaking Bad')
      expect(results[0].episodeTitle).toBe('Pilot')
      expect(results[0].progressPercent).toBe(50)
      expect(results[0].isActive).toBe(true)
    })
  })

  describe('unmonitorAndDeleteSeries (entire series)', () => {
    it('should cancel downloads and delete series when no selection is provided', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [librarySeries] })
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [] } })
      mockDeleteApiV3SeriesById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteSeries(81189)

      expect(result.success).toBe(true)
      expect(result.seriesDeleted).toBe(true)
      expect(deleteApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 1 } }),
      )
    })

    it('should return failure when series is not found in library', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })

      const result = await service.unmonitorAndDeleteSeries(99999)

      expect(result.success).toBe(false)
      expect(result.seriesDeleted).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should cancel active downloads before deleting', async () => {
      const queueItem = {
        id: 5,
        seriesId: librarySeries.id,
        title: 'Breaking Bad - S01E01',
      }

      mockGetApiV3Series.mockResolvedValue({ data: [librarySeries] })
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [queueItem] } })
      mockDeleteApiV3QueueBulk.mockResolvedValue({ data: undefined })
      mockDeleteApiV3SeriesById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteSeries(81189)

      expect(result.success).toBe(true)
      expect(deleteApiV3QueueBulk).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { ids: [5] },
          query: { removeFromClient: true, blocklist: false },
        }),
      )
      expect(deleteApiV3SeriesById).toHaveBeenCalled()
      expect(result.canceledDownloads).toBe(1)
    })
  })

  describe('error propagation', () => {
    it('should propagate connection timeout from searchShows', async () => {
      const error = Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })
      mockGetApiV3SeriesLookup.mockRejectedValue(error)

      await expect(service.searchShows('test')).rejects.toThrow('ETIMEDOUT')
    })

    it('should propagate HTTP 401 from getDownloadingEpisodes', async () => {
      const error = Object.assign(new Error('Unauthorized'), {
        response: { status: 401 },
      })
      mockGetApiV3Queue.mockRejectedValue(error)

      await expect(service.getDownloadingEpisodes()).rejects.toThrow(
        'Unauthorized',
      )
    })

    it('should propagate network error from getLibrarySeries', async () => {
      mockGetApiV3Series.mockRejectedValue(new Error('Network Error'))

      await expect(service.getLibrarySeries()).rejects.toThrow('Network Error')
    })
  })
})
