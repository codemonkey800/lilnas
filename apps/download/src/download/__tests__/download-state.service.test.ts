// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadStateService, since Phase 5's ensureVideo()) must mock it first
// (see media/__tests__/download.controller.media.test.ts for the same
// pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJobEvent,
  DownloadJobEventType,
  DownloadJobStatus,
  DownloadType,
  MovieDownloadJob,
  ShowDownloadJob,
  VideoDownloadJob,
} from '@lilnas/utils/download/types'
import { Test, TestingModule } from '@nestjs/testing'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { eq } from 'drizzle-orm'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { jobs, videos } from 'src/db/schema'
import { DownloadStateService } from 'src/download/download-state.service'
import {
  DownloadGateway,
  DownloadGatewayMessage,
} from 'src/download-gateway/download.gateway'

function buildVideoJob(
  overrides: Partial<VideoDownloadJob> = {},
): VideoDownloadJob {
  return {
    id: 'video-1',
    status: DownloadJobStatus.Pending,
    type: DownloadType.Video,
    url: 'https://example.com/video',
    ...overrides,
  }
}

function buildMovieJob(
  overrides: Partial<MovieDownloadJob> = {},
): MovieDownloadJob {
  return {
    id: 'movie-1',
    status: DownloadJobStatus.Requested,
    type: DownloadType.Movie,
    url: 'radarr://tmdb/1',
    ...overrides,
  }
}

function buildShowJob(
  overrides: Partial<ShowDownloadJob> = {},
): ShowDownloadJob {
  return {
    id: 'show-1',
    status: DownloadJobStatus.Requested,
    type: DownloadType.Show,
    url: 'sonarr://tvdb/1',
    ...overrides,
  }
}

type BroadcastBuild = (isAdmin: boolean) => DownloadGatewayMessage

