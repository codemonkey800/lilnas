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
import { spawn } from 'child_process'
import fs from 'fs-extra'
import { nanoid } from 'nanoid'

import { DownloadSchedulerService } from './download-scheduler.service'
import { DownloadStateService } from './download-state.service'

const VIDEO_DIR = '/download/videos'

async function getVideoInfo(url: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const proc = spawn('/usr/bin/yt-dlp', ['--dump-json', url])

    const timeout = setTimeout(() => {
      proc.kill()
      reject(new Error('yt-dlp timed out'))
    }, 30000)

    proc.stdout.on('data', chunk => {
      chunks.push(chunk)
    })

    proc.stderr.on('data', data => {
      console.error(`yt-dlp stderr: ${data}`)
    })

    proc.on('error', err => {
      clearTimeout(timeout)
      reject(err)
    })

    proc.on('close', code => {
      clearTimeout(timeout)

      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}`))
        return
      }

      const result = Buffer.concat(chunks).toString()

      try {
        if (isJson(result)) {
          resolve(VideoInfoSchema.parse(JSON.parse(result)))
        } else {
          // sometimes yt-dlp will output JSON on multiple lines for Instagram posts
          // with multiple videos.  this only happens if the user didn't set a title or
          // description, so we can just default whatever is set for the first video.
          const info = VideoInfoSchema.parse(JSON.parse(result.split('\n')[0]))

          resolve({
            title: info.playlist || info.title,
            description: info.description,
          })
        }
      } catch (err) {
        reject(new Error(`Failed to parse yt-dlp output: ${err}`))
      }
    })
  })
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
