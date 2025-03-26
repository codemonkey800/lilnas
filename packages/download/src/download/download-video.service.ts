import { DownloadJobStatus } from '@lilnas/utils/download/types'
import { env } from '@lilnas/utils/env'
import { getErrorMessage } from '@lilnas/utils/error'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { spawn } from 'child_process'
import fs from 'fs-extra'
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
  const files = await fs.readdir(dir)

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

  async download(options: DownloadStepOptions) {
    const { job } = options
    const log = this.getJobLogger(job.id)

    this.downloadStateService.updateJob(job.id, {
      status: DownloadJobStatus.Downloading,
    })

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

    await fs.ensureDir(renderDir)

    log('log', { ...options, files, jobDir, renderDir }, 'Starting conversion')

    for (let index = 0; index < files.length; index++) {
      const file = files[index]
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
      ...job,

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
    await Promise.all(allFiles.map(file => fs.remove(file)))
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
    const logFileStream = fs.createWriteStream(
      `${VIDEO_DIR}/${logFile}`,
      'utf-8',
    )

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
