import { VideoInfoSchema } from '@lilnas/utils/download/schema'
import { DownloadJobStatus, VideoInfo } from '@lilnas/utils/download/types'
import { env } from '@lilnas/utils/env'
import { getErrorMessage } from '@lilnas/utils/error'
import { isJson } from '@lilnas/utils/json'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import { ensureDir, readdir, remove } from 'fs-extra'
import * as mime from 'mime-types'
import { Client } from 'minio'
import { MINIO_CONNECTION } from 'nestjs-minio'
import path from 'path'

import { EnvKey } from 'src/utils/env'

import { DownloadStateService } from './download-state.service'
import { DownloadStepOptions } from './types'

const VIDEO_DIR = '/download/videos'
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm']

async function getVideoFiles(path: string) {
  const dir = `${VIDEO_DIR}/${path}`
  const files = await readdir(dir)

  return files
    .filter(f => VIDEO_EXTENSIONS.some(ext => f.endsWith(ext)))
    .map(f => `${dir}/${f}`)
}

@Injectable()
export class DownloadVideoService {
  private logger = new Logger(DownloadVideoService.name)

  constructor(
    @Inject(MINIO_CONNECTION) private readonly minioClient: Client,
    private readonly downloadStateService: DownloadStateService,
  ) {}

  private async getVideoInfo(url: string): Promise<VideoInfo> {
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

      const timeout = setTimeout(() => {
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
      }, 60 * 1000)

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

  async download(options: DownloadStepOptions) {
    const { job } = options
    const log = this.getJobLogger(job.id)

    this.downloadStateService.updateJob(job.id, {
      status: DownloadJobStatus.Downloading,
    })

    // Fetch video info as first step (non-blocking - continue download if this fails)
    try {
      log('log', options, 'Fetching video metadata')
      const videoInfo = await this.getVideoInfo(job.url)

      // Update job with video info
      this.downloadStateService.updateJob(job.id, {
        title: videoInfo.title ?? undefined,
        description: videoInfo.description ?? undefined,
      })

      log(
        'log',
        {
          ...options,
          title: videoInfo.title?.substring(0, 100),
          hasDescription: !!videoInfo.description,
        },
        'Video metadata fetched and updated',
      )
    } catch (err) {
      // Log warning but continue with download - video info is not critical
      log(
        'warn',
        {
          ...options,
          error: getErrorMessage(err),
        },
        'Failed to fetch video metadata, continuing with download',
      )
    }

    const args = [
      ...(job.timeRange
        ? [
            '--download-sections',
            `*${job.timeRange.start}-${job.timeRange.end}`,
            '--force-keyframes-at-cuts',
          ]
        : []),
      job.url,
    ]

    log('log', options, 'Started download')
    const downloadProcess = await this.runProcess({
      args,
      bin: '/usr/bin/yt-dlp',
      cwd: `${VIDEO_DIR}/${job.id}`,
      logFile: `${job.id}/download.log`,
    })

    this.downloadStateService.updateJob(job.id, {
      proc: downloadProcess.proc,
    })

    try {
      await downloadProcess.promise

      const files = await getVideoFiles(job.id)

      if (files.length === 0) {
        throw new Error('No video files found')
      }

      log('log', { ...options, files }, 'Download complete')
    } catch (err) {
      log(
        'error',
        { ...options, error: getErrorMessage(err) },
        'Download failed',
      )

      throw err
    }
  }

  async convert(options: DownloadStepOptions) {
    const { job } = options
    const log = this.getJobLogger(job.id)

    this.downloadStateService.updateJob(job.id, {
      status: DownloadJobStatus.Converting,
    })

    const files = await getVideoFiles(job.id)
    const jobDir = `${VIDEO_DIR}/${job.id}`
    const renderDir = `${jobDir}/render`

    await ensureDir(renderDir)

    log('log', { ...options, files, jobDir, renderDir }, 'Starting conversion')

    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      if (!file) continue
      const args = [
        '-i',
        file,
        '-c:v',
        'libx264',
        '-crf',
        '30',
        '-preset',
        'medium',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        `${renderDir}/part${index}.mp4`,
      ]

      const convertProcess = await this.runProcess({
        args,
        bin: '/usr/bin/ffmpeg',
        cwd: jobDir,
        logFile: `${job.id}/render.log`,
      })

      this.downloadStateService.updateJob(job.id, {
        proc: convertProcess.proc,
      })

      try {
        await convertProcess.promise

        const files = await getVideoFiles(`${job.id}/render`)
        log('log', { ...options, files }, 'Conversion complete')
      } catch (err) {
        log(
          'error',
          { ...options, error: getErrorMessage(err) },
          'Conversion failed',
        )

        throw err
      }
    }
  }

  async upload(options: DownloadStepOptions) {
    const { job } = options
    const log = this.getJobLogger(job.id)

    this.downloadStateService.updateJob(job.id, {
      status: DownloadJobStatus.Uploading,
    })

    const files = await getVideoFiles(`${job.id}/render`)

    log('log', options, 'Starting upload')

    if (files.length === 0) {
      log('warn', options, 'No video files found')
      return
    }

    const getFileKey = (file: string) => `${job.id}/${path.basename(file)}`

    log('log', { ...options, files }, 'Uploading video file')
    await Promise.all(
      files.map(async file => {
        await this.minioClient.fPutObject('videos', getFileKey(file), file, {
          'Content-Type': mime.lookup(file) || 'video/webm',
        })
      }),
    )
    log('log', { ...options, files: files }, 'Video file uploaded')

    const downloadUrls = files.map(
      file => `${env<EnvKey>('MINIO_PUBLIC_URL')}/videos/${getFileKey(file)}`,
    )

    log('log', { ...options, downloadUrls }, 'Updating job with download URLs')

    this.downloadStateService.updateJob(job.id, {
      downloadUrls: files.map(
        file => `${env<EnvKey>('MINIO_PUBLIC_URL')}/videos/${getFileKey(file)}`,
      ),
    })
  }

  async clean(options: DownloadStepOptions) {
    const { job } = options
    const log = this.getJobLogger(job.id)

    this.downloadStateService.updateJob(job.id, {
      status: DownloadJobStatus.Cleaning,
    })

    const files = await getVideoFiles(job.id)
    const renderFiles = await getVideoFiles(`${job.id}/render`)
    const allFiles = [...files, ...renderFiles]
    const logArgs = { ...options, files: allFiles }

    log('log', logArgs, 'Cleaning up video files')
    await Promise.all(allFiles.map(file => remove(file)))
    log('log', logArgs, 'Files cleaned')
  }

  private getJobLogger(jobId: string) {
    return (level: 'log' | 'error' | 'warn', data: object, message: string) => {
      const job = { ...this.downloadStateService.jobs.get(jobId) }
      delete job.proc

      this.logger[level]({ ...data, job }, message)
    }
  }

  private async runProcess({
    logFile,
    cwd,
    args,
    bin,
  }: {
    logFile: string
    cwd?: string
    args: string[]
    bin: string
  }) {
    const logFileStream = createWriteStream(`${VIDEO_DIR}/${logFile}`, 'utf-8')

    logFileStream.write(`$ ${bin} ${args.join(' ')}\n`)

    const proc = spawn(bin, args, { cwd })

    const promise = new Promise((resolve, reject) => {
      proc.stdout.pipe(logFileStream)
      proc.stderr.pipe(logFileStream)

      proc.on('error', err => {
        logFileStream.write(err)
        reject(err)
      })

      proc.on('close', code => {
        logFileStream.close()
        resolve(code)
      })
    })

    return { proc, promise }
  }
}
