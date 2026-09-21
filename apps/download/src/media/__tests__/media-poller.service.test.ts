// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadStateService, since Phase 5's ensureVideo()) must mock it first
// (see media/__tests__/download.controller.media.test.ts for the same
// pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import type { MovieFileResource } from '@lilnas/media/radarr'
import type { EpisodeFileResource, EpisodeResource } from '@lilnas/media/sonarr'
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
import {
  MediaPollerService,
  type TrackedJob,
} from 'src/media/media-poller.service'
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
    discordRequester: null,
    hiddenAttribution: false,
    id: type === DownloadType.Movie ? 'movie-1' : 'show-1',
    linkedDiscord: null,
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

function buildTrackedShowJob(
  upstreamId: number,
  overrides: Partial<DownloadJobRecord> = {},
): TrackedJob {
  return { record: buildShowJob(overrides), upstreamId }
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
    const mockRadarrService = {
      getMovieFiles: jest.fn().mockResolvedValue([]),
      getQueue: jest.fn().mockResolvedValue([]),
    }
    const mockSonarrService = {
      getEpisodeFiles: jest.fn().mockResolvedValue([]),
      getEpisodes: jest.fn().mockResolvedValue([]),
      getQueue: jest.fn().mockResolvedValue([]),
    }
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

  describe('pollShows with scoped jobs', () => {
    // The regression this whole aggregation exists for: Sonarr queues one
    // item per episode, so taking the first hit made a season job report
    // "Completed" the moment its first episode landed.
    it('does not complete a season job while later episodes are still downloading', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 3 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([
        {
          episodeId: 1,
          seasonNumber: 3,
          seriesId: 9,
          size: 100,
          sizeleft: 0,
          trackedDownloadState: 'imported',
        },
        {
          episodeId: 2,
          seasonNumber: 3,
          seriesId: 9,
          size: 100,
          sizeleft: 80,
          status: 'downloading',
        },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      // Progress is over the whole season, not over the finished episode.
      expect(downloadStateService.getQueueSnapshot(job.id)?.progress).toBe(60)
    })

    it('completes a season job only once every episode leaves the queue', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 3 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    it('gives two differently-scoped jobs for one series different snapshots', async () => {
      const episodeJob = buildShowJob({
        id: 'show-episode',
        scope: { episodeId: 2, seasonNumber: 3 },
        status: DownloadJobStatus.Downloading,
      })
      const seriesJob = buildShowJob({
        id: 'show-series',
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(episodeJob.id, episodeJob)
      downloadStateService.jobs.set(seriesJob.id, seriesJob)

      sonarrService.getQueue.mockResolvedValue([
        {
          episodeId: 1,
          seasonNumber: 3,
          seriesId: 9,
          size: 100,
          sizeleft: 0,
          status: 'downloading',
        },
        {
          episodeId: 2,
          seasonNumber: 3,
          seriesId: 9,
          size: 100,
          sizeleft: 50,
          status: 'downloading',
        },
      ])

      await service.poll()

      // The episode job sees only its own item...
      expect(
        downloadStateService.getQueueSnapshot(episodeJob.id)?.progress,
      ).toBe(50)
      // ...while the unscoped job sees both, aggregated.
      expect(
        downloadStateService.getQueueSnapshot(seriesJob.id)?.progress,
      ).toBe(75)
    })

    // An item Sonarr can't attribute to an episode is not evidence about
    // *this* episode.
    it('never matches a null-episodeId item to an episode-scoped job', async () => {
      const job = buildShowJob({
        scope: { episodeId: 2 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([
        { episodeId: null, seriesId: 9, status: 'downloading' },
      ])

      await service.poll()

      // No match at all, so the disappeared-means-completed rule applies.
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    it('ignores queue items from another season', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 3 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([
        { episodeId: 7, seasonNumber: 4, seriesId: 9, status: 'failed' },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    // Season 0 is specials - a truthiness check would match every item.
    it('treats season 0 as a real filter', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 0 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([
        { episodeId: 7, seasonNumber: 1, seriesId: 9, status: 'downloading' },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    it('surfaces every failure message across a scope', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 3 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([
        {
          episodeId: 1,
          seasonNumber: 3,
          seriesId: 9,
          status: 'failed',
          statusMessages: [{ messages: ['disk full'], title: 'a' }],
        },
        {
          episodeId: 2,
          seasonNumber: 3,
          seriesId: 9,
          status: 'failed',
          statusMessages: [{ messages: ['unpack failed'], title: 'b' }],
        },
      ])

      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Failed)
      expect(updated?.error).toBe('disk full; unpack failed')
    })
  })

  // Exercised directly rather than through `poll()`: nothing calls it yet -
  // the queue-empty completion check that consumes it lands separately, and
  // this fetch is deliberately inert until then.
  describe('completionInputs', () => {
    // The steady state: every job has a queue entry, so nothing ever reaches
    // the completion check and it must cost exactly nothing.
    it('makes no upstream call at all when handed no jobs', async () => {
      const movies = await service.completionInputs(DownloadType.Movie, [])
      const shows = await service.completionInputs(DownloadType.Show, [])

      expect(movies.size).toBe(0)
      expect(shows.size).toBe(0)
      expect(radarrService.getMovieFiles).not.toHaveBeenCalled()
      expect(sonarrService.getEpisodeFiles).not.toHaveBeenCalled()
      expect(sonarrService.getEpisodes).not.toHaveBeenCalled()
    })

    it('returns a movie job its movie files, keyed by job id', async () => {
      const record = buildMovieJob()
      const files: MovieFileResource[] = [
        { dateAdded: NOW_ISO, id: 501, movieId: 42 },
      ]
      radarrService.getMovieFiles.mockResolvedValue(files)

      const result = await service.completionInputs(DownloadType.Movie, [
        { record, upstreamId: 42 },
      ])

      expect(radarrService.getMovieFiles).toHaveBeenCalledWith(42)
      expect(result.get(record.id)).toEqual({ files })
      // A movie is one file with no episode indirection, so there is nothing
      // to join and `episodes` stays absent rather than empty.
      expect(result.get(record.id)?.episodes).toBeUndefined()
      expect(sonarrService.getEpisodeFiles).not.toHaveBeenCalled()
    })

    it('returns a show job both its episode files and its episodes', async () => {
      const record = buildShowJob({ scope: { episodeId: 77, seasonNumber: 3 } })
      const files: EpisodeFileResource[] = [
        { dateAdded: NOW_ISO, id: 900, seasonNumber: 3, seriesId: 9 },
      ]
      const episodes: EpisodeResource[] = [
        { episodeFileId: 900, id: 77, seasonNumber: 3, seriesId: 9 },
      ]
      sonarrService.getEpisodeFiles.mockResolvedValue(files)
      sonarrService.getEpisodes.mockResolvedValue(episodes)

      const result = await service.completionInputs(DownloadType.Show, [
        { record, upstreamId: 9 },
      ])

      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledWith(9)
      // Unfiltered by season: one list per series serves every scope, which
      // is what lets differently-scoped jobs share the call below.
      expect(sonarrService.getEpisodes).toHaveBeenCalledWith(9)
      // `EpisodeFileResource` has no `episodeId`, so the episodes are the
      // only way back from `scope.episodeId` to a file - hence both.
      expect(result.get(record.id)).toEqual({ episodes, files })
    })

    // The whole point of the helper: four episode-scoped jobs on one series
    // read one series-wide file list, so they must cost one fetch, not four.
    it('fetches once per distinct upstreamId, not once per job', async () => {
      const jobs: TrackedJob[] = [1, 2, 3, 4].map(episodeId =>
        buildTrackedShowJob(9, {
          id: `show-${episodeId}`,
          scope: { episodeId, seasonNumber: 3 },
        }),
      )

      const result = await service.completionInputs(DownloadType.Show, jobs)

      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledTimes(1)
      expect(sonarrService.getEpisodes).toHaveBeenCalledTimes(1)
      expect(result.size).toBe(4)
      // Every job is keyed separately but shares the one fetched result.
      const shared = result.get('show-1')
      expect(shared).toBeDefined()
      for (const job of jobs) {
        expect(result.get(job.record.id)).toBe(shared)
      }
    })

    it('still fetches once per series when the jobs span two series', async () => {
      const result = await service.completionInputs(DownloadType.Show, [
        buildTrackedShowJob(9, { id: 'a' }),
        buildTrackedShowJob(9, { id: 'b' }),
        buildTrackedShowJob(11, { id: 'c' }),
      ])

      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledTimes(2)
      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledWith(9)
      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledWith(11)
      expect(result.get('a')).toBe(result.get('b'))
      expect(result.get('a')).not.toBe(result.get('c'))
    })

    // `poll()` already owns the exponential backoff; a second one here would
    // only let the two disagree about when to retry.
    it('lets an upstream rejection propagate rather than swallowing it', async () => {
      radarrService.getMovieFiles.mockRejectedValue(new Error('radarr down'))

      await expect(
        service.completionInputs(DownloadType.Movie, [
          { record: buildMovieJob(), upstreamId: 42 },
        ]),
      ).rejects.toThrow('radarr down')
    })
  })
})
