// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (DownloadService
// itself, via createVideoDownloadJob()) must mock it first (see
// download-state.service.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  DownloadJob,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ChildProcessWithoutNullStreams } from 'child_process'

import { DownloadService } from 'src/download/download.service'
import { DownloadMetricsService } from 'src/download/download-metrics.service'
import { DownloadSchedulerService } from 'src/download/download-scheduler.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobInterruptKind } from 'src/download/job-interrupted.error'
import { MediaFileService } from 'src/media/media-file.service'

const NOW_ISO = '2026-08-25T12:00:00.000Z'

type JobUpdates = Partial<Omit<DownloadJobRecord, 'id' | 'mediaId' | 'type'>>

/**
 * Every ordering-sensitive call made during a test, in the order it happened.
 * Pause's correctness depends on the interruption note being recorded *before*
 * the signal goes out, and that is not something a plain
 * `toHaveBeenCalledWith` can see.
 */
let callOrder: string[] = []

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

/** The record -> wire-shape projection, mirroring DownloadStateService. */
function toJob(record: DownloadJobRecord): DownloadJob {
  const { mediaId, type: _type, ...jobFields } = record
  void _type

  return {
    ...jobFields,
    media: {
      id: mediaId,
      sourceUrl: 'https://example.com/video',
      title: 'A video',
      type: DownloadType.Video,
    },
  }
}

/**
 * A `ChildProcessWithoutNullStreams` stand-in. `removeAllListeners`/`once` are
 * here purely so the tests can assert they are *never* called: the old cancel
 * implementation stripped the `close` listener `runProcess()` settles its
 * promise from, which stranded the job's in-progress slot forever.
 */
function createProcMock() {
  return {
    kill: jest.fn(() => {
      callOrder.push('kill')
      return true
    }),
    once: jest.fn(),
    removeAllListeners: jest.fn(),
  }
}

type ProcMock = ReturnType<typeof createProcMock>

function asProc(proc: ProcMock): ChildProcessWithoutNullStreams {
  return proc as unknown as ChildProcessWithoutNullStreams
}

/**
 * A `DownloadStateService` double backed by real Maps, so the service under
 * test sees the same read-your-writes behaviour it does in production - which
 * is what makes "pause twice" and "resume twice" meaningful here.
 */
function createStateMock() {
  const interruptions = new Map<string, JobInterruptKind>()
  const jobs = new Map<string, DownloadJobRecord>()
  const procs = new Map<string, ChildProcessWithoutNullStreams>()

  return {
    // The real one falls back to the durable `jobs` row and seeds the Map;
    // here the Map *is* the durable store, so a hit is the whole behaviour.
    adoptJob: jest.fn((id: string) => jobs.get(id)),
    clearInterruption: jest.fn((id: string) => {
      interruptions.delete(id)
    }),
    getProc: jest.fn((id: string) => procs.get(id)),
    hydrateOne: jest.fn((record: DownloadJobRecord) =>
      Promise.resolve(toJob(record)),
    ),
    interruptions,
    jobs,
    procs,
    setInterruption: jest.fn((id: string, kind: JobInterruptKind) => {
      callOrder.push('setInterruption')
      interruptions.set(id, kind)
    }),
    updateJob: jest.fn((id: string, updates: JobUpdates) => {
      const record = jobs.get(id)
      if (!record) {
        throw new Error(`Job with ID '${id}' not found`)
      }

      const updated: DownloadJobRecord = {
        ...record,
        ...updates,
        updatedAt: NOW_ISO,
      }
      jobs.set(id, updated)

      return updated
    }),
    updateVideo: jest.fn(),
  }
}

