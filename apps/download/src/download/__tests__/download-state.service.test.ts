// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadStateService, since ensureVideo()) must mock it first (see
// media/__tests__/download.controller.media.test.ts for the same pattern).
// Counts up rather than returning a constant: two videos with *different*
// natural keys legitimately need different primary keys, so a fixed id would
// collide on `videos.id` in the clip-vs-full-length case.
jest.mock('nanoid', () => {
  let counter = 0
  return { nanoid: jest.fn(() => `mock-id-${++counter}`) }
})

import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJobEvent,
  DownloadJobEventType,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
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
import {
  createFakeMediaResolver,
  flushAsync,
} from 'src/media/__tests__/helpers/fake-media-resolver'
import { MediaResolverService } from 'src/media/media-resolver.service'

const NOW_ISO = '2026-08-20T12:00:00.000Z'
const VIDEO_URL = 'https://example.com/video'

function buildRecord(overrides: Partial<DownloadJobRecord> = {}) {
  return {
    completedAt: null,
    createdAt: NOW_ISO,
    hiddenAttribution: false,
    id: 'job-1',
    mediaId: 'video:v1',
    requester: null,
    status: DownloadJobStatus.Pending,
    type: DownloadType.Video,
    updatedAt: NOW_ISO,
    ...overrides,
  } satisfies DownloadJobRecord
}

function buildMovieRecord(overrides: Partial<DownloadJobRecord> = {}) {
  return buildRecord({
    id: 'movie-1',
    mediaId: 'tmdb:1',
    status: DownloadJobStatus.Requested,
    type: DownloadType.Movie,
    ...overrides,
  })
}

function buildShowRecord(overrides: Partial<DownloadJobRecord> = {}) {
  return buildRecord({
    id: 'show-1',
    mediaId: 'tvdb:1',
    status: DownloadJobStatus.Requested,
    type: DownloadType.Show,
    ...overrides,
  })
}

type BroadcastBuild = (isAdmin: boolean) => DownloadGatewayMessage

