import {
  deleteApiV3QueueById,
  getApiV3Movie,
  getApiV3QueueDetails as radarrGetQueueDetails,
  postApiV3Command as radarrPostCommand,
  postApiV3Release,
  putApiV3MovieById,
} from '@lilnas/media/radarr-next'
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
} from '@lilnas/media/sonarr'
import { NotFoundException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Test, TestingModule } from '@nestjs/testing'

import { DownloadsService } from 'src/downloads/downloads.service'
import {
  DownloadEvents,
  INTERNAL_DOWNLOAD_EVENT,
  type TrackedEpisodeDownload,
  type TrackedMovieDownload,
} from 'src/downloads/downloads.types'
import { RADARR_CLIENT, SONARR_CLIENT } from 'src/media/clients'

// All @lilnas/media/* functions are mocked globally in setup.ts
const mockGetApiV3Movie = getApiV3Movie as jest.MockedFunction<
  typeof getApiV3Movie
>
const mockRadarrGetQueueDetails = radarrGetQueueDetails as jest.MockedFunction<
  typeof radarrGetQueueDetails
>
const mockRadarrPostCommand = radarrPostCommand as jest.MockedFunction<
  typeof radarrPostCommand
>
const mockPostApiV3Release = postApiV3Release as jest.MockedFunction<
  typeof postApiV3Release
>
const mockPutApiV3MovieById = putApiV3MovieById as jest.MockedFunction<
  typeof putApiV3MovieById
>
const mockDeleteApiV3QueueById = deleteApiV3QueueById as jest.MockedFunction<
  typeof deleteApiV3QueueById
>

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
const mockDeleteApiV3QueueBulk = deleteApiV3QueueBulk as jest.MockedFunction<
  typeof deleteApiV3QueueBulk
>
const mockSonarrDeleteQueueById = sonarrDeleteQueueById as jest.MockedFunction<
  typeof sonarrDeleteQueueById
>

// Mock cached() so it doesn't interfere with TTL state across tests
jest.mock('src/media/cache', () => ({
  cached: jest.fn((_key: string, _ttl: number, fn: () => Promise<unknown>) =>
    fn(),
  ),
}))

function makeMovieResource(overrides = {}) {
  return {
    id: 1,
    tmdbId: 100,
    title: 'Test Movie',
    year: 2024,
    monitored: true,
    images: [],
    ...overrides,
  }
}

function makeSeriesResource(overrides = {}) {
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

function makeEpisodeResource(overrides = {}) {
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
    movieId: 1,
    episodeId: undefined,
    status: 'downloading',
    size: 1000,
    sizeleft: 500,
    ...overrides,
  }
}