describe('DownloadStateService', () => {
  let service: DownloadStateService
  let dbService: DbService
  let downloadGateway: jest.Mocked<DownloadGateway>

  // `mock.calls[n]` is `[BroadcastBuild] | undefined` under
  // noUncheckedIndexedAccess - this centralizes the "was it actually
  // called" assertion so every caller gets a real build function (and a
  // clear failure) instead of juggling the possibly-undefined tuple at each
  // call site.
  function firstBroadcastBuild(): BroadcastBuild {
    const call = downloadGateway.broadcastPerViewer.mock.calls[0]
    if (!call) {
      throw new Error(
        'Expected DownloadGateway.broadcastPerViewer to have been called',
      )
    }
    return call[0]
  }

  function readRow(id: string) {
    return dbService.db.select().from(jobs).where(eq(jobs.id, id)).all()[0]
  }

  beforeEach(async () => {
    dbService = createTestDbService()
    const mockDownloadGateway = { broadcastPerViewer: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        { provide: DownloadGateway, useValue: mockDownloadGateway },
      ],
    }).compile()

    service = module.get(DownloadStateService)
    downloadGateway = module.get(DownloadGateway)
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  describe('addJob', () => {
    it('inserts the job into the map', () => {
      const job = buildMovieJob()

      service.addJob(job)

      expect(service.jobs.get(job.id)).toEqual(job)
    })

    it('broadcasts a "created" event carrying the job', () => {
      const job = buildMovieJob()

      service.addJob(job)

      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(1)
      const build = firstBroadcastBuild()
      // Movie jobs are always attributed - the non-admin and admin variants
      // are identical.
      expect(build(false)).toEqual({
        data: { job, type: DownloadJobEventType.Created },
        type: DOWNLOAD_JOB_EVENT_TYPE,
      })
      expect(build(true)).toEqual({
        data: { job, type: DownloadJobEventType.Created },
        type: DOWNLOAD_JOB_EVENT_TYPE,
      })
    })

    it('writes a durable row', () => {
      const job = buildMovieJob({
        mediaTitle: 'A Movie',
        radarrId: 42,
        requester: { email: 'alice@example.com', userId: 'user_1' },
      })

      service.addJob(job)

      const row = readRow(job.id)
      expect(row).toMatchObject({
        id: 'movie-1',
        mediaTitle: 'A Movie',
        origin: 'web',
        radarrId: 42,
        requesterEmail: 'alice@example.com',
        requesterUserId: 'user_1',
        status: DownloadJobStatus.Requested,
        type: DownloadType.Movie,
      })
    })

    it('writes origin "service" and null requester fields for a job with no requester', () => {
      const job = buildVideoJob()

      service.addJob(job)

      const row = readRow(job.id)
      expect(row).toMatchObject({
        origin: 'service',
        requesterEmail: null,
        requesterUserId: null,
      })
    })

    it('writes show-only columns for a show job, leaving movie-only columns null', () => {
      const job = buildShowJob({
        mediaTitle: 'A Show',
        overview: 'a show overview',
        sonarrId: 9,
      })

      service.addJob(job)

      expect(readRow(job.id)).toMatchObject({
        mediaTitle: 'A Show',
        overview: 'a show overview',
        radarrId: null,
        sonarrId: 9,
        type: DownloadType.Show,
      })
    })

    it('writes video-only columns for a video job, leaving media-only columns null', () => {
      const job = buildVideoJob({
        downloadUrls: ['https://example.com/a.mp4'],
        hiddenAttribution: true,
        timeRange: { start: '00:00:00', end: '00:01:00' },
      })

      service.addJob(job)

      expect(readRow(job.id)).toMatchObject({
        downloadUrls: ['https://example.com/a.mp4'],
        hiddenAttribution: true,
        mediaTitle: null,
        radarrId: null,
        sonarrId: null,
        timeRange: { start: '00:00:00', end: '00:01:00' },
        type: DownloadType.Video,
      })
    })

    it('propagates a persistence failure instead of silently continuing', () => {
      const job = buildMovieJob()
      jest.spyOn(dbService.db, 'insert').mockImplementation(() => {
        throw new Error('disk full')
      })

      expect(() => service.addJob(job)).toThrow('disk full')
      // A failed persist must not still broadcast as if it had succeeded.
      expect(downloadGateway.broadcastPerViewer).not.toHaveBeenCalled()
      // Nor leave a phantom entry in the Map with no backing row.
      expect(service.jobs.has(job.id)).toBe(false)
    })
  })

  describe('updateJob', () => {
    it('throws and does not broadcast when the job does not exist', () => {
      expect(() =>
        service.updateJob('missing', { status: DownloadJobStatus.Completed }),
      ).toThrow("Job with ID 'missing' not found")

      expect(downloadGateway.broadcastPerViewer).not.toHaveBeenCalled()
    })

    it('merges updates, stores the result, and broadcasts an "updated" event', () => {
      const job = buildMovieJob()
      service.addJob(job) // seeds the map; also broadcasts once (Created)
      downloadGateway.broadcastPerViewer.mockClear()

      const updated = service.updateJob(job.id, {
        status: DownloadJobStatus.Searching,
      })

      expect(updated.status).toBe(DownloadJobStatus.Searching)
      expect(service.jobs.get(job.id)).toEqual(updated)
      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(1)
      const build = firstBroadcastBuild()
      expect(build(false)).toEqual({
        data: { job: updated, type: DownloadJobEventType.Updated },
        type: DOWNLOAD_JOB_EVENT_TYPE,
      })
    })

    it('writes the updated row', () => {
      const job = buildMovieJob()
      service.addJob(job)

      service.updateJob(job.id, {
        mediaTitle: 'Updated Title',
        status: DownloadJobStatus.Searching,
      })

      const row = readRow(job.id)
      expect(row).toMatchObject({
        mediaTitle: 'Updated Title',
        status: DownloadJobStatus.Searching,
      })
    })

    it('stamps completedAt when the status transitions to Completed', () => {
      const job = buildVideoJob()
      service.addJob(job)
      expect(readRow(job.id)?.completedAt).toBeNull()

      service.updateJob(job.id, { status: DownloadJobStatus.Completed })

      expect(readRow(job.id)?.completedAt).toBeInstanceOf(Date)
    })

    it('upserts a row for a job that was seeded directly into the map, bypassing addJob()', () => {
      // Mirrors media/__tests__'s pattern of seeding
      // `downloadStateService.jobs.set(...)` directly rather than going
      // through addJob() - no row exists for this job yet.
      const job = buildMovieJob()
      service.jobs.set(job.id, job)
      expect(readRow(job.id)).toBeUndefined()

      expect(() =>
        service.updateJob(job.id, { status: DownloadJobStatus.Searching }),
      ).not.toThrow()

      expect(readRow(job.id)).toMatchObject({
        id: job.id,
        status: DownloadJobStatus.Searching,
      })
    })

    it('swallows a persistence failure and still updates in-memory state and broadcasts', () => {
      const job = buildMovieJob()
      service.addJob(job)
      jest.spyOn(dbService.db, 'insert').mockImplementation(() => {
        throw new Error('disk full')
      })

      const updated = service.updateJob(job.id, {
        status: DownloadJobStatus.Searching,
      })

      expect(updated.status).toBe(DownloadJobStatus.Searching)
      expect(service.jobs.get(job.id)).toEqual(updated)
      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalled()
    })

    it('never carries a process handle in a broadcast payload, since proc lives in the procs side map', () => {
      const job = buildVideoJob()
      service.addJob(job)

      // A real ChildProcess has circular internal references (sockets,
      // streams, etc.) that make JSON.stringify throw - reproduce that
      // shape here rather than a flat mock object, so this test actually
      // proves nothing proc-shaped reaches the payload rather than passing
      // by accident because a flat object happens to stringify fine anyway.
      const fakeProc = {} as unknown as ChildProcessWithoutNullStreams
      ;(fakeProc as unknown as { self: unknown }).self = fakeProc
      service.setProc(job.id, fakeProc)
      downloadGateway.broadcastPerViewer.mockClear()

      const updated = service.updateJob(job.id, {
        status: DownloadJobStatus.Converting,
      })

      // setProc() never touches the job object itself - it was never there
      // to strip.
      expect((updated as VideoDownloadJob).proc).toBeUndefined()
      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(1)
      const build = firstBroadcastBuild()

      for (const isAdmin of [false, true]) {
        const payload = build(isAdmin)
        const event = payload.data as DownloadJobEvent
        const broadcastJob = event.job as VideoDownloadJob

        expect(broadcastJob.proc).toBeUndefined()
        expect(broadcastJob.id).toBe(job.id)
        expect(() => JSON.stringify(payload)).not.toThrow()
      }
    })

    it('clears the tracked process handle once a job reaches a terminal status', () => {
      const job = buildVideoJob()
      service.addJob(job)
      service.setProc(job.id, {} as unknown as ChildProcessWithoutNullStreams)
      expect(service.getProc(job.id)).toBeDefined()

      service.updateJob(job.id, { status: DownloadJobStatus.Completed })

      expect(service.getProc(job.id)).toBeUndefined()
    })

    it('leaves the tracked process handle alone across a non-terminal status change', () => {
      const job = buildVideoJob()
      service.addJob(job)
      const fakeProc = {} as unknown as ChildProcessWithoutNullStreams
      service.setProc(job.id, fakeProc)

      service.updateJob(job.id, { status: DownloadJobStatus.Converting })

      expect(service.getProc(job.id)).toBe(fakeProc)
    })

    it('broadcasts movie/show jobs as-is, since they have no proc field to strip', () => {
      const job = buildMovieJob()
      service.addJob(job)
      downloadGateway.broadcastPerViewer.mockClear()

      service.updateJob(job.id, { status: DownloadJobStatus.Downloading })

      const build = firstBroadcastBuild()
      expect(build(false)).toEqual({
        data: {
          job: { ...job, status: DownloadJobStatus.Downloading },
          type: DownloadJobEventType.Updated,
        },
        type: DOWNLOAD_JOB_EVENT_TYPE,
      })
    })

    it('masks a hidden video job requester for a non-admin viewer, and reveals it to an admin - never in the same frame', () => {
      const requesterEmail = 'alice@example.com'
      const job = buildVideoJob({
        hiddenAttribution: true,
        requester: { email: requesterEmail, userId: 'user_1' },
      })
      service.addJob(job)
      downloadGateway.broadcastPerViewer.mockClear()

      service.updateJob(job.id, { status: DownloadJobStatus.Downloading })

      const build = firstBroadcastBuild()
      const nonAdminFrame = JSON.stringify(build(false))
      const adminFrame = JSON.stringify(build(true))

      // The specific leak this phase exists to close: the raw WS frame a
      // non-admin socket receives must never contain the hidden requester's
      // email, even though the job object carries it internally.
      expect(nonAdminFrame).not.toContain(requesterEmail)
      expect(adminFrame).toContain(requesterEmail)
    })
  })

  describe('resolveJob', () => {
    it('returns the live job from the Map without querying the DB', () => {
      const job = buildMovieJob()
      service.addJob(job)
      const selectSpy = jest.spyOn(dbService.db, 'select')

      const resolved = service.resolveJob(job.id)

      expect(resolved).toEqual(job)
      // The Map hit must win outright - a live job carries fields (a video
      // job's `proc` handle, in-flight progress) the row can never
      // reconstruct, so a hit there must never be second-guessed by a DB
      // read.
      expect(selectSpy).not.toHaveBeenCalled()
    })

    it('falls back to the durable row when the Map has no entry (simulating a post-restart lookup)', () => {
      const job = buildMovieJob({ mediaTitle: 'A Movie', radarrId: 7 })
      // Persist without touching the Map, mirroring what a restart leaves
      // behind: a row survives, but the Map starts out empty.
      service.addJob(job)
      service.jobs.delete(job.id)
      expect(service.jobs.has(job.id)).toBe(false)

      const resolved = service.resolveJob(job.id)

      expect(resolved).toMatchObject({
        id: job.id,
        mediaTitle: 'A Movie',
        radarrId: 7,
        type: DownloadType.Movie,
      })
    })

    it('returns undefined when the job exists in neither the Map nor the DB', () => {
      expect(service.resolveJob('missing')).toBeUndefined()
    })
  })

  describe('setProc / getProc / clearProc', () => {
    it('tracks a process handle out-of-band, never touching the job object', () => {
      const job = buildVideoJob()
      service.addJob(job)
      const fakeProc = {} as unknown as ChildProcessWithoutNullStreams

      service.setProc(job.id, fakeProc)

      expect(service.getProc(job.id)).toBe(fakeProc)
      expect(service.jobs.get(job.id)).toEqual(job)
    })

    it('returns undefined for a job with no tracked process', () => {
      expect(service.getProc('missing')).toBeUndefined()
    })

    it('clearProc is a no-op when nothing was tracked', () => {
      expect(() => service.clearProc('missing')).not.toThrow()
    })
  })

  describe('ensureVideo / media id persistence', () => {
    function readVideoRows() {
      return dbService.db.select().from(videos).all()
    }

    it('creates one videos row and a matching jobs.media_id for a new video job', () => {
      const job = buildVideoJob()

      service.addJob(job)

      const rows = readVideoRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ sourceUrl: job.url })
      expect(readRow(job.id)?.mediaId).toBe(`video:${rows[0]?.id}`)
    })

    it('collapses two jobs for the same (url, timeRange) onto one videos row', () => {
      service.addJob(buildVideoJob({ id: 'video-a' }))
      service.addJob(buildVideoJob({ id: 'video-b' }))

      expect(readVideoRows()).toHaveLength(1)
    })

    it('overwrites the placeholder title once the real one is known, without duplicating the row', () => {
      const job = buildVideoJob()
      service.addJob(job)
      expect(readVideoRows()[0]?.title).toBe(job.url)

      service.updateJob(job.id, { title: 'The Real Title' })

      const rows = readVideoRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.title).toBe('The Real Title')
    })

    it("derives jobs.media_id from a movie/show job's legacy synthetic url", () => {
      service.addJob(buildMovieJob({ url: 'radarr://tmdb/438631' }))
      service.addJob(buildShowJob({ url: 'sonarr://tvdb/121361' }))

      expect(readRow('movie-1')?.mediaId).toBe('tmdb:438631')
      expect(readRow('show-1')?.mediaId).toBe('tvdb:121361')
    })
  })
})
