import { DownloadJob } from '@lilnas/utils/download/types'
import { Queue } from '@lilnas/utils/queue'
import { Injectable, Logger } from '@nestjs/common'
import _ from 'lodash'

@Injectable()
export class DownloadStateService {
  private logger = new Logger(DownloadStateService.name)

  inProgressJobs = new Set<string>()
  jobs = new Map<string, DownloadJob>()
  queue = new Queue<string>()

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
    const hasProcess = !!job.proc

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

    return updatedJob
  }
}
