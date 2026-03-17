import {
  DownloadJob,
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
import { DownloadStepOptions } from './types'

@Injectable()
export class DownloadSchedulerService {
  private logger = new Logger(DownloadSchedulerService.name)

  constructor(
    private readonly downloadVideoService: DownloadVideoService,
    private readonly downloadStateService: DownloadStateService,
    private readonly metrics: DownloadMetricsService,
  ) {}

  add(job: DownloadJob) {
    const action = 'addJob'
    const sanitizedUrl = job.url.split('?')[0]

    this.logger.log(
      {
        action,
        jobId: job.id,
        url: sanitizedUrl,
        jobType: job.type,
        queueSizeBefore: this.downloadStateService.queue.size(),
        inProgressJobs: this.downloadStateService.inProgressJobs.size,
      },
      'Adding job to queue',
    )

    this.downloadStateService.jobs.set(job.id, job)
    this.downloadStateService.queue.push(job.id)

    this.logger.log(
      {
        action,
        jobId: job.id,
        url: sanitizedUrl,
        queueSizeAfter: this.downloadStateService.queue.size(),
      },
      'Job added to queue successfully',
    )

    this.metrics.setQueueDepth(this.downloadStateService.queue.size())
    this.maybeProcessNextJob()
  }

  delete(id: string): DownloadJob | undefined {
    const action = 'deleteJob'
    const job = this.downloadStateService.jobs.get(id)

    if (!job) {
      this.logger.warn({ action, jobId: id }, 'Job not found for deletion')
      return undefined
    }

    const sanitizedUrl = job.url.split('?')[0]

    this.logger.log(
      {
        action,
        jobId: id,
        url: sanitizedUrl,
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
        url: sanitizedUrl,
        queueSizeAfter: this.downloadStateService.queue.size(),
      },
      'Job deleted from queue successfully',
    )

    this.maybeProcessNextJob()

    return job
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

    const sanitizedUrl = job.url.split('?')[0]
    const jobStartTime = Date.now()

    this.logger.log(
      {
        action,
        jobId: id,
        url: sanitizedUrl,
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
          url: sanitizedUrl,
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
          url: sanitizedUrl,
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
          url: sanitizedUrl,
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
          url: sanitizedUrl,
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
          url: sanitizedUrl,
          totalDuration,
          downloadDuration,
          convertDuration,
          uploadDuration,
          cleanDuration,
        },
        'Job processing completed successfully',
      )
    } catch (err) {
      const error = getErrorMessage(err)
      const totalDuration = Date.now() - jobStartTime

      this.logger.error(
        {
          action,
          jobId: id,
          url: sanitizedUrl,
          error,
          totalDuration,
          jobType: job.type,
          jobStatus: job.status,
        },
        'Error processing job',
      )

      this.downloadStateService.updateJob(job.id, {
        status: DownloadJobStatus.Failed,
      })

      this.metrics.jobCompleted('failed')
    } finally {
      inProgressJobs.delete(job.id)

      this.metrics.setInProgress(inProgressJobs.size)
      this.metrics.setQueueDepth(queue.size())

      this.logger.log(
        {
          action,
          jobId: id,
          url: sanitizedUrl,
          inProgressJobsRemaining: inProgressJobs.size,
          queueSizeRemaining: queue.size(),
        },
        'Job removed from in-progress, checking for next job',
      )

      this.maybeProcessNextJob()
    }
  }
}