describe('DownloadStateService', () => {
  let service: DownloadStateService
  let dbService: DbService
  let downloadGateway: jest.Mocked<DownloadGateway>
  let mediaResolver: ReturnType<typeof createFakeMediaResolver>

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

  function readVideoRows() {
    return dbService.db.select().from(videos).all()
  }

  /** Seeds a real `videos` row and returns the record pointing at it. */
  function seedVideoJob(overrides: Partial<DownloadJobRecord> = {}) {
    const row = service.ensureVideo({ sourceUrl: VIDEO_URL })
    return buildRecord({ mediaId: `video:${row.id}`, ...overrides })
  }

  beforeEach(async () => {
    dbService = createTestDbService()
    mediaResolver = createFakeMediaResolver()
    const mockDownloadGateway = { broadcastPerViewer: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        { provide: DownloadGateway, useValue: mockDownloadGateway },
        { provide: MediaResolverService, useValue: mediaResolver },
      ],
    }).compile()

    service = module.get(DownloadStateService)
    downloadGateway = module.get(DownloadGateway)
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  describe('addJob', () => {
    it('inserts the record into the map', () => {
      const record = buildMovieRecord()

      service.addJob(record)

      expect(service.jobs.get(record.id)).toEqual(record)
    })

    it('broadcasts a "created" event carrying the job with its media resolved', async () => {
      const record = buildMovieRecord()

      service.addJob(record)
      await flushAsync()

      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(1)
      const build = firstBroadcastBuild()
      // Movie jobs are always attributed - the non-admin and admin variants
      // are identical.
      for (const isAdmin of [false, true]) {
        expect(build(isAdmin)).toEqual({
          data: {
            job: expect.objectContaining({
              id: record.id,
              media: expect.objectContaining({ id: 'tmdb:1' }),
            }),
            type: DownloadJobEventType.Created,
          },
          type: DOWNLOAD_JOB_EVENT_TYPE,
        })
      }
    })

    it('writes a durable row carrying only the derived key, not metadata', () => {
      const record = buildMovieRecord({
        requester: { email: 'alice@example.com', userId: 'user_1' },
      })

      service.addJob(record)

      expect(readRow(record.id)).toMatchObject({
        id: 'movie-1',
        mediaId: 'tmdb:1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'user_1',
        status: DownloadJobStatus.Requested,
        type: DownloadType.Movie,
      })
    })

    it('writes origin "service" and null requester fields for a job with no requester', () => {
      service.addJob(buildMovieRecord())

      expect(readRow('movie-1')).toMatchObject({
        origin: 'service',
        requesterEmail: null,
        requesterUserId: null,
      })
    })

    it('propagates a persistence failure instead of silently continuing', () => {
      const record = buildMovieRecord()
      jest.spyOn(dbService.db, 'insert').mockImplementation(() => {
        throw new Error('disk full')
      })

      expect(() => service.addJob(record)).toThrow('disk full')
      // A failed persist must not still broadcast as if it had succeeded.
      expect(downloadGateway.broadcastPerViewer).not.toHaveBeenCalled()
      // Nor leave a phantom entry in the Map with no backing row.
      expect(service.jobs.has(record.id)).toBe(false)
    })
  })

  describe('updateJob', () => {
    it('throws and does not broadcast when the job does not exist', () => {
      expect(() =>
        service.updateJob('missing', { status: DownloadJobStatus.Completed }),
      ).toThrow("Job with ID 'missing' not found")

      expect(downloadGateway.broadcastPerViewer).not.toHaveBeenCalled()
    })

    it('merges updates, stores the result, and broadcasts an "updated" event', async () => {
      const record = buildMovieRecord()
      service.addJob(record) // seeds the map; also broadcasts once (Created)
      await flushAsync()
      downloadGateway.broadcastPerViewer.mockClear()

      const updated = service.updateJob(record.id, {
        status: DownloadJobStatus.Searching,
      })
      await flushAsync()

      expect(updated.status).toBe(DownloadJobStatus.Searching)
      expect(service.jobs.get(record.id)).toEqual(updated)
      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(1)
      expect(firstBroadcastBuild()(false)).toEqual({
        data: {
          job: expect.objectContaining({
            id: record.id,
            status: DownloadJobStatus.Searching,
          }),
          type: DownloadJobEventType.Updated,
        },
        type: DOWNLOAD_JOB_EVENT_TYPE,
      })
    })

    it('writes the updated row', () => {
      const record = buildMovieRecord()
      service.addJob(record)

      service.updateJob(record.id, { status: DownloadJobStatus.Searching })

      expect(readRow(record.id)).toMatchObject({
        status: DownloadJobStatus.Searching,
      })
    })

    it('stamps completedAt when the status transitions to Completed', () => {
      const record = buildMovieRecord()
      service.addJob(record)
      expect(readRow(record.id)?.completedAt).toBeNull()

      const updated = service.updateJob(record.id, {
        status: DownloadJobStatus.Completed,
      })

      expect(updated.completedAt).toEqual(expect.any(String))
      expect(readRow(record.id)?.completedAt).toBeInstanceOf(Date)
    })

    it('does not re-stamp completedAt on a later Completed -> Cancelled transition', () => {
      const record = buildMovieRecord()
      service.addJob(record)
      const completed = service.updateJob(record.id, {
        status: DownloadJobStatus.Completed,
      })

      const cancelled = service.updateJob(record.id, {
        status: DownloadJobStatus.Cancelled,
      })

      expect(cancelled.completedAt).toBe(completed.completedAt)
    })

    it('upserts a row for a job that was seeded directly into the map, bypassing addJob()', () => {
      // Mirrors media/__tests__'s pattern of seeding
      // `downloadStateService.jobs.set(...)` directly rather than going
      // through addJob() - no row exists for this job yet.
      const record = buildMovieRecord()
      service.jobs.set(record.id, record)
      expect(readRow(record.id)).toBeUndefined()

      expect(() =>
        service.updateJob(record.id, { status: DownloadJobStatus.Searching }),
      ).not.toThrow()

      expect(readRow(record.id)).toMatchObject({
        id: record.id,
        status: DownloadJobStatus.Searching,
      })
    })

    it('swallows a persistence failure and still updates in-memory state and broadcasts', async () => {
      const record = buildMovieRecord()
      service.addJob(record)
      jest.spyOn(dbService.db, 'insert').mockImplementation(() => {
        throw new Error('disk full')
      })

      const updated = service.updateJob(record.id, {
        status: DownloadJobStatus.Searching,
      })
      await flushAsync()

      expect(updated.status).toBe(DownloadJobStatus.Searching)
      expect(service.jobs.get(record.id)).toEqual(updated)
      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalled()
    })

    it('never carries a process handle in a broadcast payload, since proc lives in the procs side map', async () => {
      const record = seedVideoJob()
      service.addJob(record)

      // A real ChildProcess has circular internal references (sockets,
      // streams, etc.) that make JSON.stringify throw - reproduce that
      // shape here rather than a flat mock object, so this test actually
      // proves nothing proc-shaped reaches the payload rather than passing
      // by accident because a flat object happens to stringify fine anyway.
      const fakeProc = {} as unknown as ChildProcessWithoutNullStreams
      ;(fakeProc as unknown as { self: unknown }).self = fakeProc
      service.setProc(record.id, fakeProc)
      await flushAsync()
      downloadGateway.broadcastPerViewer.mockClear()

      service.updateJob(record.id, { status: DownloadJobStatus.Converting })
      await flushAsync()

      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(1)
      const build = firstBroadcastBuild()

      for (const isAdmin of [false, true]) {
        const payload = build(isAdmin)
        const event = payload.data as DownloadJobEvent

        expect(event.job).not.toHaveProperty('proc')
        expect(event.job.id).toBe(record.id)
        expect(() => JSON.stringify(payload)).not.toThrow()
      }
    })

    it('clears the tracked process handle once a job reaches a terminal status', () => {
      const record = seedVideoJob()
      service.addJob(record)
      service.setProc(
        record.id,
        {} as unknown as ChildProcessWithoutNullStreams,
      )
      expect(service.getProc(record.id)).toBeDefined()

      service.updateJob(record.id, { status: DownloadJobStatus.Completed })

      expect(service.getProc(record.id)).toBeUndefined()
    })

    it('leaves the tracked process handle alone across a non-terminal status change', () => {
      const record = seedVideoJob()
      service.addJob(record)
      const fakeProc = {} as unknown as ChildProcessWithoutNullStreams
      service.setProc(record.id, fakeProc)

      service.updateJob(record.id, { status: DownloadJobStatus.Converting })

      expect(service.getProc(record.id)).toBe(fakeProc)
    })

    it('masks a hidden video job requester for a non-admin viewer, and reveals it to an admin - never in the same frame', async () => {
      const requesterEmail = 'alice@example.com'
      const record = seedVideoJob({
        hiddenAttribution: true,
        requester: { email: requesterEmail, userId: 'user_1' },
      })
      service.addJob(record)
      await flushAsync()
      downloadGateway.broadcastPerViewer.mockClear()

      service.updateJob(record.id, { status: DownloadJobStatus.Downloading })
      await flushAsync()

      const build = firstBroadcastBuild()
      const nonAdminFrame = JSON.stringify(build(false))
      const adminFrame = JSON.stringify(build(true))

      // The raw WS frame a non-admin socket receives must never contain the
      // hidden requester's email, even though the record carries it
      // internally.
      expect(nonAdminFrame).not.toContain(requesterEmail)
      expect(adminFrame).toContain(requesterEmail)
    })
  })

  describe('queue snapshots', () => {
    it('keeps the snapshot out of the persisted row entirely', async () => {
      const record = buildMovieRecord()
      service.addJob(record)
      await flushAsync()
      downloadGateway.broadcastPerViewer.mockClear()

      service.setQueueSnapshot(record.id, { progress: 50 })
      await flushAsync()

      expect(readRow(record.id)).not.toHaveProperty('queue_snapshot', {
        progress: 50,
      })
      expect(readRow(record.id)?.queueSnapshot).toBeNull()
      expect(service.getQueueSnapshot(record.id)).toEqual({ progress: 50 })
    })

    it('grafts the snapshot onto the resolved media so subscribers still see progress', async () => {
      const record = buildMovieRecord()
      service.addJob(record)
      service.setQueueSnapshot(record.id, { progress: 50 })

      const job = await service.hydrateOne(record)

      expect(job.media).toMatchObject({ queueSnapshot: { progress: 50 } })
    })

    it('drops the snapshot once the job reaches a terminal status', () => {
      const record = buildMovieRecord()
      service.addJob(record)
      service.setQueueSnapshot(record.id, { progress: 50 })

      service.updateJob(record.id, { status: DownloadJobStatus.Completed })

      expect(service.getQueueSnapshot(record.id)).toBeUndefined()
    })
  })

  describe('resolveJobRecord / resolveJob', () => {
    it('returns the live record from the Map without querying the DB', () => {
      const record = buildMovieRecord()
      service.addJob(record)
      const selectSpy = jest.spyOn(dbService.db, 'select')

      expect(service.resolveJobRecord(record.id)).toEqual(record)
      // The Map hit must win outright - a live job may carry in-flight
      // state the row can't reconstruct, so a hit there must never be
      // second-guessed by a DB read.
      expect(selectSpy).not.toHaveBeenCalled()
    })

    it('falls back to the durable row when the Map has no entry (simulating a post-restart lookup)', () => {
      const record = buildMovieRecord()
      // Persist without keeping the Map entry, mirroring what a restart
      // leaves behind: a row survives, but the Map starts out empty.
      service.addJob(record)
      service.jobs.delete(record.id)

      expect(service.resolveJobRecord(record.id)).toMatchObject({
        id: record.id,
        mediaId: 'tmdb:1',
        type: DownloadType.Movie,
      })
    })

    it('returns undefined when the job exists in neither the Map nor the DB', async () => {
      expect(service.resolveJobRecord('missing')).toBeUndefined()
      await expect(service.resolveJob('missing')).resolves.toBeUndefined()
    })

    it('resolveJob joins the record to its media', async () => {
      const record = buildMovieRecord()
      service.addJob(record)

      await expect(service.resolveJob(record.id)).resolves.toMatchObject({
        id: record.id,
        media: { id: 'tmdb:1', tmdbId: 1, type: DownloadType.Movie },
      })
    })
  })

  describe('hydrate', () => {
    it('resolves a whole batch in one resolver call, not one per job', async () => {
      const records = [
        buildMovieRecord({ id: 'a', mediaId: 'tmdb:1' }),
        buildMovieRecord({ id: 'b', mediaId: 'tmdb:2' }),
        buildShowRecord({ id: 'c', mediaId: 'tvdb:3' }),
      ]

      const hydrated = await service.hydrate(records)

      expect(mediaResolver.resolve).toHaveBeenCalledTimes(1)
      expect(hydrated.map(job => job.media.id)).toEqual([
        'tmdb:1',
        'tmdb:2',
        'tvdb:3',
      ])
    })

    it('short-circuits an empty batch without calling the resolver', async () => {
      await expect(service.hydrate([])).resolves.toEqual([])
      expect(mediaResolver.resolve).not.toHaveBeenCalled()
    })

    it('strips the storage-only fields, leaving media in their place', async () => {
      const [job] = await service.hydrate([buildMovieRecord()])

      expect(job).not.toHaveProperty('mediaId')
      expect(job).not.toHaveProperty('type')
      expect(job?.media.type).toBe(DownloadType.Movie)
    })
  })

  describe('setProc / getProc / clearProc', () => {
    it('tracks a process handle out-of-band, never touching the job record', () => {
      const record = seedVideoJob()
      service.addJob(record)
      const fakeProc = {} as unknown as ChildProcessWithoutNullStreams

      service.setProc(record.id, fakeProc)

      expect(service.getProc(record.id)).toBe(fakeProc)
      expect(service.jobs.get(record.id)).toEqual(record)
    })

    it('returns undefined for a job with no tracked process', () => {
      expect(service.getProc('missing')).toBeUndefined()
    })

    it('clearProc is a no-op when nothing was tracked', () => {
      expect(() => service.clearProc('missing')).not.toThrow()
    })
  })

  describe('ensureVideo / updateVideo', () => {
    it('creates one videos row, seeding the title from the source URL', () => {
      const row = service.ensureVideo({ sourceUrl: VIDEO_URL })

      expect(readVideoRows()).toHaveLength(1)
      expect(row).toMatchObject({ sourceUrl: VIDEO_URL, title: VIDEO_URL })
    })

    it('collapses two requests for the same (url, timeRange) onto one row', () => {
      const first = service.ensureVideo({ sourceUrl: VIDEO_URL })
      const second = service.ensureVideo({ sourceUrl: VIDEO_URL })

      expect(readVideoRows()).toHaveLength(1)
      expect(second.id).toBe(first.id)
    })

    it('treats a clip as a distinct video from its full-length sibling', () => {
      service.ensureVideo({ sourceUrl: VIDEO_URL })
      service.ensureVideo({
        sourceUrl: VIDEO_URL,
        timeRange: { start: '00:00:00', end: '00:01:00' },
      })

      expect(readVideoRows()).toHaveLength(2)
    })

    it('overwrites the placeholder title once the real one is known, without duplicating the row', async () => {
      const record = seedVideoJob()
      service.addJob(record)
      expect(readVideoRows()[0]?.title).toBe(VIDEO_URL)

      service.updateVideo(record.id, { title: 'The Real Title' })
      await flushAsync()

      const rows = readVideoRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.title).toBe('The Real Title')
      // A media change still has to reach subscribers even though no job
      // field moved.
      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalled()
    })

    it('only writes the keys present in the patch, so a later step cannot blank an earlier one', () => {
      const record = seedVideoJob()
      service.addJob(record)
      service.updateVideo(record.id, { title: 'The Real Title' })

      service.updateVideo(record.id, {
        downloadUrls: ['https://example.com/a.mp4'],
      })

      expect(readVideoRows()[0]).toMatchObject({
        downloadUrls: ['https://example.com/a.mp4'],
        title: 'The Real Title',
      })
    })

    it('throws rather than silently no-oping when the job is unknown', () => {
      expect(() => service.updateVideo('missing', { title: 'x' })).toThrow(
        "Job with ID 'missing' not found",
      )
    })
  })

  describe('getVideo / requireVideo', () => {
    it('reads the row behind a video: key', () => {
      const row = service.ensureVideo({ sourceUrl: VIDEO_URL })

      expect(service.getVideo(`video:${row.id}`)?.id).toBe(row.id)
      expect(service.requireVideo(`video:${row.id}`).sourceUrl).toBe(VIDEO_URL)
    })

    it('returns undefined / throws for an unknown key', () => {
      expect(service.getVideo('video:nope')).toBeUndefined()
      expect(() => service.requireVideo('video:nope')).toThrow(
        "No videos row for media id 'video:nope'",
      )
    })
  })
})
