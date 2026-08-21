import { VideoInfoSchema } from '@lilnas/utils/download/schema'
import {
  CreateDownloadJobInput,
  DownloadJob,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  JobRequester,
  VideoInfo,
} from '@lilnas/utils/download/types'
import { isJson } from '@lilnas/utils/json'
import { Injectable, Logger } from '@nestjs/common'
import { spawn } from 'child_process'
import { ensureDir } from 'fs-extra'
import { nanoid } from 'nanoid'

import { mediaId } from 'src/db/media-id'

import { DownloadMetricsService } from './download-metrics.service'
import { DownloadSchedulerService } from './download-scheduler.service'
import { DownloadStateService } from './download-state.service'

const VIDEO_DIR = '/download/videos'

@Injectable()
export class DownloadService {
  private logger = new Logger(DownloadService.name)

  constructor(
    private readonly downloadScheduler: DownloadSchedulerService,
    private readonly downloadStateService: DownloadStateService,
    private readonly metrics: DownloadMetricsService,
  ) {}

  async getVideoInfo(url: string): Promise<VideoInfo> {
    const action = 'getVideoInfo'
    const startTime = Date.now()

    // Sanitize URL for logging (remove query params that might contain sensitive data)
    const sanitizedUrl = url.split('?')[0]

    this.logger.log(
      { action, url: sanitizedUrl },
      'Starting video info extraction',
    )

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const args = ['--dump-json', url]

      this.logger.log(
        { action, args, url: sanitizedUrl },
        'Spawning yt-dlp process',
      )
      const proc = spawn('/usr/bin/yt-dlp', args)

      const timeout = setTimeout(
        () => {
          const duration = Date.now() - startTime
          this.logger.warn(
            {
              action,
              url: sanitizedUrl,
              duration,
              timeoutMs: 60000,
            },
            'yt-dlp timed out, killing process',
          )

          proc.kill()
          reject(new Error('yt-dlp timed out'))
        },
        2 * 60 * 1000,
      )

      proc.stdout.on('data', chunk => {
        chunks.push(chunk)
        this.logger.debug(
          {
            action,
            url: sanitizedUrl,
            chunkSize: chunk.length,
          },
          'Received stdout data from yt-dlp',
        )
      })

      proc.stderr.on('data', data => {
        const errorOutput = data.toString().trim()
        this.logger.warn(
          {
            action,
            url: sanitizedUrl,
            stderr: errorOutput,
          },
          'yt-dlp stderr output',
        )
      })

      proc.on('error', err => {
        clearTimeout(timeout)
        const duration = Date.now() - startTime
        this.logger.error(
          {
            action,
            url: sanitizedUrl,
            duration,
            error: err.message,
          },
          'yt-dlp process error',
        )
        reject(err)
      })

      proc.on('close', code => {
        clearTimeout(timeout)
        const duration = Date.now() - startTime

        if (code !== 0) {
          this.logger.error(
            {
              action,
              url: sanitizedUrl,
              duration,
              exitCode: code,
            },
            'yt-dlp exited with non-zero code',
          )
          reject(new Error(`yt-dlp exited with code ${code}`))
          return
        }

        const result = Buffer.concat(chunks).toString()
        const resultLength = result.length

        this.logger.log(
          {
            action,
            url: sanitizedUrl,
            duration,
            outputLength: resultLength,
          },
          'yt-dlp completed successfully, parsing output',
        )

        try {
          let parsedInfo: VideoInfo

          if (isJson(result)) {
            this.logger.debug(
              { action, url: sanitizedUrl },
              'Parsing single JSON output',
            )
            parsedInfo = VideoInfoSchema.parse(JSON.parse(result))
          } else {
            // sometimes yt-dlp will output JSON on multiple lines for Instagram posts
            // with multiple videos.  this only happens if the user didn't set a title or
            // description, so we can just default whatever is set for the first video.
            this.logger.debug(
              {
                action,
                url: sanitizedUrl,
              },
              'Parsing multi-line JSON output (Instagram posts)',
            )

            const firstLine = result.split('\n')[0] ?? ''
            const info = VideoInfoSchema.parse(JSON.parse(firstLine))

            parsedInfo = {
              title: info.playlist || info.title,
              description: info.description ?? '',
            }
          }

          this.logger.log(
            {
              action,
              url: sanitizedUrl,
              duration,
              title: parsedInfo.title?.substring(0, 100), // Truncate for logging
              hasDescription: !!parsedInfo.description,
            },
            'Video info extraction completed successfully',
          )

          resolve(parsedInfo)
        } catch (err) {
          const duration = Date.now() - startTime
          this.logger.error(
            {
              action,
              url: sanitizedUrl,
              duration,
              error: err instanceof Error ? err.message : String(err),
              outputPreview: result.substring(0, 200), // First 200 chars for debugging
            },
            'Failed to parse yt-dlp output',
          )

          reject(new Error(`Failed to parse yt-dlp output: ${err}`))
        }
      })
    })
  }

  async createVideoDownloadJob(
    { hiddenAttribution, timeRange, url }: CreateDownloadJobInput,
    requester?: JobRequester | null,
  ): Promise<DownloadJob> {
    const action = 'createVideoDownloadJob'
    const jobId = nanoid()

    // Sanitize URL for logging
    const sanitizedUrl = url.split('?')[0]

    this.logger.log(
      {
        action,
        jobId,
        url: sanitizedUrl,
        hasTimeRange: !!timeRange,
        hasRequester: !!requester,
      },
      'Creating video download job',
    )

    // The `videos` row is the video's identity and must exist before the
    // job can name it - `jobs.media_id` points at it. Two requests for the
    // same URL+range collapse onto one row (and therefore one media id)
    // while staying two independent jobs, which is exactly the intent.
    const video = this.downloadStateService.ensureVideo({
      sourceUrl: url,
      timeRange,
    })

    const now = new Date().toISOString()
    const record: DownloadJobRecord = {
      completedAt: null,
      createdAt: now,
      hiddenAttribution: hiddenAttribution ?? false,
      id: jobId,
      mediaId: mediaId({ id: video.id, type: DownloadType.Video }),
      requester: requester ?? null,
      status: DownloadJobStatus.Pending,
      type: DownloadType.Video,
      updatedAt: now,
    }

    await ensureDir(`${VIDEO_DIR}/${record.id}`)

    this.logger.log(
      {
        action,
        jobId,
        url: sanitizedUrl,
      },
      'Created job directory, adding to scheduler',
    )

    this.downloadScheduler.add(record)
    this.metrics.jobCreated(url)

    this.logger.log(
      {
        action,
        jobId,
        mediaId: record.mediaId,
        url: sanitizedUrl,
      },
      'Video download job created successfully',
    )

    return this.downloadStateService.hydrateOne(record)
  }

  async cancelVideoDownloadJob(id: string): Promise<DownloadJob> {
    const action = 'cancelVideoDownloadJob'
    const job = this.downloadStateService.jobs.get(id)

    if (!job) {
      this.logger.warn({ action, id }, 'Job not found')
      throw new Error(`Job with ID '${id}' not found`)
    }

    if (job.type !== DownloadType.Video) {
      this.logger.warn({ action, id, type: job.type }, 'Job is not a video job')
      throw new Error(`Job '${id}' is not a video job`)
    }

    const logArgs = {
      action,
      id,
      mediaId: job.mediaId,
      type: job.type,
    }

    const proc = this.downloadStateService.getProc(id)
    if (!proc) {
      this.logger.warn(logArgs, 'Job not started')
      throw new Error(`Job '${id}' has not started`)
    }

    proc.removeAllListeners('close')
    proc.once('close', () => {
      this.downloadStateService.updateJob(job.id, {
        status: DownloadJobStatus.Cancelled,
      })

      this.logger.log(logArgs, 'Job closed')
    })

    proc.kill()
    this.metrics.jobCompleted('cancelled')

    this.downloadScheduler.delete(id)
    const cancelling = this.downloadStateService.updateJob(id, {
      status: DownloadJobStatus.Cancelling,
    })

    return this.downloadStateService.hydrateOne(cancelling)
  }
}