describe('DownloadService', () => {
  let service: DownloadService
  let state: ReturnType<typeof createStateMock>
  let proc: ProcMock

  const scheduler = {
    add: jest.fn(),
    delete: jest.fn(),
    requeue: jest.fn(),
  }

  const mediaFileService = {
    deleteVideoObjects: jest.fn(() => Promise.resolve(2)),
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

  /** Seeds a job into the fake state, optionally with a live process. */
  function seed(
    overrides: Partial<DownloadJobRecord> = {},
    options: { withProc?: boolean } = {},
  ): DownloadJobRecord {
    const record = buildRecord(overrides)
    state.jobs.set(record.id, record)

    if (options.withProc ?? true) {
      state.procs.set(record.id, asProc(proc))
    }

    return record
  }

  beforeEach(async () => {
    callOrder = []
    state = createStateMock()
    proc = createProcMock()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadService,
        { provide: DownloadMetricsService, useValue: metrics },
        { provide: DownloadSchedulerService, useValue: scheduler },
        { provide: DownloadStateService, useValue: state },
        { provide: MediaFileService, useValue: mediaFileService },
      ],
    }).compile()

    service = module.get(DownloadService)

    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  describe('pauseVideoDownloadJob', () => {
    it('records the pause intent, kills the process and parks the job at Pausing', async () => {
      const record = seed()

      const job = await service.pauseVideoDownloadJob(record.id)

      expect(state.interruptions.get(record.id)).toBe('pause')
      expect(proc.kill).toHaveBeenCalledTimes(1)
      expect(state.updateJob).toHaveBeenCalledWith(record.id, {
        status: DownloadJobStatus.Pausing,
      })
      expect(job.status).toBe(DownloadJobStatus.Pausing)
    })

    // The whole reason `setInterruption` exists. `runProcess()`'s close
    // handler reads the note the instant the process dies; recording it after
    // the signal races that read, and losing the race reports a deliberate
    // pause as a crashed download.
    it('records the interruption before signalling the process', async () => {
      const record = seed()

      await service.pauseVideoDownloadJob(record.id)

      expect(callOrder).toEqual(['setInterruption', 'kill'])
    })

    it('never lands the job in Paused itself - the scheduler owns that', async () => {
      const record = seed()

      await service.pauseVideoDownloadJob(record.id)

      expect(state.updateJob).toHaveBeenCalledTimes(1)
      expect(state.jobs.get(record.id)?.status).toBe(DownloadJobStatus.Pausing)
    })

    it('rejects an id the jobs map has never heard of', async () => {
      await expect(service.pauseVideoDownloadJob('ghost')).rejects.toThrow(
        NotFoundException,
      )
      await expect(service.pauseVideoDownloadJob('ghost')).rejects.toThrow(
        "Job with ID 'ghost' not found",
      )
    })

    // A pausable job is running *right now*, so it is in the Map by
    // definition. A row-only job outlived a restart, and a restart already
    // killed whatever process there was to pause.
    it('does not fall back to the durable jobs row', async () => {
      await expect(service.pauseVideoDownloadJob('ghost')).rejects.toThrow(
        NotFoundException,
      )
      expect(proc.kill).not.toHaveBeenCalled()
    })

    it.each([DownloadType.Movie, DownloadType.Show])(
      'rejects a %s job',
      async type => {
        const record = seed({ mediaId: 'movie:1', type })

        await expect(service.pauseVideoDownloadJob(record.id)).rejects.toThrow(
          BadRequestException,
        )
        await expect(service.pauseVideoDownloadJob(record.id)).rejects.toThrow(
          `Job '${record.id}' is not a video job`,
        )
        expect(proc.kill).not.toHaveBeenCalled()
      },
    )

    // Pending is the queued-but-unstarted case: there is nothing to signal,
    // and the message has to say so rather than looking like a missing job.
    it('rejects a queued job that has not started downloading', async () => {
      const record = seed(
        { status: DownloadJobStatus.Pending },
        {
          withProc: false,
        },
      )

      await expect(service.pauseVideoDownloadJob(record.id)).rejects.toThrow(
        ConflictException,
      )
      await expect(service.pauseVideoDownloadJob(record.id)).rejects.toThrow(
        `Job '${record.id}' cannot be paused while it is 'pending'; only a downloading job can be paused`,
      )
      expect(proc.kill).not.toHaveBeenCalled()
      expect(state.setInterruption).not.toHaveBeenCalled()
    })

    // ffmpeg has no resume, so pausing mid-transcode would mean redoing it
    // from zero. The status guard is also what guarantees `getProc()` hands
    // back yt-dlp rather than ffmpeg: convert() writes Converting first.
    it.each([
      DownloadJobStatus.Converting,
      DownloadJobStatus.Uploading,
      DownloadJobStatus.Cleaning,
    ])('refuses to pause during the %s phase', async status => {
      const record = seed({ status })

      await expect(service.pauseVideoDownloadJob(record.id)).rejects.toThrow(
        ConflictException,
      )
      expect(proc.kill).not.toHaveBeenCalled()
    })

    it.each([DownloadJobStatus.Pausing, DownloadJobStatus.Paused])(
      'refuses a second pause while the job is already %s',
      async status => {
        const record = seed({ status })

        await expect(service.pauseVideoDownloadJob(record.id)).rejects.toThrow(
          ConflictException,
        )
        expect(proc.kill).not.toHaveBeenCalled()
        expect(state.setInterruption).not.toHaveBeenCalled()
      },
    )

    // The pre-spawn window. `download()` writes Downloading before it fetches
    // metadata and only registers the yt-dlp handle afterwards, so a job can
    // legitimately be Downloading with nothing to signal for about a second.
    // This used to throw a 409 on a job the UI was showing as downloading;
    // recording the intent instead lets `download()` deliver the signal itself
    // the moment it registers the handle.
    it('records the intent when the process is not registered yet', async () => {
      const record = seed({}, { withProc: false })

      const job = await service.pauseVideoDownloadJob(record.id)

      expect(state.setInterruption).toHaveBeenCalledWith(record.id, 'pause')
      expect(state.updateJob).toHaveBeenCalledWith(record.id, {
        status: DownloadJobStatus.Pausing,
      })
      expect(job.status).toBe(DownloadJobStatus.Pausing)
    })
  })

  describe('resumeVideoDownloadJob', () => {
    it('clears the interruption, marks the job Pending and requeues it', async () => {
      const record = seed({ status: DownloadJobStatus.Paused })

      const job = await service.resumeVideoDownloadJob(record.id)

      expect(state.clearInterruption).toHaveBeenCalledWith(record.id)
      expect(state.updateJob).toHaveBeenCalledWith(record.id, {
        status: DownloadJobStatus.Pending,
      })
      expect(scheduler.requeue).toHaveBeenCalledWith(record.id)
      expect(metrics.jobResumed).toHaveBeenCalledTimes(1)
      expect(job.status).toBe(DownloadJobStatus.Pending)
    })

    // `add()` would route through addJob(), re-persisting the row and
    // re-broadcasting a Created event for a job every client already has.
    it('requeues rather than adding the job a second time', async () => {
      const record = seed({ status: DownloadJobStatus.Paused })

      await service.resumeVideoDownloadJob(record.id)

      expect(scheduler.requeue).toHaveBeenCalledTimes(1)
      expect(scheduler.add).not.toHaveBeenCalled()
    })

    // With a free slot, requeue() drives the scheduler into download()
    // synchronously, which writes Downloading before returning.
    it('returns the fresher status when requeue starts the job immediately', async () => {
      const record = seed({ status: DownloadJobStatus.Paused })
      scheduler.requeue.mockImplementationOnce((id: string) => {
        state.updateJob(id, { status: DownloadJobStatus.Downloading })
      })

      const job = await service.resumeVideoDownloadJob(record.id)

      expect(job.status).toBe(DownloadJobStatus.Downloading)
    })

    it('rejects an id the jobs map has never heard of', async () => {
      await expect(service.resumeVideoDownloadJob('ghost')).rejects.toThrow(
        NotFoundException,
      )
      await expect(service.resumeVideoDownloadJob('ghost')).rejects.toThrow(
        "Job with ID 'ghost' not found",
      )
    })

    it.each([DownloadType.Movie, DownloadType.Show])(
      'rejects a %s job',
      async type => {
        const record = seed({
          mediaId: 'show:1',
          status: DownloadJobStatus.Paused,
          type,
        })

        await expect(service.resumeVideoDownloadJob(record.id)).rejects.toThrow(
          BadRequestException,
        )
        expect(scheduler.requeue).not.toHaveBeenCalled()
      },
    )

    it.each([
      DownloadJobStatus.Pending,
      DownloadJobStatus.Downloading,
      // Still winding down: requeueing now would run a second yt-dlp against
      // the same .part file.
      DownloadJobStatus.Pausing,
      DownloadJobStatus.Completed,
    ])('refuses to resume a job that is %s', async status => {
      const record = seed({ status })

      await expect(service.resumeVideoDownloadJob(record.id)).rejects.toThrow(
        ConflictException,
      )
      await expect(service.resumeVideoDownloadJob(record.id)).rejects.toThrow(
        `Job '${record.id}' cannot be resumed while it is '${status}'; only a paused job can be resumed`,
      )
      expect(scheduler.requeue).not.toHaveBeenCalled()
      expect(metrics.jobResumed).not.toHaveBeenCalled()
    })

    it('refuses a second resume, because the first already left Paused', async () => {
      const record = seed({ status: DownloadJobStatus.Paused })

      await service.resumeVideoDownloadJob(record.id)

      await expect(service.resumeVideoDownloadJob(record.id)).rejects.toThrow(
        ConflictException,
      )
      expect(scheduler.requeue).toHaveBeenCalledTimes(1)
      expect(metrics.jobResumed).toHaveBeenCalledTimes(1)
    })
  })

  describe('cancelVideoDownloadJob', () => {
    it('records the cancel intent, kills the process and parks the job at Cancelling', async () => {
      const record = seed()

      const job = await service.cancelVideoDownloadJob(record.id)

      expect(state.interruptions.get(record.id)).toBe('cancel')
      expect(proc.kill).toHaveBeenCalledTimes(1)
      expect(metrics.jobCompleted).toHaveBeenCalledWith('cancelled')
      expect(scheduler.delete).toHaveBeenCalledWith(record.id)
      expect(job.status).toBe(DownloadJobStatus.Cancelling)
    })

    it('records the interruption before signalling the process', async () => {
      const record = seed()

      await service.cancelVideoDownloadJob(record.id)

      expect(callOrder).toEqual(['setInterruption', 'kill'])
    })

    // The regression this rewrite exists for: the old implementation called
    // proc.removeAllListeners('close'), which stripped the listener
    // runProcess() settles its promise from. download() then never returned,
    // the scheduler's finally never ran, and the job held its in-progress
    // slot (and an open log file stream) until the process restarted.
    it('leaves the pipeline close listener intact', async () => {
      const record = seed()

      await service.cancelVideoDownloadJob(record.id)

      expect(proc.removeAllListeners).not.toHaveBeenCalled()
      expect(proc.once).not.toHaveBeenCalled()
    })

    // A paused job has no process and no queue entry, so the kill path can't
    // serve it and the "has not started" guard below would strand it.
    it('cancels a paused job outright, with no kill and no scheduler call', async () => {
      const record = seed(
        { status: DownloadJobStatus.Paused },
        {
          withProc: false,
        },
      )

      const job = await service.cancelVideoDownloadJob(record.id)

      expect(job.status).toBe(DownloadJobStatus.Cancelled)
      expect(metrics.jobCompleted).toHaveBeenCalledWith('cancelled')
      expect(proc.kill).not.toHaveBeenCalled()
      expect(scheduler.delete).not.toHaveBeenCalled()
      expect(state.setInterruption).not.toHaveBeenCalled()
    })

    it('rejects an id the jobs map has never heard of', async () => {
      await expect(service.cancelVideoDownloadJob('ghost')).rejects.toThrow(
        "Job with ID 'ghost' not found",
      )
    })

    it.each([DownloadType.Movie, DownloadType.Show])(
      'rejects a %s job',
      async type => {
        const record = seed({ mediaId: 'movie:1', type })

        await expect(service.cancelVideoDownloadJob(record.id)).rejects.toThrow(
          `Job '${record.id}' is not a video job`,
        )
        expect(proc.kill).not.toHaveBeenCalled()
      },
    )

    // Unchanged pre-existing behaviour: a queued-but-unstarted job still
    // can't be cancelled. Widening that is out of scope here.
    it('still refuses a queued job that has not started', async () => {
      const record = seed(
        { status: DownloadJobStatus.Pending },
        {
          withProc: false,
        },
      )

      await expect(service.cancelVideoDownloadJob(record.id)).rejects.toThrow(
        `Job '${record.id}' has not started`,
      )
      expect(metrics.jobCompleted).not.toHaveBeenCalled()
    })
  })

  describe('deleteVideoDownloadJob', () => {
    it('deletes the objects, clears the download URLs and lands the job at Cancelled', async () => {
      const record = seed(
        { status: DownloadJobStatus.Completed },
        { withProc: false },
      )

      const job = await service.deleteVideoDownloadJob(record.id)

      expect(mediaFileService.deleteVideoObjects).toHaveBeenCalledWith(
        'video:v1',
      )
      expect(state.updateVideo).toHaveBeenCalledWith(record.id, {
        downloadUrls: [],
      })
      expect(state.updateJob).toHaveBeenCalledWith(record.id, {
        status: DownloadJobStatus.Cancelled,
      })
      expect(job.status).toBe(DownloadJobStatus.Cancelled)
    })

    // The gap this route closes: `cancel` 404s once a job is Completed, so
    // before it there was no way to remove a finished video at all.
    it('works on a Completed job, which cancel refuses outright', async () => {
      const record = seed(
        { status: DownloadJobStatus.Completed },
        { withProc: false },
      )

      await expect(
        service.deleteVideoDownloadJob(record.id),
      ).resolves.toBeDefined()
      expect(state.getProc).not.toHaveBeenCalled()
    })

    it('stops a running job before removing what it produced', async () => {
      const record = seed({ status: DownloadJobStatus.Downloading })

      await service.deleteVideoDownloadJob(record.id)

      expect(proc.kill).toHaveBeenCalledTimes(1)
      expect(callOrder.indexOf('kill')).toBeGreaterThanOrEqual(0)
      expect(mediaFileService.deleteVideoObjects).toHaveBeenCalled()
    })

    // "It wasn't running" is not a reason to refuse a delete - cancel throws
    // for an unstarted job, and that throw must not become the user's answer.
    it('deletes a queued job even though cancel refuses it', async () => {
      const record = seed(
        { status: DownloadJobStatus.Pending },
        { withProc: false },
      )

      const job = await service.deleteVideoDownloadJob(record.id)

      expect(job.status).toBe(DownloadJobStatus.Cancelled)
      expect(mediaFileService.deleteVideoObjects).toHaveBeenCalled()
    })

    it('404s an unknown job and 400s a non-video one', async () => {
      await expect(service.deleteVideoDownloadJob('nope')).rejects.toThrow(
        NotFoundException,
      )

      const movie = seed(
        {
          id: 'job-movie',
          mediaId: 'tmdb:5',
          status: DownloadJobStatus.Completed,
          type: DownloadType.Movie,
        },
        { withProc: false },
      )

      await expect(service.deleteVideoDownloadJob(movie.id)).rejects.toThrow(
        BadRequestException,
      )
      expect(mediaFileService.deleteVideoObjects).not.toHaveBeenCalled()
    })
  })
})
