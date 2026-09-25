// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadStateService, since Phase 5's ensureVideo()) must mock it first
// (see media/__tests__/download.controller.media.test.ts for the same
// pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import type { MovieFileResource, QueueResource } from '@lilnas/media/radarr'
import type {
  EpisodeFileResource,
  EpisodeResource,
  QueueResource as SonarrQueueResource,
} from '@lilnas/media/sonarr'
import {
  type DownloadJobEvent,
  DownloadJobEventType,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  isManagedMedia,
  isMovie,
  isShow,
  MEDIA_EVENT_TYPE,
  type MediaEvent,
  type Movie,
  type Show,
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { nanoid } from 'nanoid'

import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { getJobById } from 'src/db/jobs.repo'
import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { flushAsync } from 'src/media/__tests__/helpers/fake-media-resolver'
import {
  MediaPollerService,
  type PollableCompletionData,
  type TrackedJob,
} from 'src/media/media-poller.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'
import {
  CANCEL_GRACE_MS,
  QUEUE_REMOVAL_CONFIRM_MS,
} from 'src/media/queue-status.util'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

const NOW_ISO = '2026-08-20T12:00:00.000Z'
/** A file imported after every job built here was created. */
const AFTER_ISO = '2026-08-20T12:05:00.000Z'
/** A file already in the library before any job built here was created. */
const BEFORE_ISO = '2026-08-20T11:00:00.000Z'

/**
 * The real Radarr queue row for a blocked import, read off the live instance
 * on 2026-09-21: movie 434, `Game Night (2018)` (`tmdb:445571`).
 *
 * Kept verbatim because its shape is the whole point - it is
 * `status: 'completed'` **and** `trackedDownloadState: 'importPending'` at
 * once, with `sizeleft: 0`. Every byte is on disk, nothing is moving it, and
 * the one thing a person needs in order to act is the sentence buried in
 * `statusMessages`.
 */
const BLOCKED_IMPORT_ITEM: QueueResource = {
  downloadClient: 'SABnzbd',
  downloadId: 'ce427a39-be9f-4271-b193-f7067dd82c4a',
  id: 152557673,
  movieId: 434,
  outputPath: '/downloads/Game.Night.2018.1080p.BluRay.x265/',
  protocol: 'usenet',
  size: 1681143972,
  sizeleft: 0,
  status: 'completed',
  statusMessages: [
    {
      messages: [
        'Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265',
      ],
      title: 'Game.Night.2018.1080p.BluRay.x265',
    },
  ],
  title: 'Game.Night.2018.1080p.BluRay.x265',
  trackedDownloadState: 'importPending',
  trackedDownloadStatus: 'warning',
}

const BLOCKED_IMPORT_REASON =
  'Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265'

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
  let downloadGateway: jest.Mocked<DownloadGateway>
  let downloadStateService: DownloadStateService
  let mediaResolverService: jest.Mocked<MediaResolverService>
  let mediaStateService: MediaStateService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>
  let dbService: DbService

  /**
   * Every job event broadcast so far, as an admin sees it. Job events are
   * fire-and-forget (the broadcast resolves the media first), so this lets
   * them settle before reading.
   */
  async function jobFrames(): Promise<DownloadJobEvent[]> {
    await flushAsync()
    return downloadGateway.broadcastPerViewer.mock.calls.map(
      ([build]) => build(true).data as DownloadJobEvent,
    )
  }

  /** A job frame's media snapshot - movies and shows only have one. */
  function snapshotOf(frame: DownloadJobEvent | undefined) {
    const media = frame?.job.media
    return media && isManagedMedia(media) ? media.queueSnapshot : undefined
  }

  beforeEach(async () => {
    upstreamIds = new Map([
      ['tmdb:1', 42],
      ['tvdb:1', 9],
    ])
    dbService = createTestDbService()
    const mockRadarrService = {
      getMovieFiles: jest.fn().mockResolvedValue([]),
      getMovieHistory: jest.fn().mockResolvedValue([]),
      getQueue: jest.fn().mockResolvedValue([]),
      refreshMonitoredDownloads: jest.fn().mockResolvedValue(undefined),
      removeQueueItem: jest.fn().mockResolvedValue(undefined),
    }
    const mockSonarrService = {
      getEpisodeFiles: jest.fn().mockResolvedValue([]),
      getEpisodes: jest.fn().mockResolvedValue([]),
      getQueue: jest.fn().mockResolvedValue([]),
      getSeriesHistory: jest.fn().mockResolvedValue([]),
      refreshMonitoredDownloads: jest.fn().mockResolvedValue(undefined),
      removeQueueItem: jest.fn().mockResolvedValue(undefined),
    }
    const mockDownloadGateway = {
      broadcast: jest.fn(),
      broadcastPerViewer: jest.fn(),
    }
    // `radarrId`/`sonarrId` are no longer persisted on the job - the poller
    // reads them off the resolved media, so the resolver is what supplies
    // "which upstream id do I poll this by". It annotates like the real one,
    // so a job frame's `media.queueSnapshot` comes off the queue cache the
    // poller fed - the only place it comes from.
    const mockMediaResolverService = {
      // Empty by default: a queue item no job owns maps to no media, so only
      // the 'media events' block below ever sees a media event.
      getMovieLibrary: jest.fn().mockResolvedValue(new Map()),
      getShowLibrary: jest.fn().mockResolvedValue(new Map()),
      invalidate: jest.fn(),
      invalidateLibrary: jest.fn(),
      resolve: jest.fn(
        (keys: Array<{ mediaId: string; type: DownloadType }>) => {
          const media = new Map<string, Movie | Show>(
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
          )
          mediaStateService.annotate(media.values())
          return { degradedSources: [], media }
        },
      ),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        fakeAttributionResolutionProvider(),
        MediaPollerService,
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: SonarrService, useValue: mockSonarrService },
        { provide: DownloadGateway, useValue: mockDownloadGateway },
        { provide: MediaResolverService, useValue: mockMediaResolverService },
        // The real one: it's a fed cache with no dependencies, so what the
        // poller wrote is asserted by reading it back.
        MediaStateService,
      ],
    }).compile()

    service = module.get(MediaPollerService)
    downloadGateway = module.get(DownloadGateway)
    downloadStateService = module.get(DownloadStateService)
    radarrService = module.get(RadarrService)
    sonarrService = module.get(SonarrService)
    mediaResolverService = module.get(MediaResolverService)
    mediaStateService = module.get(MediaStateService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  describe('tick gating', () => {
    // Nothing tracked no longer means nothing to do - a download started
    // outside this app is only ever seen by reading the queue - but an idle
    // upstream is still sent no refresh command.
    it('reads both queues but requests no refresh when idle', async () => {
      await service.poll()

      expect(radarrService.getQueue).toHaveBeenCalledTimes(1)
      expect(sonarrService.getQueue).toHaveBeenCalledTimes(1)
      expect(radarrService.refreshMonitoredDownloads).not.toHaveBeenCalled()
      expect(sonarrService.refreshMonitoredDownloads).not.toHaveBeenCalled()
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

  describe('queue refresh', () => {
    it('asks Radarr to refresh its queue before reading it', async () => {
      const job = buildMovieJob()
      downloadStateService.jobs.set(job.id, job)

      await service.poll()

      expect(radarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)
      expect(
        radarrService.refreshMonitoredDownloads.mock.invocationCallOrder[0],
      ).toBeLessThan(
        radarrService.getQueue.mock.invocationCallOrder[0] as number,
      )
      // Nothing tracked and nothing queued on the Sonarr side, so nothing
      // sent there.
      expect(sonarrService.refreshMonitoredDownloads).not.toHaveBeenCalled()
    })

    it('asks Sonarr the same way for a show job', async () => {
      const job = buildShowJob()
      downloadStateService.jobs.set(job.id, job)

      await service.poll()

      expect(sonarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)
      expect(radarrService.refreshMonitoredDownloads).not.toHaveBeenCalled()
    })

    it('reads the queue anyway, without backing off, when the refresh is refused', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      radarrService.refreshMonitoredDownloads.mockRejectedValueOnce(
        new Error('radarr said no'),
      )
      radarrService.getQueue.mockResolvedValue([
        { movieId: 42, status: 'downloading', size: 1000, sizeleft: 500 },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)
    })
  })

  describe('full queue cache', () => {
    it('reads each queue whole, with no ids', async () => {
      const job = buildMovieJob()
      downloadStateService.jobs.set(job.id, job)
      const show = buildShowJob()
      downloadStateService.jobs.set(show.id, show)

      await service.poll()

      expect(radarrService.getQueue).toHaveBeenCalledWith()
      expect(sonarrService.getQueue).toHaveBeenCalledWith()
    })

    it('stores a queue item no tracked job owns', async () => {
      const unowned: QueueResource = {
        movieId: 77,
        size: 1000,
        sizeleft: 250,
        status: 'downloading',
      }
      const unownedEpisode: SonarrQueueResource = {
        episodeId: 5,
        seasonNumber: 1,
        seriesId: 12,
        status: 'downloading',
      }
      radarrService.getQueue.mockResolvedValue([unowned])
      sonarrService.getQueue.mockResolvedValue([unownedEpisode])

      await service.poll()

      expect(mediaStateService.getQueue('radarr')).toEqual([unowned])
      expect(mediaStateService.getQueue('sonarr')).toEqual([unownedEpisode])
    })

    it('stores the whole queue alongside the tracked job it matches', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      const queue: QueueResource[] = [
        { movieId: 42, size: 1000, sizeleft: 500, status: 'downloading' },
        { movieId: 77, size: 1000, sizeleft: 250, status: 'downloading' },
      ]
      radarrService.getQueue.mockResolvedValue(queue)

      await service.poll()

      expect(mediaStateService.getQueue('radarr')).toEqual(queue)
      const [frame] = await jobFrames()
      expect(snapshotOf(frame)?.progress).toBe(50)
    })

    // An empty queue is news - whatever was downloading has left - so it
    // replaces the last one rather than being skipped as "nothing to store".
    it('stores an empty queue as empty', async () => {
      mediaStateService.setQueue('radarr', [
        { movieId: 77, status: 'downloading' },
      ])
      radarrService.getQueue.mockResolvedValue([])

      await service.poll()

      expect(mediaStateService.getQueue('radarr')).toEqual([])
    })

    it('keeps the previous queue, and backs off, when reading it fails', async () => {
      const previous = [{ movieId: 77, status: 'downloading' }]
      mediaStateService.setQueue('radarr', previous)
      radarrService.getQueue.mockRejectedValueOnce(new Error('radarr down'))

      await service.poll()

      expect(mediaStateService.getQueue('radarr')).toEqual(previous)
      expect((service as unknown as { backoffMs: number }).backoffMs).toBe(
        20_000,
      )
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBeGreaterThan(Date.now())
    })

    // Something is downloading that this app didn't start: keep nudging
    // upstream until it leaves the queue, exactly as for a tracked job.
    it('requests a refresh for a non-empty previous queue with nothing tracked', async () => {
      mediaStateService.setQueue('radarr', [
        { movieId: 77, status: 'downloading' },
      ])
      mediaStateService.setQueue('sonarr', [
        { seriesId: 12, status: 'downloading' },
      ])

      await service.poll()

      expect(radarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)
      expect(sonarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)
      expect(
        radarrService.refreshMonitoredDownloads.mock.invocationCallOrder[0],
      ).toBeLessThan(
        radarrService.getQueue.mock.invocationCallOrder[0] as number,
      )
    })

    // The gate reads the queue as of the *previous* tick, so the first tick
    // that sees an un-owned download reads it un-refreshed and the next one
    // refreshes - and once it has left, the tick after goes quiet again.
    it('gates the refresh on the previous tick, not the one being read', async () => {
      radarrService.getQueue.mockResolvedValue([
        { movieId: 77, status: 'downloading' },
      ])
      await service.poll()
      expect(radarrService.refreshMonitoredDownloads).not.toHaveBeenCalled()

      radarrService.getQueue.mockResolvedValue([])
      await service.poll()
      expect(radarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)

      await service.poll()
      expect(radarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)
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
    it('only updates tracked, non-terminal movie jobs', async () => {
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
      const updateJobSpy = jest.spyOn(downloadStateService, 'updateJob')

      radarrService.getQueue.mockResolvedValue([
        { movieId: 42, size: 1000, sizeleft: 500, status: 'downloading' },
      ])

      await service.poll()

      expect(radarrService.getQueue).toHaveBeenCalledWith()
      // Only the tracked job moved; the completed one and the one with no
      // library id were never matched against the queue.
      expect(updateJobSpy).not.toHaveBeenCalled()
      // The tracked job's progress still went out, as a bare re-broadcast.
      expect((await jobFrames()).map(frame => frame.job.id)).toEqual([
        trackedJob.id,
      ])
      expect(downloadStateService.jobs.get(notInLibraryJob.id)?.status).toBe(
        DownloadJobStatus.Searching,
      )
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
      // The snapshot is never on the job - the frame's media carries the
      // one the resolver derived from the queue cache.
      const frames = await jobFrames()
      expect(frames).toHaveLength(1)
      expect(snapshotOf(frames[0])).toMatchObject({
        progress: 50,
        status: 'downloading',
      })
    })

    it('neither calls updateJob nor broadcasts when nothing has changed', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([
        { movieId: 42, status: 'downloading', size: 1000, sizeleft: 500 },
      ])
      await service.poll()
      await flushAsync()
      downloadGateway.broadcastPerViewer.mockClear()
      const updateJobSpy = jest.spyOn(downloadStateService, 'updateJob')

      await service.poll()

      expect(updateJobSpy).not.toHaveBeenCalled()
      expect(await jobFrames()).toEqual([])
    })

    it('marks the job Completed once it leaves the queue with its file imported', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)

      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    it('evicts the media from the resolver cache before broadcasting Completed', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      const updateJobSpy = jest.spyOn(downloadStateService, 'updateJob')

      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
      ])

      await service.poll()

      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(job.mediaId)
      expect(
        mediaResolverService.invalidate.mock.invocationCallOrder[0],
      ).toBeLessThan(updateJobSpy.mock.invocationCallOrder[0] as number)
    })

    it('leaves the resolver cache alone for a non-terminal status change', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)

      radarrService.getQueue.mockResolvedValue([
        { movieId: 42, status: 'downloading', size: 1000, sizeleft: 500 },
      ])

      await service.poll()

      expect(mediaResolverService.invalidate).not.toHaveBeenCalled()
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

  // A job's `media.queueSnapshot` is the resolver's, off the queue cache, so
  // the poller's only part in live progress is deciding when a job is worth
  // re-broadcasting - once per change, never twice in a tick.
  describe('job frames', () => {
    const downloading = (sizeleft: number): QueueResource => ({
      movieId: 42,
      size: 1000,
      sizeleft,
      status: 'downloading',
    })

    async function pollOnce(): Promise<DownloadJobEvent[]> {
      downloadGateway.broadcastPerViewer.mockClear()
      await service.poll()
      return jobFrames()
    }

    it('sends one Updated frame carrying the new progress on a progress-only tick', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([downloading(500)])
      await pollOnce()
      const updateJobSpy = jest.spyOn(downloadStateService, 'updateJob')

      radarrService.getQueue.mockResolvedValue([downloading(250)])
      const frames = await pollOnce()

      expect(updateJobSpy).not.toHaveBeenCalled()
      expect(frames).toHaveLength(1)
      expect(frames[0]).toMatchObject({
        job: { id: job.id, status: DownloadJobStatus.Downloading },
        type: DownloadJobEventType.Updated,
      })
      expect(snapshotOf(frames[0])?.progress).toBe(75)
    })

    it('sends no frame when the snapshot is unchanged', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([downloading(500)])
      await pollOnce()

      expect(await pollOnce()).toEqual([])
    })

    it('sends one frame, not two, when the status and the progress move together', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      const touchSpy = jest.spyOn(downloadStateService, 'touchJob')

      radarrService.getQueue.mockResolvedValue([downloading(500)])
      const frames = await pollOnce()

      expect(touchSpy).not.toHaveBeenCalled()
      expect(frames).toHaveLength(1)
      expect(frames[0]?.job.status).toBe(DownloadJobStatus.Downloading)
      expect(snapshotOf(frames[0])?.progress).toBe(50)
    })

    // The item is gone but nothing has landed yet, so the job stays where it
    // is - and its frame must stop showing the progress it last had.
    it('sends one frame without a snapshot when the item leaves the queue unsettled', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([downloading(500)])
      await pollOnce()

      radarrService.getQueue.mockResolvedValue([])
      const frames = await pollOnce()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(frames).toHaveLength(1)
      expect(frames[0]?.job.media).not.toHaveProperty('queueSnapshot')
      // Still gone: nothing new to say.
      expect(await pollOnce()).toEqual([])
    })

    it('sends only the status frame when the item leaves and the job settles in the same tick', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([downloading(500)])
      await pollOnce()
      const touchSpy = jest.spyOn(downloadStateService, 'touchJob')

      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
      ])
      const frames = await pollOnce()

      expect(touchSpy).not.toHaveBeenCalled()
      expect(frames).toHaveLength(1)
      expect(frames[0]?.job.status).toBe(DownloadJobStatus.Completed)
    })
  })

  describe('pollShows', () => {
    it('only updates tracked, non-terminal show jobs', async () => {
      const trackedJob = buildShowJob({ status: DownloadJobStatus.Downloading })
      const failedJob = buildShowJob({
        id: 'failed',
        status: DownloadJobStatus.Failed,
      })
      downloadStateService.jobs.set(trackedJob.id, trackedJob)
      downloadStateService.jobs.set(failedJob.id, failedJob)

      sonarrService.getQueue.mockResolvedValue([
        { seriesId: 9, size: 100, sizeleft: 50, status: 'downloading' },
      ])

      await service.poll()

      expect(sonarrService.getQueue).toHaveBeenCalledWith()
      expect((await jobFrames()).map(frame => frame.job.id)).toEqual([
        trackedJob.id,
      ])
      expect(downloadStateService.jobs.get(failedJob.id)?.status).toBe(
        DownloadJobStatus.Failed,
      )
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
      const [frame] = await jobFrames()
      expect(snapshotOf(frame)?.progress).toBe(60)
    })

    it('completes a season job once every episode leaves the queue with its file', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 3 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([])
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 901, id: 1, seasonNumber: 3, seriesId: 9 },
        { episodeFileId: 902, id: 2, seasonNumber: 3, seriesId: 9 },
      ])
      sonarrService.getEpisodeFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 901, seasonNumber: 3, seriesId: 9 },
        { dateAdded: AFTER_ISO, id: 902, seasonNumber: 3, seriesId: 9 },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    // The frame's snapshot is the series' - the media is per-title - but
    // whether a job is re-broadcast at all is decided by its own scope.
    it('re-broadcasts only the jobs whose own queue items moved', async () => {
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
      const queue = (episodeOneLeft: number): SonarrQueueResource[] => [
        {
          episodeId: 1,
          seasonNumber: 3,
          seriesId: 9,
          size: 100,
          sizeleft: episodeOneLeft,
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
      ]

      sonarrService.getQueue.mockResolvedValue(queue(100))
      await service.poll()
      expect((await jobFrames()).map(frame => frame.job.id).sort()).toEqual([
        episodeJob.id,
        seriesJob.id,
      ])
      downloadGateway.broadcastPerViewer.mockClear()

      // Only episode 1 moved, which is outside the episode job's scope.
      sonarrService.getQueue.mockResolvedValue(queue(0))
      await service.poll()

      const frames = await jobFrames()
      expect(frames.map(frame => frame.job.id)).toEqual([seriesJob.id])
      expect(snapshotOf(frames[0])?.progress).toBe(75)
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

      // No match at all, so the job is settled from its files - and with
      // none landed, inside the grace period, it is left where it was.
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
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

      // Not Failed: the other season's failure is not this job's.
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
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

      // The season 1 item is no evidence about season 0, so the job has no
      // item at all and nothing it can be settled from yet.
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledWith(9)
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

  describe('needs_attention reasons', () => {
    // Every test here polls the real fixture, so the job has to resolve to
    // the movie it actually belongs to.
    function seedBlockedMovieJob(): DownloadJobRecord {
      upstreamIds.set('tmdb:445571', 434)
      const job = buildMovieJob({
        mediaId: 'tmdb:445571',
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)
      return job
    }

    it("carries upstream's own sentence onto the job when an import is blocked", async () => {
      const job = seedBlockedMovieJob()

      radarrService.getQueue.mockResolvedValue([BLOCKED_IMPORT_ITEM])

      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.NeedsAttention)
      expect(updated?.error).toBe(BLOCKED_IMPORT_REASON)
    })

    // `updateJob` spreads its patch over the record and never touches
    // `error` on its own, so nothing clears it implicitly. Without the
    // explicit `undefined` the job would carry "was not found in the grabbed
    // release" into history forever - including into the persisted row,
    // which `buildJobRow` writes as `record.error ?? null`.
    it('drops the reason from the record and the row once the job completes', async () => {
      const job = seedBlockedMovieJob()

      radarrService.getQueue.mockResolvedValue([BLOCKED_IMPORT_ITEM])
      await service.poll()

      expect(getJobById(dbService.db, job.id)?.error).toBe(
        BLOCKED_IMPORT_REASON,
      )

      // A human worked the manual-import dialog, so Radarr imported the file
      // and dropped the row.
      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 434 },
      ])
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Completed)
      expect(updated?.error).toBeUndefined()
      expect(getJobById(dbService.db, job.id)?.error).toBeNull()
    })

    // The status never moves and neither does the snapshot, so the only
    // thing that makes this tick a change at all is the sentence itself.
    it('re-writes the reason when upstream re-parses while still blocked', async () => {
      const job = seedBlockedMovieJob()

      radarrService.getQueue.mockResolvedValue([BLOCKED_IMPORT_ITEM])
      await service.poll()

      const reparsed =
        'Found matching movie via grab history, but release was matched to movie by ID. Automatic import is not possible.'
      radarrService.getQueue.mockResolvedValue([
        {
          ...BLOCKED_IMPORT_ITEM,
          statusMessages: [
            { messages: [reparsed], title: BLOCKED_IMPORT_ITEM.title },
          ],
        },
      ])
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.NeedsAttention)
      expect(updated?.error).toBe(reparsed)
    })

    it('replaces the block reason with the failure message on a later failure', async () => {
      const job = seedBlockedMovieJob()

      radarrService.getQueue.mockResolvedValue([BLOCKED_IMPORT_ITEM])
      await service.poll()

      radarrService.getQueue.mockResolvedValue([
        {
          ...BLOCKED_IMPORT_ITEM,
          status: 'failed',
          statusMessages: [
            {
              messages: ['Download client reported an error'],
              title: BLOCKED_IMPORT_ITEM.title,
            },
          ],
          trackedDownloadState: 'failedPending',
        },
      ])
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Failed)
      expect(updated?.error).toBe('Download client reported an error')
    })

    // A season is blocked as a whole the moment any one of its episodes is:
    // that is the one thing in the scope a person can act on now, and the
    // sibling still transferring must not hide it.
    it('reports a season blocked by one episode, with every message joined', async () => {
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
          status: 'completed',
          statusMessages: [
            {
              messages: [
                'Episode [S03E01] was not found in the grabbed release',
                'One or more episodes expected in this release were not imported or missing',
              ],
              title: 'A.Show.S03E01.1080p.WEB.x265',
            },
          ],
          trackedDownloadState: 'importBlocked',
          trackedDownloadStatus: 'warning',
        },
        {
          episodeId: 2,
          seasonNumber: 3,
          seriesId: 9,
          size: 100,
          sizeleft: 40,
          status: 'downloading',
        },
      ])

      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.NeedsAttention)
      expect(updated?.error).toBe(
        'Episode [S03E01] was not found in the grabbed release; One or more episodes expected in this release were not imported or missing',
      )
    })
  })

  describe('media events', () => {
    // What upstream holds right now, by media id: a movie (Radarr 77) and a
    // series (Sonarr 12) that no job owns. The resolver mock below models the
    // real one's library cache - it serves the copy it first read until
    // `invalidate()` evicts it - so an event can only carry a freshly
    // imported file if the poller invalidated before resolving.
    let upstream: Map<string, Movie | Show>
    let cached: Map<string, Movie | Show>

    const UNOWNED_MOVIE_ITEM: QueueResource = {
      movieId: 77,
      size: 1000,
      sizeleft: 750,
      status: 'downloading',
    }

    function mediaEvents(): MediaEvent[] {
      return downloadGateway.broadcast.mock.calls.map(([message]) => {
        expect(message.type).toBe(MEDIA_EVENT_TYPE)
        return message.data as MediaEvent
      })
    }

    // The poll gate is a backoff concern the tests below don't exercise.
    function clearBackoff(): void {
      ;(service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt = 0
    }

    function buildEpisodes(count: number): EpisodeResource[] {
      return Array.from({ length: count }, (_, index) => ({
        episodeNumber: index + 1,
        hasFile: false,
        id: index + 1,
        monitored: true,
        seasonNumber: 1,
        seriesId: 12,
      }))
    }

    beforeEach(() => {
      // Every download here is one no job owns, which the poller would
      // otherwise adopt - minting a job and reading the library and episodes
      // to do it. This block covers the media diff on its own; adoption has
      // its own block below.
      jest
        .spyOn(
          service as unknown as {
            adoptUnownedDownloads: () => Promise<void>
          },
          'adoptUnownedDownloads',
        )
        .mockResolvedValue(undefined)

      upstream = new Map<string, Movie | Show>([
        [
          'tmdb:500',
          {
            id: 'tmdb:500',
            monitored: true,
            radarrId: 77,
            title: 'Unowned Movie',
            tmdbId: 500,
            type: DownloadType.Movie,
          },
        ],
        [
          'tvdb:300',
          {
            id: 'tvdb:300',
            monitored: true,
            sonarrId: 12,
            title: 'Unowned Show',
            tvdbId: 300,
            type: DownloadType.Show,
          },
        ],
      ])
      cached = new Map()

      mediaResolverService.getMovieLibrary.mockImplementation(
        async () =>
          new Map(
            Array.from(upstream.values())
              .filter(isMovie)
              .map(movie => [movie.tmdbId, movie]),
          ),
      )
      mediaResolverService.getShowLibrary.mockImplementation(
        async () =>
          new Map(
            Array.from(upstream.values())
              .filter(isShow)
              .map(show => [show.tvdbId, show]),
          ),
      )
      mediaResolverService.invalidate.mockImplementation(key => {
        cached.delete(key)
      })

      const byUpstreamIds = mediaResolverService.resolve.getMockImplementation()
      mediaResolverService.resolve.mockImplementation(async keys => {
        const result = await byUpstreamIds!(keys)

        for (const { mediaId } of keys) {
          const current = upstream.get(mediaId)
          if (!current) continue

          if (!cached.has(mediaId)) cached.set(mediaId, { ...current })
          result.media.set(mediaId, cached.get(mediaId) as Movie | Show)
        }

        // What the real resolve() ends on.
        mediaStateService.annotate(result.media.values())
        return result
      })
    })

    it('costs nothing while both queues are empty', async () => {
      await service.poll()

      expect(mediaResolverService.getMovieLibrary).not.toHaveBeenCalled()
      expect(mediaResolverService.resolve).not.toHaveBeenCalled()
      expect(sonarrService.getEpisodes).not.toHaveBeenCalled()
      expect(downloadGateway.broadcast).not.toHaveBeenCalled()
    })

    it('broadcasts a download no job owns the first tick it is seen', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])

      await service.poll()

      expect(downloadStateService.jobs.size).toBe(0)
      const events = mediaEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.media).toMatchObject({
        id: 'tmdb:500',
        queueSnapshot: { progress: 25, status: 'downloading' },
        state: 'downloading',
      })
      expect(events[0]).not.toHaveProperty('episodes')
    })

    it('sends nothing on a tick that changed nothing', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])

      await service.poll()
      await service.poll()

      expect(mediaEvents()).toHaveLength(1)
    })

    // Anything seen last tick already knows its media id, so the library is
    // read only for an upstream id that is new.
    it('reads the library only for a queue item it has not seen before', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])

      await service.poll()
      await service.poll()

      expect(mediaResolverService.getMovieLibrary).toHaveBeenCalledTimes(1)
    })

    // Added in Radarr's own UI, which searches and grabs within seconds: the
    // resolver's library cache was filled before the add, and serves that
    // copy until `invalidateLibrary()` drops it.
    describe('a title added upstream after the library was cached', () => {
      let cachedLibrary: Map<number, Movie> | undefined

      beforeEach(() => {
        cachedLibrary = new Map()
        mediaResolverService.getMovieLibrary.mockImplementation(async () => {
          cachedLibrary ??= new Map(
            Array.from(upstream.values())
              .filter(isMovie)
              .map(movie => [movie.tmdbId, movie]),
          )
          return cachedLibrary
        })
        mediaResolverService.invalidateLibrary.mockImplementation(() => {
          cachedLibrary = undefined
        })
      })

      it('re-reads the library and broadcasts the download the first tick it is seen', async () => {
        radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])

        await service.poll()

        expect(mediaResolverService.invalidateLibrary).toHaveBeenCalledWith(
          DownloadType.Movie,
        )
        const events = mediaEvents()
        expect(events).toHaveLength(1)
        expect(events[0]?.media).toMatchObject({
          id: 'tmdb:500',
          state: 'downloading',
        })
      })

      it('re-reads the library only once for an id it still cannot find', async () => {
        radarrService.getQueue.mockResolvedValue([
          { ...UNOWNED_MOVIE_ITEM, movieId: 99 },
        ])

        await service.poll()
        await service.poll()
        await service.poll()

        expect(mediaResolverService.invalidateLibrary).toHaveBeenCalledTimes(1)
        expect(mediaEvents()).toHaveLength(0)
      })

      it('re-reads the library again once the id leaves the queue and comes back', async () => {
        const orphan = { ...UNOWNED_MOVIE_ITEM, movieId: 99 }
        radarrService.getQueue.mockResolvedValue([orphan])
        await service.poll()
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()
        radarrService.getQueue.mockResolvedValue([orphan])

        await service.poll()

        expect(mediaResolverService.invalidateLibrary).toHaveBeenCalledTimes(2)
      })
    })

    it('sends one event when the progress moves', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])
      await service.poll()

      radarrService.getQueue.mockResolvedValue([
        { ...UNOWNED_MOVIE_ITEM, sizeleft: 500 },
      ])
      await service.poll()

      const events = mediaEvents()
      expect(events).toHaveLength(2)
      expect(events[1]?.media).toMatchObject({
        queueSnapshot: { progress: 50 },
      })
    })

    it('sends one last event, carrying the imported file, once the item leaves the queue', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])
      await service.poll()

      // Radarr imported it between ticks.
      upstream.set('tmdb:500', {
        ...(upstream.get('tmdb:500') as Movie),
        filePath: '/movies/Unowned Movie (2020)/unowned.mkv',
      })
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()

      const events = mediaEvents()
      expect(events).toHaveLength(2)
      expect(events[1]?.media).toMatchObject({
        filePath: '/movies/Unowned Movie (2020)/unowned.mkv',
        id: 'tmdb:500',
        state: 'available',
      })
      expect(events[1]?.media).not.toHaveProperty('queueSnapshot')

      expect(mediaResolverService.invalidate).toHaveBeenCalledWith('tmdb:500')
      expect(
        mediaResolverService.invalidate.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mediaResolverService.resolve.mock.invocationCallOrder.at(-1) as number,
      )
    })

    it('sends nothing more once the last event, carrying the file, is out', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])
      await service.poll()
      upstream.set('tmdb:500', {
        ...(upstream.get('tmdb:500') as Movie),
        filePath: '/movies/Unowned Movie (2020)/unowned.mkv',
      })
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()
      const resolveCalls = mediaResolverService.resolve.mock.calls.length

      await service.poll()

      expect(mediaEvents()).toHaveLength(2)
      expect(mediaResolverService.resolve).toHaveBeenCalledTimes(resolveCalls)
    })

    // The import race, for a download no job owns: the item goes a tick
    // before Radarr lists the file. The vanish frame is truthfully "no file",
    // so the media stays watched - re-read fresh each tick - until the file
    // lands, or for the grace period if it never does.
    describe('after the item leaves with no file listed', () => {
      const T0 = Date.parse('2026-08-20T13:00:00.000Z')

      function at(ms: number): void {
        jest.spyOn(Date, 'now').mockReturnValue(ms)
      }

      async function vanishWithoutFile(): Promise<void> {
        at(T0)
        radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])
        await service.poll()

        at(T0 + 10_000)
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()
      }

      afterEach(() => {
        jest.restoreAllMocks()
      })

      it('says wanted, then sends one more frame once the file is listed', async () => {
        await vanishWithoutFile()

        expect(mediaEvents().at(-1)?.media).toMatchObject({ state: 'wanted' })

        upstream.set('tmdb:500', {
          ...(upstream.get('tmdb:500') as Movie),
          filePath: '/movies/Unowned Movie (2020)/unowned.mkv',
        })
        at(T0 + 20_000)
        clearBackoff()
        await service.poll()

        const events = mediaEvents()
        expect(events).toHaveLength(3)
        expect(events[2]?.media).toMatchObject({
          filePath: '/movies/Unowned Movie (2020)/unowned.mkv',
          state: 'available',
        })

        // Landed: no longer watched.
        const resolveCalls = mediaResolverService.resolve.mock.calls.length
        at(T0 + 30_000)
        await service.poll()
        expect(mediaResolverService.resolve).toHaveBeenCalledTimes(resolveCalls)
      })

      it('re-reads it fresh every tick while watched, sending nothing unchanged', async () => {
        await vanishWithoutFile()
        mediaResolverService.invalidate.mockClear()

        at(T0 + 20_000)
        await service.poll()

        expect(mediaResolverService.invalidate).toHaveBeenCalledWith('tmdb:500')
        expect(mediaEvents()).toHaveLength(2)
      })

      it('stops watching once the grace period passes with no file', async () => {
        await vanishWithoutFile()

        at(T0 + 10_000 + 59_000)
        await service.poll()
        expect(mediaResolverService.resolve).toHaveBeenCalledTimes(3)

        at(T0 + 10_000 + 60_000)
        await service.poll()
        const resolveCalls = mediaResolverService.resolve.mock.calls.length

        at(T0 + 10_000 + 70_000)
        await service.poll()

        expect(mediaResolverService.resolve).toHaveBeenCalledTimes(resolveCalls)
        expect(mediaEvents()).toHaveLength(2)
      })

      // A series that already had episodes is `available` before this grab
      // even started, so the series state can't say the grab landed - the
      // episodes it had queued can.
      it('watches a series until the episodes it had queued have files', async () => {
        const withFiles = (ids: readonly number[]): EpisodeResource[] =>
          buildEpisodes(3).map(episode => ({
            ...episode,
            hasFile: ids.includes(episode.id as number),
          }))
        upstream.set('tvdb:300', {
          ...(upstream.get('tvdb:300') as Show),
          episodeFileCount: 1,
        })
        sonarrService.getEpisodes.mockResolvedValue(withFiles([1]))

        at(T0)
        sonarrService.getQueue.mockResolvedValue([
          {
            episodeId: 2,
            seasonNumber: 1,
            seriesId: 12,
            status: 'downloading',
          },
        ])
        await service.poll()

        at(T0 + 10_000)
        sonarrService.getQueue.mockResolvedValue([])
        await service.poll()

        expect(mediaEvents().at(-1)?.media).toMatchObject({
          state: 'available',
        })
        expect(
          mediaEvents()
            .at(-1)
            ?.episodes?.find(entry => entry.episodeId === 2),
        ).toMatchObject({ state: 'wanted' })

        sonarrService.getEpisodes.mockResolvedValue(withFiles([1, 2]))
        at(T0 + 20_000)
        await service.poll()

        expect(
          mediaEvents()
            .at(-1)
            ?.episodes?.find(entry => entry.episodeId === 2),
        ).toMatchObject({ state: 'available' })

        const episodeReads = sonarrService.getEpisodes.mock.calls.length
        at(T0 + 30_000)
        await service.poll()
        expect(sonarrService.getEpisodes).toHaveBeenCalledTimes(episodeReads)
      })
    })

    it('sends a series as one event carrying every episode, however many are queued', async () => {
      sonarrService.getEpisodes.mockResolvedValue(buildEpisodes(200))
      sonarrService.getQueue.mockResolvedValue([
        { episodeId: 1, seasonNumber: 1, seriesId: 12, status: 'downloading' },
        { episodeId: 2, seasonNumber: 1, seriesId: 12, status: 'downloading' },
        { episodeId: 3, seasonNumber: 1, seriesId: 12, status: 'downloading' },
      ])

      await service.poll()

      const events = mediaEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.media).toMatchObject({
        id: 'tvdb:300',
        state: 'downloading',
      })
      expect(sonarrService.getEpisodes).toHaveBeenCalledTimes(1)
      expect(sonarrService.getEpisodes).toHaveBeenCalledWith(12)

      const episodes = events[0]?.episodes ?? []
      expect(episodes).toHaveLength(200)
      expect(episodes[0]).toMatchObject({ episodeId: 1, state: 'downloading' })
      expect(episodes[3]).toEqual({
        episodeId: 4,
        seasonNumber: 1,
        state: 'wanted',
      })
    })

    it('skips a series whose episodes cannot be read, and retries it next tick', async () => {
      sonarrService.getQueue.mockResolvedValue([
        { episodeId: 1, seasonNumber: 1, seriesId: 12, status: 'downloading' },
      ])
      sonarrService.getEpisodes.mockRejectedValueOnce(new Error('sonarr down'))

      await service.poll()

      expect(downloadGateway.broadcast).not.toHaveBeenCalled()
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)

      sonarrService.getEpisodes.mockResolvedValue(buildEpisodes(1))
      await service.poll()

      expect(mediaEvents()).toHaveLength(1)
    })

    it('swallows a resolve failure without disturbing the job update', async () => {
      upstream.set('tmdb:1', {
        id: 'tmdb:1',
        monitored: true,
        radarrId: 42,
        title: 'A Movie',
        tmdbId: 1,
        type: DownloadType.Movie,
      })
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([
        { movieId: 42, size: 1000, sizeleft: 500, status: 'downloading' },
      ])
      // The job lookup's resolve succeeds and every later one - the media
      // diff's, and the job broadcast's fire-and-forget hydrate - rejects.
      const resolve = mediaResolverService.resolve.getMockImplementation()
      mediaResolverService.resolve
        .mockImplementationOnce(resolve!)
        .mockRejectedValue(new Error('resolver broke'))

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(downloadGateway.broadcast).not.toHaveBeenCalled()
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)

      // Nothing was recorded, so the next tick sends it.
      mediaResolverService.resolve.mockImplementation(resolve!)
      await service.poll()

      expect(mediaEvents().map(event => event.media.id)).toEqual(['tmdb:1'])
    })

    it('sends no vanish event for a source whose queue read failed', async () => {
      sonarrService.getQueue.mockResolvedValue([
        { episodeId: 1, seasonNumber: 1, seriesId: 12, status: 'downloading' },
      ])
      await service.poll()
      expect(mediaEvents()).toHaveLength(1)

      sonarrService.getQueue.mockRejectedValueOnce(new Error('sonarr down'))
      await service.poll()

      expect(mediaEvents()).toHaveLength(1)
      expect(mediaResolverService.invalidate).not.toHaveBeenCalled()

      // Still queued once Sonarr answers again: nothing moved, nothing sent.
      clearBackoff()
      await service.poll()

      expect(mediaEvents()).toHaveLength(1)
    })

    it('skips the batch, and retries it, when the resolve comes back degraded', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])
      const resolve = mediaResolverService.resolve.getMockImplementation()
      mediaResolverService.resolve.mockImplementationOnce(async keys => ({
        ...(await resolve!(keys)),
        degradedSources: [DownloadType.Movie],
      }))

      await service.poll()
      expect(downloadGateway.broadcast).not.toHaveBeenCalled()

      await service.poll()
      expect(mediaEvents()).toHaveLength(1)
    })
  })

  describe('completionInputs', () => {
    // Private - `settleAbsentJobs` is its only caller - but its batching is
    // a contract of its own, so it is exercised directly as well as through
    // `poll()` below.
    function completionInputs(
      type: DownloadType.Movie | DownloadType.Show,
      jobs: readonly TrackedJob[],
    ): Promise<Map<string, PollableCompletionData>> {
      return (
        service as unknown as {
          completionInputs: (
            type: DownloadType.Movie | DownloadType.Show,
            jobs: readonly TrackedJob[],
          ) => Promise<Map<string, PollableCompletionData>>
        }
      ).completionInputs(type, jobs)
    }

    // The steady state: every job has a queue entry, so nothing ever reaches
    // the completion check and it must cost exactly nothing.
    it('makes no upstream call at all when handed no jobs', async () => {
      const movies = await completionInputs(DownloadType.Movie, [])
      const shows = await completionInputs(DownloadType.Show, [])

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

      const result = await completionInputs(DownloadType.Movie, [
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

      const result = await completionInputs(DownloadType.Show, [
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

      const result = await completionInputs(DownloadType.Show, jobs)

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
      const result = await completionInputs(DownloadType.Show, [
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

    // One title's failed read must not hold up another's, nor trip the
    // poll's backoff: its jobs are simply left out, and stay as they are.
    it('leaves out only the jobs whose title could not be read', async () => {
      sonarrService.getEpisodeFiles.mockImplementation(async seriesId => {
        if (seriesId === 11) throw new Error('sonarr down')
        return []
      })

      const result = await completionInputs(DownloadType.Show, [
        buildTrackedShowJob(9, { id: 'a' }),
        buildTrackedShowJob(11, { id: 'b' }),
      ])

      expect(result.has('a')).toBe(true)
      expect(result.has('b')).toBe(false)
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'completionInputs',
          error: 'sonarr down',
          upstreamId: 11,
        }),
        expect.any(String),
      )
    })
  })

  describe('settling a job with no queue item', () => {
    const T0 = Date.parse('2026-08-20T13:00:00.000Z')

    // Wall-clock, like the poller's own timer: every tick below reads the
    // clock this controls.
    function at(ms: number): void {
      jest.spyOn(Date, 'now').mockReturnValue(ms)
    }

    function clearBackoff(): void {
      ;(service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt = 0
    }

    function absentSince(): Map<string, number> {
      return (service as unknown as { absentSince: Map<string, number> })
        .absentSince
    }

    const DOWNLOADING_ITEM: QueueResource = {
      movieId: 42,
      size: 1000,
      sizeleft: 500,
      status: 'downloading',
    }

    it('reads no files while every job has a queue item', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([DOWNLOADING_ITEM])

      await service.poll()

      expect(radarrService.getMovieFiles).not.toHaveBeenCalled()
      expect(absentSince().size).toBe(0)
    })

    // The race the grace period exists for: the queue row goes a tick before
    // the file listing shows the import.
    it('completes a job whose file is listed a tick after its item left', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)

      at(T0)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(mediaResolverService.invalidate).not.toHaveBeenCalled()

      at(T0 + 10_000)
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
      ])
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
      expect(downloadStateService.jobs.get(job.id)?.error).toBeUndefined()
      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(job.mediaId)
      expect(absentSince().has(job.id)).toBe(false)
    })

    it('fails a job whose item left over a minute ago with no file', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])

      at(T0)
      await service.poll()
      at(T0 + 59_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )

      at(T0 + 61_000)
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Failed)
      expect(updated?.error).toBe('Left the queue without producing a file')
      expect(getJobById(dbService.db, job.id)?.error).toBe(
        'Left the queue without producing a file',
      )
      expect(mediaResolverService.invalidate).not.toHaveBeenCalled()
      expect(absentSince().has(job.id)).toBe(false)
    })

    it('fails an importing show job the same way', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 3 },
        status: DownloadJobStatus.Importing,
      })
      downloadStateService.jobs.set(job.id, job)
      sonarrService.getQueue.mockResolvedValue([])

      at(T0)
      await service.poll()
      at(T0 + 61_000)
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Failed)
      expect(updated?.error).toBe('Left the queue without producing a file')
    })

    it('restarts the grace period when the item comes back', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)

      at(T0)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()
      expect(absentSince().get(job.id)).toBe(T0)

      at(T0 + 30_000)
      radarrService.getQueue.mockResolvedValue([DOWNLOADING_ITEM])
      await service.poll()
      expect(absentSince().has(job.id)).toBe(false)

      at(T0 + 50_000)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()

      // 70s after it first went, but only 20s since it last went.
      at(T0 + 70_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(absentSince().get(job.id)).toBe(T0 + 50_000)
    })

    // Wall-clock, not tick-count: polls that fail in between still count.
    it('keeps the grace timer running through a failed poll', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])

      at(T0)
      await service.poll()

      at(T0 + 20_000)
      radarrService.getQueue.mockRejectedValueOnce(new Error('radarr down'))
      await service.poll()
      expect(absentSince().get(job.id)).toBe(T0)

      clearBackoff()
      at(T0 + 61_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Failed,
      )
    })

    // Without the listing there is no telling a finished import from a
    // dropped download, so a failed read decides nothing - even past the
    // grace period - and never backs the poll off.
    it('leaves a job unchanged when its files cannot be read', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])

      at(T0)
      await service.poll()

      at(T0 + 61_000)
      radarrService.getMovieFiles.mockRejectedValueOnce(
        new Error('radarr down'),
      )
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)

      // Readable again, and still nothing landed: now it fails.
      at(T0 + 71_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Failed,
      )
    })

    // The wedge this whole check exists for: a small usenet grab can go
    // grabbed -> imported entirely between two ticks.
    it('completes a searching job whose whole download ran between ticks', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    // A file from before the job is the library's old copy, not this
    // attempt's result.
    it('leaves a searching job searching when its only file is older than it', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: BEFORE_ISO, id: 501, movieId: 42 },
      ])

      at(T0)
      await service.poll()
      at(T0 + 120_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Searching,
      )
    })

    // A blocked import that vanished without a file is a human's call -
    // they may still import it by hand - so it waits; with a file, it's done.
    it('never fails a needs-attention job, and completes it once a file lands', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.NeedsAttention })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])

      at(T0)
      await service.poll()
      at(T0 + 120_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.NeedsAttention,
      )

      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
      ])
      at(T0 + 130_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    describe('a show job completes only once its own scope lands', () => {
      const EPISODES: EpisodeResource[] = [
        { episodeFileId: 0, id: 1, seasonNumber: 3, seriesId: 9 },
        { episodeFileId: 0, id: 2, seasonNumber: 3, seriesId: 9 },
        { episodeFileId: 0, id: 3, seasonNumber: 4, seriesId: 9 },
      ]

      function landed(...episodeIds: number[]): void {
        sonarrService.getEpisodes.mockResolvedValue(
          EPISODES.map(episode =>
            episodeIds.includes(episode.id as number)
              ? { ...episode, episodeFileId: 900 + (episode.id as number) }
              : episode,
          ),
        )
        sonarrService.getEpisodeFiles.mockResolvedValue(
          episodeIds.map(id => ({
            dateAdded: AFTER_ISO,
            id: 900 + id,
            seasonNumber: EPISODES.find(e => e.id === id)?.seasonNumber,
            seriesId: 9,
          })),
        )
      }

      beforeEach(() => {
        sonarrService.getQueue.mockResolvedValue([])
      })

      it('an episode job, on its own episode', async () => {
        const job = buildShowJob({
          scope: { episodeId: 2, seasonNumber: 3 },
          status: DownloadJobStatus.Downloading,
        })
        downloadStateService.jobs.set(job.id, job)

        landed(1, 3)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Downloading,
        )

        landed(2)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Completed,
        )
      })

      // One new file in its season is enough - how much of the season is
      // on disk is the media's state, not the attempt's - but a file from
      // another season is not.
      it('a season job, on any new file in its season', async () => {
        const job = buildShowJob({
          scope: { seasonNumber: 3 },
          status: DownloadJobStatus.Downloading,
        })
        downloadStateService.jobs.set(job.id, job)

        landed(3)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Downloading,
        )

        landed(1, 3)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Completed,
        )
      })

      it('reads a series once for all of its settling jobs', async () => {
        const episodeJob = buildShowJob({
          id: 'show-episode',
          scope: { episodeId: 3, seasonNumber: 4 },
          status: DownloadJobStatus.Downloading,
        })
        const seasonJob = buildShowJob({
          id: 'show-season',
          scope: { seasonNumber: 3 },
          status: DownloadJobStatus.Downloading,
        })
        downloadStateService.jobs.set(episodeJob.id, episodeJob)
        downloadStateService.jobs.set(seasonJob.id, seasonJob)

        landed(3)
        await service.poll()

        expect(sonarrService.getEpisodeFiles).toHaveBeenCalledTimes(1)
        expect(downloadStateService.jobs.get(episodeJob.id)?.status).toBe(
          DownloadJobStatus.Completed,
        )
        expect(downloadStateService.jobs.get(seasonJob.id)?.status).toBe(
          DownloadJobStatus.Downloading,
        )
      })
    })

    // Removed from Radarr's/Sonarr's own queue: the history of the job's own
    // download settles it, without waiting out the grace period.
    describe('reading what became of a download that left the queue', () => {
      const QUEUED_ITEM: QueueResource = {
        ...DOWNLOADING_ITEM,
        downloadId: 'dl-1',
      }
      const GRABBED = { downloadId: 'dl-1', eventType: 'grabbed' } as const

      async function queuedThenGone(
        status = DownloadJobStatus.Downloading,
      ): Promise<DownloadJobRecord> {
        const job = buildMovieJob({ status })
        downloadStateService.jobs.set(job.id, job)

        at(T0)
        radarrService.getQueue.mockResolvedValue([
          status === DownloadJobStatus.NeedsAttention
            ? { ...QUEUED_ITEM, trackedDownloadState: 'importPending' }
            : QUEUED_ITEM,
        ])
        await service.poll()

        at(T0 + 10_000)
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()
        return job
      }

      it('cancels a job whose download was removed in Radarr, on the next read', async () => {
        radarrService.getMovieHistory.mockResolvedValue([GRABBED])
        const job = await queuedThenGone()

        // One read without it is not enough to call it.
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Downloading,
        )

        at(T0 + 20_000)
        await service.poll()

        const updated = downloadStateService.jobs.get(job.id)
        expect(radarrService.getMovieHistory).toHaveBeenCalledWith(42)
        expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
        expect(updated?.error).toBe("Removed from Radarr's queue")
        expect(getJobById(dbService.db, job.id)?.error).toBe(
          "Removed from Radarr's queue",
        )
      })

      it("fails a job the download client failed, with the client's reason", async () => {
        radarrService.getMovieHistory.mockResolvedValue([
          GRABBED,
          {
            data: { message: 'Repair failed, not enough repair blocks' },
            downloadId: 'dl-1',
            eventType: 'downloadFailed',
          },
        ])
        const job = await queuedThenGone()

        at(T0 + 20_000)
        await service.poll()

        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.status).toBe(DownloadJobStatus.Failed)
        expect(updated?.error).toBe('Repair failed, not enough repair blocks')
      })

      it('keeps waiting on a job whose import is recorded but not yet listed', async () => {
        radarrService.getMovieHistory.mockResolvedValue([
          GRABBED,
          { downloadId: 'dl-1', eventType: 'downloadFolderImported' },
        ])
        const job = await queuedThenGone()

        at(T0 + 20_000)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Downloading,
        )

        radarrService.getMovieFiles.mockResolvedValue([
          { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
        ])
        at(T0 + 30_000)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Completed,
        )
      })

      it('cancels a needs-attention job someone gave up on in Radarr', async () => {
        radarrService.getMovieHistory.mockResolvedValue([GRABBED])
        const job = await queuedThenGone(DownloadJobStatus.NeedsAttention)

        at(T0 + 20_000)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelled,
        )
      })

      it("cancels a show job from Sonarr's history", async () => {
        const job = buildShowJob({ status: DownloadJobStatus.Downloading })
        downloadStateService.jobs.set(job.id, job)
        sonarrService.getSeriesHistory.mockResolvedValue([GRABBED])

        at(T0)
        sonarrService.getQueue.mockResolvedValue([
          { downloadId: 'dl-1', seriesId: 9, status: 'downloading' },
        ])
        await service.poll()
        sonarrService.getQueue.mockResolvedValue([])
        at(T0 + 10_000)
        await service.poll()
        at(T0 + 20_000)
        await service.poll()

        const updated = downloadStateService.jobs.get(job.id)
        expect(sonarrService.getSeriesHistory).toHaveBeenCalledWith(9)
        expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
        expect(updated?.error).toBe("Removed from Sonarr's queue")
      })

      // No download id to look for: nothing in the history is the job's.
      it('reads no history for a job whose downloads it never saw', async () => {
        const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
        downloadStateService.jobs.set(job.id, job)
        radarrService.getQueue.mockResolvedValue([])

        at(T0)
        await service.poll()
        at(T0 + 20_000)
        await service.poll()

        expect(radarrService.getMovieHistory).not.toHaveBeenCalled()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Downloading,
        )
      })

      it('falls back to the grace period when the history cannot be read', async () => {
        radarrService.getMovieHistory.mockRejectedValue(
          new Error('radarr down'),
        )
        const job = await queuedThenGone()

        at(T0 + 20_000)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Downloading,
        )

        at(T0 + 71_000)
        await service.poll()
        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.status).toBe(DownloadJobStatus.Failed)
        expect(updated?.error).toBe('Left the queue without producing a file')
      })
    })

    // Cancel pressed here: the action removed the queue items and wrote
    // `cancelling`, and the poller carries the job the rest of the way.
    describe('carrying a cancelling job to its end', () => {
      /** A release a search still running at the press grabbed afterwards. */
      const LATE_GRAB: QueueResource = {
        ...DOWNLOADING_ITEM,
        downloadId: 'dl-late',
        id: 7001,
      }

      function cancellingMovie(
        overrides: Partial<DownloadJobRecord> = {},
      ): DownloadJobRecord {
        const job = buildMovieJob({
          status: DownloadJobStatus.Cancelling,
          ...overrides,
        })
        downloadStateService.jobs.set(job.id, job)
        return job
      }

      it('removes a late grab instead of following it', async () => {
        const job = cancellingMovie()

        at(T0)
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()

        at(T0 + 10_000)
        radarrService.getQueue.mockResolvedValue([LATE_GRAB])
        await service.poll()

        expect(radarrService.removeQueueItem).toHaveBeenCalledTimes(1)
        expect(radarrService.removeQueueItem).toHaveBeenCalledWith(7001)
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )
        expect(getJobById(dbService.db, job.id)).toBeUndefined()
      })

      it("never removes a sibling episode's download", async () => {
        const job = buildShowJob({
          scope: { episodeId: 2, seasonNumber: 3 },
          status: DownloadJobStatus.Cancelling,
        })
        downloadStateService.jobs.set(job.id, job)

        const sibling: SonarrQueueResource = {
          episodeId: 1,
          id: 8001,
          seasonNumber: 3,
          seriesId: 9,
          status: 'downloading',
        }
        sonarrService.getQueue.mockResolvedValue([sibling])
        await service.poll()

        expect(sonarrService.removeQueueItem).not.toHaveBeenCalled()

        sonarrService.getQueue.mockResolvedValue([
          sibling,
          { ...sibling, episodeId: 2, id: 8002 },
        ])
        await service.poll()

        expect(sonarrService.removeQueueItem).toHaveBeenCalledTimes(1)
        expect(sonarrService.removeQueueItem).toHaveBeenCalledWith(8002)
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )
      })

      it('logs a refused removal and finishes the tick without backing off', async () => {
        const job = cancellingMovie()
        radarrService.removeQueueItem.mockRejectedValue(
          new Error('radarr said no'),
        )
        radarrService.getQueue.mockResolvedValue([LATE_GRAB])

        await expect(service.poll()).resolves.toBeUndefined()

        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )
        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'removeLateGrab',
            error: 'radarr said no',
            jobId: job.id,
            queueId: 7001,
          }),
          expect.any(String),
        )
        expect(
          (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
        ).toBe(0)
      })

      it('skips an item with no id', async () => {
        const job = cancellingMovie()
        radarrService.getQueue.mockResolvedValue([
          { ...LATE_GRAB, id: undefined },
        ])

        await service.poll()

        expect(radarrService.removeQueueItem).not.toHaveBeenCalled()
        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'removeLateGrab',
            jobId: job.id,
          }),
          expect.any(String),
        )
      })

      // The cancel was the user's own press, so the job carries none of
      // "Removed from Radarr's queue" - nor whatever it said before.
      it('cancels with no error once the history confirms the removal', async () => {
        const job = cancellingMovie({ error: BLOCKED_IMPORT_REASON })
        radarrService.getMovieHistory.mockResolvedValue([
          { downloadId: 'dl-late', eventType: 'grabbed' },
        ])

        at(T0)
        radarrService.getQueue.mockResolvedValue([LATE_GRAB])
        await service.poll()

        at(T0 + 1_000)
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()
        at(T0 + 1_000 + QUEUE_REMOVAL_CONFIRM_MS - 1)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )

        at(T0 + 1_000 + QUEUE_REMOVAL_CONFIRM_MS)
        await service.poll()

        const updated = downloadStateService.jobs.get(job.id)
        expect(radarrService.getMovieHistory).toHaveBeenCalledWith(42)
        expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
        expect(updated?.error).toBeUndefined()
        expect(getJobById(dbService.db, job.id)?.status).toBe(
          DownloadJobStatus.Cancelled,
        )
        expect(getJobById(dbService.db, job.id)?.error).toBeNull()
      })

      it('cancels a show job with no error once the history confirms the removal', async () => {
        const job = buildShowJob({ status: DownloadJobStatus.Cancelling })
        downloadStateService.jobs.set(job.id, job)
        sonarrService.getSeriesHistory.mockResolvedValue([
          { downloadId: 'dl-1', eventType: 'grabbed' },
        ])

        at(T0)
        sonarrService.getQueue.mockResolvedValue([
          { downloadId: 'dl-1', id: 8001, seriesId: 9, status: 'downloading' },
        ])
        await service.poll()
        expect(sonarrService.removeQueueItem).toHaveBeenCalledWith(8001)

        sonarrService.getQueue.mockResolvedValue([])
        at(T0 + 10_000)
        await service.poll()
        at(T0 + 20_000)
        await service.poll()

        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
        expect(updated?.error).toBeUndefined()
        expect(getJobById(dbService.db, job.id)?.error).toBeNull()
      })

      it('cancels at the grace period when nothing says what became of it', async () => {
        const job = cancellingMovie()
        radarrService.getQueue.mockResolvedValue([])

        at(T0)
        await service.poll()
        at(T0 + CANCEL_GRACE_MS - 1)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )

        at(T0 + CANCEL_GRACE_MS)
        await service.poll()

        const updated = downloadStateService.jobs.get(job.id)
        expect(radarrService.getMovieHistory).not.toHaveBeenCalled()
        expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
        expect(updated?.error).toBeUndefined()
        expect(getJobById(dbService.db, job.id)?.error).toBeNull()
      })

      // Removing a late grab must not restart the clock, or a search that
      // keeps grabbing would hold the job in `cancelling` forever.
      it('times the grace period from the first absence across a late grab', async () => {
        const job = cancellingMovie()

        at(T0)
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()

        // No download id, so no history can confirm it: only the clock can.
        at(T0 + 10_000)
        radarrService.getQueue.mockResolvedValue([
          { ...LATE_GRAB, downloadId: undefined },
        ])
        await service.poll()
        expect(radarrService.removeQueueItem).toHaveBeenCalledWith(7001)
        expect(absentSince().get(job.id)).toBe(T0)

        at(T0 + 20_000)
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )

        at(T0 + CANCEL_GRACE_MS)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelled,
        )
      })

      it('completes a cancelling job whose file landed anyway', async () => {
        const job = cancellingMovie()
        radarrService.getQueue.mockResolvedValue([])
        radarrService.getMovieFiles.mockResolvedValue([
          { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
        ])

        await service.poll()

        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.status).toBe(DownloadJobStatus.Completed)
        expect(updated?.error).toBeUndefined()
      })
    })

    // Cancelled while its listing was in flight: the cancel stands.
    it('does not move a job that settled while its files were being read', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockImplementation(async () => {
        downloadStateService.jobs.set(job.id, {
          ...job,
          status: DownloadJobStatus.Cancelled,
        })
        return [{ dateAdded: AFTER_ISO, id: 501, movieId: 42 }]
      })

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Cancelled,
      )
      expect(mediaResolverService.invalidate).not.toHaveBeenCalled()
    })

    it('forgets the timer of a job that stops being tracked', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])

      await service.poll()
      expect(absentSince().has(job.id)).toBe(true)

      downloadStateService.jobs.set(job.id, {
        ...job,
        status: DownloadJobStatus.Cancelled,
      })
      await service.poll()

      expect(absentSince().has(job.id)).toBe(false)
    })
  })

  // A grab made in Radarr's/Sonarr's own UI, by their RSS sync, or by a
  // search this app did not send: no job covers it until the poller mints
  // one.
  describe('adopting downloads started upstream', () => {
    const T0 = Date.parse('2026-08-20T13:00:00.000Z')

    const UPSTREAM_GRAB: QueueResource = {
      downloadId: 'dl-up',
      id: 7001,
      movieId: 42,
      size: 1000,
      sizeleft: 500,
      status: 'downloading',
    }

    /** Season 2 of Sonarr series 9, three episodes, none with a file yet. */
    const SEASON_2: EpisodeResource[] = [21, 22, 23].map((id, index) => ({
      episodeNumber: index + 1,
      hasFile: false,
      id,
      monitored: true,
      seasonNumber: 2,
      seriesId: 9,
    }))

    function episodeItem(episodeId: number): SonarrQueueResource {
      return {
        downloadId: 'dl-pack',
        episodeId,
        id: 8000 + episodeId,
        seasonNumber: 2,
        seriesId: 9,
        size: 1000,
        sizeleft: 500,
        status: 'downloading',
      }
    }

    // What upstream's library holds, by media id: the same titles the
    // default resolve maps to Radarr 42 / Sonarr 9, so an adopted job
    // resolves - and is tracked - on the next tick.
    let library: Map<string, Movie | Show>
    let addJob: jest.SpyInstance

    function at(ms: number): void {
      jest.spyOn(Date, 'now').mockReturnValue(ms)
    }

    function adoptedJobs(): DownloadJobRecord[] {
      return Array.from(downloadStateService.jobs.values()).filter(
        record => record.startedUpstream,
      )
    }

    beforeEach(() => {
      // Distinct ids, so a second mint shows up as a second job rather than
      // overwriting the first in the Map.
      let minted = 0
      jest.mocked(nanoid).mockImplementation(() => `adopted-${++minted}`)

      library = new Map<string, Movie | Show>([
        [
          'tmdb:1',
          {
            id: 'tmdb:1',
            monitored: true,
            radarrId: 42,
            title: 'A Movie',
            tmdbId: 1,
            type: DownloadType.Movie,
          },
        ],
        [
          'tvdb:1',
          {
            id: 'tvdb:1',
            monitored: true,
            sonarrId: 9,
            title: 'A Show',
            tvdbId: 1,
            type: DownloadType.Show,
          },
        ],
      ])

      mediaResolverService.getMovieLibrary.mockImplementation(
        async () =>
          new Map(
            Array.from(library.values())
              .filter(isMovie)
              .map(movie => [movie.tmdbId, movie]),
          ),
      )
      mediaResolverService.getShowLibrary.mockImplementation(
        async () =>
          new Map(
            Array.from(library.values())
              .filter(isShow)
              .map(show => [show.tvdbId, show]),
          ),
      )

      // The library copy of a title that resolves at all, so a file on it
      // reaches the adoption's upgrade check.
      const byUpstreamIds = mediaResolverService.resolve.getMockImplementation()
      mediaResolverService.resolve.mockImplementation(async keys => {
        const result = await byUpstreamIds!(keys)
        for (const { mediaId } of keys) {
          const entry = library.get(mediaId)
          if (entry && upstreamIds.has(mediaId)) {
            result.media.set(mediaId, { ...entry })
          }
        }
        mediaStateService.annotate(result.media.values())
        return result
      })

      sonarrService.getEpisodes.mockResolvedValue(SEASON_2)
      addJob = jest.spyOn(downloadStateService, 'addJob')
    })

    afterEach(() => {
      jest.mocked(nanoid).mockImplementation(() => 'mock-id')
    })

    it('adopts a movie download no job covers, and tracks it from the next tick', async () => {
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

      await service.poll()

      expect(addJob).toHaveBeenCalledTimes(1)
      const [job] = adoptedJobs()
      expect(job).toMatchObject({
        discordRequester: null,
        hiddenAttribution: false,
        mediaId: 'tmdb:1',
        requester: null,
        startedUpstream: true,
        status: DownloadJobStatus.Downloading,
        type: DownloadType.Movie,
      })
      expect(job).not.toHaveProperty('scope')
      expect(getJobById(dbService.db, job!.id)?.origin).toBe('upstream')
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'adoptUnownedDownloads',
          downloadId: 'dl-up',
          jobId: job!.id,
          mediaId: 'tmdb:1',
          status: DownloadJobStatus.Downloading,
        }),
        'Adopted a download started upstream',
      )
      const [created] = await jobFrames()
      expect(created).toMatchObject({
        job: { id: job!.id },
        type: DownloadJobEventType.Created,
      })

      radarrService.getQueue.mockResolvedValue([
        { ...UPSTREAM_GRAB, sizeleft: 0, status: 'completed' },
      ])
      await service.poll()

      expect(addJob).toHaveBeenCalledTimes(1)
      expect(downloadStateService.jobs.get(job!.id)?.status).toBe(
        DownloadJobStatus.Importing,
      )
    })

    it('leaves an upgrade of a movie that has its file alone', async () => {
      library.set('tmdb:1', {
        ...(library.get('tmdb:1') as Movie),
        filePath: '/movies/A Movie (2020)/a-movie.mkv',
      })
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

      await service.poll()
      await service.poll()

      expect(addJob).not.toHaveBeenCalled()
    })

    it('leaves a download a request made here already covers', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

      await service.poll()

      expect(addJob).not.toHaveBeenCalled()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
    })

    // `trackedJobs` drops it this tick, but it still owns its media id.
    it('lets a job whose title did not resolve still own its download', async () => {
      upstreamIds.delete('tmdb:1')
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([
        { ...UPSTREAM_GRAB, downloadId: undefined },
      ])

      await service.poll()

      expect(mediaResolverService.getMovieLibrary).toHaveBeenCalled()
      expect(addJob).not.toHaveBeenCalled()
    })

    it("never adopts a cancelling job's late grab, but adopts one after it is cancelled", async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Cancelling })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

      await service.poll()

      expect(radarrService.removeQueueItem).toHaveBeenCalledWith(7001)
      expect(addJob).not.toHaveBeenCalled()

      downloadStateService.jobs.set(job.id, {
        ...job,
        status: DownloadJobStatus.Cancelled,
      })
      radarrService.getQueue.mockResolvedValue([
        { ...UPSTREAM_GRAB, downloadId: 'dl-later', id: 7002 },
      ])
      await service.poll()

      expect(addJob).toHaveBeenCalledTimes(1)
      expect(adoptedJobs()).toHaveLength(1)
    })

    it('adopts a Sonarr season pack as one season-scoped job', async () => {
      sonarrService.getQueue.mockResolvedValue([
        episodeItem(21),
        episodeItem(22),
        episodeItem(23),
      ])

      await service.poll()

      expect(addJob).toHaveBeenCalledTimes(1)
      expect(sonarrService.getEpisodes).toHaveBeenCalledWith(9)
      const [job] = adoptedJobs()
      expect(job).toMatchObject({
        mediaId: 'tvdb:1',
        scope: { seasonNumber: 2 },
        startedUpstream: true,
        status: DownloadJobStatus.Downloading,
        type: DownloadType.Show,
      })

      await service.poll()
      expect(addJob).toHaveBeenCalledTimes(1)
    })

    it('adopts one episode with its episode number filled in', async () => {
      sonarrService.getQueue.mockResolvedValue([
        { ...episodeItem(22), downloadId: 'dl-ep' },
      ])

      await service.poll()

      expect(adoptedJobs()).toEqual([
        expect.objectContaining({
          scope: { episodeId: 22, episodeNumber: 2, seasonNumber: 2 },
        }),
      ])

      await service.poll()
      expect(addJob).toHaveBeenCalledTimes(1)
    })

    it('leaves a show download whose episodes all have their files alone', async () => {
      sonarrService.getEpisodes.mockResolvedValue(
        SEASON_2.map(episode => ({ ...episode, hasFile: true })),
      )
      sonarrService.getQueue.mockResolvedValue([
        episodeItem(21),
        episodeItem(22),
      ])

      await service.poll()

      expect(addJob).not.toHaveBeenCalled()
    })

    // The cron has no overlap guard: the second tick starts while the first
    // is still reading the library, and both plan the same download.
    it('mints one job when two ticks overlap', async () => {
      let release!: () => void
      const gate = new Promise<void>(resolve => {
        release = resolve
      })
      const readLibrary =
        mediaResolverService.getMovieLibrary.getMockImplementation()!
      mediaResolverService.getMovieLibrary.mockImplementation(async () => {
        await gate
        return readLibrary()
      })
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

      const ticks = Promise.all([service.poll(), service.poll()])
      await flushAsync()
      expect(mediaResolverService.getMovieLibrary).toHaveBeenCalledTimes(2)
      release()
      await ticks

      expect(addJob).toHaveBeenCalledTimes(1)
      expect(adoptedJobs()).toHaveLength(1)
    })

    // Reloaded from its row at boot by `adoptOpenJobs`.
    it('adopts nothing more for a download adopted before a restart', async () => {
      const job = buildMovieJob({
        id: 'adopted-before',
        startedUpstream: true,
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

      await service.poll()
      await service.poll()

      expect(addJob).not.toHaveBeenCalled()
      expect(downloadStateService.jobs.size).toBe(1)
    })

    it('never adopts a failed download, tick after tick', async () => {
      radarrService.getQueue.mockResolvedValue([
        { ...UPSTREAM_GRAB, status: 'failed' },
      ])

      await service.poll()
      await service.poll()
      await service.poll()

      expect(addJob).not.toHaveBeenCalled()
    })

    it('waits a tick, without backing off, when the episodes cannot be read', async () => {
      sonarrService.getEpisodes.mockRejectedValueOnce(new Error('sonarr down'))
      sonarrService.getQueue.mockResolvedValue([episodeItem(21)])

      await expect(service.poll()).resolves.toBeUndefined()

      expect(addJob).not.toHaveBeenCalled()
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'adoptableShows',
          error: 'sonarr down',
          seriesId: 9,
        }),
        expect.any(String),
      )
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)

      await service.poll()

      expect(addJob).toHaveBeenCalledTimes(1)
      expect(adoptedJobs()).toEqual([
        expect.objectContaining({
          scope: { episodeId: 21, episodeNumber: 1, seasonNumber: 2 },
        }),
      ])
    })

    // Nobody here pressed cancel, so it carries the upstream sentence.
    it('settles an adopted job removed in Radarr like any other', async () => {
      radarrService.getMovieHistory.mockResolvedValue([
        { downloadId: 'dl-up', eventType: 'grabbed' },
      ])

      at(T0)
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])
      await service.poll()
      const [job] = adoptedJobs()

      at(T0 + 10_000)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()
      expect(downloadStateService.jobs.get(job!.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )

      at(T0 + 20_000)
      await service.poll()

      const updated = downloadStateService.jobs.get(job!.id)
      expect(radarrService.getMovieHistory).toHaveBeenCalledWith(42)
      expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
      expect(updated?.error).toBe("Removed from Radarr's queue")
      expect(addJob).toHaveBeenCalledTimes(1)
    })
  })
})
