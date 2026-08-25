// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadStateService, via ensureVideo()) must mock it first (see
// download-state.service.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  DownloadJobEvent,
  DownloadJobEventType,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ChildProcessWithoutNullStreams } from 'child_process'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { DownloadMetricsService } from 'src/download/download-metrics.service'
import { DownloadSchedulerService } from 'src/download/download-scheduler.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadVideoService } from 'src/download/download-video.service'
import { JobInterruptedError } from 'src/download/job-interrupted.error'
import { DownloadStepOptions } from 'src/download/types'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import {
  createFakeMediaResolver,
  flushAsync,
} from 'src/media/__tests__/helpers/fake-media-resolver'
import { MediaResolverService } from 'src/media/media-resolver.service'

const NOW_ISO = '2026-08-25T12:00:00.000Z'

type StepMock = jest.Mock<Promise<void>, [DownloadStepOptions]>

function stepMock(): StepMock {
  return jest.fn<Promise<void>, [DownloadStepOptions]>(() => Promise.resolve())
}

function buildRecord(
  overrides: Partial<DownloadJobRecord> = {},
): DownloadJobRecord {
  return {
    completedAt: null,
    createdAt: NOW_ISO,
    hiddenAttribution: false,
    id: 'job-1',
    mediaId: 'video:v1',
    requester: null,
    status: DownloadJobStatus.Downloading,
    type: DownloadType.Video,
    updatedAt: NOW_ISO,
    ...overrides,
  }
}

/**
 * The scheduler drives the pipeline from a *floating* `maybeProcessNextJob()`
 * promise (nothing awaits `add()`/`requeue()`), and each finished job kicks
 * off another one from its `finally`. Every step here is an
 * already-settled mock, so the whole cascade is microtasks - a couple of
 * macrotask turns drains it, including the follow-on job.
 */
async function drain(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await flushAsync()
  }
}

