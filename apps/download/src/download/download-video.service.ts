import { VideoInfoSchema } from '@lilnas/utils/download/schema'
import {
  DownloadJobStatus,
  DownloadType,
  VideoInfo,
} from '@lilnas/utils/download/types'
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

import { EnvKeys } from 'src/env'

import { DownloadMetricsService } from './download-metrics.service'
import { DownloadStateService } from './download-state.service'
import { JobInterruptedError } from './job-interrupted.error'
import { DownloadStepOptions } from './types'
import {
  createLineSplitter,
  createProgressReducer,
  YTDLP_PROGRESS_ARGS,
} from './ytdlp-progress'

type JobLogger = (
  level: 'log' | 'error' | 'warn',
  data: object,
  message: string,
) => void

const VIDEO_DIR = '/download/videos'
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm']
const MAX_STDERR_BUFFER_CHARS = 8000

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
    private readonly metrics: DownloadMetricsService,
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

        this.metrics.observeVideoInfo('timeout', duration)
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
        this.metrics.observeVideoInfo('error', duration)
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

          this.metrics.observeVideoInfo('success', duration)
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

          this.metrics.observeVideoInfo('error', duration)
          reject(new Error(`Failed to parse yt-dlp output: ${err}`))
        }
      })
    })
  }

  /**
   * Runs yt-dlp for a video job and reports its progress as it goes.
   *
   * `YTDLP_PROGRESS_ARGS` make yt-dlp print one JSON progress tick per line
   * (at most one a second) behind a fixed prefix. Every stdout line still
   * lands in `download.log` untouched; a per-run reducer additionally folds
   * the ticks into `VideoProgress` snapshots and hands them to
   * `DownloadStateService.setProgress()`, which throttles the re-broadcast.
   *
   * Progress is process-lifetime only: the state service holds the latest
   * snapshot in memory and nothing persists it, so a restart simply shows no
   * progress until the next tick. A resume re-enters this method and builds
   * a fresh reducer, so file numbering starts over with the new run.
   */
  async download(options: DownloadStepOptions) {
    const { job } = options

    if (job.type !== DownloadType.Video) {
      throw new Error(
        `Expected a video job but got a '${job.type}' job (id: '${job.id}')`,
      )
    }

    // The source URL and clip range live on the `videos` row now, not on
    // the job - a job is the event, the video is the thing.
    const video = this.downloadStateService.requireVideo(job.mediaId)
    const log = this.getJobLogger(job.id)

    this.downloadStateService.updateJob(job.id, {
      status: DownloadJobStatus.Downloading,
    })

    // Fetch video info as first step (non-blocking - continue download if this fails)
    try {
      log('log', options, 'Fetching video metadata')
      const videoInfo = await this.getVideoInfo(video.sourceUrl)

      // Overwrites the placeholder title `ensureVideo()` seeded from the
      // source URL, on the `videos` row rather than the job.
      this.downloadStateService.updateVideo(job.id, {
        overview: videoInfo.description ?? undefined,
        title: videoInfo.title ?? undefined,
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
      ...YTDLP_PROGRESS_ARGS,
      ...(video.timeRange
        ? [
            '--download-sections',
            `*${video.timeRange.start}-${video.timeRange.end}`,
            '--force-keyframes-at-cuts',
          ]
        : []),
      video.sourceUrl,
    ]

    // Per run, never shared: a resume starts a new yt-dlp whose file
    // numbering has nothing to do with the run that was paused.
    const progressReducer = createProgressReducer()

    log('log', options, 'Started download')
    const downloadProcess = await this.runProcess({
      args,
      bin: '/usr/bin/yt-dlp',
      cwd: `${VIDEO_DIR}/${job.id}`,
      log,
      logFile: `${job.id}/download.log`,
      onStdoutLine: line => {
        const next = progressReducer.next(line)

        if (next) {
          this.downloadStateService.setProgress(job.id, next.snapshot, {
            flush: next.flush,
          })
        }
      },
    })

    this.downloadStateService.setProc(job.id, downloadProcess.proc)

    // A pause or cancel that arrived while the metadata fetch above was in
    // flight found no process to signal and left its intent on record instead
    // (`DownloadService.pauseVideoDownloadJob`). Registering the handle is the
    // first moment that signal can actually be delivered, so deliver it here -
    // otherwise the request is silently dropped and the job runs to completion
    // after the user asked it to stop.
    //
    // Only this direction needs handling. An interrupt arriving *after* this
    // line finds the handle through `getProc()` and signals it directly, and
    // the two cannot interleave: `setProc()` and this read are one synchronous
    // block, so a pause either precedes both or follows both.
    if (this.downloadStateService.getInterruption(job.id)) {
      log('log', options, 'Interrupt requested before spawn, signalling now')
      downloadProcess.proc.kill()
    }

    try {
      // The throttle may be holding the last tick on a timer. Send it now,
      // however the run ended - a clean exit, a crash, a pause's SIGTERM or a
      // spawn error - so a job parking at Paused shows where it stopped. It
      // runs before `assertNotInterrupted()` below, which throws on a pause.
      const { code, stderrTail } = await downloadProcess.promise.finally(() =>
        this.downloadStateService.flushProgress(job.id),
      )

      // Deliberately *before* the exit-code check below: SIGTERM always
      // produces a non-zero code, so if the code check ran first every pause
      // and cancel would surface as a crash.
      this.assertNotInterrupted(job.id)

      if (code !== 0) {
        throw new Error(stderrTail || `yt-dlp exited with code ${code}`)
      }

      // A paused job legitimately has zero video files - yt-dlp's in-flight
      // output is a `.part` file, which `getVideoFiles()` filters out - so
      // this check must stay downstream of the interrupt check too.
      const files = await getVideoFiles(job.id)

      if (files.length === 0) {
        throw new Error(stderrTail || 'No video files found')
      }

      log('log', { ...options, files }, 'Download complete')
    } catch (err) {
      // A deliberate pause/cancel is not a failure, so it must not be logged
      // as one - re-thrown untouched for the scheduler to branch on.
      if (err instanceof JobInterruptedError) {
        log(
          'log',
          { ...options, kind: err.kind },
          'Download interrupted deliberately',
        )

        throw err
      }

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

      this.downloadStateService.setProc(job.id, convertProcess.proc)

      try {
        const { code, stderrTail } = await convertProcess.promise

        // Same ordering rule as `download()`. Only 'cancel' can reach here in
        // practice - pause is refused outside the Downloading status - but
        // without this a cancel landing mid-ffmpeg would be logged as a
        // pipeline failure.
        this.assertNotInterrupted(job.id)

        if (code !== 0) {
          throw new Error(stderrTail || `ffmpeg exited with code ${code}`)
        }

        const files = await getVideoFiles(`${job.id}/render`)
        log('log', { ...options, files }, 'Conversion complete')
      } catch (err) {
        if (err instanceof JobInterruptedError) {
          log(
            'log',
            { ...options, kind: err.kind },
            'Conversion interrupted deliberately',
          )

          throw err
        }

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
      file => `${env(EnvKeys.MINIO_PUBLIC_URL)}/videos/${getFileKey(file)}`,
    )

    log('log', { ...options, downloadUrls }, 'Updating job with download URLs')

    this.downloadStateService.updateVideo(job.id, { downloadUrls })
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

  /**
   * Throws the interrupt sentinel if someone recorded an intent to kill this
   * job's process. Call it immediately after a child process resolves and
   * *before* inspecting its exit code: a SIGTERM'd yt-dlp/ffmpeg is
   * indistinguishable from a crashed one by exit code alone, so the recorded
   * intent is the only thing that can tell them apart, and it has to win.
   *
   * Known, accepted race: an intent recorded *after* the process already
   * exited cleanly (a pause arriving on a download that was about to finish)
   * still throws. The job parks at Paused with a complete, `.part`-free file
   * on disk, and resuming re-runs yt-dlp, which exits immediately with
   * "already downloaded". Detecting that would mean second-guessing an
   * explicit user intent to save one no-op round trip - not worth it.
   */
  private assertNotInterrupted(jobId: string): void {
    const kind = this.downloadStateService.getInterruption(jobId)

    if (kind) {
      throw new JobInterruptedError(jobId, kind)
    }
  }

  private getJobLogger(jobId: string): JobLogger {
    return (level, data, message) => {
      const job = this.downloadStateService.jobs.get(jobId)

      this.logger[level]({ ...data, job }, message)
    }
  }

  /**
   * Wraps a stdout line handler so it can never throw. It runs inside a
   * stream 'data' listener (and the 'close' handler, for the last line),
   * where a throw is an uncaught exception that also skips everything after
   * it in that listener - including `resolve()`.
   *
   * Only the first failure per run is logged: a broken parser fails on every
   * tick, and a long download would otherwise log the same warning once a
   * second.
   */
  private guardLineHandler(
    onLine: (line: string) => void,
    context: { bin: string; log?: JobLogger; logFile: string },
  ): (line: string) => void {
    const { bin, log, logFile } = context
    let failureLogged = false

    return line => {
      try {
        onLine(line)
      } catch (err) {
        if (failureLogged) return
        failureLogged = true

        const data = { bin, error: getErrorMessage(err), logFile }
        const message =
          'stdout line handler threw; ignoring it and any further failures this run'

        if (log) {
          log('warn', data, message)
        } else {
          this.logger.warn(data, message)
        }
      }
    }
  }

  /**
   * `onStdoutLine`, when given, sees every complete stdout line on top of -
   * never instead of - the pipe into the log file. A throw from it is logged
   * (via `log` when given) and swallowed by `guardLineHandler()`: the
   * process keeps running and its exit path is unchanged.
   */
  private async runProcess({
    logFile,
    cwd,
    args,
    bin,
    log,
    onStdoutLine,
  }: {
    logFile: string
    cwd?: string
    args: string[]
    bin: string
    log?: JobLogger
    onStdoutLine?: (line: string) => void
  }) {
    // Append, not truncate: a resumed download re-runs this step against the
    // same job directory, and the first run's output is the only record of
    // how the download got to where it left off.
    const logFileStream = createWriteStream(`${VIDEO_DIR}/${logFile}`, {
      encoding: 'utf-8',
      flags: 'a',
    })

    logFileStream.write(`$ ${bin} ${args.join(' ')}\n`)

    // Not every spawn failure reaches the 'error' handler below. Node defers
    // only EACCES/EAGAIN/EMFILE/ENFILE/ENOENT to a `process.nextTick()` error
    // event; every other errno - ENOMEM under memory pressure, or the ENOEXEC
    // a half-written yt-dlp binary produces - is thrown from `spawn()` right
    // here. That path already lands the job on `Failed` (it rejects before
    // `setProc()` runs, so there is no stale handle and nothing can wedge),
    // but it would otherwise leave this stream's fd open for the life of the
    // process, once per failed attempt.
    let proc
    try {
      proc = spawn(bin, args, { cwd })
    } catch (err) {
      logFileStream.close()
      throw err
    }

    let stderrBuffer = ''
    proc.stderr.on('data', chunk => {
      stderrBuffer += chunk.toString('utf-8')
      if (stderrBuffer.length > MAX_STDERR_BUFFER_CHARS) {
        stderrBuffer = stderrBuffer.slice(-MAX_STDERR_BUFFER_CHARS)
      }
    })

    const stdoutLines = onStdoutLine
      ? createLineSplitter(
          this.guardLineHandler(onStdoutLine, { bin, log, logFile }),
        )
      : undefined

    if (stdoutLines) {
      proc.stdout.on('data', (chunk: Buffer) => stdoutLines.push(chunk))
    }

    const promise = new Promise<{
      code: number | null
      stderrTail: string
    }>((resolve, reject) => {
      // The log file keeps the full stdout regardless of `onStdoutLine`: it is
      // the only record of a run, and holds the proof a resume picked up
      // where the paused run stopped.
      proc.stdout.pipe(logFileStream)
      proc.stderr.pipe(logFileStream)

      proc.on('error', err => {
        // Serialised, never written raw. `logFileStream` is a plain
        // (non-objectMode) fs stream, and `write()` *throws*
        // ERR_INVALID_ARG_TYPE - it does not emit - for anything that isn't a
        // string/Buffer/TypedArray. An Error is none of those, so passing one
        // straight through threw from inside this listener, and a throw from
        // an 'error' listener escapes `emit()` into the `process.nextTick()`
        // node schedules for a failed spawn: an uncaught exception.
        //
        // That took `reject()` below with it, and node emits no 'close' after
        // a spawn its 'error' listener threw from, so the 'close' handler
        // never ran either. This promise then never settled at all, and
        // `download()`'s `await` on it hung forever - which is the whole
        // spawn-error wedge. The job kept the `Downloading` written before
        // the spawn, the scheduler's catch was still suspended inside that
        // await so it never wrote `Failed`, and the handle `download()`
        // passed to `setProc()` stayed registered on a child that never started,
        // so pause and cancel signalled a no-op corpse and parked at
        // Pausing/Cancelling with nothing left alive to move them.
        //
        // Reachable in production well beyond the ENOENT that first exposed
        // it: EACCES if /opt/yt-dlp/yt-dlp loses its exec bit, EPERM, ENOMEM
        // under memory pressure, and a `YtdlpUpdateService` update that
        // leaves a truncated or non-executable binary mid-`move` - that one
        // runs on a daily cron, on by default.
        //
        // Nothing here needs to clear the handle itself: settling is enough.
        // The rejection propagates to the scheduler's catch, which writes
        // `Failed`, and `DownloadStateService.updateJob()` drops both the proc
        // and the interrupt note on every terminal transition.
        logFileStream.write(`\n${getErrorMessage(err)}\n`)
        reject(err)
      })

      proc.on('close', code => {
        // A last line with no trailing newline is still a line.
        stdoutLines?.flush()
        logFileStream.close()
        resolve({ code, stderrTail: stderrBuffer.trim() })
      })
    })

    return { proc, promise }
  }
}
