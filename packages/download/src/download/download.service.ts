import { VideoInfoSchema } from '@lilnas/utils/download/schema'
import {
  CreateDownloadJobInput,
  DownloadJob,
  DownloadJobStatus,
  DownloadType,
  VideoInfo,
} from '@lilnas/utils/download/types'
import { isJson } from '@lilnas/utils/json'
import { Injectable, Logger } from '@nestjs/common'
import { execSync } from 'child_process'
import fs from 'fs-extra'
import { nanoid } from 'nanoid'

import { DownloadSchedulerService } from './download-scheduler.service'
import { DownloadStateService } from './download-state.service'

const VIDEO_DIR = '/download/videos'

async function getVideoInfo(url: string): Promise<VideoInfo> {
  const result = execSync(`/usr/bin/yt-dlp --dump-json '${url}'`).toString()

  if (isJson(result)) {
    return VideoInfoSchema.parse(JSON.parse(result))
  }

  // sometimes yt-dlp will output JSON on multiple lines for Instagram posts
  // with multiple videos.  this only happens if the user didn't set a title or
  // description, so we can just default whatever is set for the first video.
  const info = VideoInfoSchema.parse(JSON.parse(result.split('\n')[0]))

  return {
    title: info.playlist || info.title,
    description: info.description,
  }
}

@Injectable()
export class DownloadService {
  private logger = new Logger(DownloadService.name)

  constructor(
    private readonly downloadScheduler: DownloadSchedulerService,
    private readonly downloadStateService: DownloadStateService,
  ) {}

  async createVideoDownloadJob({
    timeRange,
    url,
  }: CreateDownloadJobInput): Promise<DownloadJob> {
    const info = await getVideoInfo(url)
    const job: DownloadJob = {
      timeRange,
      url,
      id: nanoid(),
      status: DownloadJobStatus.Pending,
      type: DownloadType.Video,
      title: info.title ?? undefined,
      description: info.description ?? undefined,
    }

    await fs.ensureDir(`${VIDEO_DIR}/${job.id}`)

    this.downloadScheduler.add(job)

    return job
  }

  cancelVideoDownloadJob(id: string): DownloadJob {
    const action = 'cancelVideoDownloadJob'
    const job = this.downloadStateService.jobs.get(id)

    if (!job) {
      this.logger.warn({ action, id }, 'Job not found')
      throw new Error(`Job with ID '${id}' not found`)
    }

    const logArgs = {
      action,
      id,
      url: job.url,
      type: job.type,
    }

    if (!job.proc) {
      this.logger.warn(logArgs, 'Job not started')
      throw new Error(`Job '${id}' has not started`)
    }

    job.proc.removeAllListeners('close')
    job.proc.once('close', () => {
      this.downloadStateService.updateJob(job.id, {
        proc: undefined,
        status: DownloadJobStatus.Cancelled,
      })

      this.logger.log(logArgs, 'Job closed')
    })

    job.proc.kill()

    this.downloadScheduler.delete(id)
    return this.downloadStateService.updateJob(id, {
      status: DownloadJobStatus.Cancelling,
    })
  }
}
