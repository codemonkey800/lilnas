import {
  DownloadJob,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'
import { env } from '@lilnas/utils/env'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { match } from 'ts-pattern'

import { EnvKey } from 'src/utils/env'

import { DownloadStateService } from './download-state.service'
import { DownloadVideoService } from './download-video.service'
import { DownloadStepOptions } from './types'

@Injectable()
export class DownloadSchedulerService {
  private logger = new Logger(DownloadSchedulerService.name)

  constructor(
    private readonly downloadVideoService: DownloadVideoService,
    private readonly downloadStateService: DownloadStateService,
  ) {}

  add(job: DownloadJob) {
    this.downloadStateService.jobs.set(job.id, job)
    this.downloadStateService.queue.push(job.id)
    this.maybeProcessNextJob()
  }

  delete(id: string): DownloadJob | undefined {
    const job = this.downloadStateService.jobs.get(id)

    if (!job) {
      return undefined
    }

    this.downloadStateService.queue.delete(id)
    this.maybeProcessNextJob()

    return job
  }

  private async maybeProcessNextJob(): Promise<void> {
    const action = 'maybeProcessNextJob'
    const { inProgressJobs, jobs, queue } = this.downloadStateService

    if (queue.isEmpty()) {
      this.logger.log({ action }, 'Queue is empty')
      return
    }

    const maxDownloads = +env<EnvKey>('MAX_DOWNLOADS')
    if (inProgressJobs.size >= maxDownloads) {
      this.logger.log({ action }, 'Max downloads reached')
      return
    }

    const id = queue.pop() ?? ''
    const job = jobs.get(id)

    if (!job) {
      this.logger.log({ action, id }, 'Unable to find job')
      throw new Error(`Unable to process job with ID '${id}'`)
    }

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

      await download()
      await convert()
      await upload()
      await clean()

      this.downloadStateService.updateJob(job.id, {
        status: DownloadJobStatus.Completed,
      })
    } catch (err) {
      const error = getErrorMessage(err)
      this.logger.error({ ...options, error }, 'Error processing job')

      this.downloadStateService.updateJob(job.id, {
        status: DownloadJobStatus.Failed,
      })
    } finally {
      inProgressJobs.delete(job.id)
      this.maybeProcessNextJob()
    }
  }
}
