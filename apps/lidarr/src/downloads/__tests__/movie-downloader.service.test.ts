import {
  deleteApiV3QueueById,
  getApiV3Movie,
  getApiV3QueueDetails as radarrGetQueueDetails,
  postApiV3Command as radarrPostCommand,
  postApiV3Release,
  putApiV3MovieById,
} from '@lilnas/media/radarr-next'
import { NotFoundException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Test, TestingModule } from '@nestjs/testing'

import { DownloadStateService } from 'src/downloads/download-state.service'
import {
  createTrackedMovie,
  DownloadEvents,
  INTERNAL_DOWNLOAD_EVENT,
} from 'src/downloads/downloads.types'
import { MovieDownloaderService } from 'src/downloads/movie-downloader.service'
import { RADARR_CLIENT } from 'src/media/clients'

// Typed references to auto-mocked functions (mocked globally in setup.ts)
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

// Bypass TTL caching so tests get live mock responses.
jest.mock('src/media/cache', () => ({
  cached: jest.fn((_key: string, _ttl: number, fn: () => Promise<unknown>) =>
    fn(),
  ),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function apiOk<T>(data: T): any {
  return { data }
}

function makeMovie(overrides = {}) {
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

function makeQueueItem(overrides = {}) {
  return {
    id: 200,
    movieId: 1,
    status: 'downloading',
    size: 2000,
    sizeleft: 1000,
    ...overrides,
  }
}

describe('MovieDownloaderService', () => {
  let service: MovieDownloaderService
  let stateService: DownloadStateService
  let mockEvents: jest.Mocked<Pick<EventEmitter2, 'emit'>>

  beforeEach(async () => {
    mockEvents = { emit: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovieDownloaderService,
        DownloadStateService,
        { provide: RADARR_CLIENT, useValue: {} },
        { provide: EventEmitter2, useValue: mockEvents },
      ],
    }).compile()

    service = module.get(MovieDownloaderService)
    stateService = module.get(DownloadStateService)
  })

  // ---------------------------------------------------------------------------
  // requestDownload — search path
  // ---------------------------------------------------------------------------

  describe('requestDownload (search)', () => {
    it('creates tracked entry with commandId and emits INITIATED', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie()]))
      mockRadarrPostCommand.mockResolvedValue(apiOk({ id: 99 }))

      await service.requestDownload({ mediaType: 'movie', tmdbId: 100 })

      const entry = stateService.getTracked().get('movie:100')
      expect(entry?.kind).toBe('movie')
      expect(entry?.commandId).toBe(99)
      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({ eventName: DownloadEvents.INITIATED }),
      )
    })

    it('throws NotFoundException when movie not in Radarr library', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([]))
      await expect(
        service.requestDownload({ mediaType: 'movie', tmdbId: 999 }),
      ).rejects.toThrow(NotFoundException)
    })

    it('monitors movie before searching when it is unmonitored', async () => {
      mockGetApiV3Movie.mockResolvedValue(
        apiOk([makeMovie({ monitored: false })]),
      )
      mockPutApiV3MovieById.mockResolvedValue(apiOk({}))
      mockRadarrPostCommand.mockResolvedValue(apiOk({ id: 1 }))

      await service.requestDownload({ mediaType: 'movie', tmdbId: 100 })

      expect(mockPutApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ monitored: true }),
        }),
      )
    })

    it('skips monitor update when movie is already monitored', async () => {
      mockGetApiV3Movie.mockResolvedValue(
        apiOk([makeMovie({ monitored: true })]),
      )
      mockRadarrPostCommand.mockResolvedValue(apiOk({ id: 1 }))

      await service.requestDownload({ mediaType: 'movie', tmdbId: 100 })

      expect(mockPutApiV3MovieById).not.toHaveBeenCalled()
    })

    it('stores null commandId when Radarr command returns no id', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie()]))
      mockRadarrPostCommand.mockResolvedValue(apiOk(null))

      await service.requestDownload({ mediaType: 'movie', tmdbId: 100 })

      expect(stateService.getTracked().get('movie:100')?.commandId).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // requestDownload — grab-release path
  // ---------------------------------------------------------------------------

  describe('requestDownload (grab release)', () => {
    it('grabs specific release and does not issue search command', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie()]))
      mockPostApiV3Release.mockResolvedValue(apiOk({}))

      await service.requestDownload({
        mediaType: 'movie',
        tmdbId: 100,
        releaseGuid: 'abc-guid',
        indexerId: 5,
      })

      expect(mockPostApiV3Release).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ guid: 'abc-guid', indexerId: 5 }),
        }),
      )
      expect(mockRadarrPostCommand).not.toHaveBeenCalled()
      // commandId is null for the grab path
      expect(stateService.getTracked().get('movie:100')?.commandId).toBeNull()
      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({ eventName: DownloadEvents.INITIATED }),
      )
    })

    it('monitors unmonitored movie before grabbing a release', async () => {
      mockGetApiV3Movie.mockResolvedValue(
        apiOk([makeMovie({ monitored: false })]),
      )
      mockPutApiV3MovieById.mockResolvedValue(apiOk({}))
      mockPostApiV3Release.mockResolvedValue(apiOk({}))

      await service.requestDownload({
        mediaType: 'movie',
        tmdbId: 100,
        releaseGuid: 'guid',
        indexerId: 1,
      })

      expect(mockPutApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ monitored: true }),
        }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // cancelMovieDownload
  // ---------------------------------------------------------------------------

  describe('cancelMovieDownload', () => {
    it('deletes queue item using tracked queueId and emits CANCELLED', async () => {
      stateService.setTracked('movie:100', createTrackedMovie(100, 1))
      stateService.updateTracked('movie:100', { queueId: 200 })
      mockDeleteApiV3QueueById.mockResolvedValue(apiOk({}))

      await service.cancelMovieDownload(100)

      expect(mockDeleteApiV3QueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 200 } }),
      )
      expect(stateService.getTracked().has('movie:100')).toBe(false)
      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({ eventName: DownloadEvents.CANCELLED }),
      )
    })

    it('falls back to live Radarr queue when tracked entry has no queueId', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie({ id: 1 })]))
      mockRadarrGetQueueDetails.mockResolvedValue(
        apiOk([makeQueueItem({ movieId: 1, id: 300 })]),
      )
      mockDeleteApiV3QueueById.mockResolvedValue(apiOk({}))

      await service.cancelMovieDownload(100)

      expect(mockDeleteApiV3QueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 300 } }),
      )
    })

    it('skips queue delete when no queue item found and still emits CANCELLED', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie()]))
      mockRadarrGetQueueDetails.mockResolvedValue(apiOk([]))

      await service.cancelMovieDownload(100)

      expect(mockDeleteApiV3QueueById).not.toHaveBeenCalled()
      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({ eventName: DownloadEvents.CANCELLED }),
      )
    })

    it('still emits CANCELLED and removes tracked entry even when movie not in library', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([]))
      stateService.setTracked('movie:100', createTrackedMovie(100, 1))

      await service.cancelMovieDownload(100)

      expect(stateService.getTracked().has('movie:100')).toBe(false)
      expect(mockEvents.emit).toHaveBeenCalledWith(
        INTERNAL_DOWNLOAD_EVENT,
        expect.objectContaining({ eventName: DownloadEvents.CANCELLED }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // getMovieStatus
  // ---------------------------------------------------------------------------

  describe('getMovieStatus', () => {
    it('returns status from in-memory tracked entry when it exists', async () => {
      stateService.setTracked('movie:100', {
        ...createTrackedMovie(100, 1),
        queueId: 5,
        lastProgress: 60,
        lastStatus: 'downloading',
        lastTitle: 'Test Movie',
        lastSize: 2000,
        lastSizeleft: 800,
        lastEta: null,
      })

      const status = await service.getMovieStatus(100)
      expect(status?.state).toBe('downloading')
      expect(status?.progress).toBe(60)
      expect(status?.size).toBe(2000)
    })

    it('returns importing state when progress >= 100', async () => {
      stateService.setTracked('movie:100', {
        ...createTrackedMovie(100, 1),
        queueId: 5,
        lastProgress: 100,
        lastStatus: 'downloading',
        lastTitle: null,
        lastSize: 1000,
        lastSizeleft: 0,
        lastEta: null,
      })

      const status = await service.getMovieStatus(100)
      expect(status?.state).toBe('importing')
    })

    it('recovers status from Radarr queue when tracked map has no entry', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie({ id: 1 })]))
      mockRadarrGetQueueDetails.mockResolvedValue(
        apiOk([
          makeQueueItem({
            movieId: 1,
            id: 700,
            size: 2000,
            sizeleft: 1000,
            status: 'downloading',
            title: 'Recovered',
          }),
        ]),
      )

      const status = await service.getMovieStatus(100)

      expect(status).not.toBeNull()
      expect(status?.state).toBe('downloading')
      expect(status?.progress).toBe(50)
      // Should now be tracked
      expect(stateService.getTracked().has('movie:100')).toBe(true)
    })

    it('returns null when movie not found during recovery', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([]))
      const status = await service.getMovieStatus(999)
      expect(status).toBeNull()
    })

    it('returns null when movie is in library but not in queue', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie({ id: 1 })]))
      mockRadarrGetQueueDetails.mockResolvedValue(apiOk([]))
      const status = await service.getMovieStatus(100)
      expect(status).toBeNull()
    })

    it('returns null and does not throw when Radarr API errors during recovery', async () => {
      mockGetApiV3Movie.mockRejectedValue(new Error('Radarr down'))
      const status = await service.getMovieStatus(100)
      expect(status).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // buildMovieDownloadItems
  // ---------------------------------------------------------------------------

  describe('buildMovieDownloadItems', () => {
    it('returns empty array for empty input', async () => {
      const result = await service.buildMovieDownloadItems([])
      expect(result).toEqual([])
    })

    it('builds item with metadata from Radarr library', async () => {
      const entry = {
        ...createTrackedMovie(100, 1),
        queueId: 5,
        lastProgress: 40,
        lastStatus: 'downloading',
        lastTitle: 'Release Title',
        lastSize: 1000,
        lastSizeleft: 600,
        lastEta: '2024-12-01T00:00:00Z',
      }

      mockGetApiV3Movie.mockResolvedValue(
        apiOk([
          makeMovie({
            id: 1,
            title: 'Test Movie',
            year: 2024,
            images: [
              {
                coverType: 'poster',
                remoteUrl: 'https://img.example.com/poster.jpg',
              },
            ],
          }),
        ]),
      )

      const result = await service.buildMovieDownloadItems([entry])

      expect(result).toHaveLength(1)
      expect(result[0]?.tmdbId).toBe(100)
      expect(result[0]?.title).toBe('Test Movie')
      expect(result[0]?.year).toBe(2024)
      expect(result[0]?.posterUrl).toBe('https://img.example.com/poster.jpg')
      expect(result[0]?.state).toBe('downloading')
      expect(result[0]?.progress).toBe(40)
    })

    it('uses poster remoteUrl over url when both present', async () => {
      const entry = createTrackedMovie(100, 1)
      mockGetApiV3Movie.mockResolvedValue(
        apiOk([
          makeMovie({
            id: 1,
            images: [
              {
                coverType: 'poster',
                remoteUrl: 'https://remote.example.com/poster.jpg',
                url: 'https://local.example.com/poster.jpg',
              },
            ],
          }),
        ]),
      )

      const result = await service.buildMovieDownloadItems([entry])

      expect(result[0]?.posterUrl).toBe('https://remote.example.com/poster.jpg')
    })

    it('returns null posterUrl when no poster image present', async () => {
      const entry = createTrackedMovie(100, 1)
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie({ images: [] })]))

      const result = await service.buildMovieDownloadItems([entry])

      expect(result[0]?.posterUrl).toBeNull()
    })

    it('falls back to lastTitle and zero year when movie not found in library', async () => {
      const entry = {
        ...createTrackedMovie(100, 999),
        lastTitle: 'Fallback Title',
      }
      mockGetApiV3Movie.mockResolvedValue(apiOk([]))

      const result = await service.buildMovieDownloadItems([entry])

      expect(result[0]?.title).toBe('Fallback Title')
      expect(result[0]?.year).toBe(0)
      expect(result[0]?.posterUrl).toBeNull()
    })

    it('handles Radarr fetch failure gracefully and falls back to tracked data', async () => {
      const entry = {
        ...createTrackedMovie(100, 1),
        lastTitle: 'Cached Title',
      }
      mockGetApiV3Movie.mockRejectedValue(new Error('Network error'))

      const result = await service.buildMovieDownloadItems([entry])

      expect(result).toHaveLength(1)
      expect(result[0]?.title).toBe('Cached Title')
    })

    it('builds multiple items from multiple tracked entries', async () => {
      const entries = [
        { ...createTrackedMovie(100, 1), radarrMovieId: 1 },
        { ...createTrackedMovie(200, 2), radarrMovieId: 2 },
      ]
      mockGetApiV3Movie.mockResolvedValue(
        apiOk([
          makeMovie({ id: 1, tmdbId: 100 }),
          makeMovie({ id: 2, tmdbId: 200, title: 'Second Movie' }),
        ]),
      )

      const result = await service.buildMovieDownloadItems(entries)

      expect(result).toHaveLength(2)
    })
  })
})
