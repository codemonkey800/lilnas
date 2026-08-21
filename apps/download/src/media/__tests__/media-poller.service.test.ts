// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadStateService, since Phase 5's ensureVideo()) must mock it first
// (see media/__tests__/download.controller.media.test.ts for the same
// pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { MediaPollerService } from 'src/media/media-poller.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

const NOW_ISO = '2026-08-20T12:00:00.000Z'

function buildRecord(
  type: DownloadType,
  mediaId: string,
  overrides: Partial<DownloadJobRecord> = {},
): DownloadJobRecord {
  return {
    completedAt: null,
    createdAt: NOW_ISO,
    hiddenAttribution: false,
    id: type === DownloadType.Movie ? 'movie-1' : 'show-1',
    mediaId,
    requester: null,
    status: DownloadJobStatus.Searching,
    type,
    updatedAt: NOW_ISO,
    ...overrides,
  }
}

function buildMovieJob(
  overrides: Partial<DownloadJobRecord> = {},
): DownloadJobRecord {
  return buildRecord(DownloadType.Movie, 'tmdb:1', overrides)
}

function buildShowJob(
  overrides: Partial<DownloadJobRecord> = {},
): DownloadJobRecord {
  return buildRecord(DownloadType.Show, 'tvdb:1', overrides)
}

