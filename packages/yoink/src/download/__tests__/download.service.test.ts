jest.mock('@lilnas/media/radarr-next', () => ({
  getApiV3Movie: jest.fn(),
  getApiV3QueueDetails: jest.fn(),
  deleteApiV3QueueById: jest.fn(),
  putApiV3MovieById: jest.fn(),
  postApiV3Command: jest.fn(),
  postApiV3Release: jest.fn(),
}))

jest.mock('@lilnas/media/sonarr', () => ({
  getApiV3SeriesLookup: jest.fn(),
  getApiV3EpisodeById: jest.fn(),
  putApiV3EpisodeById: jest.fn(),
  postApiV3Command: jest.fn(),
  getApiV3Episode: jest.fn(),
  getApiV3QueueDetails: jest.fn(),
  getApiV3SeriesById: jest.fn(),
  putApiV3EpisodeMonitor: jest.fn(),
  putApiV3SeriesById: jest.fn(),
  deleteApiV3QueueBulk: jest.fn(),
  deleteApiV3QueueById: jest.fn(),
}))

import {
  deleteApiV3QueueById as radarrDeleteQueueById,
  getApiV3Movie,
  getApiV3QueueDetails as radarrGetQueueDetails,
  postApiV3Command as radarrPostCommand,
  putApiV3MovieById,
} from '@lilnas/media/radarr-next'
import {
  deleteApiV3QueueBulk,
  deleteApiV3QueueById as sonarrDeleteQueueById,
  getApiV3Episode,
  getApiV3EpisodeById,
  getApiV3QueueDetails as sonarrGetQueueDetails,
  getApiV3SeriesById,
  getApiV3SeriesLookup,
  postApiV3Command as sonarrPostCommand,
  putApiV3EpisodeById,
  putApiV3EpisodeMonitor,
} from '@lilnas/media/sonarr'
import { EventEmitter2 } from '@nestjs/event-emitter'

import { DownloadService } from 'src/download/download.service'
import {
  DownloadEvents,
  INTERNAL_DOWNLOAD_EVENT,
} from 'src/download/download.types'

function makeEventEmitter(): jest.Mocked<EventEmitter2> {
  return { emit: jest.fn() } as unknown as jest.Mocked<EventEmitter2>
}

function makeMovieApiResponse(
  movie = { id: 123, tmdbId: 456, monitored: true },
) {
  return { data: [movie] }
}

function makeEmptyMovieApiResponse() {
  return { data: [] }
}

