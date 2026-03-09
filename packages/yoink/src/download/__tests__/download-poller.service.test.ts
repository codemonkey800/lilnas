jest.mock('@lilnas/media/radarr-next', () => ({
  getApiV3CommandById: jest.fn(),
  getApiV3QueueDetails: jest.fn(),
  postApiV3Command: jest.fn(),
}))

jest.mock('@lilnas/media/sonarr', () => ({
  getApiV3CommandById: jest.fn(),
  getApiV3QueueDetails: jest.fn(),
  postApiV3Command: jest.fn(),
  deleteApiV3QueueById: jest.fn(),
  putApiV3EpisodeMonitor: jest.fn(),
}))

import {
  getApiV3CommandById as radarrGetCommandById,
  getApiV3QueueDetails as radarrGetQueueDetails,
  postApiV3Command as radarrPostCommand,
} from '@lilnas/media/radarr-next'
import {
  deleteApiV3QueueById as sonarrDeleteQueueById,
  getApiV3CommandById as sonarrGetCommandById,
  getApiV3QueueDetails as sonarrGetQueueDetails,
  postApiV3Command as sonarrPostCommand,
  putApiV3EpisodeMonitor,
} from '@lilnas/media/sonarr'

import { DownloadService } from 'src/download/download.service'
import {
  createTrackedEpisode,
  createTrackedMovie,
  DownloadEvents,
} from 'src/download/download.types'
import { DownloadPollerService } from 'src/download/download-poller.service'

function makeMockDownloadService(): jest.Mocked<
  Pick<
    DownloadService,
    | 'getTracked'
    | 'getPendingCancelEpisodes'
    | 'updateTracked'
    | 'removeTracked'
    | 'emitEvent'
    | 'removePendingCancel'
  >
> {
  return {
    getTracked: jest.fn().mockReturnValue(new Map()),
    getPendingCancelEpisodes: jest.fn().mockReturnValue(new Map()),
    updateTracked: jest.fn(),
    removeTracked: jest.fn(),
    emitEvent: jest.fn(),
    removePendingCancel: jest.fn(),
  }
}

const SEARCH_TIMEOUT_MS = 30_000

