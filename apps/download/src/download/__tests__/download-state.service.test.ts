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

import { parseMediaEventFrame } from '@lilnas/utils/download/job-events'
import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJobEvent,
  DownloadJobEventType,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  isManagedMedia,
  MEDIA_EVENT_TYPE,
  type MediaEvent,
  type MediaState,
  type VideoProgress,
} from '@lilnas/utils/download/types'
import { Test, TestingModule } from '@nestjs/testing'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { eq } from 'drizzle-orm'

import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { reconcileInterruptedJobs } from 'src/db/reconcile-interrupted-jobs'
import { jobs, videos } from 'src/db/schema'
import {
  DownloadStateService,
  PROGRESS_BROADCAST_INTERVAL_MS,
} from 'src/download/download-state.service'
import { JobInterruptedError } from 'src/download/job-interrupted.error'
import {
  DownloadGateway,
  DownloadGatewayMessage,
} from 'src/download-gateway/download.gateway'
import {
  createFakeMediaResolver,
  flushAsync,
} from 'src/media/__tests__/helpers/fake-media-resolver'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'

const NOW_ISO = '2026-08-20T12:00:00.000Z'
const VIDEO_URL = 'https://example.com/video'

function buildRecord(overrides: Partial<DownloadJobRecord> = {}) {
  return {
    completedAt: null,
    createdAt: NOW_ISO,
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-1',
    linkedDiscord: null,
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
  let mediaStateService: MediaStateService

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
    const mockDownloadGateway = {
      broadcast: jest.fn(),
      broadcastPerViewer: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        fakeAttributionResolutionProvider(),
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        { provide: DownloadGateway, useValue: mockDownloadGateway },
        { provide: MediaResolverService, useValue: mediaResolver },
        MediaStateService,
      ],
    }).compile()

    service = module.get(DownloadStateService)
    downloadGateway = module.get(DownloadGateway)
    mediaStateService = module.get(MediaStateService)
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

    it('clears both the tracked process handle and the interrupt intent once a job reaches a terminal status', () => {
      const record = seedVideoJob()
      service.addJob(record)
      service.setProc(
        record.id,
        {} as unknown as ChildProcessWithoutNullStreams,
      )
      service.setInterruption(record.id, 'cancel')
      expect(service.getProc(record.id)).toBeDefined()
      expect(service.getInterruption(record.id)).toBe('cancel')

      service.updateJob(record.id, { status: DownloadJobStatus.Completed })

      expect(service.getProc(record.id)).toBeUndefined()
      // A stale intent would tell the *next* reader that a job which is
      // already finished was stopped on purpose.
      expect(service.getInterruption(record.id)).toBeUndefined()
    })

    it('leaves both the process handle and the interrupt intent alone across a non-terminal status change', () => {
      const record = seedVideoJob()
      service.addJob(record)
      const fakeProc = {} as unknown as ChildProcessWithoutNullStreams
      service.setProc(record.id, fakeProc)
      service.setInterruption(record.id, 'pause')

      service.updateJob(record.id, { status: DownloadJobStatus.Converting })

      expect(service.getProc(record.id)).toBe(fakeProc)
      // A pause records its intent and *then* kills the process; the status
      // writes in between must not wipe the note before the exit handler
      // reads it.
      expect(service.getInterruption(record.id)).toBe('pause')
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

  describe('touchJob / queue snapshots', () => {
    it('re-broadcasts the job as Updated without writing its row', async () => {
      const record = buildMovieRecord()
      service.addJob(record)
      await flushAsync()
      downloadGateway.broadcastPerViewer.mockClear()
      const rowBefore = readRow(record.id)

      service.touchJob(record.id)
      await flushAsync()

      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(1)
      expect(firstBroadcastBuild()(true)).toEqual({
        data: {
          job: expect.objectContaining({ id: record.id }),
          type: DownloadJobEventType.Updated,
        },
        type: DOWNLOAD_JOB_EVENT_TYPE,
      })
      expect(readRow(record.id)).toEqual(rowBefore)
      expect(service.jobs.get(record.id)).toBe(record)
    })

    it('does nothing for a job the Map does not hold', async () => {
      service.touchJob('nope')
      await flushAsync()

      expect(downloadGateway.broadcastPerViewer).not.toHaveBeenCalled()
    })

    it('never invents a snapshot the resolver did not supply', async () => {
      const record = buildMovieRecord()
      service.addJob(record)

      const job = await service.hydrateOne(record)

      expect(job.media).not.toHaveProperty('queueSnapshot')
    })

    // The resolver annotates from MediaStateService's queue cache on every
    // resolve(), so each broadcast reads the progress as of the last poll.
    it("carries the queue cache's snapshot on every touch", async () => {
      mediaResolver.fixtures.set('tmdb:1', {
        id: 'tmdb:1',
        monitored: true,
        radarrId: 42,
        title: 'A Movie',
        tmdbId: 1,
        type: DownloadType.Movie,
      })
      const unannotated = createFakeMediaResolver(mediaResolver.fixtures)
      mediaResolver.resolve.mockImplementation(async keys => {
        const result = await unannotated.resolve(keys)
        mediaStateService.annotate(result.media.values())
        return result
      })
      const record = buildMovieRecord()
      service.addJob(record)
      await flushAsync()

      const progressAfterTouch = async (sizeleft: number) => {
        mediaStateService.setQueue('radarr', [
          { movieId: 42, size: 1000, sizeleft, status: 'downloading' },
        ])
        downloadGateway.broadcastPerViewer.mockClear()
        service.touchJob(record.id)
        await flushAsync()
        const { media } = (firstBroadcastBuild()(true).data as DownloadJobEvent)
          .job
        return isManagedMedia(media) ? media.queueSnapshot?.progress : undefined
      }

      expect(await progressAfterTouch(500)).toBe(50)
      expect(await progressAfterTouch(250)).toBe(75)
    })
  })

  /**
   * Plan 015. A video job's yt-dlp ticks live in memory only and ride on the
   * job, re-broadcast through `touchJob()` at most once per window.
   */
  describe('setProgress / flushProgress', () => {
    const TICK_A: VideoProgress = { downloadedBytes: 100, fileIndex: 1 }
    const TICK_B: VideoProgress = {
      downloadedBytes: 200,
      fileIndex: 1,
      percent: 20,
    }
    const TICK_C: VideoProgress = {
      downloadedBytes: 300,
      etaSeconds: 5,
      fileIndex: 1,
      percent: 30,
      speedBps: 1024,
      totalBytes: 1000,
    }

    beforeEach(() => {
      // Only the throttle's clock and timers are faked: `flushAsync()` rides
      // on setImmediate, and the broadcast's hydrate on real promise ticks.
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
      })
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    /** The `progress` of every job frame sent so far, in order. */
    function sentProgress(): (VideoProgress | undefined)[] {
      return downloadGateway.broadcastPerViewer.mock.calls.map(
        ([build]) => (build(true).data as DownloadJobEvent).job.progress,
      )
    }

    async function seedLiveVideo(overrides: Partial<DownloadJobRecord> = {}) {
      const record = seedVideoJob({
        status: DownloadJobStatus.Downloading,
        ...overrides,
      })
      service.addJob(record)
      await flushAsync()
      downloadGateway.broadcastPerViewer.mockClear()
      return record
    }

    it('re-broadcasts the job carrying the snapshot, without writing its row', async () => {
      const record = await seedLiveVideo()
      const rowBefore = readRow(record.id)

      service.setProgress(record.id, TICK_C)
      await flushAsync()

      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(1)
      for (const isAdmin of [false, true]) {
        expect(firstBroadcastBuild()(isAdmin)).toEqual({
          data: {
            job: expect.objectContaining({ id: record.id, progress: TICK_C }),
            type: DownloadJobEventType.Updated,
          },
          type: DOWNLOAD_JOB_EVENT_TYPE,
        })
      }
      expect(readRow(record.id)).toEqual(rowBefore)
      expect(service.jobs.get(record.id)).toBe(record)
      expect(service.jobs.get(record.id)).not.toHaveProperty('progress')
      expect(service.getProgress(record.id)).toBe(TICK_C)
      await expect(service.resolveJob(record.id)).resolves.toMatchObject({
        progress: TICK_C,
      })
    })

    it('collapses ticks inside the window into one trailing frame carrying the latest', async () => {
      const record = await seedLiveVideo()

      // Each send's hydrate reads the Map when it completes, so let A's
      // frame land before B replaces it.
      service.setProgress(record.id, TICK_A)
      await flushAsync()
      jest.advanceTimersByTime(200)
      service.setProgress(record.id, TICK_B)
      jest.advanceTimersByTime(200)
      service.setProgress(record.id, TICK_C)
      await flushAsync()

      // Only the first tick has gone out; B and C are waiting on one timer.
      expect(sentProgress()).toEqual([TICK_A])
      expect(jest.getTimerCount()).toBe(1)
      expect(service.getProgress(record.id)).toBe(TICK_C)

      jest.advanceTimersByTime(PROGRESS_BROADCAST_INTERVAL_MS - 401)
      await flushAsync()
      expect(sentProgress()).toEqual([TICK_A])

      jest.advanceTimersByTime(1)
      await flushAsync()
      expect(sentProgress()).toEqual([TICK_A, TICK_C])
      expect(jest.getTimerCount()).toBe(0)
    })

    it('sends a tick immediately once a full window has passed since the last send', async () => {
      const record = await seedLiveVideo()

      service.setProgress(record.id, TICK_A)
      await flushAsync()
      jest.advanceTimersByTime(PROGRESS_BROADCAST_INTERVAL_MS)
      service.setProgress(record.id, TICK_B)
      await flushAsync()

      expect(sentProgress()).toEqual([TICK_A, TICK_B])
      expect(jest.getTimerCount()).toBe(0)
    })

    it('sends a flush tick inside the window immediately and restarts the window', async () => {
      const record = await seedLiveVideo()

      service.setProgress(record.id, TICK_A)
      await flushAsync()
      jest.advanceTimersByTime(100)
      service.setProgress(record.id, TICK_B)
      expect(jest.getTimerCount()).toBe(1)
      service.setProgress(record.id, TICK_C, { flush: true })
      await flushAsync()

      // The flush sent C and cancelled the trailing timer B had armed.
      expect(sentProgress()).toEqual([TICK_A, TICK_C])
      expect(jest.getTimerCount()).toBe(0)

      // The window now runs from the flush, not from A.
      jest.advanceTimersByTime(PROGRESS_BROADCAST_INTERVAL_MS - 100)
      service.setProgress(record.id, TICK_B)
      await flushAsync()
      expect(sentProgress()).toEqual([TICK_A, TICK_C])

      jest.advanceTimersByTime(100)
      await flushAsync()
      expect(sentProgress()).toEqual([TICK_A, TICK_C, TICK_B])
    })

    it('flushProgress drains a pending tick now, and is a no-op with nothing pending', async () => {
      const record = await seedLiveVideo()

      service.flushProgress(record.id)
      service.setProgress(record.id, TICK_A)
      service.flushProgress(record.id)
      await flushAsync()
      expect(sentProgress()).toEqual([TICK_A])

      service.setProgress(record.id, TICK_B)
      service.flushProgress(record.id)
      await flushAsync()
      expect(sentProgress()).toEqual([TICK_A, TICK_B])
      expect(jest.getTimerCount()).toBe(0)

      jest.advanceTimersByTime(PROGRESS_BROADCAST_INTERVAL_MS * 2)
      await flushAsync()
      expect(sentProgress()).toEqual([TICK_A, TICK_B])
    })

    it.each([
      DownloadJobStatus.Completed,
      DownloadJobStatus.Failed,
      DownloadJobStatus.Cancelled,
    ])('drops the snapshot and cancels a pending send on %s', async status => {
      const record = await seedLiveVideo()
      service.setProgress(record.id, TICK_A)
      service.setProgress(record.id, TICK_B)
      expect(jest.getTimerCount()).toBe(1)

      service.updateJob(record.id, { status })
      await flushAsync()

      expect(service.getProgress(record.id)).toBeUndefined()
      expect(jest.getTimerCount()).toBe(0)
      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(2)
      const terminalBuild = downloadGateway.broadcastPerViewer.mock.calls[1]
      const terminalJob = (terminalBuild?.[0](true).data as DownloadJobEvent)
        .job
      expect(terminalJob.status).toBe(status)
      expect(terminalJob).not.toHaveProperty('progress')

      jest.advanceTimersByTime(PROGRESS_BROADCAST_INTERVAL_MS * 2)
      await flushAsync()
      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(2)
    })

    it('restarts the window after a terminal clear, so a fresh tick sends at once', async () => {
      const record = await seedLiveVideo()
      service.setProgress(record.id, TICK_A)
      service.updateJob(record.id, { status: DownloadJobStatus.Failed })
      // A retry re-enters the pipeline under the same id.
      service.updateJob(record.id, { status: DownloadJobStatus.Downloading })
      await flushAsync()
      downloadGateway.broadcastPerViewer.mockClear()

      service.setProgress(record.id, TICK_B)
      await flushAsync()

      expect(sentProgress()).toEqual([TICK_B])
    })

    it.each([
      DownloadJobStatus.Pausing,
      DownloadJobStatus.Paused,
      DownloadJobStatus.Converting,
    ])('keeps the last snapshot across a move to %s', async status => {
      const record = await seedLiveVideo()
      service.setProgress(record.id, TICK_A)
      await flushAsync()
      downloadGateway.broadcastPerViewer.mockClear()

      service.updateJob(record.id, { status })
      await flushAsync()

      expect(service.getProgress(record.id)).toBe(TICK_A)
      expect(sentProgress()).toEqual([TICK_A])
    })

    it('omits the key entirely - not undefined - for a job with no snapshot', async () => {
      const record = await seedLiveVideo()

      service.touchJob(record.id)
      await flushAsync()
      const job = await service.hydrateOne(record)

      expect(job).not.toHaveProperty('progress')
      expect(
        (firstBroadcastBuild()(true).data as DownloadJobEvent).job,
      ).not.toHaveProperty('progress')
    })

    it('never attaches one to a movie job', async () => {
      const record = buildMovieRecord()
      service.addJob(record)
      service.touchJob(record.id)
      await flushAsync()

      expect(sentProgress()).toEqual([undefined, undefined])
      for (const [build] of downloadGateway.broadcastPerViewer.mock.calls) {
        expect((build(true).data as DownloadJobEvent).job).not.toHaveProperty(
          'progress',
        )
      }
      expect(await service.hydrateOne(record)).not.toHaveProperty('progress')
    })

    it('never attaches one to a job resolved from its row alone (post-restart)', async () => {
      const record = await seedLiveVideo()
      service.jobs.delete(record.id)

      const job = await service.resolveJob(record.id)

      expect(job?.id).toBe(record.id)
      expect(job).not.toHaveProperty('progress')
    })

    it('does nothing for a job the Map does not hold', async () => {
      service.setProgress('nope', TICK_A)
      service.setProgress('nope', TICK_B, { flush: true })
      service.flushProgress('nope')
      await flushAsync()

      expect(downloadGateway.broadcastPerViewer).not.toHaveBeenCalled()
      expect(service.getProgress('nope')).toBeUndefined()
      expect(jest.getTimerCount()).toBe(0)
    })

    it('unrefs a pending send so it never holds the process open', async () => {
      const record = await seedLiveVideo()
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

      service.setProgress(record.id, TICK_A)
      service.setProgress(record.id, TICK_B)

      const timer = setTimeoutSpy.mock.results[0]?.value as NodeJS.Timeout
      expect(timer.hasRef()).toBe(false)
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

  describe('setInterruption / getInterruption / clearInterruption', () => {
    it('round-trips an intent without touching the job record', () => {
      const record = seedVideoJob()
      service.addJob(record)

      service.setInterruption(record.id, 'pause')
      expect(service.getInterruption(record.id)).toBe('pause')
      expect(service.jobs.get(record.id)).toEqual(record)

      service.clearInterruption(record.id)
      expect(service.getInterruption(record.id)).toBeUndefined()
    })

    it('returns undefined for a job with no recorded intent', () => {
      expect(service.getInterruption('missing')).toBeUndefined()
    })

    it('clearInterruption is a no-op when nothing was recorded', () => {
      expect(() => service.clearInterruption('missing')).not.toThrow()
    })

    it('accepts an intent for a job with no tracked process', () => {
      // The caller decides whether a kill is actually going to happen; the
      // store deliberately does not second-guess it.
      expect(() => service.setInterruption('no-proc', 'cancel')).not.toThrow()
      expect(service.getInterruption('no-proc')).toBe('cancel')
    })

    it('is last-write-wins, so a cancel chasing a pause overwrites it', () => {
      service.setInterruption('job-1', 'pause')

      service.setInterruption('job-1', 'cancel')

      expect(service.getInterruption('job-1')).toBe('cancel')
    })
  })

  describe('JobInterruptedError', () => {
    // The scheduler branches on `instanceof JobInterruptedError` to tell a
    // deliberate stop from a crash, and subclassing `Error` loses the
    // prototype under some compile targets - pin the behaviour the branch
    // depends on.
    it('survives instanceof and carries the job id and kind', () => {
      const err = new JobInterruptedError('job-1', 'pause')

      expect(err).toBeInstanceOf(JobInterruptedError)
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('JobInterruptedError')
      expect(err.jobId).toBe('job-1')
      expect(err.kind).toBe('pause')
      expect(err.message).toContain('job-1')
      expect(err.message).toContain('pause')
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

  /**
   * Plan 021. A video's state follows its job: `addJob()`/`updateJob()` feed
   * the job's status to `MediaStateService`, and every video job event (and
   * `updateVideo()`) is followed by a `media` frame carrying the annotated
   * media. Movie/show state moves with the upstream queue instead, so their
   * jobs touch neither.
   */
  describe('video activity and media events', () => {
    let setVideoActivity: jest.SpiedFunction<
      MediaStateService['setVideoActivity']
    >

    /**
     * Every `media` frame sent so far, decoded the way a client would - off
     * the wire, through the shared parser - so a malformed frame fails here.
     */
    function mediaEvents(): MediaEvent[] {
      return downloadGateway.broadcast.mock.calls.map(([message]) => {
        const event = parseMediaEventFrame(JSON.stringify(message))
        if (!event) {
          throw new Error(`Not a media frame: ${JSON.stringify(message)}`)
        }
        return event
      })
    }

    function mediaEventStates(): (MediaState | undefined)[] {
      return mediaEvents().map(event => event.media.state)
    }

    beforeEach(() => {
      // The real resolver annotates everything it resolves through
      // MediaStateService (see MediaResolverService.resolve()); the fake
      // doesn't, so do it here - that's what puts `state` on the frames.
      const answer = createFakeMediaResolver().resolve
      mediaResolver.resolve.mockImplementation(async keys => {
        const result = await answer(keys)
        mediaStateService.annotate(result.media.values())
        return result
      })
      setVideoActivity = jest.spyOn(mediaStateService, 'setVideoActivity')
    })

    it('follows a video job from Pending to Completed and clears it at the end', async () => {
      const record = seedVideoJob()

      service.addJob(record)
      await flushAsync()
      for (const status of [
        DownloadJobStatus.Downloading,
        DownloadJobStatus.Converting,
        DownloadJobStatus.Completed,
      ]) {
        service.updateJob(record.id, { status })
        await flushAsync()
      }

      expect(setVideoActivity.mock.calls).toEqual([
        [record.mediaId, DownloadJobStatus.Pending],
        [record.mediaId, DownloadJobStatus.Downloading],
        [record.mediaId, DownloadJobStatus.Converting],
        [record.mediaId, undefined],
      ])
      // The fake's video has no download URLs, so once the job stops
      // speaking for it the video has no file - `absent`, not a stale
      // `importing` left behind by the Converting step.
      expect(mediaEventStates()).toEqual([
        'wanted',
        'downloading',
        'importing',
        'absent',
      ])
    })

    it('records the resulting status even when an update does not change it', () => {
      const record = seedVideoJob({ status: DownloadJobStatus.Downloading })
      service.addJob(record)
      setVideoActivity.mockClear()

      service.updateJob(record.id, { requester: null })

      expect(setVideoActivity).toHaveBeenCalledWith(
        record.mediaId,
        DownloadJobStatus.Downloading,
      )
    })

    it('clears the activity on every terminal status', () => {
      for (const status of [
        DownloadJobStatus.Cancelled,
        DownloadJobStatus.Failed,
      ]) {
        const record = seedVideoJob({ id: `job-${status}` })
        service.addJob(record)
        setVideoActivity.mockClear()

        service.updateJob(record.id, { status })

        expect(setVideoActivity).toHaveBeenCalledWith(record.mediaId, undefined)
      }
    })

    it('sends one media frame, for the same media, alongside every video job event', async () => {
      const record = seedVideoJob()

      service.addJob(record)
      service.updateJob(record.id, { status: DownloadJobStatus.Downloading })
      await flushAsync()

      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(2)
      expect(downloadGateway.broadcast).toHaveBeenCalledTimes(2)
      for (const [message] of downloadGateway.broadcast.mock.calls) {
        expect(message.type).toBe(MEDIA_EVENT_TYPE)
      }
      for (const event of mediaEvents()) {
        expect(event.media).toMatchObject({
          id: record.mediaId,
          type: DownloadType.Video,
        })
        // A media frame has no episodes, and nothing viewer-specific.
        expect(event).toEqual({ media: event.media })
      }
    })

    it("reuses the job event's resolve rather than resolving the media twice", async () => {
      const record = seedVideoJob()

      service.addJob(record)
      await flushAsync()

      expect(mediaResolver.resolve).toHaveBeenCalledTimes(1)
    })

    it('sends a media frame after updateVideo, reflecting the patched row', async () => {
      const record = seedVideoJob({ status: DownloadJobStatus.Uploading })
      service.addJob(record)
      await flushAsync()
      downloadGateway.broadcast.mockClear()

      service.updateVideo(record.id, { title: 'The Real Title' })
      await flushAsync()

      expect(mediaEventStates()).toEqual(['importing'])
      expect(mediaEvents()[0]?.media.id).toBe(record.mediaId)
    })

    it('skips the media frame, without throwing, when the media cannot be resolved', async () => {
      const record = seedVideoJob()
      mediaResolver.resolve.mockRejectedValue(new Error('resolver down'))

      expect(() => service.addJob(record)).not.toThrow()
      expect(() =>
        service.updateJob(record.id, { status: DownloadJobStatus.Downloading }),
      ).not.toThrow()
      await flushAsync()

      expect(downloadGateway.broadcast).not.toHaveBeenCalled()
      // The activity is recorded regardless - it doesn't depend on a resolve.
      expect(setVideoActivity).toHaveBeenLastCalledWith(
        record.mediaId,
        DownloadJobStatus.Downloading,
      )
    })

    it.each([
      ['movie', buildMovieRecord],
      ['show', buildShowRecord],
    ])(
      'never touches the activity map or sends a media frame for a %s job',
      async (_kind, build) => {
        const record = build()

        service.addJob(record)
        service.updateJob(record.id, { status: DownloadJobStatus.Downloading })
        service.touchJob(record.id)
        service.updateJob(record.id, { status: DownloadJobStatus.Completed })
        await flushAsync()

        expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(4)
        expect(setVideoActivity).not.toHaveBeenCalled()
        expect(downloadGateway.broadcast).not.toHaveBeenCalled()
      },
    )
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

  /**
   * Plans 020 and 021. `reconcileInterruptedJobs()` spares every open
   * movie/show row and every `needs_attention` row at boot, but the Map is
   * what MediaPollerService iterates and a restart empties it - so sparing
   * the row only helps if something adopts it back.
   */
  describe('adoptOpenJobs', () => {
    const MEDIA_PREFIX = { movie: 'tmdb', show: 'tvdb', video: 'video' }

    function seedRow(
      id: string,
      status: DownloadJobStatus,
      type: DownloadType = DownloadType.Movie,
    ) {
      dbService.db
        .insert(jobs)
        .values({
          id,
          mediaId: `${MEDIA_PREFIX[type]}:${id}`,
          origin: 'service',
          status,
          type,
        })
        .run()
    }

    it('puts every open movie/show row in the map and returns the count', () => {
      seedRow('movie-downloading', DownloadJobStatus.Downloading)
      seedRow('movie-attention', DownloadJobStatus.NeedsAttention)
      seedRow('show-searching', DownloadJobStatus.Searching, DownloadType.Show)
      seedRow('show-requested', DownloadJobStatus.Requested, DownloadType.Show)
      seedRow('show-importing', DownloadJobStatus.Importing, DownloadType.Show)
      seedRow('show-paused', DownloadJobStatus.Paused, DownloadType.Show)

      expect(service.adoptOpenJobs()).toBe(6)
      expect([...service.jobs.keys()].sort()).toEqual([
        'movie-attention',
        'movie-downloading',
        'show-importing',
        'show-paused',
        'show-requested',
        'show-searching',
      ])
      expect(service.jobs.get('movie-downloading')?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(service.jobs.get('show-paused')?.status).toBe(
        DownloadJobStatus.Paused,
      )
    })

    it('adopts a needs_attention row of any type, videos included', () => {
      seedRow('movie-attention', DownloadJobStatus.NeedsAttention)
      seedRow(
        'show-attention',
        DownloadJobStatus.NeedsAttention,
        DownloadType.Show,
      )
      seedRow(
        'video-attention',
        DownloadJobStatus.NeedsAttention,
        DownloadType.Video,
      )

      expect(service.adoptOpenJobs()).toBe(3)
      expect([...service.jobs.keys()].sort()).toEqual([
        'movie-attention',
        'show-attention',
        'video-attention',
      ])
    })

    // In production `reconcileInterruptedJobs()` has already failed these by
    // the time this runs; adopting one anyway would track a yt-dlp run that
    // died with the previous process.
    it('never adopts any other open video row', () => {
      seedRow(
        'video-downloading',
        DownloadJobStatus.Downloading,
        DownloadType.Video,
      )
      seedRow('video-paused', DownloadJobStatus.Paused, DownloadType.Video)

      expect(service.adoptOpenJobs()).toBe(0)
      expect(service.jobs.size).toBe(0)
    })

    it('never adopts a terminal row of any type', () => {
      for (const type of Object.values(DownloadType)) {
        seedRow(`${type}-done`, DownloadJobStatus.Completed, type)
        seedRow(`${type}-failed`, DownloadJobStatus.Failed, type)
        seedRow(`${type}-cancelled`, DownloadJobStatus.Cancelled, type)
      }

      expect(service.adoptOpenJobs()).toBe(0)
      expect(service.jobs.size).toBe(0)
    })

    it('broadcasts nothing - nothing is connected at boot', () => {
      seedRow('attention-1', DownloadJobStatus.NeedsAttention)
      seedRow('downloading-1', DownloadJobStatus.Downloading)

      service.adoptOpenJobs()

      expect(downloadGateway.broadcastPerViewer).not.toHaveBeenCalled()
    })

    it('is idempotent - a second sweep re-adopts nothing new', () => {
      seedRow('downloading-1', DownloadJobStatus.Downloading)
      const first = service.adoptOpenJobs()
      const adopted = service.jobs.get('downloading-1')

      expect(first).toBe(1)
      expect(service.adoptOpenJobs()).toBe(1)
      expect(service.jobs.size).toBe(1)
      expect(service.jobs.get('downloading-1')).toBe(adopted)
    })

    // The boot sequence in bootstrap.ts: the sweep, then the adoption. Every
    // row ends up either failed or back in the Map - never both, never
    // neither - and terminal rows are left alone by both halves.
    it('adopts exactly the rows reconcileInterruptedJobs() spares', () => {
      seedRow('movie-downloading', DownloadJobStatus.Downloading)
      seedRow('show-paused', DownloadJobStatus.Paused, DownloadType.Show)
      seedRow(
        'video-attention',
        DownloadJobStatus.NeedsAttention,
        DownloadType.Video,
      )
      seedRow(
        'video-downloading',
        DownloadJobStatus.Downloading,
        DownloadType.Video,
      )
      seedRow('video-paused', DownloadJobStatus.Paused, DownloadType.Video)
      seedRow('movie-done', DownloadJobStatus.Completed)

      expect(reconcileInterruptedJobs(dbService.db)).toBe(2)
      expect(service.adoptOpenJobs()).toBe(3)

      expect([...service.jobs.keys()].sort()).toEqual([
        'movie-downloading',
        'show-paused',
        'video-attention',
      ])
      for (const id of ['video-downloading', 'video-paused']) {
        const row = dbService.db
          .select()
          .from(jobs)
          .where(eq(jobs.id, id))
          .get()
        expect(row?.status).toBe(DownloadJobStatus.Failed)
        expect(row?.error).toBe('Interrupted by a service restart')
      }
    })

    it('returns 0 on an empty table', () => {
      expect(service.adoptOpenJobs()).toBe(0)
      expect(service.jobs.size).toBe(0)
    })
  })
})
