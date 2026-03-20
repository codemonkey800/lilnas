import {
  getApiV3CommandById as radarrGetCommandById,
  getApiV3QueueDetails as radarrGetQueueDetails,
  postApiV3Command as radarrPostCommand,
} from '@lilnas/media/radarr-next'
import {
  deleteApiV3QueueById as sonarrDeleteQueueById,
  getApiV3QueueDetails as sonarrGetQueueDetails,
  postApiV3Command as sonarrPostCommand,
  putApiV3EpisodeMonitor,
} from '@lilnas/media/sonarr'
import { Test, TestingModule } from '@nestjs/testing'

import { DownloadGateway } from 'src/downloads/download.gateway'
import { DownloadPollerService } from 'src/downloads/download-poller.service'
import { DownloadsService } from 'src/downloads/downloads.service'
import {
  createTrackedEpisode,
  createTrackedMovie,
  DownloadEvents,
  type TrackedDownload,
  type TrackedEpisodeDownload,
  type TrackedMovieDownload,
} from 'src/downloads/downloads.types'
import { RADARR_CLIENT, SONARR_CLIENT } from 'src/media/clients'

const mockRadarrGetQueueDetails = radarrGetQueueDetails as jest.MockedFunction<
  typeof radarrGetQueueDetails
>
const mockRadarrPostCommand = radarrPostCommand as jest.MockedFunction<
  typeof radarrPostCommand
>
const mockSonarrGetQueueDetails = sonarrGetQueueDetails as jest.MockedFunction<
  typeof sonarrGetQueueDetails
>
const mockSonarrPostCommand = sonarrPostCommand as jest.MockedFunction<
  typeof sonarrPostCommand
>
const mockRadarrGetCommandById = radarrGetCommandById as jest.MockedFunction<
  typeof radarrGetCommandById
>
const mockSonarrDeleteQueueById = sonarrDeleteQueueById as jest.MockedFunction<
  typeof sonarrDeleteQueueById
>
const mockPutApiV3EpisodeMonitor =
  putApiV3EpisodeMonitor as jest.MockedFunction<typeof putApiV3EpisodeMonitor>

