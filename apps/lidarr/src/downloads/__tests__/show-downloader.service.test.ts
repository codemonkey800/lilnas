import {
  deleteApiV3QueueBulk,
  deleteApiV3QueueById as sonarrDeleteQueueById,
  getApiV3Episode,
  getApiV3EpisodeById,
  getApiV3QueueDetails,
  getApiV3Series,
  getApiV3SeriesById,
  getApiV3SeriesLookup,
  postApiV3Command as sonarrPostCommand,
  putApiV3EpisodeById,
  putApiV3EpisodeMonitor,
  putApiV3SeriesById,
} from '@lilnas/media/sonarr'
import { NotFoundException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Test, TestingModule } from '@nestjs/testing'

import { DownloadStateService } from 'src/downloads/download-state.service'
import {
  createTrackedEpisode,
  DownloadEvents,
  INTERNAL_DOWNLOAD_EVENT,
  type TrackedEpisodeDownload,
} from 'src/downloads/downloads.types'
import { ShowDownloaderService } from 'src/downloads/show-downloader.service'
import { SONARR_CLIENT } from 'src/media/clients'

const mockGetApiV3SeriesLookup = getApiV3SeriesLookup as jest.MockedFunction<
  typeof getApiV3SeriesLookup
>
const mockGetApiV3EpisodeById = getApiV3EpisodeById as jest.MockedFunction<
  typeof getApiV3EpisodeById
>
const mockGetApiV3Episode = getApiV3Episode as jest.MockedFunction<
  typeof getApiV3Episode
>
const mockGetApiV3QueueDetails = getApiV3QueueDetails as jest.MockedFunction<
  typeof getApiV3QueueDetails
>
const mockGetApiV3SeriesById = getApiV3SeriesById as jest.MockedFunction<
  typeof getApiV3SeriesById
>
const mockGetApiV3Series = getApiV3Series as jest.MockedFunction<
  typeof getApiV3Series
>
const mockSonarrPostCommand = sonarrPostCommand as jest.MockedFunction<
  typeof sonarrPostCommand
>
const mockPutApiV3EpisodeById = putApiV3EpisodeById as jest.MockedFunction<
  typeof putApiV3EpisodeById
>
const mockPutApiV3EpisodeMonitor =
  putApiV3EpisodeMonitor as jest.MockedFunction<typeof putApiV3EpisodeMonitor>
const mockPutApiV3SeriesById = putApiV3SeriesById as jest.MockedFunction<
  typeof putApiV3SeriesById
>
const mockDeleteApiV3QueueBulk = deleteApiV3QueueBulk as jest.MockedFunction<
  typeof deleteApiV3QueueBulk
>
const mockSonarrDeleteQueueById = sonarrDeleteQueueById as jest.MockedFunction<
  typeof sonarrDeleteQueueById
>