describe('DownloadService', () => {
  let service: DownloadService
  let events: jest.Mocked<EventEmitter2>

  beforeEach(() => {
    events = makeEventEmitter()
    service = new DownloadService(events)

    // Default: all API calls succeed with minimal responses
    ;(getApiV3Movie as jest.Mock).mockResolvedValue(makeMovieApiResponse())
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })
    ;(radarrDeleteQueueById as jest.Mock).mockResolvedValue({})
    ;(putApiV3MovieById as jest.Mock).mockResolvedValue({})
    ;(radarrPostCommand as jest.Mock).mockResolvedValue({})
    ;(getApiV3SeriesLookup as jest.Mock).mockResolvedValue({
      data: [{ id: 20, tvdbId: 789 }],
    })
    ;(getApiV3EpisodeById as jest.Mock).mockResolvedValue({
      data: { id: 1, seasonNumber: 1, episodeNumber: 1, monitored: false },
    })
    ;(putApiV3EpisodeById as jest.Mock).mockResolvedValue({})
    ;(sonarrPostCommand as jest.Mock).mockResolvedValue({})
    ;(sonarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })
    ;(getApiV3Episode as jest.Mock).mockResolvedValue({ data: [] })
    ;(getApiV3SeriesById as jest.Mock).mockResolvedValue({
      data: { id: 20, seasons: [] },
    })
    ;(putApiV3EpisodeMonitor as jest.Mock).mockResolvedValue({})
    ;(deleteApiV3QueueBulk as jest.Mock).mockResolvedValue({})
    ;(sonarrDeleteQueueById as jest.Mock).mockResolvedValue({})
  })

  // ---------------------------------------------------------------------------
  // State management helpers
  // ---------------------------------------------------------------------------

  describe('getTracked / updateTracked / removeTracked', () => {
    it('updateTracked does nothing when key does not exist', () => {
      service.updateTracked('movie:999', { queueId: 1 })
      expect(service.getTracked().size).toBe(0)
    })

    it('updateTracked merges into existing entry', async () => {
      await service.requestDownload({ mediaType: 'movie', tmdbId: 456 })
      service.updateTracked('movie:456', { queueId: 99, lastTitle: 'Hello' })
      const entry = service.getTracked().get('movie:456')
      expect(entry?.queueId).toBe(99)
      expect((entry as never as { lastTitle: string }).lastTitle).toBe('Hello')
    })

    it('removeTracked removes an existing key', async () => {
      await service.requestDownload({ mediaType: 'movie', tmdbId: 456 })
      expect(service.getTracked().has('movie:456')).toBe(true)
      service.removeTracked('movie:456')
      expect(service.getTracked().has('movie:456')).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // emitEvent
  // ---------------------------------------------------------------------------

  describe('emitEvent', () => {
    it('emits INTERNAL_DOWNLOAD_EVENT with correct envelope', () => {
      const payload = {
        event: DownloadEvents.INITIATED,
        mediaType: 'movie' as const,
        tmdbId: 456,
      }
      service.emitEvent(payload)
      expect(events.emit).toHaveBeenCalledWith(INTERNAL_DOWNLOAD_EVENT, {
        eventName: DownloadEvents.INITIATED,
        payload,
      })
    })
  })

  // ---------------------------------------------------------------------------
  // requestDownload – movie
  // ---------------------------------------------------------------------------

  describe('requestDownload (movie)', () => {
    it('adds tracked entry and emits INITIATED on search path', async () => {
      await service.requestDownload({ mediaType: 'movie', tmdbId: 456 })
      expect(service.getTracked().has('movie:456')).toBe(true)
      expect(events.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({
          eventName: DownloadEvents.INITIATED,
          payload: expect.objectContaining({ tmdbId: 456 }),
        }),
      )
    })

    it('calls radarrPostCommand to trigger search', async () => {
      await service.requestDownload({ mediaType: 'movie', tmdbId: 456 })
      expect(radarrPostCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ name: 'MoviesSearch' }),
        }),
      )
    })

    it('monitors movie before search if not already monitored', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue(
        makeMovieApiResponse({ id: 123, tmdbId: 456, monitored: false }),
      )
      await service.requestDownload({ mediaType: 'movie', tmdbId: 456 })
      expect(putApiV3MovieById).toHaveBeenCalled()
    })

    it('skips monitoring if movie is already monitored', async () => {
      await service.requestDownload({ mediaType: 'movie', tmdbId: 456 })
      expect(putApiV3MovieById).not.toHaveBeenCalled()
    })

    it('grabs specific release when releaseGuid and indexerId provided', async () => {
      const { postApiV3Release } = jest.requireMock('@lilnas/media/radarr-next')
      ;(postApiV3Release as jest.Mock).mockResolvedValue({})
      await service.requestDownload({
        mediaType: 'movie',
        tmdbId: 456,
        releaseGuid: 'abc-guid',
        indexerId: 7,
      })
      expect(postApiV3Release).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ guid: 'abc-guid', indexerId: 7 }),
        }),
      )
    })

    it('throws NotFoundException when movie not found in Radarr', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue(
        makeEmptyMovieApiResponse(),
      )
      await expect(
        service.requestDownload({ mediaType: 'movie', tmdbId: 999 }),
      ).rejects.toThrow('not found in Radarr library')
    })
  })

  // ---------------------------------------------------------------------------
  // requestDownload – show (episode)
  // ---------------------------------------------------------------------------

  describe('requestDownload (show – episode)', () => {
    it('adds tracked episode entry and emits INITIATED', async () => {
      ;(getApiV3EpisodeById as jest.Mock).mockResolvedValue({
        data: { id: 1, seasonNumber: 1, episodeNumber: 1, monitored: false },
      })
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 789,
        scope: 'episode',
        episodeId: 1,
      })
      expect(service.getTracked().has('episode:1')).toBe(true)
      expect(events.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({
          eventName: DownloadEvents.INITIATED,
          payload: expect.objectContaining({ episodeId: 1 }),
        }),
      )
    })

    it('throws NotFoundException when show not found in Sonarr', async () => {
      ;(getApiV3SeriesLookup as jest.Mock).mockResolvedValue({ data: [] })
      await expect(
        service.requestDownload({
          mediaType: 'show',
          tvdbId: 999,
          scope: 'episode',
          episodeId: 1,
        }),
      ).rejects.toThrow('not found in Sonarr library')
    })
  })

  // ---------------------------------------------------------------------------
  // cancelMovieDownload
  // ---------------------------------------------------------------------------

  describe('cancelMovieDownload', () => {
    it('deletes queue item when queueId resolved from Radarr fallback', async () => {
      ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({
        data: [{ id: 77, movieId: 123 }],
      })
      await service.cancelMovieDownload(456)
      expect(radarrDeleteQueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 77 } }),
      )
    })

    it('emits CANCELLED event when download is cancelled', async () => {
      await service.cancelMovieDownload(456)
      expect(events.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({
          eventName: DownloadEvents.CANCELLED,
          payload: expect.objectContaining({
            tmdbId: 456,
          }),
        }),
      )
    })

    it('removes tracked entry after cancellation', async () => {
      await service.requestDownload({ mediaType: 'movie', tmdbId: 456 })
      await service.cancelMovieDownload(456)
      expect(service.getTracked().has('movie:456')).toBe(false)
    })

    it('skips delete API call when movie not in queue', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue(
        makeEmptyMovieApiResponse(),
      )
      await service.cancelMovieDownload(456)
      expect(radarrDeleteQueueById).not.toHaveBeenCalled()
    })

    it('uses tracked queueId when entry has one', async () => {
      await service.requestDownload({ mediaType: 'movie', tmdbId: 456 })
      service.updateTracked('movie:456', { queueId: 55 })
      await service.cancelMovieDownload(456)
      expect(radarrDeleteQueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 55 } }),
      )
      // Should NOT have needed to query Radarr for the queueId
      expect(radarrGetQueueDetails).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // getMovieStatus
  // ---------------------------------------------------------------------------

  describe('getMovieStatus', () => {
    it('returns null when movie not tracked and not in Radarr queue', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue(
        makeEmptyMovieApiResponse(),
      )
      const status = await service.getMovieStatus(456)
      expect(status).toBeNull()
    })

    it('returns searching state when tracked but queueId is null', async () => {
      await service.requestDownload({ mediaType: 'movie', tmdbId: 456 })
      const status = await service.getMovieStatus(456)
      expect(status?.state).toBe('searching')
    })

    it('returns downloading state when tracked with queueId and non-import status', async () => {
      await service.requestDownload({ mediaType: 'movie', tmdbId: 456 })
      service.updateTracked('movie:456', {
        queueId: 99,
        lastProgress: 50,
        lastStatus: 'downloading',
      })
      const status = await service.getMovieStatus(456)
      expect(status?.state).toBe('downloading')
    })

    it('returns importing state when tracked with import status', async () => {
      await service.requestDownload({ mediaType: 'movie', tmdbId: 456 })
      service.updateTracked('movie:456', {
        queueId: 99,
        lastProgress: 100,
        lastStatus: 'importing',
      })
      const status = await service.getMovieStatus(456)
      expect(status?.state).toBe('importing')
    })

    it('recovers status from Radarr queue when not tracked', async () => {
      ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({
        data: [
          {
            id: 99,
            movieId: 123,
            title: 'Movie.mkv',
            size: 1000,
            sizeleft: 500,
            status: 'downloading',
            estimatedCompletionTime: null,
          },
        ],
      })
      const status = await service.getMovieStatus(456)
      expect(status?.state).toBe('downloading')
      expect(status?.title).toBe('Movie.mkv')
    })

    it('handles Radarr API error during recovery by returning null', async () => {
      ;(getApiV3Movie as jest.Mock).mockRejectedValue(new Error('Radarr down'))
      const status = await service.getMovieStatus(456)
      expect(status).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // cancelShowDownloads
  // ---------------------------------------------------------------------------

  describe('cancelShowDownloads', () => {
    it('returns empty cancelledEpisodeIds when tracked and queue are empty', async () => {
      const result = await service.cancelShowDownloads(789, 20)
      expect(result.cancelledEpisodeIds).toEqual([])
    })

    it('cancels queued episodes via bulk delete', async () => {
      ;(sonarrGetQueueDetails as jest.Mock).mockResolvedValue({
        data: [
          { id: 50, episodeId: 1 },
          { id: 51, episodeId: 2 },
        ],
      })
      const result = await service.cancelShowDownloads(789, 20)
      expect(deleteApiV3QueueBulk).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { ids: [50, 51] },
        }),
      )
      expect(result.cancelledEpisodeIds).toContain(1)
      expect(result.cancelledEpisodeIds).toContain(2)
    })

    it('emits CANCELLED event for each tracked episode', async () => {
      // Seed two tracked episodes via requestDownload
      ;(getApiV3EpisodeById as jest.Mock)
        .mockResolvedValueOnce({
          data: { id: 1, seasonNumber: 1, episodeNumber: 1, monitored: false },
        })
        .mockResolvedValueOnce({
          data: { id: 2, seasonNumber: 1, episodeNumber: 2, monitored: false },
        })

      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 789,
        scope: 'episode',
        episodeId: 1,
      })
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 789,
        scope: 'episode',
        episodeId: 2,
      })

      events.emit.mockClear()
      await service.cancelShowDownloads(789, 20)

      const calls = (events.emit as jest.Mock).mock.calls
      const cancelledEvents = calls.filter(
        ([, env]) => env?.eventName === DownloadEvents.CANCELLED,
      )
      expect(cancelledEvents).toHaveLength(2)
    })
  })

  // ---------------------------------------------------------------------------
  // getShowStatus
  // ---------------------------------------------------------------------------

  describe('getShowStatus', () => {
    it('returns empty array when no episodes tracked for tvdbId', () => {
      expect(service.getShowStatus(789)).toEqual([])
    })

    it('returns status items for tracked episodes of the show', async () => {
      ;(getApiV3EpisodeById as jest.Mock).mockResolvedValue({
        data: { id: 1, seasonNumber: 1, episodeNumber: 1, monitored: false },
      })
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 789,
        scope: 'episode',
        episodeId: 1,
      })
      const status = service.getShowStatus(789)
      expect(status).toHaveLength(1)
      expect(status[0]!.episodeId).toBe(1)
      expect(status[0]!.state).toBe('searching')
    })

    it('does not include episodes from different tvdbId', async () => {
      ;(getApiV3SeriesLookup as jest.Mock)
        .mockResolvedValueOnce({ data: [{ id: 20, tvdbId: 789 }] })
        .mockResolvedValueOnce({ data: [{ id: 21, tvdbId: 111 }] })
      ;(getApiV3EpisodeById as jest.Mock)
        .mockResolvedValueOnce({
          data: { id: 1, seasonNumber: 1, episodeNumber: 1, monitored: false },
        })
        .mockResolvedValueOnce({
          data: { id: 2, seasonNumber: 1, episodeNumber: 1, monitored: false },
        })

      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 789,
        scope: 'episode',
        episodeId: 1,
      })
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 111,
        scope: 'episode',
        episodeId: 2,
      })

      expect(service.getShowStatus(789)).toHaveLength(1)
      expect(service.getShowStatus(789)[0]!.episodeId).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // getPendingCancelEpisodes / removePendingCancel
  // ---------------------------------------------------------------------------

  describe('getPendingCancelEpisodes / removePendingCancel', () => {
    it('adds episodes to pending cancel when tracked but not in queue', async () => {
      ;(getApiV3EpisodeById as jest.Mock).mockResolvedValue({
        data: { id: 1, seasonNumber: 1, episodeNumber: 1, monitored: false },
      })
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 789,
        scope: 'episode',
        episodeId: 1,
      })
      // Queue is empty → episode is tracked-only
      await service.cancelShowDownloads(789, 20)
      expect(service.getPendingCancelEpisodes().has(1)).toBe(true)
    })
  })

  describe('requestDownload (show – series scope)', () => {
    it('calls SeriesSearch command for series scope', async () => {
      ;(getApiV3Episode as jest.Mock).mockResolvedValue({
        data: [
          {
            id: 1,
            seasonNumber: 1,
            episodeNumber: 1,
            hasFile: false,
            airDate: '2020-01-01',
          },
        ],
      })
      ;(getApiV3SeriesById as jest.Mock).mockResolvedValue({
        data: { id: 20, seasons: [] },
      })
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 789,
        scope: 'series',
      })
      expect(sonarrPostCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ name: 'SeriesSearch' }),
        }),
      )
    })

    it('calls EpisodeSearch command for season scope', async () => {
      ;(getApiV3Episode as jest.Mock).mockResolvedValue({
        data: [
          {
            id: 1,
            seasonNumber: 2,
            episodeNumber: 1,
            hasFile: false,
            airDate: '2020-01-01',
          },
        ],
      })
      ;(getApiV3SeriesById as jest.Mock).mockResolvedValue({
        data: {
          id: 20,
          seasons: [{ seasonNumber: 2, monitored: true }],
        },
      })
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 789,
        scope: 'season',
        seasonNumber: 2,
      })
      expect(sonarrPostCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ name: 'EpisodeSearch' }),
        }),
      )
    })
  })

  describe('requestDownload – API failure paths', () => {
    it('propagates error when radarrPostCommand fails during movie search', async () => {
      ;(radarrPostCommand as jest.Mock).mockRejectedValue(
        new Error('Radarr command failed'),
      )
      await expect(
        service.requestDownload({ mediaType: 'movie', tmdbId: 456 }),
      ).rejects.toThrow('Radarr command failed')
    })

    it('propagates error when radarrDeleteQueueById fails during movie cancel', async () => {
      ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({
        data: [{ id: 77, movieId: 123 }],
      })
      ;(radarrDeleteQueueById as jest.Mock).mockRejectedValue(
        new Error('Queue delete failed'),
      )
      await expect(service.cancelMovieDownload(456)).rejects.toThrow(
        'Queue delete failed',
      )
    })
  })

  // ---------------------------------------------------------------------------
  // cancelEpisodeDownload
  // ---------------------------------------------------------------------------

  describe('cancelEpisodeDownload', () => {
    async function seedEpisode(episodeId: number) {
      ;(getApiV3EpisodeById as jest.Mock).mockResolvedValue({
        data: {
          id: episodeId,
          seasonNumber: 1,
          episodeNumber: episodeId,
          monitored: false,
        },
      })
      await service.requestDownload({
        mediaType: 'show',
        tvdbId: 789,
        scope: 'episode',
        episodeId,
      })
    }

    it('removes tracked entry and emits CANCELLED', async () => {
      await seedEpisode(1)
      events.emit.mockClear()

      await service.cancelEpisodeDownload(1)

      expect(service.getTracked().has('episode:1')).toBe(false)
      expect(events.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({
          eventName: DownloadEvents.CANCELLED,
          payload: expect.objectContaining({ episodeId: 1 }),
        }),
      )
    })

    it('deletes queue item when tracked entry has a queueId', async () => {
      await seedEpisode(1)
      service.updateTracked('episode:1', { queueId: 88 })

      await service.cancelEpisodeDownload(1)

      expect(sonarrDeleteQueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 88 } }),
      )
      expect(sonarrGetQueueDetails).not.toHaveBeenCalled()
    })

    it('falls back to Sonarr queue lookup when tracked entry has no queueId', async () => {
      await seedEpisode(1)
      // Leave queueId as null (default after requestDownload)
      ;(sonarrGetQueueDetails as jest.Mock).mockResolvedValue({
        data: [{ id: 55, episodeId: 1 }],
      })

      await service.cancelEpisodeDownload(1)

      expect(sonarrGetQueueDetails).toHaveBeenCalled()
      expect(sonarrDeleteQueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 55 } }),
      )
    })

    it('unmonitors episode even when not in queue', async () => {
      // Cancel a non-tracked episode not in any queue
      await service.cancelEpisodeDownload(999)

      expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ episodeIds: [999], monitored: false }),
        }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // cancelSeasonDownloads
  // ---------------------------------------------------------------------------

  describe('cancelSeasonDownloads', () => {
    async function seedSeasonEpisodes(
      tvdbId: number,
      seasonNumber: number,
      episodeIds: number[],
    ) {
      for (const id of episodeIds) {
        ;(getApiV3EpisodeById as jest.Mock).mockResolvedValue({
          data: { id, seasonNumber, episodeNumber: id, monitored: false },
        })
        await service.requestDownload({
          mediaType: 'show',
          tvdbId,
          scope: 'episode',
          episodeId: id,
        })
      }
    }

    it('returns empty when no tracked episodes match the season', async () => {
      const result = await service.cancelSeasonDownloads(789, 20, 2)
      expect(result.cancelledEpisodeIds).toEqual([])
    })

    it('cancels only episodes matching the target seasonNumber', async () => {
      await seedSeasonEpisodes(789, 1, [1, 2])
      await seedSeasonEpisodes(789, 2, [3])

      ;(sonarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })

      const result = await service.cancelSeasonDownloads(789, 20, 1)

      expect(result.cancelledEpisodeIds).toContain(1)
      expect(result.cancelledEpisodeIds).toContain(2)
      expect(result.cancelledEpisodeIds).not.toContain(3)
      // Season 2 episode should still be tracked
      expect(service.getTracked().has('episode:3')).toBe(true)
    })

    it('emits CANCELLED event for each cancelled episode', async () => {
      await seedSeasonEpisodes(789, 1, [1, 2])
      ;(sonarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })

      events.emit.mockClear()
      await service.cancelSeasonDownloads(789, 20, 1)

      const calls = (events.emit as jest.Mock).mock.calls
      const cancelledEvents = calls.filter(
        ([, env]) => env?.eventName === DownloadEvents.CANCELLED,
      )
      expect(cancelledEvents).toHaveLength(2)
    })
  })
})
