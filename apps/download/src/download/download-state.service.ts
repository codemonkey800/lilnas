import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJob,
  DownloadJobEvent,
  DownloadJobEventType,
  isVideoDownloadJob,
} from '@lilnas/utils/download/types'
import { Queue } from '@lilnas/utils/queue'
import { Injectable, Logger } from '@nestjs/common'
import _ from 'lodash'

import { DownloadGateway } from 'src/download-gateway/download.gateway'

@Injectable()
export class DownloadStateService {
  private logger = new Logger(DownloadStateService.name)

  inProgressJobs = new Set<string>()
  jobs = new Map<string, DownloadJob>()
  queue = new Queue<string>()

  constructor(private readonly downloadGateway: DownloadGateway) {}

  /**
   * Inserts a brand-new job and broadcasts its creation. Job creation never
   * goes through `updateJob()` below (there's no existing job in the map to
   * update yet), so without this, a freshly-created job would stay
   * invisible to other connected clients until its first status change -
   * this is the only place that closes that gap. Every direct-insert call
   * site (`DownloadSchedulerService.add()`, `MediaDownloadService`'s
   * requestMovie/requestShow) must go through this method instead of
   * touching `jobs.set()` itself.
   */
  addJob(job: DownloadJob): void {
    this.jobs.set(job.id, job)
    this.broadcastJobEvent(job, DownloadJobEventType.Created)
  }

  updateJob(id: string, updates: Partial<DownloadJob>): DownloadJob {
    const action = 'updateJob'
    const job = this.jobs.get(id)

    if (!job) {
      this.logger.error(
        { action, jobId: id, totalJobs: this.jobs.size },
        'Job not found for update',
      )
      throw new Error(`Job with ID '${id}' not found`)
    }

    const sanitizedUrl = job.url.split('?')[0]
    const oldStatus = job.status
    const oldTitle = job.title
    const oldDescription = job.description
    const hasProcess = isVideoDownloadJob(job) && !!job.proc

    // Extract key fields from updates for logging
    const updateKeys = Object.keys(updates)
    const newStatus = updates.status
    const hasNewTitle = 'title' in updates
    const hasNewDescription = 'description' in updates
    const hasNewProcess = 'proc' in updates

    this.logger.log(
      {
        action,
        jobId: id,
        url: sanitizedUrl,
        updateKeys,
        statusTransition: newStatus
          ? `${oldStatus} -> ${newStatus}`
          : undefined,
        titleUpdate: hasNewTitle ? (oldTitle ? 'updated' : 'added') : undefined,
        descriptionUpdate: hasNewDescription
          ? oldDescription
            ? 'updated'
            : 'added'
          : undefined,
        processUpdate: hasNewProcess
          ? hasProcess
            ? 'updated'
            : 'added'
          : undefined,
      },
      'Updating job state',
    )

    const updatedJob = _.merge({
      ...job,
      ...updates,
    })

    this.jobs.set(id, updatedJob)

    // Log the result based on what was changed
    if (newStatus && newStatus !== oldStatus) {
      this.logger.log(
        {
          action,
          jobId: id,
          url: sanitizedUrl,
          oldStatus,
          newStatus,
          totalJobs: this.jobs.size,
          queueSize: this.queue.size(),
          inProgressJobs: this.inProgressJobs.size,
        },
        'Job status updated',
      )
    }

    if (hasNewTitle || hasNewDescription) {
      this.logger.log(
        {
          action,
          jobId: id,
          url: sanitizedUrl,
          titleAdded: hasNewTitle && !oldTitle,
          descriptionAdded: hasNewDescription && !oldDescription,
        },
        'Job metadata updated',
      )
    }

    if (hasNewProcess) {
      this.logger.debug(
        {
          action,
          jobId: id,
          url: sanitizedUrl,
          processAdded: !!updates.proc,
          processRemoved: updates.proc === undefined,
        },
        'Job process reference updated',
      )
    }

    this.logger.debug(
      {
        action,
        jobId: id,
        url: sanitizedUrl,
        updateKeys,
        totalJobs: this.jobs.size,
      },
      'Job update completed',
    )

    this.broadcastJobEvent(updatedJob, DownloadJobEventType.Updated)

    return updatedJob
  }

  private broadcastJobEvent(
    job: DownloadJob,
    type: DownloadJobEventType,
  ): void {
    // VideoDownloadJob.proc is a live ChildProcess handle - not JSON-safe
    // (circular references would throw inside DownloadGateway.broadcast()'s
    // JSON.stringify()) and not meaningful to a WS subscriber anyway.
    // Stripped the same way getJobLogger() strips it before logging
    // (download-video.service.ts): setting it to `undefined` rather than
    // deleting the key, since JSON.stringify() omits `undefined`-valued
    // properties entirely, and this is a fresh shallow copy so the job
    // actually stored in `this.jobs` is untouched.
    const broadcastableJob = isVideoDownloadJob(job)
      ? { ...job, proc: undefined }
      : job

    const event: DownloadJobEvent = { job: broadcastableJob, type }

    this.downloadGateway.broadcast({
      data: event,
      type: DOWNLOAD_JOB_EVENT_TYPE,
    })
  }
}
