import { VideoInfoSchema } from '@lilnas/utils/download/schema'
import {
  CreateDownloadJobInput,
  DownloadJob,
  DownloadJobStatus,
  DownloadType,
  VideoInfo,
} from '@lilnas/utils/download/types'
import { env } from '@lilnas/utils/env'
import { getErrorMessage } from '@lilnas/utils/error'
import { isJson } from '@lilnas/utils/json'
import { Queue } from '@lilnas/utils/queue'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { execSync, spawn } from 'child_process'
import fs from 'fs-extra'
import * as mime from 'mime-types'
import { Client } from 'minio'
import { nanoid } from 'nanoid'
import { MINIO_CONNECTION } from 'nestjs-minio'
import { match } from 'ts-pattern'

import { EnvKey } from 'src/utils/env'

const VIDEO_DIR = '/download/videos'

@Injectable()
export class DownloadService {
  private logger = new Logger(DownloadService.name)
  jobs = new Map<string, DownloadJob>()
  downloadJobs = new Set<string>()
  queue = new Queue<string>()

  constructor(@Inject(MINIO_CONNECTION) private readonly minioClient: Client) {}

  getVideoDownloadJob(id: string): DownloadJob {
    const job = this.jobs.get(id)

    if (!job) {
      throw new Error(`Job with ID '${id}' not found`)
    }

    return job
  }

  async getVideoInfo(url: string): Promise<VideoInfo> {
    const result = execSync(`/usr/bin/yt-dlp --dump-json '${url}'`).toString()

    if (isJson(result)) {
      return VideoInfoSchema.parse(JSON.parse(result))
    }

    const info = VideoInfoSchema.parse(JSON.parse(result.split('\n')[0]))

    return {
      title: info.playlist || info.title,
      description: info.description,
    }
  }

  async createVideoDownloadJob({
    timeRange,
    url,
  }: CreateDownloadJobInput): Promise<DownloadJob> {
    const info = await this.getVideoInfo(url)

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

    this.jobs.set(job.id, job)
    this.queue.push(job.id)
    this.maybeProcessNextJob()

    return job
  }

  cancelVideoDownloadJob(id: string): DownloadJob {
    const action = 'cancelVideoDownloadJob'
    const job = this.jobs.get(id)

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
      this.downloadJobs.delete(job.id)

      this.jobs.set(job.id, {
        ...job,
        status: DownloadJobStatus.Cancelled,
        proc: undefined,
      })

      this.logger.log(logArgs, 'Job closed')
    })

    job.proc.kill()

    const updatedJob: DownloadJob = {
      ...job,
      status: DownloadJobStatus.Cancelling,
    }

    this.jobs.set(id, updatedJob)
    this.queue.delete(id)
    this.maybeProcessNextJob()

    return updatedJob
  }

  private async maybeProcessNextJob(): Promise<void> {
    const action = 'maybeProcessNextJob'

    if (this.queue.isEmpty()) {
      this.logger.log({ action }, 'Queue is empty')
      return
    }

    const maxDownloads = +env<EnvKey>('MAX_DOWNLOADS')
    if (this.downloadJobs.size >= maxDownloads) {
      this.logger.log({ action }, 'Max downloads reached')
      return
    }

    const id = this.queue.pop() ?? ''
    const job = this.jobs.get(id)

    if (!job) {
      this.logger.log({ action, id }, 'Unable to find job')
      throw new Error(`Unable to process job with ID '${id}'`)
    }

    const proc = match(job.type)
      .with(DownloadType.Video, () => this.downloadVideo(job))
      .exhaustive()

    const logArgs = {
      action,
      id,
      url: job.url,
      type: job.type,
    }

    this.logger.log(logArgs, 'Started download job')

    const updatedJob: DownloadJob = {
      ...job,
      proc,
      status: DownloadJobStatus.Downloading,
    }

    this.jobs.set(id, updatedJob)
    this.downloadJobs.add(id)

    const logFile = `${VIDEO_DIR}/${id}/convert.log`
    const logFileStream = fs.createWriteStream(logFile, 'utf-8')

    proc.stdout.on('data', data => {
      logFileStream.write(String(data))
    })

    proc.stderr.on('data', data => {
      logFileStream.write(String(data))
    })

    proc.on('error', err => {
      const error = getErrorMessage(err)

      logFileStream.write(error)
      this.logger.error({ ...logArgs, error }, 'Error while converting video')
    })

    proc.on('close', async code => {
      logFileStream.close()

      const files = await fs.readdir(`${VIDEO_DIR}/${id}`)
      const fileExtensions = ['.mp4', '.mkv', '.webm']
      const videoFiles = files.filter(
        f => !f.endsWith('.log') && fileExtensions.some(ext => f.endsWith(ext)),
      )
      const hasVideos = videoFiles.length > 0

      this.logger.log(
        { ...logArgs, code },
        `Download job ${hasVideos ? 'completed' : 'failed'}`,
      )

      this.downloadJobs.delete(id)
      this.jobs.set(id, {
        ...job,
        proc: undefined,

        status: hasVideos
          ? DownloadJobStatus.Completed
          : DownloadJobStatus.Failed,

        ...(hasVideos
          ? {
              downloadUrls: videoFiles.map(
                (file, idx) =>
                  `${env<EnvKey>('MINIO_PUBLIC_URL')}/videos/${id}/part${idx}.${file.split('.').at(-1) ?? ''}`,
              ),
            }
          : {}),
      })

      this.maybeProcessNextJob()

      if (!hasVideos) {
        return
      }

      this.logger.log({ ...logArgs, files: videoFiles }, 'Uploading video file')

      await Promise.all(
        videoFiles.map(async (file, idx) => {
          const fullFile = `${VIDEO_DIR}/${id}/${file}`
          await this.minioClient.fPutObject(
            'videos',
            `${id}/part${idx}.${file.split('.').at(-1) ?? ''}`,
            fullFile,
            { 'Content-Type': mime.lookup(file) || 'video/webm' },
          )
        }),
      )

      this.logger.log({ ...logArgs, files: videoFiles }, 'Video file uploaded')

      await fs.remove(`${VIDEO_DIR}/${id}`)
    })
  }

  private downloadVideo(job: DownloadJob) {
    const args = [
      ...(job.url.includes('youtube.com')
        ? ['-f', 'bestvideo+bestaudio', '-S', 'ext:mp4:m4a']
        : []),

      ...(job.timeRange
        ? [
            '--download-sections',
            `*${job.timeRange.start}-${job.timeRange.end}`,
            '--force-keyframes-at-cuts',
          ]
        : []),
      job.url,
    ]

    return spawn('/usr/bin/yt-dlp', args, { cwd: `${VIDEO_DIR}/${job.id}` })
  }
}