describe('DownloadPollerService.poll()', () => {
  let poller: DownloadPollerService
  let mockService: ReturnType<typeof makeMockDownloadService>

  beforeEach(() => {
    mockService = makeMockDownloadService()
    poller = new DownloadPollerService(
      mockService as unknown as DownloadService,
    )
    ;(radarrPostCommand as jest.Mock).mockResolvedValue({})
    ;(sonarrPostCommand as jest.Mock).mockResolvedValue({})
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })
    ;(sonarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })
    ;(radarrGetCommandById as jest.Mock).mockResolvedValue({
      data: { status: 'queued' },
    })
    ;(sonarrGetCommandById as jest.Mock).mockResolvedValue({
      data: { status: 'queued' },
    })
    ;(sonarrDeleteQueueById as jest.Mock).mockResolvedValue({})
    ;(putApiV3EpisodeMonitor as jest.Mock).mockResolvedValue({})
  })

  it('returns early without calling any APIs when nothing is tracked', async () => {
    await poller.poll()
    expect(radarrGetQueueDetails).not.toHaveBeenCalled()
    expect(sonarrGetQueueDetails).not.toHaveBeenCalled()
  })

  it('fetches queues when pending cancels exist even without tracked downloads', async () => {
    mockService.getTracked.mockReturnValue(new Map())
    mockService.getPendingCancelEpisodes.mockReturnValue(
      new Map([
        [1, { tvdbId: 789, seriesId: 20, cancelledAt: Date.now() - 1000 }],
      ]),
    )
    ;(sonarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })

    await poller.poll()

    expect(radarrGetQueueDetails).toHaveBeenCalled()
    expect(sonarrGetQueueDetails).toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Completed: tracked entry had queueId but queue item disappeared
  // ---------------------------------------------------------------------------

  it('emits COMPLETED and removes tracked when item leaves queue after being grabbed', async () => {
    const entry = {
      ...createTrackedMovie(456, 123),
      queueId: 99,
      initiatedAt: Date.now() - 100,
    }
    mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })

    await poller.poll()

    expect(mockService.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: DownloadEvents.COMPLETED, tmdbId: 456 }),
    )
    expect(mockService.removeTracked).toHaveBeenCalledWith('movie:456')
  })

  // ---------------------------------------------------------------------------
  // Search not found: command-status-based detection
  // ---------------------------------------------------------------------------

  it('emits FAILED and removes tracked when movie command completes with no queue item', async () => {
    const entry = {
      ...createTrackedMovie(456, 123, 42),
      queueId: null,
    }
    mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })
    ;(radarrGetCommandById as jest.Mock).mockResolvedValue({
      data: { status: 'completed' },
    })

    await poller.poll()

    expect(radarrGetCommandById).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 42 } }),
    )
    expect(mockService.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: DownloadEvents.FAILED,
        tmdbId: 456,
        error: 'No releases found',
      }),
    )
    expect(mockService.removeTracked).toHaveBeenCalledWith('movie:456')
  })

  it('emits FAILED and removes tracked when episode command completes with no queue item', async () => {
    const entry = {
      ...createTrackedEpisode(
        {
          tvdbId: 789,
          sonarrSeriesId: 20,
          sonarrEpisodeId: 1,
          seasonNumber: 1,
          episodeNumber: 1,
        },
        55,
      ),
      queueId: null,
    }
    mockService.getTracked.mockReturnValue(new Map([['episode:1', entry]]))
    ;(sonarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })
    ;(sonarrGetCommandById as jest.Mock).mockResolvedValue({
      data: { status: 'completed' },
    })

    await poller.poll()

    expect(sonarrGetCommandById).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 55 } }),
    )
    expect(mockService.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: DownloadEvents.FAILED,
        tvdbId: 789,
        episodeId: 1,
        error: 'No releases found',
      }),
    )
    expect(mockService.removeTracked).toHaveBeenCalledWith('episode:1')
  })

  it.each(['failed', 'aborted', 'cancelled', 'orphaned'])(
    'emits FAILED when movie command status is "%s"',
    async terminalStatus => {
      const entry = { ...createTrackedMovie(456, 123, 42), queueId: null }
      mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
      ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })
      ;(radarrGetCommandById as jest.Mock).mockResolvedValue({
        data: { status: terminalStatus },
      })

      await poller.poll()

      expect(mockService.emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: DownloadEvents.FAILED }),
      )
    },
  )

  it('does not emit any event when movie command is still searching (status: started)', async () => {
    const entry = { ...createTrackedMovie(456, 123, 42), queueId: null }
    mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })
    ;(radarrGetCommandById as jest.Mock).mockResolvedValue({
      data: { status: 'started' },
    })

    await poller.poll()

    expect(mockService.emitEvent).not.toHaveBeenCalled()
    expect(mockService.removeTracked).not.toHaveBeenCalled()
  })

  it('does not emit any event when command status fetch fails', async () => {
    const entry = { ...createTrackedMovie(456, 123, 42), queueId: null }
    mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })
    ;(radarrGetCommandById as jest.Mock).mockRejectedValue(
      new Error('API error'),
    )

    await poller.poll()

    expect(mockService.emitEvent).not.toHaveBeenCalled()
    expect(mockService.removeTracked).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Fallback timeout: entries without commandId (direct grabs via postApiV3Release)
  // ---------------------------------------------------------------------------

  it('emits FAILED via timeout fallback when no commandId and search exceeds timeout', async () => {
    const entry = {
      ...createTrackedMovie(456, 123),
      queueId: null,
      initiatedAt: Date.now() - SEARCH_TIMEOUT_MS - 1000,
    }
    mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })

    await poller.poll()

    expect(mockService.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: DownloadEvents.FAILED,
        tmdbId: 456,
        error: 'No releases found',
      }),
    )
    expect(mockService.removeTracked).toHaveBeenCalledWith('movie:456')
  })

  it('does not emit any event when no commandId and still within timeout', async () => {
    const entry = {
      ...createTrackedMovie(456, 123),
      queueId: null,
      initiatedAt: Date.now() - 5000,
    }
    mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })

    await poller.poll()

    expect(mockService.emitEvent).not.toHaveBeenCalled()
    expect(mockService.removeTracked).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Grabbing: first appearance in queue
  // ---------------------------------------------------------------------------

  it('emits GRABBING when movie first appears in queue', async () => {
    const entry = {
      ...createTrackedMovie(456, 123),
      queueId: null,
      initiatedAt: Date.now() - 1000,
    }
    mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({
      data: [{ id: 99, movieId: 123, title: 'Movie.mkv', size: 10000 }],
    })

    await poller.poll()

    expect(mockService.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: DownloadEvents.GRABBING,
        tmdbId: 456,
        title: 'Movie.mkv',
        size: 10000,
      }),
    )
    expect(mockService.updateTracked).toHaveBeenCalledWith(
      'movie:456',
      expect.objectContaining({ queueId: 99 }),
    )
  })

  // ---------------------------------------------------------------------------
  // Failure states
  // ---------------------------------------------------------------------------

  it('emits FAILED and removes tracked for queue item in "failed" state', async () => {
    const entry = {
      ...createTrackedMovie(456, 123),
      queueId: 99,
      initiatedAt: Date.now() - 1000,
    }
    mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({
      data: [
        { id: 99, movieId: 123, status: 'failed', trackedDownloadState: null },
      ],
    })

    await poller.poll()

    expect(mockService.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: DownloadEvents.FAILED }),
    )
    expect(mockService.removeTracked).toHaveBeenCalledWith('movie:456')
  })

  it('emits FAILED for importFailed tracked download state', async () => {
    const entry = {
      ...createTrackedMovie(456, 123),
      queueId: 99,
      initiatedAt: Date.now() - 1000,
    }
    mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({
      data: [
        {
          id: 99,
          movieId: 123,
          trackedDownloadState: 'importFailed',
          status: 'completed',
          errorMessage: 'Import failed',
        },
      ],
    })

    await poller.poll()

    expect(mockService.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: DownloadEvents.FAILED,
        error: 'Import failed',
      }),
    )
  })

  // ---------------------------------------------------------------------------
  // Progress updates
  // ---------------------------------------------------------------------------

  it('emits PROGRESS when queue item values change', async () => {
    const entry = {
      ...createTrackedMovie(456, 123),
      queueId: 99,
      initiatedAt: Date.now() - 1000,
      lastProgress: 25,
      lastSizeleft: 7500,
    }
    mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({
      data: [
        {
          id: 99,
          movieId: 123,
          size: 10000,
          sizeleft: 5000,
          status: 'downloading',
          trackedDownloadState: null,
          estimatedCompletionTime: null,
        },
      ],
    })

    await poller.poll()

    expect(mockService.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: DownloadEvents.PROGRESS,
        progress: 50,
        size: 10000,
        sizeleft: 5000,
      }),
    )
  })

  it('does not emit PROGRESS when values are unchanged', async () => {
    const entry = {
      ...createTrackedMovie(456, 123),
      queueId: 99,
      initiatedAt: Date.now() - 1000,
      lastProgress: 50,
      lastSizeleft: 5000,
    }
    mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
    ;(radarrGetQueueDetails as jest.Mock).mockResolvedValue({
      data: [
        {
          id: 99,
          movieId: 123,
          size: 10000,
          sizeleft: 5000,
          status: 'downloading',
          trackedDownloadState: null,
        },
      ],
    })

    await poller.poll()

    expect(mockService.emitEvent).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Pending cancel cleanup
  // ---------------------------------------------------------------------------

  it('deletes pending cancel queue item when it appears in Sonarr queue', async () => {
    mockService.getTracked.mockReturnValue(new Map())
    mockService.getPendingCancelEpisodes.mockReturnValue(
      new Map([
        [1, { tvdbId: 789, seriesId: 20, cancelledAt: Date.now() - 1000 }],
      ]),
    )
    ;(sonarrGetQueueDetails as jest.Mock).mockResolvedValue({
      data: [{ id: 50, episodeId: 1 }],
    })

    await poller.poll()

    expect(sonarrDeleteQueueById).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 50 } }),
    )
    expect(mockService.removePendingCancel).toHaveBeenCalledWith(1)
  })

  it('expires stale pending cancel entry after timeout', async () => {
    mockService.getTracked.mockReturnValue(new Map())
    mockService.getPendingCancelEpisodes.mockReturnValue(
      new Map([
        [
          1,
          {
            tvdbId: 789,
            seriesId: 20,
            cancelledAt: Date.now() - SEARCH_TIMEOUT_MS - 5000,
          },
        ],
      ]),
    )
    // No queue item for this episode
    ;(sonarrGetQueueDetails as jest.Mock).mockResolvedValue({ data: [] })

    await poller.poll()

    expect(mockService.removePendingCancel).toHaveBeenCalledWith(1)
    expect(sonarrDeleteQueueById).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  it('does not throw when Radarr queue fetch fails', async () => {
    const entry = createTrackedMovie(456, 123)
    mockService.getTracked.mockReturnValue(new Map([['movie:456', entry]]))
    ;(radarrGetQueueDetails as jest.Mock).mockRejectedValue(
      new Error('Radarr down'),
    )

    await expect(poller.poll()).resolves.not.toThrow()
    expect(mockService.emitEvent).not.toHaveBeenCalled()
  })

  it('does not throw when Sonarr queue fetch fails', async () => {
    const entry = createTrackedEpisode({
      tvdbId: 789,
      sonarrSeriesId: 20,
      sonarrEpisodeId: 1,
      seasonNumber: 1,
      episodeNumber: 1,
    })
    mockService.getTracked.mockReturnValue(new Map([['episode:1', entry]]))
    ;(sonarrGetQueueDetails as jest.Mock).mockRejectedValue(
      new Error('Sonarr down'),
    )

    await expect(poller.poll()).resolves.not.toThrow()
    expect(mockService.emitEvent).not.toHaveBeenCalled()
  })
})