describe('DownloadSchedulerService', () => {
  let scheduler: DownloadSchedulerService
  let state: DownloadStateService
  let dbService: DbService
  let downloadGateway: jest.Mocked<DownloadGateway>
  let loggerWarn: jest.SpyInstance
  let originalMaxDownloads: string | undefined

  const steps = {
    clean: stepMock(),
    convert: stepMock(),
    download: stepMock(),
    upload: stepMock(),
  }

  const metrics = {
    jobCompleted: jest.fn(),
    jobCreated: jest.fn(),
    jobPaused: jest.fn(),
    jobResumed: jest.fn(),
    observePhase: jest.fn(),
    observeVideoInfo: jest.fn(),
    setInProgress: jest.fn(),
    setQueueDepth: jest.fn(),
    ytdlpUpdate: jest.fn(),
  }

  // `procs` holds a real ChildProcess in production; nothing under test ever
  // touches a member of it, only whether the entry is still there.
  const fakeProc = {} as ChildProcessWithoutNullStreams

  /** Every `DownloadJobEvent` the gateway was asked to broadcast so far. */
  function broadcastEvents(): DownloadJobEvent[] {
    return downloadGateway.broadcastPerViewer.mock.calls.map(
      ([build]) => build(true).data as DownloadJobEvent,
    )
  }

  beforeEach(async () => {
    originalMaxDownloads = process.env.MAX_DOWNLOADS
    process.env.MAX_DOWNLOADS = '1'

    dbService = createTestDbService()

    steps.clean = stepMock()
    steps.convert = stepMock()
    steps.download = stepMock()
    steps.upload = stepMock()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadSchedulerService,
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        {
          provide: DownloadGateway,
          useValue: { broadcastPerViewer: jest.fn() },
        },
        { provide: DownloadMetricsService, useValue: metrics },
        { provide: DownloadVideoService, useValue: steps },
        { provide: MediaResolverService, useValue: createFakeMediaResolver() },
      ],
    }).compile()

    scheduler = module.get(DownloadSchedulerService)
    state = module.get(DownloadStateService)
    downloadGateway = module.get(DownloadGateway)

    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    loggerWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  afterEach(() => {
    dbService.onModuleDestroy()

    // A plain assignment would coerce `undefined` to the string 'undefined',
    // which env() would happily hand back as a MAX_DOWNLOADS of NaN.
    if (originalMaxDownloads === undefined) {
      delete process.env.MAX_DOWNLOADS
    } else {
      process.env.MAX_DOWNLOADS = originalMaxDownloads
    }
  })

  describe('interrupted jobs', () => {
    it('lands a paused interrupt in Paused with no error, and releases the process handle', async () => {
      const record = buildRecord()
      steps.download.mockImplementation(({ id }) => {
        state.setProc(id, fakeProc)
        state.setInterruption(id, 'pause')
        return Promise.reject(new JobInterruptedError(id, 'pause'))
      })

      scheduler.add(record)
      await drain()

      const job = state.jobs.get(record.id)
      expect(job?.status).toBe(DownloadJobStatus.Paused)
      // A pause is an outcome the user asked for, not a failure - nothing
      // should be sitting in the field the UI renders as an error banner.
      expect(job?.error).toBeUndefined()
      // Paused is non-terminal, so updateJob()'s terminal auto-clear does
      // not fire here; the scheduler branch has to do this itself.
      expect(state.procs.has(record.id)).toBe(false)
      expect(state.getInterruption(record.id)).toBeUndefined()
    })

    it('counts a pause and never books it as a failed completion', async () => {
      steps.download.mockImplementation(({ id }) =>
        Promise.reject(new JobInterruptedError(id, 'pause')),
      )

      scheduler.add(buildRecord())
      await drain()

      expect(metrics.jobPaused).toHaveBeenCalledTimes(1)
      expect(metrics.jobCompleted).not.toHaveBeenCalled()
    })

    it('lands a cancel interrupt in Cancelled with no error', async () => {
      const record = buildRecord()
      steps.download.mockImplementation(({ id }) => {
        state.setProc(id, fakeProc)
        state.setInterruption(id, 'cancel')
        return Promise.reject(new JobInterruptedError(id, 'cancel'))
      })

      scheduler.add(record)
      await drain()

      const job = state.jobs.get(record.id)
      expect(job?.status).toBe(DownloadJobStatus.Cancelled)
      expect(job?.error).toBeUndefined()
      expect(state.getInterruption(record.id)).toBeUndefined()
      // The 'cancelled' completion is booked by
      // DownloadService.cancelVideoDownloadJob at the point of cancellation;
      // counting one here too would double it.
      expect(metrics.jobCompleted).not.toHaveBeenCalled()
      expect(metrics.jobPaused).not.toHaveBeenCalled()
    })

    it('still fails a job on an ordinary pipeline error', async () => {
      const record = buildRecord()
      steps.download.mockImplementation(() =>
        Promise.reject(new Error('yt-dlp exited with code 1')),
      )

      scheduler.add(record)
      await drain()

      const job = state.jobs.get(record.id)
      expect(job?.status).toBe(DownloadJobStatus.Failed)
      expect(job?.error).toBe('yt-dlp exited with code 1')
      expect(metrics.jobCompleted).toHaveBeenCalledWith('failed')
      expect(metrics.jobPaused).not.toHaveBeenCalled()
    })

    it('does not throw when the interrupted job was deleted mid-flight', async () => {
      const record = buildRecord()
      steps.download.mockImplementation(({ id }) => {
        // Exactly the pre-existing race: the job is gone from the Map by the
        // time its killed process finishes winding down. updateJob() throws
        // on an unknown id, and we are inside a catch block.
        state.jobs.delete(id)
        return Promise.reject(new JobInterruptedError(id, 'pause'))
      })

      scheduler.add(record)
      await drain()

      expect(loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: record.id }),
        'Interrupted job no longer exists; skipping status update',
      )
      expect(state.inProgressJobs.size).toBe(0)
    })

    // The whole reason the sentinel branch is worth having: whichever way a
    // job ends, its download slot has to come back. With MAX_DOWNLOADS=1 a
    // slot that never returns wedges the queue until the process restarts.
    const slotCases: [string, () => Error][] = [
      ['pause', () => new JobInterruptedError('job-a', 'pause')],
      ['cancel', () => new JobInterruptedError('job-a', 'cancel')],
      ['a plain failure', () => new Error('boom')],
    ]

    it.each(slotCases)(
      'releases the slot and starts the next job after %s',
      async (_label, makeError) => {
        const first = buildRecord({ id: 'job-a' })
        const second = buildRecord({ id: 'job-b' })
        steps.download.mockImplementation(({ id }) =>
          id === first.id ? Promise.reject(makeError()) : Promise.resolve(),
        )

        scheduler.add(first)
        scheduler.add(second)
        await drain()

        expect(steps.download).toHaveBeenCalledTimes(2)
        expect(state.jobs.get(second.id)?.status).toBe(
          DownloadJobStatus.Completed,
        )
        expect(state.inProgressJobs.size).toBe(0)
        expect(state.queue.isEmpty()).toBe(true)
      },
    )
  })

  describe('requeue', () => {
    it('queues an existing job and runs it without re-broadcasting a "created" event', async () => {
      const record = buildRecord({ status: DownloadJobStatus.Paused })
      // addJob() directly rather than scheduler.add(): the job already
      // exists and every connected client already knows about it, which is
      // exactly the state a resume starts from.
      state.addJob(record)
      await flushAsync()
      downloadGateway.broadcastPerViewer.mockClear()

      scheduler.requeue(record.id)
      await drain()

      expect(steps.download).toHaveBeenCalledWith(
        expect.objectContaining({ id: record.id }),
      )
      expect(state.jobs.get(record.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
      const types = broadcastEvents().map(event => event.type)
      expect(types).not.toContain(DownloadJobEventType.Created)
      expect(types).toContain(DownloadJobEventType.Updated)
    })

    it('leaves the job queued when every download slot is taken', async () => {
      const running = buildRecord({ id: 'job-a' })
      const resumed = buildRecord({
        id: 'job-b',
        status: DownloadJobStatus.Paused,
      })
      // Never settles: job-a holds the single slot for the whole test.
      steps.download.mockImplementation(({ id }) =>
        id === running.id ? new Promise<void>(() => {}) : Promise.resolve(),
      )

      scheduler.add(running)
      state.addJob(resumed)
      await drain()

      scheduler.requeue(resumed.id)
      await drain()

      expect(steps.download).toHaveBeenCalledTimes(1)
      expect(state.queue.toJSON()).toEqual([resumed.id])
      expect(state.jobs.get(resumed.id)?.status).toBe(DownloadJobStatus.Paused)
      expect(state.inProgressJobs.size).toBe(1)
    })

    it('does not queue an id the jobs map has never heard of', async () => {
      scheduler.requeue('ghost')
      await drain()

      expect(loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'ghost' }),
        'Job not found for requeue',
      )
      expect(state.queue.isEmpty()).toBe(true)
      expect(steps.download).not.toHaveBeenCalled()
    })
  })
})
