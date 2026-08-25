import {
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'
import { env } from '@lilnas/utils/env'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { match } from 'ts-pattern'

import { EnvKeys } from 'src/env'

import { DownloadMetricsService } from './download-metrics.service'
import { DownloadStateService } from './download-state.service'
import { DownloadVideoService } from './download-video.service'
import { JobInterruptedError } from './job-interrupted.error'
import { DownloadStepOptions } from './types'

@Injectable()
export class DownloadSchedulerService {
  private logger = new Logger(DownloadSchedulerService.name)

  constructor(
    private readonly downloadVideoService: DownloadVideoService,
    private readonly downloadStateService: DownloadStateService,
    private readonly metrics: DownloadMetricsService,
  ) {}

  add(job: DownloadJobRecord) {
    const action = 'addJob'
    const jobMediaId = job.mediaId

    this.logger.log(
      {
        action,
        jobId: job.id,
        mediaId: jobMediaId,
        jobType: job.type,
        queueSizeBefore: this.downloadStateService.queue.size(),
        inProgressJobs: this.downloadStateService.inProgressJobs.size,
      },
      'Adding job to queue',
    )

    this.downloadStateService.addJob(job)
    this.downloadStateService.queue.push(job.id)

    this.logger.log(
      {
        action,
        jobId: job.id,
        mediaId: jobMediaId,
        queueSizeAfter: this.downloadStateService.queue.size(),
      },
      'Job added to queue successfully',
    )

    this.metrics.setQueueDepth(this.downloadStateService.queue.size())
    this.maybeProcessNextJob()
  }

  delete(id: string): DownloadJobRecord | undefined {
    const action = 'deleteJob'
    const job = this.downloadStateService.jobs.get(id)

    if (!job) {
      this.logger.warn({ action, jobId: id }, 'Job not found for deletion')
      return undefined
    }

    const jobMediaId = job.mediaId

    this.logger.log(
      {
        action,
        jobId: id,
        mediaId: jobMediaId,
        status: job.status,
        queueSizeBefore: this.downloadStateService.queue.size(),
        inProgressJobs: this.downloadStateService.inProgressJobs.size,
      },
      'Deleting job from queue',
    )

    this.downloadStateService.queue.delete(id)

    this.logger.log(
      {
        action,
        jobId: id,
        mediaId: jobMediaId,
        queueSizeAfter: this.downloadStateService.queue.size(),
      },
      'Job deleted from queue successfully',
    )

    this.maybeProcessNextJob()

    return job
  }

  /**
   * Puts an **already-known** job back on the queue - the resume half of
   * pause/resume, and the only supported way to re-enter the pipeline.
   *
   * Deliberately not `add()`: that routes through
   * `DownloadStateService.addJob()`, which re-persists the row and
   * broadcasts a `Created` event for a job every connected client already
   * has, so a resumed job would pop into every Activity feed a second time.
   * The job's status is left to the caller - it owns the
   * Paused -> Pending/Downloading transition and the `Created`-free
   * `Updated` broadcast that comes with it.
   *
   * `Queue.push()` appends, so a resumed job goes to the *back* and competes
   * for a download slot on exactly the same terms as a freshly-created one -
   * resuming can never jump the line ahead of jobs that have been waiting.
   */
  requeue(id: string): void {
    const action = 'requeueJob'
    const job = this.downloadStateService.jobs.get(id)

    // `maybeProcessNextJob()` throws on an id it can't resolve in the `jobs`
    // Map, and it's called here without an `await` - letting a phantom id
    // through would turn into an unhandled rejection rather than anything a
    // caller could act on. Refusing loudly up front matches `delete()`
    // above, which also treats an unknown id as a no-op warning.
    if (!job) {
      this.logger.warn({ action, jobId: id }, 'Job not found for requeue')
      return
    }

    this.logger.log(
      {
        action,
        jobId: id,
        mediaId: job.mediaId,
        jobType: job.type,
        queueSizeBefore: this.downloadStateService.queue.size(),
        inProgressJobs: this.downloadStateService.inProgressJobs.size,
      },
      'Requeueing existing job',
    )

    this.downloadStateService.queue.push(id)

    this.logger.log(
      {
        action,
        jobId: id,
        mediaId: job.mediaId,
        queueSizeAfter: this.downloadStateService.queue.size(),
      },
      'Job requeued successfully',
    )

    this.metrics.setQueueDepth(this.downloadStateService.queue.size())
    this.maybeProcessNextJob()
  }

  private async maybeProcessNextJob(): Promise<void> {
    const action = 'maybeProcessNextJob'
    const { inProgressJobs, jobs, queue } = this.downloadStateService

    this.metrics.setInProgress(inProgressJobs.size)
    this.metrics.setQueueDepth(queue.size())

    this.logger.debug(
      {
        action,
        queueSize: queue.size(),
        inProgressJobs: inProgressJobs.size,
      },
      'Checking if next job can be processed',
    )

    if (queue.isEmpty()) {
      this.logger.log(
        {
          action,
          queueSize: 0,
          inProgressJobs: inProgressJobs.size,
        },
        'Queue is empty, no jobs to process',
      )
      return
    }

    const maxDownloads = +env(EnvKeys.MAX_DOWNLOADS)
    if (inProgressJobs.size >= maxDownloads) {
      this.logger.log(
        {
          action,
          currentJobs: inProgressJobs.size,
          maxDownloads,
          queueSize: queue.size(),
        },
        'Max downloads reached, waiting for slots',
      )
      return
    }

    const id = queue.pop() ?? ''
    const job = jobs.get(id)

    if (!job) {
      this.logger.error(
        { action, jobId: id, queueSize: queue.size() },
        'Unable to find job in jobs map',
      )
      throw new Error(`Unable to process job with ID '${id}'`)
    }

    const jobMediaId = job.mediaId
    const jobStartTime = Date.now()

    this.logger.log(
      {
        action,
        jobId: id,
        mediaId: jobMediaId,
        jobType: job.type,
        queueSizeRemaining: queue.size(),
        inProgressJobs: inProgressJobs.size + 1, // +1 because we're about to add this job
        maxDownloads,
      },
      'Starting job processing',
    )

    const options: DownloadStepOptions = { action, id, job }
    const { download, convert, upload, clean } = match(job.type)
      .with(DownloadType.Video, () => ({
        download: () => this.downloadVideoService.download(options),
        convert: () => this.downloadVideoService.convert(options),
        upload: () => this.downloadVideoService.upload(options),
        clean: () => this.downloadVideoService.clean(options),
      }))
      .with(DownloadType.Movie, DownloadType.Show, () => {
        throw new Error(
          'Movie/Show jobs are not managed by DownloadSchedulerService',
        )
      })
      .exhaustive()

    try {
      inProgressJobs.add(job.id)

      const downloadStartTime = Date.now()
      await download()
      const downloadDuration = Date.now() - downloadStartTime

      this.logger.log(
        {
          action,
          jobId: id,
          mediaId: jobMediaId,
          duration: downloadDuration,
          phase: 'download',
        },
        'Download phase completed',
      )
      this.metrics.observePhase('download', downloadDuration)

      const convertStartTime = Date.now()
      await convert()
      const convertDuration = Date.now() - convertStartTime

      this.logger.log(
        {
          action,
          jobId: id,
          mediaId: jobMediaId,
          duration: convertDuration,
          phase: 'convert',
        },
        'Convert phase completed',
      )
      this.metrics.observePhase('convert', convertDuration)

      const uploadStartTime = Date.now()
      await upload()
      const uploadDuration = Date.now() - uploadStartTime

      this.logger.log(
        {
          action,
          jobId: id,
          mediaId: jobMediaId,
          duration: uploadDuration,
          phase: 'upload',
        },
        'Upload phase completed',
      )
      this.metrics.observePhase('upload', uploadDuration)

      const cleanStartTime = Date.now()
      await clean()
      const cleanDuration = Date.now() - cleanStartTime

      this.logger.log(
        {
          action,
          jobId: id,
          mediaId: jobMediaId,
          duration: cleanDuration,
          phase: 'clean',
        },
        'Clean phase completed',
      )
      this.metrics.observePhase('clean', cleanDuration)

      const totalDuration = Date.now() - jobStartTime

      this.downloadStateService.updateJob(job.id, {
        status: DownloadJobStatus.Completed,
      })

      this.metrics.observePhase('total', totalDuration)
      this.metrics.jobCompleted('completed')

      this.logger.log(
        {
          action,
          jobId: id,
          mediaId: jobMediaId,
          totalDuration,
          downloadDuration,
          convertDuration,
          uploadDuration,
          cleanDuration,
        },
        'Job processing completed successfully',
      )
    } catch (err) {
      const totalDuration = Date.now() - jobStartTime

      // A deliberately-killed process is not a failed one. The pipeline can't
      // tell the two apart from the exit code, so it reads the recorded
      // intent and throws this sentinel instead; branching on it here is what
      // keeps a pause or a cancel from being reported as a crash.
      if (err instanceof JobInterruptedError) {
        this.handleInterruptedJob(err, {
          action,
          id,
          mediaId: jobMediaId,
          totalDuration,
        })
      } else {
        const error = getErrorMessage(err)

        this.logger.error(
          {
            action,
            jobId: id,
            mediaId: jobMediaId,
            error,
            totalDuration,
            jobType: job.type,
            jobStatus: job.status,
          },
          'Error processing job',
        )

        this.downloadStateService.updateJob(job.id, {
          status: DownloadJobStatus.Failed,
          error,
        })

        this.metrics.jobCompleted('failed')
      }
    } finally {
      inProgressJobs.delete(job.id)

      this.metrics.setInProgress(inProgressJobs.size)
      this.metrics.setQueueDepth(queue.size())

      this.logger.log(
        {
          action,
          jobId: id,
          mediaId: jobMediaId,
          inProgressJobsRemaining: inProgressJobs.size,
          queueSizeRemaining: queue.size(),
        },
        'Job removed from in-progress, checking for next job',
      )

      this.maybeProcessNextJob()
    }
  }

  /**
   * Lands a deliberately-interrupted job in the status its interrupt kind
   * implies. Never writes an `error` - an interrupt is an outcome the user
   * asked for, not a failure - and never counts against
   * `download_jobs_completed_total{status="failed"}`; the cancel path already
   * books its own `jobCompleted('cancelled')` at the point of cancellation
   * (`DownloadService.cancelVideoDownloadJob`), so counting one here would
   * double it.
   *
   * The caller's `finally` still runs after this returns, which is the whole
   * point: it drops the job from `inProgressJobs` and pumps the queue, so
   * pausing a job releases its download slot to the next one immediately
   * rather than parking a slot on a process that is already dead.
   */
  private handleInterruptedJob(
    err: JobInterruptedError,
    context: {
      action: string
      id: string
      mediaId: string
      totalDuration: number
    },
  ): void {
    const { action, id, mediaId, totalDuration } = context

    // Unconditional, both kinds: the note describes the *next* exit of a
    // live process, and by the time we're here that process has already
    // exited and been accounted for. `updateJob()` clears it for us on the
    // cancel path (Cancelled is terminal) but not on the pause path, and a
    // surviving 'pause' note is not inert - `assertNotInterrupted()` reads it
    // on every process exit, so a resumed job would throw straight back into
    // Paused the moment its new yt-dlp finished.
    this.downloadStateService.clearInterruption(id)

    const status = match(err.kind)
      .with('pause', () => {
        // Paused is non-terminal, so `updateJob()`'s terminal auto-clear
        // never fires for it - this is the only thing that releases the dead
        // child-process handle. Left behind, `getProc()` would keep handing
        // out a killed process to a later cancel/pause of the same job.
        this.downloadStateService.clearProc(id)
        this.metrics.jobPaused()
        return DownloadJobStatus.Paused
      })
      .with('cancel', () => DownloadJobStatus.Cancelled)
      .exhaustive()

    this.logger.log(
      {
        action,
        jobId: id,
        mediaId,
        totalDuration,
        interruptKind: err.kind,
        newStatus: status,
      },
      'Job interrupted deliberately',
    )

    // `updateJob()` throws on an id it doesn't know, and we are already
    // inside a `catch` - a throw from here escapes into the floating
    // `maybeProcessNextJob()` promise as an unhandled rejection. A job can
    // legitimately vanish from the Map mid-flight (deleted while its process
    // was still winding down), and there is nothing left to update when it
    // has: the clears above already ran, and the caller's `finally` still
    // releases the slot.
    if (!this.downloadStateService.jobs.has(id)) {
      this.logger.warn(
        { action, jobId: id, mediaId, interruptKind: err.kind },
        'Interrupted job no longer exists; skipping status update',
      )
      return
    }

    this.downloadStateService.updateJob(id, { status })
  }
}