describe('DownloadsService', () => {
  let service: DownloadsService
  let mockEvents: jest.Mocked<EventEmitter2>

  beforeEach(async () => {
    mockEvents = { emit: jest.fn() } as unknown as jest.Mocked<EventEmitter2>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadsService,
        { provide: RADARR_CLIENT, useValue: {} },
        { provide: SONARR_CLIENT, useValue: {} },
        { provide: EventEmitter2, useValue: mockEvents },
      ],
    }).compile()

    service = module.get(DownloadsService)
  })

  // ---------------------------------------------------------------------------
  // Movie download
  // ---------------------------------------------------------------------------

  describe('requestDownload (movie)', () => {
    it('creates tracked entry with commandId and emits INITIATED', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [makeMovieResource()],
      } as never)
      mockRadarrPostCommand.mockResolvedValue({ data: { id: 99 } } as never)

      await service.requestDownload({ mediaType: 'movie', tmdbId: 100 })

      const tracked = service.getTracked().get('movie:100') as
        | TrackedMovieDownload
        | undefined
      expect(tracked).toBeDefined()
      expect(tracked?.commandId).toBe(99)
      expect(tracked?.tmdbId).toBe(100)
      expect(tracked?.radarrMovieId).toBe(1)
      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({ eventName: DownloadEvents.INITIATED }),
      )
    })

    it('throws NotFoundException when movie not found in Radarr', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] } as never)
      await expect(
        service.requestDownload({ mediaType: 'movie', tmdbId: 999 }),
      ).rejects.toThrow(NotFoundException)
    })

    it('enables monitoring when movie is unmonitored before searching', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [makeMovieResource({ monitored: false })],
      } as never)
      mockRadarrPostCommand.mockResolvedValue({ data: { id: 10 } } as never)
      mockPutApiV3MovieById.mockResolvedValue({} as never)

      await service.requestDownload({ mediaType: 'movie', tmdbId: 100 })
      expect(mockPutApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ monitored: true }),
        }),
      )
    })

    it('skips monitoring update when movie is already monitored', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [makeMovieResource({ monitored: true })],
      } as never)
      mockRadarrPostCommand.mockResolvedValue({ data: { id: 10 } } as never)

      await service.requestDownload({ mediaType: 'movie', tmdbId: 100 })
      expect(mockPutApiV3MovieById).not.toHaveBeenCalled()
    })

    it('grabs a specific release when releaseGuid and indexerId are provided', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [makeMovieResource()],
      } as never)
      mockPostApiV3Release.mockResolvedValue({} as never)

      await service.requestDownload({
        mediaType: 'movie',
        tmdbId: 100,
        releaseGuid: 'guid-abc',
        indexerId: 5,
      })

      expect(mockPostApiV3Release).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ guid: 'guid-abc', indexerId: 5 }),
        }),
      )
      // No search command issued
      expect(mockRadarrPostCommand).not.toHaveBeenCalled()

      const tracked = service.getTracked().get('movie:100')
      expect(tracked).toBeDefined()
      // commandId is null for grab path (no search command)
      expect((tracked as TrackedMovieDownload).commandId).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Episode download (single)
  // ---------------------------------------------------------------------------

  describe('requestDownload (episode)', () => {
    it('monitors episode, issues search command, and creates tracked entry', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [makeSeriesResource()],
      } as never)
      mockGetApiV3EpisodeById.mockResolvedValue({
        data: makeEpisodeResource({
          id: 50,
          seasonNumber: 2,
          episodeNumber: 3,
        }),
      } as never)
      mockPutApiV3EpisodeById.mockResolvedValue({} as never)
      mockSonarrPostCommand.mockResolvedValue({ data: { id: 77 } } as never)

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

      const tracked = service.getTracked().get('episode:50') as
        | TrackedEpisodeDownload
        | undefined
      expect(tracked).toBeDefined()
      expect(tracked?.commandId).toBe(77)
      expect(tracked?.seasonNumber).toBe(2)
      expect(tracked?.episodeNumber).toBe(3)
      expect(tracked?.tvdbId).toBe(2000)
    })

    it('throws NotFoundException when show not found in Sonarr', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({ data: [] } as never)
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
  // filterEligibleEpisodes (tested via season/series download)
  // ---------------------------------------------------------------------------

  describe('filterEligibleEpisodes (via season download)', () => {
    function setupSeasonDownload(
      episodes: ReturnType<typeof makeEpisodeResource>[],
    ) {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          makeSeriesResource({
            seasons: [{ seasonNumber: 1, monitored: true }],
          }),
        ],
      } as never)
      mockGetApiV3Episode.mockResolvedValue({ data: episodes } as never)
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] } as never)
      mockGetApiV3SeriesById.mockResolvedValue({
        data: makeSeriesResource({
          seasons: [{ seasonNumber: 1, monitored: true }],
        }),
      } as never)
      mockPutApiV3EpisodeMonitor.mockResolvedValue({} as never)
      mockSonarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)
    }

    it('skips episodes that already have a file', async () => {
      setupSeasonDownload([makeEpisodeResource({ id: 1, hasFile: true })])
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'season',
        seasonNumber: 1,
      })
      // No tracked entries added because the episode has a file
      expect(service.getTracked().size).toBe(0)
    })

    it('skips episodes with a future air date', async () => {
      const futureDate = new Date(Date.now() + 86400000)
        .toISOString()
        .slice(0, 10)
      setupSeasonDownload([
        makeEpisodeResource({ id: 2, hasFile: false, airDate: futureDate }),
      ])
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'season',
        seasonNumber: 1,
      })
      expect(service.getTracked().size).toBe(0)
    })

    it('skips episodes already in the Sonarr queue', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          makeSeriesResource({
            seasons: [{ seasonNumber: 1, monitored: true }],
          }),
        ],
      } as never)
      mockGetApiV3Episode.mockResolvedValue({
        data: [makeEpisodeResource({ id: 3, hasFile: false })],
      } as never)
      mockGetApiV3QueueDetails.mockResolvedValue({
        data: [{ episodeId: 3, id: 100 }],
      } as never)
      mockGetApiV3SeriesById.mockResolvedValue({
        data: makeSeriesResource({
          seasons: [{ seasonNumber: 1, monitored: true }],
        }),
      } as never)
      mockPutApiV3EpisodeMonitor.mockResolvedValue({} as never)
      mockSonarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)

      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'season',
        seasonNumber: 1,
      })
      expect(service.getTracked().size).toBe(0)
    })

    it('skips episodes already tracked in memory', async () => {
      // Pre-populate the tracked map
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [makeSeriesResource()],
      } as never)
      mockGetApiV3EpisodeById.mockResolvedValue({
        data: makeEpisodeResource({ id: 4 }),
      } as never)
      mockPutApiV3EpisodeById.mockResolvedValue({} as never)
      mockSonarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'episode',
        episodeId: 4,
      })

      // Now attempt a season download that includes the same episode
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          makeSeriesResource({
            seasons: [{ seasonNumber: 1, monitored: true }],
          }),
        ],
      } as never)
      mockGetApiV3Episode.mockResolvedValue({
        data: [makeEpisodeResource({ id: 4 })],
      } as never)
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] } as never)
      mockGetApiV3SeriesById.mockResolvedValue({
        data: makeSeriesResource({
          seasons: [{ seasonNumber: 1, monitored: true }],
        }),
      } as never)

      const sizeBefore = service.getTracked().size
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'season',
        seasonNumber: 1,
      })
      // Episode 4 was already tracked; no new entry added
      expect(service.getTracked().size).toBe(sizeBefore)
    })

    it('tracks eligible episodes and emits INITIATED for each', async () => {
      setupSeasonDownload([
        makeEpisodeResource({ id: 5, hasFile: false }),
        makeEpisodeResource({ id: 6, hasFile: false, episodeNumber: 2 }),
      ])
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'season',
        seasonNumber: 1,
      })
      expect(service.getTracked().has('episode:5')).toBe(true)
      expect(service.getTracked().has('episode:6')).toBe(true)
      expect(mockEvents.emit).toHaveBeenCalledTimes(2)
    })
  })

  // ---------------------------------------------------------------------------
  // Cancel movie
  // ---------------------------------------------------------------------------

  describe('cancelMovieDownload', () => {
    it('removes queue item and emits CANCELLED when tracked entry has queueId', async () => {
      // Seed a tracked movie with queueId already set
      service.updateTracked('movie:100', {})
      // Manually set via internal; instead seed tracked entry first
      await service
        .requestDownload({ mediaType: 'movie', tmdbId: 100 })
        .catch(() => null)
      // Simplified: just test cancel via the public updateTracked + cancel path
      // Set up fresh
      mockGetApiV3Movie.mockResolvedValue({
        data: [makeMovieResource()],
      } as never)
      mockRadarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)
      await service.requestDownload({ mediaType: 'movie', tmdbId: 100 })
      service.updateTracked('movie:100', { queueId: 200 })

      mockDeleteApiV3QueueById.mockResolvedValue({} as never)
      await service.cancelMovieDownload(100)

      expect(mockDeleteApiV3QueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 200 } }),
      )
      expect(service.getTracked().has('movie:100')).toBe(false)
      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({ eventName: DownloadEvents.CANCELLED }),
      )
    })

    it('falls back to live Radarr queue lookup when tracked entry has no queueId', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [makeMovieResource({ id: 1 })],
      } as never)
      mockRadarrGetQueueDetails.mockResolvedValue({
        data: [makeQueueItem({ movieId: 1, id: 300 })],
      } as never)
      mockDeleteApiV3QueueById.mockResolvedValue({} as never)

      await service.cancelMovieDownload(100)

      expect(mockDeleteApiV3QueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 300 } }),
      )
    })

    it('still emits CANCELLED and removes tracked entry even when no queue item exists', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [makeMovieResource()],
      } as never)
      mockRadarrGetQueueDetails.mockResolvedValue({ data: [] } as never)

      // Seed tracked with no queueId
      mockRadarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)
      await service.requestDownload({ mediaType: 'movie', tmdbId: 100 })

      await service.cancelMovieDownload(100)

      expect(service.getTracked().has('movie:100')).toBe(false)
      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({ eventName: DownloadEvents.CANCELLED }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Cancel episode
  // ---------------------------------------------------------------------------

  describe('cancelEpisodeDownload', () => {
    it('removes from queue and unmonitors when queueId is tracked', async () => {
      // Seed tracked episode with queueId
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [makeSeriesResource()],
      } as never)
      mockGetApiV3EpisodeById.mockResolvedValue({
        data: makeEpisodeResource({ id: 50 }),
      } as never)
      mockPutApiV3EpisodeById.mockResolvedValue({} as never)
      mockSonarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'episode',
        episodeId: 50,
      })
      service.updateTracked('episode:50', { queueId: 400 })

      mockSonarrDeleteQueueById.mockResolvedValue({} as never)
      mockPutApiV3EpisodeMonitor.mockResolvedValue({} as never)

      await service.cancelEpisodeDownload(50)

      expect(mockSonarrDeleteQueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 400 } }),
      )
      expect(mockPutApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [50], monitored: false },
        }),
      )
      expect(service.getTracked().has('episode:50')).toBe(false)
    })

    it('only unmonitors when no queueId is found', async () => {
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] } as never)
      mockPutApiV3EpisodeMonitor.mockResolvedValue({} as never)

      await service.cancelEpisodeDownload(50)

      expect(mockSonarrDeleteQueueById).not.toHaveBeenCalled()
      expect(mockPutApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [50], monitored: false },
        }),
      )
    })

    it('does not throw when cleanup API calls fail', async () => {
      mockGetApiV3QueueDetails.mockResolvedValue({
        data: [{ id: 500, episodeId: 50 }],
      } as never)
      mockSonarrDeleteQueueById.mockRejectedValue(
        new Error('Sonarr unavailable'),
      )
      mockPutApiV3EpisodeMonitor.mockResolvedValue({} as never)

      // Should not throw
      await expect(service.cancelEpisodeDownload(50)).resolves.toBeUndefined()
      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({ eventName: DownloadEvents.CANCELLED }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Cancel season / show
  // ---------------------------------------------------------------------------

  describe('cancelSeasonDownloads', () => {
    it('bulk deletes queue items for tracked season episodes and emits CANCELLED per episode', async () => {
      // Seed two tracked episodes in season 1
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [makeSeriesResource()],
      } as never)
      mockGetApiV3EpisodeById
        .mockResolvedValueOnce({
          data: makeEpisodeResource({ id: 10, seasonNumber: 1 }),
        } as never)
        .mockResolvedValueOnce({
          data: makeEpisodeResource({
            id: 11,
            seasonNumber: 1,
            episodeNumber: 2,
          }),
        } as never)
      mockPutApiV3EpisodeById.mockResolvedValue({} as never)
      mockSonarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'episode',
        episodeId: 10,
      })
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'episode',
        episodeId: 11,
      })

      mockGetApiV3QueueDetails.mockResolvedValue({
        data: [
          { id: 600, episodeId: 10 },
          { id: 601, episodeId: 11 },
        ],
      } as never)
      mockDeleteApiV3QueueBulk.mockResolvedValue({} as never)
      mockPutApiV3EpisodeMonitor.mockResolvedValue({} as never)

      const result = await service.cancelSeasonDownloads(2000, 10, 1)

      expect(mockDeleteApiV3QueueBulk).toHaveBeenCalled()
      expect(result.cancelledEpisodeIds).toEqual(
        expect.arrayContaining([10, 11]),
      )
      expect(service.getTracked().has('episode:10')).toBe(false)
      expect(service.getTracked().has('episode:11')).toBe(false)
      // Two CANCELLED events emitted
      const cancelEvents = (mockEvents.emit as jest.Mock).mock.calls.filter(
        ([, payload]) => payload?.eventName === DownloadEvents.CANCELLED,
      )
      expect(cancelEvents).toHaveLength(2)
    })

    it('adds episodes not yet in queue to pendingCancelEpisodes', async () => {
      // Seed tracked episode but queue is empty for it
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [makeSeriesResource()],
      } as never)
      mockGetApiV3EpisodeById.mockResolvedValue({
        data: makeEpisodeResource({ id: 20, seasonNumber: 1 }),
      } as never)
      mockPutApiV3EpisodeById.mockResolvedValue({} as never)
      mockSonarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'episode',
        episodeId: 20,
      })

      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] } as never)
      mockPutApiV3EpisodeMonitor.mockResolvedValue({} as never)

      await service.cancelSeasonDownloads(2000, 10, 1)

      expect(service.getPendingCancelEpisodes().has(20)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // getMovieStatus / queue recovery
  // ---------------------------------------------------------------------------

  describe('getMovieStatus', () => {
    it('returns status from tracked map when entry exists', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [makeMovieResource()],
      } as never)
      mockRadarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)
      await service.requestDownload({ mediaType: 'movie', tmdbId: 100 })
      service.updateTracked('movie:100', {
        queueId: 5,
        lastProgress: 42,
        lastStatus: 'downloading',
        lastTitle: 'Test Movie',
        lastSize: 2000,
        lastSizeleft: 1160,
        lastEta: null,
      })

      const status = await service.getMovieStatus(100)
      expect(status?.state).toBe('downloading')
      expect(status?.progress).toBe(42)
    })

    it('recovers from Radarr queue when tracked map has no entry for the tmdbId', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [makeMovieResource({ id: 1 })],
      } as never)
      mockRadarrGetQueueDetails.mockResolvedValue({
        data: [
          makeQueueItem({
            movieId: 1,
            id: 700,
            size: 2000,
            sizeleft: 1000,
            status: 'downloading',
            title: 'Recovered Movie',
          }),
        ],
      } as never)

      const status = await service.getMovieStatus(100)
      expect(status).not.toBeNull()
      expect(status?.state).toBe('downloading')
      expect(status?.progress).toBe(50)
      // Entry should now be populated in tracked map
      expect(service.getTracked().has('movie:100')).toBe(true)
    })

    it('returns null when movie not found during queue recovery', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] } as never)
      mockRadarrGetQueueDetails.mockResolvedValue({ data: [] } as never)
      const status = await service.getMovieStatus(999)
      expect(status).toBeNull()
    })

    it('returns null when movie is in library but not in queue', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [makeMovieResource({ id: 1 })],
      } as never)
      mockRadarrGetQueueDetails.mockResolvedValue({ data: [] } as never)
      const status = await service.getMovieStatus(100)
      expect(status).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // getShowStatus
  // ---------------------------------------------------------------------------

  describe('getShowStatus', () => {
    it('returns empty array when no episodes are tracked for the tvdbId', () => {
      expect(service.getShowStatus(2000)).toEqual([])
    })

    it('returns status items for tracked episodes matching tvdbId', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [makeSeriesResource()],
      } as never)
      mockGetApiV3EpisodeById.mockResolvedValue({
        data: makeEpisodeResource({ id: 50 }),
      } as never)
      mockPutApiV3EpisodeById.mockResolvedValue({} as never)
      mockSonarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'episode',
        episodeId: 50,
      })

      const status = service.getShowStatus(2000)
      expect(status).toHaveLength(1)
      expect(status[0]?.episodeId).toBe(50)
      expect(status[0]?.state).toBe('searching')
    })

    it('excludes episodes from a different tvdbId', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [makeSeriesResource({ tvdbId: 3000, id: 20 })],
      } as never)
      mockGetApiV3EpisodeById.mockResolvedValue({
        data: makeEpisodeResource({ id: 60, seriesId: 20 }),
      } as never)
      mockPutApiV3EpisodeById.mockResolvedValue({} as never)
      mockSonarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 3000,
        scope: 'episode',
        episodeId: 60,
      })

      expect(service.getShowStatus(2000)).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // getAllDownloads
  // ---------------------------------------------------------------------------

  describe('getAllDownloads', () => {
    it('returns empty movies and shows arrays when nothing is tracked', async () => {
      const result = await service.getAllDownloads()
      expect(result).toEqual({ movies: [], shows: [] })
    })

    it('builds movie items with metadata from cached Radarr movie list', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [
          makeMovieResource({
            id: 1,
            title: 'Interstellar',
            year: 2014,
            images: [],
          }),
        ],
      } as never)
      mockRadarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)
      await service.requestDownload({ mediaType: 'movie', tmdbId: 100 })

      // For getAllDownloads, cached() passes through to getApiV3Movie (all movies)
      mockGetApiV3Movie.mockResolvedValue({
        data: [
          makeMovieResource({
            id: 1,
            title: 'Interstellar',
            year: 2014,
            images: [],
          }),
        ],
      } as never)

      const result = await service.getAllDownloads()
      expect(result.movies).toHaveLength(1)
      expect(result.movies[0]?.title).toBe('Interstellar')
      expect(result.movies[0]?.year).toBe(2014)
      expect(result.movies[0]?.tmdbId).toBe(100)
    })

    it('groups show episodes by show and season', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [makeSeriesResource()],
      } as never)
      mockGetApiV3EpisodeById
        .mockResolvedValueOnce({
          data: makeEpisodeResource({
            id: 50,
            seasonNumber: 1,
            episodeNumber: 1,
          }),
        } as never)
        .mockResolvedValueOnce({
          data: makeEpisodeResource({
            id: 51,
            seasonNumber: 1,
            episodeNumber: 2,
          }),
        } as never)
      mockPutApiV3EpisodeById.mockResolvedValue({} as never)
      mockSonarrPostCommand.mockResolvedValue({ data: { id: 1 } } as never)
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'episode',
        episodeId: 50,
      })
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 2000,
        scope: 'episode',
        episodeId: 51,
      })

      mockGetApiV3Series.mockResolvedValue({
        data: [makeSeriesResource({ title: 'Breaking Bad', year: 2008 })],
      } as never)

      const result = await service.getAllDownloads()
      expect(result.shows).toHaveLength(1)
      expect(result.shows[0]?.title).toBe('Breaking Bad')
      expect(result.shows[0]?.seasons).toHaveLength(1)
      expect(result.shows[0]?.seasons[0]?.episodes).toHaveLength(2)
    })
  })
})
