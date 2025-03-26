import { DownloadJob } from '@lilnas/utils/download/types'
import { Queue } from '@lilnas/utils/queue'
import { Injectable } from '@nestjs/common'
import _ from 'lodash'

@Injectable()
export class DownloadStateService {
  inProgressJobs = new Set<string>()
  jobs = new Map<string, DownloadJob>()
  queue = new Queue<string>()

  updateJob(id: string, updates: Partial<DownloadJob>): DownloadJob {
    const job = this.jobs.get(id)

    if (!job) {
      throw new Error(`Job with ID '${id}' not found`)
    }

    const updatedJob = _.merge({
      ...job,
      ...updates,
    })

    this.jobs.set(id, updatedJob)

    return updatedJob
  }
}