jest.mock('src/media/cache', () => ({
  cached: jest.fn((_key: string, _ttl: number, fn: () => Promise<unknown>) =>
    fn(),
  ),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function apiOk<T>(data: T): any {
  return { data }
}

function makeSeries(overrides = {}) {
  return {
    id: 10,
    tvdbId: 2000,
    title: 'Test Show',
    year: 2021,
    monitored: true,
    images: [],
    seasons: [],
    ...overrides,
  }
}

function makeEpisode(overrides = {}) {
  return {
    id: 50,
    seriesId: 10,
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Pilot',
    hasFile: false,
    monitored: false,
    airDate: '2021-01-01',
    ...overrides,
  }
}

function makeQueueItem(overrides = {}) {
  return {
    id: 200,
    episodeId: 50,
    status: 'downloading',
    size: 2000,
    sizeleft: 1000,
    ...overrides,
  }
}

describe('ShowDownloaderService', () => {
  let service: ShowDownloaderService
  let stateService: DownloadStateService
  let mockEvents: jest.Mocked<Pick<EventEmitter2, 'emit'>>

  beforeEach(async () => {
    mockEvents = { emit: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShowDownloaderService,
        DownloadStateService,
        { provide: SONARR_CLIENT, useValue: {} },
        { provide: EventEmitter2, useValue: mockEvents },
      ],
    }).compile()

    service = module.get(ShowDownloaderService)
    stateService = module.get(DownloadStateService)
  })

  // ---------------------------------------------------------------------------
  // requestDownload — single episode
  // ---------------------------------------------------------------------------

  describe('requestDownload (episode scope)', () => {
    it('monitors episode, issues EpisodeSearch, and creates tracked entry', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([makeSeries()]))
      mockGetApiV3EpisodeById.mockResolvedValue(
        apiOk(makeEpisode({ id: 50, seasonNumber: 2, episodeNumber: 3 })),
      )
      mockPutApiV3EpisodeById.mockResolvedValue(apiOk({}))
      mockSonarrPostCommand.mockResolvedValue(apiOk({ id: 77 }))

      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'episode',
        episodeId: 50,
      })

      expect(mockPutApiV3EpisodeById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ monitored: true }),
        }),
      )

      const entry = stateService.getTracked().get('episode:50') as
        | TrackedEpisodeDownload
        | undefined
      expect(entry?.kind).toBe('episode')
      expect(entry?.commandId).toBe(77)
      expect(entry?.seasonNumber).toBe(2)
      expect(entry?.episodeNumber).toBe(3)

      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({ eventName: DownloadEvents.INITIATED }),
      )
    })

    it('throws NotFoundException when show not found in Sonarr', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([]))
      await expect(
        service.requestDownload({
          mediaType: 'show',
          tvdbId: 9999,
          scope: 'episode',
          episodeId: 1,
        }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  // ---------------------------------------------------------------------------
  // requestDownload — season scope
  // ---------------------------------------------------------------------------

  describe('requestDownload (season scope)', () => {
    function setupSeason(
      episodes: ReturnType<typeof makeEpisode>[],
      seriesOverrides = {},
    ) {
      const series = makeSeries({
        seasons: [{ seasonNumber: 1, monitored: true }],
        ...seriesOverrides,
      })
      mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([series]))
      mockGetApiV3Episode.mockResolvedValue(apiOk(episodes))
      mockGetApiV3QueueDetails.mockResolvedValue(apiOk([]))
      mockGetApiV3SeriesById.mockResolvedValue(apiOk(series))
      mockPutApiV3EpisodeMonitor.mockResolvedValue(apiOk({}))
      mockSonarrPostCommand.mockResolvedValue(apiOk({ id: 1 }))
    }

    it('tracks eligible episodes and emits INITIATED per episode', async () => {
      setupSeason([
        makeEpisode({ id: 1, episodeNumber: 1 }),
        makeEpisode({ id: 2, episodeNumber: 2 }),
      ])

      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'season',
        seasonNumber: 1,
      })

      expect(stateService.getTracked().has('episode:1')).toBe(true)
      expect(stateService.getTracked().has('episode:2')).toBe(true)
      expect(mockEvents.emit).toHaveBeenCalledTimes(2)
    })

    it('monitors unmonitored season before issuing EpisodeSearch', async () => {
      const series = makeSeries({
        seasons: [{ seasonNumber: 1, monitored: false }],
      })
      mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([series]))
      mockGetApiV3Episode.mockResolvedValue(apiOk([makeEpisode({ id: 1 })]))
      mockGetApiV3QueueDetails.mockResolvedValue(apiOk([]))
      mockGetApiV3SeriesById.mockResolvedValue(apiOk(series))
      mockPutApiV3EpisodeMonitor.mockResolvedValue(apiOk({}))
      mockPutApiV3SeriesById.mockResolvedValue(apiOk({}))
      mockSonarrPostCommand.mockResolvedValue(apiOk({ id: 1 }))

      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'season',
        seasonNumber: 1,
      })

      expect(mockPutApiV3SeriesById).toHaveBeenCalled()
    })

    it('returns early when no eligible episodes exist for the season', async () => {
      setupSeason([makeEpisode({ id: 1, hasFile: true })])

      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'season',
        seasonNumber: 1,
      })

      expect(stateService.getTracked().size).toBe(0)
    })

    it('skips episodes with a future air date', async () => {
      const futureDate = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10)
      setupSeason([makeEpisode({ id: 1, airDate: futureDate })])

      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'season',
        seasonNumber: 1,
      })

      expect(stateService.getTracked().size).toBe(0)
    })

    it('skips episodes already in Sonarr queue', async () => {
      const series = makeSeries({
        seasons: [{ seasonNumber: 1, monitored: true }],
      })
      mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([series]))
      mockGetApiV3Episode.mockResolvedValue(apiOk([makeEpisode({ id: 3 })]))
      mockGetApiV3QueueDetails.mockResolvedValue(
        apiOk([makeQueueItem({ episodeId: 3, id: 99 })]),
      )
      mockGetApiV3SeriesById.mockResolvedValue(apiOk(series))
      mockPutApiV3EpisodeMonitor.mockResolvedValue(apiOk({}))
      mockSonarrPostCommand.mockResolvedValue(apiOk({ id: 1 }))

      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'season',
        seasonNumber: 1,
      })

      expect(stateService.getTracked().size).toBe(0)
    })

    it('skips episodes already tracked in memory', async () => {
      // Pre-track episode 4
      stateService.setTracked(
        'episode:4',
        createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 4,
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      )
      setupSeason([makeEpisode({ id: 4 })])

      const sizeBefore = stateService.getTracked().size
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'season',
        seasonNumber: 1,
      })

      expect(stateService.getTracked().size).toBe(sizeBefore)
    })
  })

  // ---------------------------------------------------------------------------
  // requestDownload — series scope
  // ---------------------------------------------------------------------------

  describe('requestDownload (series scope)', () => {
    it('monitors series, issues SeriesSearch, and tracks all eligible episodes', async () => {
      const series = makeSeries({
        seasons: [{ seasonNumber: 1, monitored: false }],
      })
      mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([series]))
      mockGetApiV3Episode.mockResolvedValue(
        apiOk([
          makeEpisode({ id: 1 }),
          makeEpisode({ id: 2, episodeNumber: 2 }),
        ]),
      )
      mockGetApiV3QueueDetails.mockResolvedValue(apiOk([]))
      mockGetApiV3SeriesById.mockResolvedValue(apiOk(series))
      mockPutApiV3EpisodeMonitor.mockResolvedValue(apiOk({}))
      mockPutApiV3SeriesById.mockResolvedValue(apiOk({}))
      mockSonarrPostCommand.mockResolvedValue(apiOk({ id: 10 }))

      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'series',
      })

      expect(mockPutApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ monitored: true }),
        }),
      )
      expect(stateService.getTracked().has('episode:1')).toBe(true)
      expect(stateService.getTracked().has('episode:2')).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // cancelEpisodeDownload
  // ---------------------------------------------------------------------------

  describe('cancelEpisodeDownload', () => {
    it('removes from queue and unmonitors when queueId is tracked', async () => {
      stateService.setTracked(
        'episode:50',
        createTrackedEpisode(
          {
            tvdbId: 2000,
            sonarrSeriesId: 10,
            sonarrEpisodeId: 50,
            seasonNumber: 1,
            episodeNumber: 1,
          },
          null,
        ),
      )
      stateService.updateTracked('episode:50', { queueId: 400 })

      mockSonarrDeleteQueueById.mockResolvedValue(apiOk({}))
      mockPutApiV3EpisodeMonitor.mockResolvedValue(apiOk({}))

      await service.cancelEpisodeDownload(50)

      expect(mockSonarrDeleteQueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 400 } }),
      )
      expect(mockPutApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [50], monitored: false },
        }),
      )
      expect(stateService.getTracked().has('episode:50')).toBe(false)
      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({ eventName: DownloadEvents.CANCELLED }),
      )
    })

    it('looks up queueId from live Sonarr queue when not tracked', async () => {
      mockGetApiV3QueueDetails.mockResolvedValue(
        apiOk([makeQueueItem({ episodeId: 50, id: 500 })]),
      )
      mockSonarrDeleteQueueById.mockResolvedValue(apiOk({}))
      mockPutApiV3EpisodeMonitor.mockResolvedValue(apiOk({}))

      await service.cancelEpisodeDownload(50)

      expect(mockSonarrDeleteQueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 500 } }),
      )
    })

    it('only unmonitors when no queueId found anywhere', async () => {
      mockGetApiV3QueueDetails.mockResolvedValue(apiOk([]))
      mockPutApiV3EpisodeMonitor.mockResolvedValue(apiOk({}))

      await service.cancelEpisodeDownload(50)

      expect(mockSonarrDeleteQueueById).not.toHaveBeenCalled()
      expect(mockPutApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [50], monitored: false },
        }),
      )
    })

    it('does not throw when cleanup API calls fail', async () => {
      mockGetApiV3QueueDetails.mockResolvedValue(
        apiOk([makeQueueItem({ episodeId: 50, id: 500 })]),
      )
      mockSonarrDeleteQueueById.mockRejectedValue(new Error('Sonarr down'))
      mockPutApiV3EpisodeMonitor.mockResolvedValue(apiOk({}))

      await expect(service.cancelEpisodeDownload(50)).resolves.toBeUndefined()
      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({ eventName: DownloadEvents.CANCELLED }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // cancelShowDownloads / cancelSeasonDownloads
  // ---------------------------------------------------------------------------

  describe('cancelShowDownloads', () => {
    it('bulk-deletes all queue items for the show and emits CANCELLED per episode', async () => {
      // Seed two tracked episodes for tvdbId=2000
      stateService.setTracked(
        'episode:10',
        createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 10,
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      )
      stateService.setTracked(
        'episode:11',
        createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 11,
          seasonNumber: 1,
          episodeNumber: 2,
        }),
      )

      mockGetApiV3SeriesLookup.mockResolvedValue(
        apiOk([makeSeries({ id: 10 })]),
      )
      mockGetApiV3QueueDetails.mockResolvedValue(
        apiOk([
          makeQueueItem({ id: 600, episodeId: 10 }),
          makeQueueItem({ id: 601, episodeId: 11 }),
        ]),
      )
      mockDeleteApiV3QueueBulk.mockResolvedValue(apiOk({}))
      mockPutApiV3EpisodeMonitor.mockResolvedValue(apiOk({}))

      const result = await service.cancelShowDownloads(2000)

      expect(mockDeleteApiV3QueueBulk).toHaveBeenCalled()
      expect(result.cancelledEpisodeIds).toEqual(
        expect.arrayContaining([10, 11]),
      )
      expect(stateService.getTracked().has('episode:10')).toBe(false)
      expect(stateService.getTracked().has('episode:11')).toBe(false)

      const cancelledEmissions = (
        mockEvents.emit as jest.Mock
      ).mock.calls.filter(([, p]) => p?.eventName === DownloadEvents.CANCELLED)
      expect(cancelledEmissions).toHaveLength(2)
    })

    it('throws NotFoundException when show not found in Sonarr', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([]))
      await expect(service.cancelShowDownloads(9999)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('cancelSeasonDownloads', () => {
    it('only cancels episodes for the specified season', async () => {
      stateService.setTracked(
        'episode:20',
        createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 20,
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      )
      stateService.setTracked(
        'episode:21',
        createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 21,
          seasonNumber: 2,
          episodeNumber: 1,
        }),
      )

      mockGetApiV3SeriesLookup.mockResolvedValue(
        apiOk([makeSeries({ id: 10 })]),
      )
      mockGetApiV3QueueDetails.mockResolvedValue(
        apiOk([makeQueueItem({ id: 700, episodeId: 20 })]),
      )
      mockDeleteApiV3QueueBulk.mockResolvedValue(apiOk({}))
      mockPutApiV3EpisodeMonitor.mockResolvedValue(apiOk({}))

      const result = await service.cancelSeasonDownloads(2000, 1)

      expect(result.cancelledEpisodeIds).toContain(20)
      expect(result.cancelledEpisodeIds).not.toContain(21)
      // Season 2 episode is still tracked
      expect(stateService.getTracked().has('episode:21')).toBe(true)
    })

    it('adds episodes not yet in queue to pendingCancelEpisodes', async () => {
      stateService.setTracked(
        'episode:30',
        createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 30,
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      )

      mockGetApiV3SeriesLookup.mockResolvedValue(
        apiOk([makeSeries({ id: 10 })]),
      )
      mockGetApiV3QueueDetails.mockResolvedValue(apiOk([]))
      mockPutApiV3EpisodeMonitor.mockResolvedValue(apiOk({}))

      await service.cancelSeasonDownloads(2000, 1)

      expect(stateService.getPendingCancelEpisodes().has(30)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // getShowStatus
  // ---------------------------------------------------------------------------

  describe('getShowStatus', () => {
    it('returns empty array when no episodes are tracked for the tvdbId', () => {
      expect(service.getShowStatus(2000)).toEqual([])
    })

    it('returns status items for tracked episodes matching tvdbId', () => {
      stateService.setTracked(
        'episode:50',
        createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 50,
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      )

      const status = service.getShowStatus(2000)
      expect(status).toHaveLength(1)
      expect(status[0]?.episodeId).toBe(50)
      expect(status[0]?.state).toBe('searching')
    })

    it('excludes episodes from a different tvdbId', () => {
      stateService.setTracked(
        'episode:60',
        createTrackedEpisode({
          tvdbId: 3000,
          sonarrSeriesId: 20,
          sonarrEpisodeId: 60,
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      )

      expect(service.getShowStatus(2000)).toEqual([])
    })

    it('returns correct state for a downloading episode', () => {
      stateService.setTracked('episode:70', {
        ...createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 70,
          seasonNumber: 1,
          episodeNumber: 5,
        }),
        queueId: 99,
        lastProgress: 45,
        lastStatus: 'downloading',
        lastSize: 1000,
        lastSizeleft: 550,
        lastTitle: 'Episode 5',
        lastEta: null,
      })

      const status = service.getShowStatus(2000)
      expect(status[0]?.state).toBe('downloading')
      expect(status[0]?.progress).toBe(45)
    })
  })

  // ---------------------------------------------------------------------------
  // buildShowDownloadItems
  // ---------------------------------------------------------------------------

  describe('buildShowDownloadItems', () => {
    it('returns empty array for empty input', async () => {
      const result = await service.buildShowDownloadItems([])
      expect(result).toEqual([])
    })

    it('groups episodes by show and season, sorted by season and episode number', async () => {
      const entries = [
        createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 1,
          seasonNumber: 2,
          episodeNumber: 1,
        }),
        createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 2,
          seasonNumber: 1,
          episodeNumber: 2,
        }),
        createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 3,
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      ]

      mockGetApiV3Series.mockResolvedValue(
        apiOk([makeSeries({ id: 10, title: 'Breaking Bad', year: 2008 })]),
      )

      const result = await service.buildShowDownloadItems(entries)

      expect(result).toHaveLength(1)
      expect(result[0]?.title).toBe('Breaking Bad')
      expect(result[0]?.year).toBe(2008)
      expect(result[0]?.seasons).toHaveLength(2)
      // Seasons sorted ascending
      expect(result[0]?.seasons[0]?.seasonNumber).toBe(1)
      expect(result[0]?.seasons[1]?.seasonNumber).toBe(2)
      // Episodes within season sorted ascending
      expect(result[0]?.seasons[0]?.episodes[0]?.episodeNumber).toBe(1)
      expect(result[0]?.seasons[0]?.episodes[1]?.episodeNumber).toBe(2)
    })

    it('groups episodes from multiple shows into separate items', async () => {
      const entries = [
        createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 1,
          seasonNumber: 1,
          episodeNumber: 1,
        }),
        createTrackedEpisode({
          tvdbId: 3000,
          sonarrSeriesId: 20,
          sonarrEpisodeId: 2,
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      ]

      mockGetApiV3Series.mockResolvedValue(
        apiOk([
          makeSeries({ id: 10, title: 'Show A' }),
          makeSeries({ id: 20, title: 'Show B', tvdbId: 3000 }),
        ]),
      )

      const result = await service.buildShowDownloadItems(entries)

      expect(result).toHaveLength(2)
    })

    it('extracts poster URL from series images', async () => {
      const entry = createTrackedEpisode({
        tvdbId: 2000,
        sonarrSeriesId: 10,
        sonarrEpisodeId: 1,
        seasonNumber: 1,
        episodeNumber: 1,
      })

      mockGetApiV3Series.mockResolvedValue(
        apiOk([
          makeSeries({
            id: 10,
            images: [
              {
                coverType: 'poster',
                remoteUrl: 'https://img.example.com/show-poster.jpg',
              },
            ],
          }),
        ]),
      )

      const result = await service.buildShowDownloadItems([entry])

      expect(result[0]?.posterUrl).toBe(
        'https://img.example.com/show-poster.jpg',
      )
    })

    it('handles Sonarr series fetch failure and falls back to unknown', async () => {
      const entry = createTrackedEpisode({
        tvdbId: 2000,
        sonarrSeriesId: 10,
        sonarrEpisodeId: 1,
        seasonNumber: 1,
        episodeNumber: 1,
      })

      mockGetApiV3Series.mockRejectedValue(new Error('Network error'))

      const result = await service.buildShowDownloadItems([entry])

      expect(result).toHaveLength(1)
      expect(result[0]?.title).toBe('Unknown')
    })
  })
})
