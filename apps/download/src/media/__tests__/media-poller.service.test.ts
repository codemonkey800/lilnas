import {
  DownloadJobStatus,
  DownloadType,
  MovieDownloadJob,
  ShowDownloadJob,
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { MediaPollerService } from 'src/media/media-poller.service'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

function buildMovieJob(
  overrides: Partial<MovieDownloadJob> = {},
): MovieDownloadJob {
  return {
    id: overrides.id ?? 'movie-1',
    radarrId: overrides.radarrId ?? 42,
    status: overrides.status ?? DownloadJobStatus.Searching,
    type: DownloadType.Movie,
    url: 'radarr://tmdb/1',
    ...overrides,
  }
}

function buildShowJob(
  overrides: Partial<ShowDownloadJob> = {},
): ShowDownloadJob {
  return {
    id: overrides.id ?? 'show-1',
    sonarrId: overrides.sonarrId ?? 9,
    status: overrides.status ?? DownloadJobStatus.Searching,
    type: DownloadType.Show,
    url: 'sonarr://tvdb/1',
    ...overrides,
  }
}

describe('MediaPollerService', () => {
  let service: MediaPollerService
  let downloadStateService: DownloadStateService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>
  let dbService: DbService

  beforeEach(async () => {
    dbService = createTestDbService()
    const mockRadarrService = { getQueue: jest.fn().mockResolvedValue([]) }
    const mockSonarrService = { getQueue: jest.fn().mockResolvedValue([]) }
    const mockDownloadGateway = { broadcastPerViewer: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaPollerService,
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: SonarrService, useValue: mockSonarrService },
        { provide: DownloadGateway, useValue: mockDownloadGateway },
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
        radarrId: 1,
        status: DownloadJobStatus.Completed,
      })
      const noRadarrIdJob = buildMovieJob({
        id: 'no-id',
        radarrId: undefined,
      })
      downloadStateService.jobs.set(trackedJob.id, trackedJob)
      downloadStateService.jobs.set(completedJob.id, completedJob)
      downloadStateService.jobs.set(noRadarrIdJob.id, noRadarrIdJob)

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

      const updated = downloadStateService.jobs.get(job.id) as MovieDownloadJob
      expect(updated.status).toBe(DownloadJobStatus.Downloading)
      expect(updated.queueSnapshot).toEqual({
        progress: 50,
        status: 'downloading',
        timeLeft: undefined,
      })
    })

    it('does not call updateJob when nothing has changed', async () => {
      const job = buildMovieJob({
        status: DownloadJobStatus.Downloading,
        queueSnapshot: { progress: 50, status: 'downloading' },
      })
      downloadStateService.jobs.set(job.id, job)
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

      const updated = downloadStateService.jobs.get(job.id) as MovieDownloadJob
      expect(updated.status).toBe(DownloadJobStatus.Completed)
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

      const updated = downloadStateService.jobs.get(job.id) as MovieDownloadJob
      expect(updated.status).toBe(DownloadJobStatus.Failed)
      expect(updated.error).toBe('no seeds found')
    })
  })

  describe('pollShows', () => {
    it('only queries the queue for tracked, non-terminal show jobs', async () => {
      const trackedJob = buildShowJob({ status: DownloadJobStatus.Downloading })
      const failedJob = buildShowJob({
        id: 'failed',
        sonarrId: 5,
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

      const updated = downloadStateService.jobs.get(job.id) as ShowDownloadJob
      expect(updated.status).toBe(DownloadJobStatus.Importing)
    })
  })
})