describe('MediaPollerService', () => {
  // Which upstream library id each media key resolves to. A key absent from
  // this map resolves to a media with no radarrId/sonarrId, i.e. a title
  // that isn't in the library yet and therefore isn't pollable.
  let upstreamIds: Map<string, number>

  let service: MediaPollerService
  let downloadStateService: DownloadStateService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>
  let dbService: DbService

  beforeEach(async () => {
    upstreamIds = new Map([
      ['tmdb:1', 42],
      ['tvdb:1', 9],
    ])
    dbService = createTestDbService()
    const mockRadarrService = { getQueue: jest.fn().mockResolvedValue([]) }
    const mockSonarrService = { getQueue: jest.fn().mockResolvedValue([]) }
    const mockDownloadGateway = { broadcastPerViewer: jest.fn() }
    // `radarrId`/`sonarrId` are no longer persisted on the job - the poller
    // reads them off the resolved media, so the resolver is what supplies
    // "which upstream id do I poll this by".
    const mockMediaResolverService = {
      invalidate: jest.fn(),
      resolve: jest.fn(
        (keys: Array<{ mediaId: string; type: DownloadType }>) => ({
          degradedSources: [],
          media: new Map(
            keys.map(key => [
              key.mediaId,
              key.type === DownloadType.Movie
                ? {
                    id: key.mediaId,
                    radarrId: upstreamIds.get(key.mediaId),
                    title: 'A Movie',
                    tmdbId: 1,
                    type: DownloadType.Movie,
                  }
                : {
                    id: key.mediaId,
                    sonarrId: upstreamIds.get(key.mediaId),
                    title: 'A Show',
                    tvdbId: 1,
                    type: DownloadType.Show,
                  },
            ]),
          ),
        }),
      ),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaPollerService,
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: SonarrService, useValue: mockSonarrService },
        { provide: DownloadGateway, useValue: mockDownloadGateway },
        { provide: MediaResolverService, useValue: mockMediaResolverService },
      ],
    }).compile()

    service = module.get(MediaPollerService)
    downloadStateService = module.get(DownloadStateService)
    radarrService = module.get(RadarrService)
    sonarrService = module.get(SonarrService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  describe('tick gating', () => {
    it('skips polling entirely when no jobs are tracked', async () => {
      await service.poll()

      expect(radarrService.getQueue).not.toHaveBeenCalled()
      expect(sonarrService.getQueue).not.toHaveBeenCalled()
    })

    it('no-ops when called before nextAllowedRunAt (mid-backoff)', async () => {
      const job = buildMovieJob()
      downloadStateService.jobs.set(job.id, job)
      ;(service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt =
        Date.now() + 60_000

      await service.poll()

      expect(radarrService.getQueue).not.toHaveBeenCalled()
    })
  })

  describe('backoff', () => {
    it('doubles the backoff (capped at 120s) on failure and resets on success', async () => {
      const job = buildMovieJob()
      downloadStateService.jobs.set(job.id, job)

      radarrService.getQueue.mockRejectedValueOnce(new Error('radarr down'))
      await service.poll()

      expect((service as unknown as { backoffMs: number }).backoffMs).toBe(
        20_000,
      )
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBeGreaterThan(Date.now())

      // Clear the artificial backoff window so the next tick actually runs.
      ;(service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt = 0

      radarrService.getQueue.mockResolvedValueOnce([])
      await service.poll()

      expect((service as unknown as { backoffMs: number }).backoffMs).toBe(
        10_000,
      )
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)
    })
  })

  describe('pollMovies', () => {
    it('only queries the queue for tracked, non-terminal movie jobs', async () => {
      const trackedJob = buildMovieJob({
        id: 'tracked',
        status: DownloadJobStatus.Downloading,
      })
      const completedJob = buildMovieJob({
        id: 'done',
        status: DownloadJobStatus.Completed,
      })
      // A title that has been requested but isn't in Radarr's library yet
      // resolves without a radarrId, so there is nothing to poll it by.
      const notInLibraryJob = buildMovieJob({
        id: 'no-id',
        mediaId: 'tmdb:999',
      })
      downloadStateService.jobs.set(trackedJob.id, trackedJob)
      downloadStateService.jobs.set(completedJob.id, completedJob)
      downloadStateService.jobs.set(notInLibraryJob.id, notInLibraryJob)

      radarrService.getQueue.mockResolvedValue([])

      await service.poll()

      expect(radarrService.getQueue).toHaveBeenCalledWith([42])
    })

    it('updates the job status when the queue entry changes', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)

      radarrService.getQueue.mockResolvedValue([
        {
          movieId: 42,
          status: 'downloading',
          size: 1000,
          sizeleft: 500,
        },
      ])

      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Downloading)
      // The snapshot lives in DownloadStateService's side map now, not on
      // the job - it's live upstream state and is never persisted.
      expect(downloadStateService.getQueueSnapshot(job.id)).toEqual({
        progress: 50,
        status: 'downloading',
        timeLeft: undefined,
      })
    })

    it('does not call updateJob when nothing has changed', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      downloadStateService.queueSnapshots.set(job.id, {
        progress: 50,
        status: 'downloading',
      })
      const updateJobSpy = jest.spyOn(downloadStateService, 'updateJob')

      radarrService.getQueue.mockResolvedValue([
        { movieId: 42, status: 'downloading', size: 1000, sizeleft: 500 },
      ])

      await service.poll()

      expect(updateJobSpy).not.toHaveBeenCalled()
    })

    it('marks the job Completed once it disappears from the queue after downloading', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)

      radarrService.getQueue.mockResolvedValue([])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    it('captures an error message when the queue reports a failure', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)

      radarrService.getQueue.mockResolvedValue([
        {
          movieId: 42,
          status: 'failed',
          statusMessages: [{ title: 'x', messages: ['no seeds found'] }],
        },
      ])

      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Failed)
      expect(updated?.error).toBe('no seeds found')
    })
  })

  describe('pollShows', () => {
    it('only queries the queue for tracked, non-terminal show jobs', async () => {
      const trackedJob = buildShowJob({ status: DownloadJobStatus.Downloading })
      const failedJob = buildShowJob({
        id: 'failed',
        status: DownloadJobStatus.Failed,
      })
      downloadStateService.jobs.set(trackedJob.id, trackedJob)
      downloadStateService.jobs.set(failedJob.id, failedJob)

      sonarrService.getQueue.mockResolvedValue([])

      await service.poll()

      expect(sonarrService.getQueue).toHaveBeenCalledWith([9])
    })

    it('updates the show job status from the queue entry', async () => {
      const job = buildShowJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([
        { seriesId: 9, trackedDownloadState: 'importing' },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Importing,
      )
    })
  })
})
