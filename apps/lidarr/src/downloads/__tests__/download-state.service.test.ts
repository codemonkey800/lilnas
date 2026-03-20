import { EventEmitter2 } from '@nestjs/event-emitter'
import { Test, TestingModule } from '@nestjs/testing'

import {
  DownloadStateService,
  type PendingCancelEntry,
} from 'src/downloads/download-state.service'
import {
  createTrackedEpisode,
  createTrackedMovie,
  DownloadEvents,
  INTERNAL_DOWNLOAD_EVENT,
} from 'src/downloads/downloads.types'

describe('DownloadStateService', () => {
  let service: DownloadStateService
  let mockEvents: jest.Mocked<Pick<EventEmitter2, 'emit'>>

  beforeEach(async () => {
    mockEvents = { emit: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadStateService,
        { provide: EventEmitter2, useValue: mockEvents },
      ],
    }).compile()

    service = module.get(DownloadStateService)
  })

  // ---------------------------------------------------------------------------
  // Tracked downloads
  // ---------------------------------------------------------------------------

  describe('getTracked', () => {
    it('returns an empty map initially', () => {
      expect(service.getTracked().size).toBe(0)
    })
  })

  describe('setTracked', () => {
    it('stores an entry by key', () => {
      const entry = createTrackedMovie(100, 1)
      service.setTracked('movie:100', entry)
      expect(service.getTracked().get('movie:100')).toStrictEqual(entry)
    })

    it('overwrites an existing entry', () => {
      const first = createTrackedMovie(100, 1)
      const second = createTrackedMovie(100, 2)
      service.setTracked('movie:100', first)
      service.setTracked('movie:100', second)
      expect(service.getTracked().get('movie:100')?.radarrMovieId).toBe(2)
    })
  })

  describe('updateTracked', () => {
    it('merges patch fields into an existing entry', () => {
      service.setTracked('movie:100', createTrackedMovie(100, 1))
      service.updateTracked('movie:100', {
        queueId: 42,
        lastProgress: 55,
        lastStatus: 'downloading',
      })
      const entry = service.getTracked().get('movie:100')
      expect(entry?.queueId).toBe(42)
      expect(entry?.lastProgress).toBe(55)
      expect(entry?.lastStatus).toBe('downloading')
    })

    it('preserves unpatched fields', () => {
      const original = createTrackedMovie(100, 1, 99)
      service.setTracked('movie:100', original)
      service.updateTracked('movie:100', { queueId: 5 })
      expect(service.getTracked().get('movie:100')?.commandId).toBe(99)
    })

    it('does nothing when key does not exist', () => {
      service.updateTracked('movie:999', { queueId: 1 })
      expect(service.getTracked().has('movie:999')).toBe(false)
    })
  })

  describe('removeTracked', () => {
    it('removes an existing entry', () => {
      service.setTracked('movie:100', createTrackedMovie(100, 1))
      service.removeTracked('movie:100')
      expect(service.getTracked().has('movie:100')).toBe(false)
    })

    it('does nothing when key does not exist', () => {
      expect(() => service.removeTracked('movie:999')).not.toThrow()
    })
  })

  describe('getTracked (readonly)', () => {
    it('returns a ReadonlyMap that reflects live state', () => {
      service.setTracked(
        'episode:1',
        createTrackedEpisode({
          tvdbId: 2000,
          sonarrSeriesId: 10,
          sonarrEpisodeId: 1,
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      )
      const tracked = service.getTracked()
      expect(tracked.size).toBe(1)
      expect(tracked.get('episode:1')?.kind).toBe('episode')
    })
  })

  // ---------------------------------------------------------------------------
  // Pending cancel episodes
  // ---------------------------------------------------------------------------

  describe('getPendingCancelEpisodes', () => {
    it('returns an empty map initially', () => {
      expect(service.getPendingCancelEpisodes().size).toBe(0)
    })
  })

  describe('setPendingCancel', () => {
    it('stores a pending cancel entry by episodeId', () => {
      const entry: PendingCancelEntry = {
        tvdbId: 2000,
        seriesId: 10,
        cancelledAt: Date.now(),
      }
      service.setPendingCancel(50, entry)
      expect(service.getPendingCancelEpisodes().get(50)).toStrictEqual(entry)
    })

    it('overwrites an existing pending cancel for the same episodeId', () => {
      const first: PendingCancelEntry = {
        tvdbId: 2000,
        seriesId: 10,
        cancelledAt: 1000,
      }
      const second: PendingCancelEntry = {
        tvdbId: 3000,
        seriesId: 20,
        cancelledAt: 2000,
      }
      service.setPendingCancel(50, first)
      service.setPendingCancel(50, second)
      expect(service.getPendingCancelEpisodes().get(50)?.tvdbId).toBe(3000)
    })
  })

  describe('removePendingCancel', () => {
    it('removes a pending cancel entry by episodeId', () => {
      service.setPendingCancel(50, {
        tvdbId: 2000,
        seriesId: 10,
        cancelledAt: 0,
      })
      service.removePendingCancel(50)
      expect(service.getPendingCancelEpisodes().has(50)).toBe(false)
    })

    it('does nothing when episodeId is not pending', () => {
      expect(() => service.removePendingCancel(999)).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // emitEvent
  // ---------------------------------------------------------------------------

  describe('emitEvent', () => {
    it('emits INTERNAL_DOWNLOAD_EVENT with wrapped payload', () => {
      service.emitEvent({
        event: DownloadEvents.INITIATED,
        mediaType: 'movie',
        tmdbId: 100,
      })

      expect(mockEvents.emit).toHaveBeenCalledWith(INTERNAL_DOWNLOAD_EVENT, {
        eventName: DownloadEvents.INITIATED,
        payload: expect.objectContaining({ event: DownloadEvents.INITIATED }),
      })
    })

    it('emits CANCELLED event with episode payload', () => {
      service.emitEvent({
        event: DownloadEvents.CANCELLED,
        mediaType: 'episode',
        tvdbId: 2000,
        episodeId: 50,
      })

      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({
          eventName: DownloadEvents.CANCELLED,
          payload: expect.objectContaining({ tvdbId: 2000, episodeId: 50 }),
        }),
      )
    })

    it('uses the correct event name as the EventEmitter2 topic', () => {
      service.emitEvent({
        event: DownloadEvents.COMPLETED,
        mediaType: 'movie',
        tmdbId: 1,
      })
      const [topic] = (mockEvents.emit as jest.Mock).mock.calls[0] ?? []
      expect(topic).toBe(INTERNAL_DOWNLOAD_EVENT)
    })
  })
})