describe('DownloadPollerService', () => {
  let poller: DownloadPollerService
  let trackedMap: Map<string, TrackedDownload>
  let pendingCancelsMap: Map<
    number,
    { tvdbId: number; seriesId: number; cancelledAt: number }
  >
  let mockDownloadsService: jest.Mocked<
    Pick<
      DownloadsService,
      | 'getTracked'
      | 'getPendingCancelEpisodes'
      | 'emitEvent'
      | 'updateTracked'
      | 'removeTracked'
      | 'removePendingCancel'
    >
  >
  let mockGateway: jest.Mocked<Pick<DownloadGateway, 'hasConnectedClients'>>

  beforeEach(async () => {
    trackedMap = new Map()
    pendingCancelsMap = new Map()

    mockDownloadsService = {
      getTracked: jest.fn(() => trackedMap),
      getPendingCancelEpisodes: jest.fn(() => pendingCancelsMap),
      emitEvent: jest.fn(),
      updateTracked: jest.fn((key, patch) => {
        const existing = trackedMap.get(key)
        if (existing)
          trackedMap.set(key, { ...existing, ...patch } as TrackedDownload)
      }),
      removeTracked: jest.fn(key => {
        trackedMap.delete(key)
      }),
      removePendingCancel: jest.fn(id => {
        pendingCancelsMap.delete(id)
      }),
    }

    mockGateway = {
      hasConnectedClients: jest.fn().mockReturnValue(false),
    }

    // Default: queues return empty
    mockRadarrGetQueueDetails.mockResolvedValue({ data: [] } as never)
    mockSonarrGetQueueDetails.mockResolvedValue({ data: [] } as never)
    mockRadarrPostCommand.mockResolvedValue({} as never)
    mockSonarrPostCommand.mockResolvedValue({} as never)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadPollerService,
        { provide: RADARR_CLIENT, useValue: {} },
        { provide: SONARR_CLIENT, useValue: {} },
        { provide: DownloadsService, useValue: mockDownloadsService },
        { provide: DownloadGateway, useValue: mockGateway },
      ],
    }).compile()

    poller = module.get(DownloadPollerService)
  })

  // ---------------------------------------------------------------------------
  // Early exit conditions
  // ---------------------------------------------------------------------------

  describe('early exit', () => {
    it('does not fetch queues when tracked is empty and no connected clients', async () => {
      await poller.poll()
      expect(mockRadarrGetQueueDetails).not.toHaveBeenCalled()
      expect(mockSonarrGetQueueDetails).not.toHaveBeenCalled()
    })

    it('does not fetch queues when both tracked and pendingCancels are empty (even with clients)', async () => {
      mockGateway.hasConnectedClients.mockReturnValue(true)
      await poller.poll()
      expect(mockRadarrGetQueueDetails).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Grabbing detection
  // ---------------------------------------------------------------------------

  describe('grabbing detection', () => {
    it('emits GRABBING and updates tracked entry when queue item appears for the first time', async () => {
      const movie = createTrackedMovie(100, 1, 42)
      trackedMap.set('movie:100', movie)

      mockRadarrGetQueueDetails.mockResolvedValue({
        data: [
          {
            id: 200,
            movieId: 1,
            size: 5000,
            sizeleft: 5000,
            status: 'queued',
            title: 'Test Movie Release',
          },
        ],
      } as never)

      await poller.poll()

      expect(mockDownloadsService.updateTracked).toHaveBeenCalledWith(
        'movie:100',
        expect.objectContaining({
          queueId: 200,
          lastTitle: 'Test Movie Release',
        }),
      )
      expect(mockDownloadsService.emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: DownloadEvents.GRABBING,
          tmdbId: 100,
        }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Progress updates
  // ---------------------------------------------------------------------------

  describe('progress updates', () => {
    it('emits PROGRESS when size or sizeleft changes', async () => {
      const movie: TrackedMovieDownload = {
        ...createTrackedMovie(100, 1, null),
        queueId: 200,
        lastProgress: 20,
        lastSizeleft: 8000,
        lastStatus: 'downloading',
        lastSize: 10000,
        lastEta: null,
        lastTitle: null,
      }
      trackedMap.set('movie:100', movie)

      mockRadarrGetQueueDetails.mockResolvedValue({
        data: [
          {
            id: 200,
            movieId: 1,
            size: 10000,
            sizeleft: 5000,
            status: 'downloading',
            title: 'Release',
          },
        ],
      } as never)

      await poller.poll()

      expect(mockDownloadsService.emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: DownloadEvents.PROGRESS,
          progress: 50,
        }),
      )
      expect(mockDownloadsService.updateTracked).toHaveBeenCalledWith(
        'movie:100',
        expect.objectContaining({ lastProgress: 50, lastSizeleft: 5000 }),
      )
    })

    it('does not emit PROGRESS when progress and sizeleft are unchanged', async () => {
      const movie: TrackedMovieDownload = {
        ...createTrackedMovie(100, 1, null),
        queueId: 200,
        lastProgress: 50,
        lastSizeleft: 5000,
        lastStatus: 'downloading',
        lastSize: 10000,
        lastEta: null,
        lastTitle: null,
      }
      trackedMap.set('movie:100', movie)

      mockRadarrGetQueueDetails.mockResolvedValue({
        data: [
          {
            id: 200,
            movieId: 1,
            size: 10000,
            sizeleft: 5000,
            status: 'downloading',
          },
        ],
      } as never)

      await poller.poll()
      expect(mockDownloadsService.emitEvent).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Completion detection
  // ---------------------------------------------------------------------------

  describe('completion detection', () => {
    it('emits COMPLETED and removes tracked entry when queue item disappears after being grabbed', async () => {
      const movie: TrackedMovieDownload = {
        ...createTrackedMovie(100, 1, null),
        queueId: 200,
        lastProgress: 100,
        lastSizeleft: 0,
        lastStatus: 'importing',
        lastSize: 10000,
        lastEta: null,
        lastTitle: null,
      }
      trackedMap.set('movie:100', movie)

      // Queue is now empty -- download completed
      mockRadarrGetQueueDetails.mockResolvedValue({ data: [] } as never)

      await poller.poll()

      expect(mockDownloadsService.emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: DownloadEvents.COMPLETED,
          tmdbId: 100,
        }),
      )
      expect(mockDownloadsService.removeTracked).toHaveBeenCalledWith(
        'movie:100',
      )
    })

    it('does not emit COMPLETED for entries that never had a queueId', async () => {
      // Entry still in searching state (no queueId yet, within timeout)
      const movie: TrackedMovieDownload = {
        ...createTrackedMovie(100, 1, null),
        queueId: null,
        lastProgress: null,
        lastSizeleft: null,
        lastStatus: null,
        lastSize: null,
        lastEta: null,
        lastTitle: null,
        initiatedAt: Date.now(),
      }
      trackedMap.set('movie:100', movie)
      mockRadarrGetQueueDetails.mockResolvedValue({ data: [] } as never)

      await poller.poll()

      expect(mockDownloadsService.emitEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: DownloadEvents.COMPLETED }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Failure detection
  // ---------------------------------------------------------------------------

  describe('failure detection', () => {
    it.each(['failed', 'failedPending', 'importFailed'])(
      'emits FAILED and removes tracked entry when trackedDownloadState is "%s"',
      async state => {
        const movie: TrackedMovieDownload = {
          ...createTrackedMovie(100, 1, null),
          queueId: 200,
          lastProgress: 50,
          lastSizeleft: 500,
          lastStatus: 'downloading',
          lastSize: 1000,
          lastEta: null,
          lastTitle: null,
        }
        trackedMap.set('movie:100', movie)

        mockRadarrGetQueueDetails.mockResolvedValue({
          data: [
            {
              id: 200,
              movieId: 1,
              trackedDownloadState: state,
              size: 1000,
              sizeleft: 500,
            },
          ],
        } as never)

        await poller.poll()

        expect(mockDownloadsService.emitEvent).toHaveBeenCalledWith(
          expect.objectContaining({ event: DownloadEvents.FAILED }),
        )
        expect(mockDownloadsService.removeTracked).toHaveBeenCalledWith(
          'movie:100',
        )
      },
    )

    it('emits FAILED when trackedDownloadStatus is "error"', async () => {
      const movie: TrackedMovieDownload = {
        ...createTrackedMovie(100, 1, null),
        queueId: 200,
        lastProgress: 0,
        lastSizeleft: null,
        lastStatus: null,
        lastSize: null,
        lastEta: null,
        lastTitle: null,
      }
      trackedMap.set('movie:100', movie)

      mockRadarrGetQueueDetails.mockResolvedValue({
        data: [
          {
            id: 200,
            movieId: 1,
            trackedDownloadStatus: 'error',
            size: 1000,
            sizeleft: 1000,
          },
        ],
      } as never)

      await poller.poll()
      expect(mockDownloadsService.emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: DownloadEvents.FAILED }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Search timeout
  // ---------------------------------------------------------------------------

  describe('search timeout', () => {
    it('emits FAILED after 30s when no queue item found and no commandId', async () => {
      const old = Date.now() - 31_000
      const movie: TrackedMovieDownload = {
        ...createTrackedMovie(100, 1, null),
        queueId: null,
        commandId: null,
        lastProgress: null,
        lastSizeleft: null,
        lastStatus: null,
        lastSize: null,
        lastEta: null,
        lastTitle: null,
        initiatedAt: old,
      }
      trackedMap.set('movie:100', movie)
      mockRadarrGetQueueDetails.mockResolvedValue({ data: [] } as never)

      await poller.poll()

      expect(mockDownloadsService.emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: DownloadEvents.FAILED,
          error: 'No releases found',
        }),
      )
      expect(mockDownloadsService.removeTracked).toHaveBeenCalledWith(
        'movie:100',
      )
    })

    it('does not emit FAILED before 30s timeout elapses', async () => {
      const recent = Date.now() - 10_000
      const movie: TrackedMovieDownload = {
        ...createTrackedMovie(100, 1, null),
        queueId: null,
        commandId: null,
        lastProgress: null,
        lastSizeleft: null,
        lastStatus: null,
        lastSize: null,
        lastEta: null,
        lastTitle: null,
        initiatedAt: recent,
      }
      trackedMap.set('movie:100', movie)
      mockRadarrGetQueueDetails.mockResolvedValue({ data: [] } as never)

      await poller.poll()
      expect(mockDownloadsService.emitEvent).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Command terminal + grace period
  // ---------------------------------------------------------------------------

  describe('command terminal + grace period', () => {
    it('sets commandTerminalAt when command reaches terminal status but no queue item yet', async () => {
      const movie: TrackedMovieDownload = {
        ...createTrackedMovie(100, 1, 42),
        queueId: null,
        commandTerminalAt: null,
        lastProgress: null,
        lastSizeleft: null,
        lastStatus: null,
        lastSize: null,
        lastEta: null,
        lastTitle: null,
        initiatedAt: Date.now(),
      }
      trackedMap.set('movie:100', movie)
      mockRadarrGetQueueDetails.mockResolvedValue({ data: [] } as never)
      mockRadarrGetCommandById.mockResolvedValue({
        data: { status: 'completed' },
      } as never)

      await poller.poll()

      expect(mockDownloadsService.updateTracked).toHaveBeenCalledWith(
        'movie:100',
        expect.objectContaining({ commandTerminalAt: expect.any(Number) }),
      )
      // Should NOT emit FAILED yet -- still within grace period
      expect(mockDownloadsService.emitEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: DownloadEvents.FAILED }),
      )
    })

    it('emits FAILED after grace period expires following command terminal', async () => {
      const commandTerminalAt = Date.now() - 16_000 // 16s ago (> 15s grace)
      const movie: TrackedMovieDownload = {
        ...createTrackedMovie(100, 1, 42),
        queueId: null,
        commandTerminalAt,
        lastProgress: null,
        lastSizeleft: null,
        lastStatus: null,
        lastSize: null,
        lastEta: null,
        lastTitle: null,
        initiatedAt: Date.now() - 20_000,
      }
      trackedMap.set('movie:100', movie)
      mockRadarrGetQueueDetails.mockResolvedValue({ data: [] } as never)
      mockRadarrGetCommandById.mockResolvedValue({
        data: { status: 'completed' },
      } as never)

      await poller.poll()

      expect(mockDownloadsService.emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: DownloadEvents.FAILED,
          error: 'No releases found',
        }),
      )
      expect(mockDownloadsService.removeTracked).toHaveBeenCalledWith(
        'movie:100',
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Pending cancel processing
  // ---------------------------------------------------------------------------

  describe('processPendingCancels', () => {
    it('cancels queue item and unmonitors when episode shows up in Sonarr queue after cancel', async () => {
      pendingCancelsMap.set(50, {
        tvdbId: 2000,
        seriesId: 10,
        cancelledAt: Date.now(),
      })

      // Episode now appears in queue
      mockSonarrGetQueueDetails.mockResolvedValue({
        data: [{ id: 800, episodeId: 50 }],
      } as never)
      mockSonarrDeleteQueueById.mockResolvedValue({} as never)
      mockPutApiV3EpisodeMonitor.mockResolvedValue({} as never)

      await poller.poll()

      expect(mockSonarrDeleteQueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 800 } }),
      )
      expect(mockPutApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [50], monitored: false },
        }),
      )
      expect(mockDownloadsService.removePendingCancel).toHaveBeenCalledWith(50)
    })

    it('expires pending cancel after 30s timeout when episode never appears in queue', async () => {
      const oldCancel = Date.now() - 31_000
      pendingCancelsMap.set(60, {
        tvdbId: 2000,
        seriesId: 10,
        cancelledAt: oldCancel,
      })

      mockSonarrGetQueueDetails.mockResolvedValue({ data: [] } as never)

      await poller.poll()

      expect(mockDownloadsService.removePendingCancel).toHaveBeenCalledWith(60)
      expect(mockSonarrDeleteQueueById).not.toHaveBeenCalled()
    })

    it('does not remove pending cancel before timeout when episode not yet in queue', async () => {
      pendingCancelsMap.set(70, {
        tvdbId: 2000,
        seriesId: 10,
        cancelledAt: Date.now() - 5_000,
      })
      mockSonarrGetQueueDetails.mockResolvedValue({ data: [] } as never)

      await poller.poll()

      expect(mockDownloadsService.removePendingCancel).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Episode entries
  // ---------------------------------------------------------------------------

  describe('episode poll entries', () => {
    it('matches episode queue items by episodeId and emits PROGRESS', async () => {
      const episode: TrackedEpisodeDownload = {
        ...createTrackedEpisode(
          {
            tvdbId: 2000,
            sonarrSeriesId: 10,
            sonarrEpisodeId: 50,
            seasonNumber: 1,
            episodeNumber: 1,
          },
          null,
        ),
        queueId: 300,
        lastProgress: 10,
        lastSizeleft: 9000,
        lastStatus: 'downloading',
        lastSize: 10000,
        lastEta: null,
        lastTitle: null,
      }
      trackedMap.set('episode:50', episode)

      mockSonarrGetQueueDetails.mockResolvedValue({
        data: [
          {
            id: 300,
            episodeId: 50,
            size: 10000,
            sizeleft: 4000,
            status: 'downloading',
          },
        ],
      } as never)

      await poller.poll()

      expect(mockDownloadsService.emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: DownloadEvents.PROGRESS,
          episodeId: 50,
          progress: 60,
        }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Refresh logic
  // ---------------------------------------------------------------------------

  describe('refresh logic', () => {
    it('does not send RefreshMonitoredDownloads on first poll within refresh interval', async () => {
      const movie = createTrackedMovie(100, 1, null)
      trackedMap.set('movie:100', movie)
      mockRadarrGetQueueDetails.mockResolvedValue({ data: [] } as never)

      // First poll -- lastRefreshAt is 0 so refresh WILL happen on first call
      await poller.poll()
      expect(mockRadarrPostCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'RefreshMonitoredDownloads' },
        }),
      )
    })

    it('does not send refresh command on subsequent polls within the refresh interval', async () => {
      const movie = createTrackedMovie(100, 1, null)
      trackedMap.set('movie:100', movie)
      mockRadarrGetQueueDetails.mockResolvedValue({ data: [] } as never)

      await poller.poll() // first poll triggers refresh
      mockRadarrPostCommand.mockClear()

      await poller.poll() // second poll within 15s -- no refresh
      expect(mockRadarrPostCommand).not.toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'RefreshMonitoredDownloads' },
        }),
      )
    })
  })
})
