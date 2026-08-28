import { VideoInfoSchema } from '@lilnas/utils/download/schema'
import {
  CreateDownloadJobInput,
  DownloadJob,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  isTerminalDownloadJobStatus,
  JobRequester,
  VideoInfo,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { isJson } from '@lilnas/utils/json'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { spawn } from 'child_process'
import { ensureDir } from 'fs-extra'
import { nanoid } from 'nanoid'

import { mediaId } from 'src/db/media-id'
import { MediaFileService } from 'src/media/media-file.service'

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
    // From MediaModule, which download.module.ts already imports via
    // forwardRef - the same way DownloadController gets it. No
    // property-level forwardRef needed: media-file.service.ts has no import
    // back into this file, so there is no *class* cycle here, only the
    // module one the module already declares.
    private readonly mediaFileService: MediaFileService,
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

  /**
   * Stops a running download without destroying anything it has already
   * fetched, so it can be picked back up later.
   *
   * Pause and cancel are the *same* primitive - a SIGTERM to the live child
   * process, no files removed - and differ only in the intent recorded
   * beforehand, which is what decides the status the job lands in once the
   * pipeline notices the process is gone. The move to `Paused` is therefore
   * not made here: this only writes `Pausing`, and
   * `DownloadSchedulerService`'s interrupt branch finishes the job off when
   * its process actually exits.
   */
  async pauseVideoDownloadJob(id: string): Promise<DownloadJob> {
    const action = 'pauseVideoDownloadJob'
    // No `resolveJobRecord()` fallback to the `jobs` table, unlike the read
    // paths: a pausable job is by definition running right now, so it is in
    // the Map. A job that exists only as a durable row is one that outlived a
    // restart, and a restart already killed every process there was to pause.
    const job = this.downloadStateService.jobs.get(id)

    if (!job) {
      this.logger.warn({ action, jobId: id }, 'Job not found')
      throw new NotFoundException(`Job with ID '${id}' not found`)
    }

    if (job.type !== DownloadType.Video) {
      this.logger.warn(
        { action, jobId: id, type: job.type },
        'Job is not a video job',
      )
      throw new BadRequestException(`Job '${id}' is not a video job`)
    }

    const logArgs = {
      action,
      jobId: id,
      mediaId: job.mediaId,
      type: job.type,
    }

    // `Downloading` and nothing else. This one guard is doing two jobs.
    //
    // It keeps pause off the ffmpeg phase: ffmpeg has no resume, so pausing
    // during `convert()` would mean throwing away the transcode and starting
    // it from zero on resume - strictly worse than not offering pause there
    // at all. (`Uploading` and `Cleaning` are seconds long and not worth a
    // button either.)
    //
    // And it makes `getProc(id)` below unambiguous: `convert()` writes
    // `Converting` before it spawns ffmpeg, so a job still reading
    // `Downloading` can only have the yt-dlp handle registered - the one
    // process that *can* pick up where it left off.
    if (job.status !== DownloadJobStatus.Downloading) {
      this.logger.warn(
        { ...logArgs, status: job.status },
        'Job is not pausable',
      )
      throw new ConflictException(
        `Job '${id}' cannot be paused while it is '${job.status}'; only a downloading job can be paused`,
      )
    }

    const proc = this.downloadStateService.getProc(id)
    if (!proc) {
      this.logger.warn(logArgs, 'Job has no running process')
      throw new ConflictException(`Job '${id}' has no running process to pause`)
    }

    // Order is load-bearing: the intent has to be on record *before* the
    // signal goes out. `runProcess()`'s close handler fires as soon as the
    // process dies and reads the note synchronously - setting it afterwards
    // races that read, and losing the race means the pipeline reports a
    // deliberate pause as a crashed download.
    this.downloadStateService.setInterruption(id, 'pause')
    proc.kill()

    const pausing = this.downloadStateService.updateJob(id, {
      status: DownloadJobStatus.Pausing,
    })

    this.logger.log(logArgs, 'Video job pause requested')

    return this.downloadStateService.hydrateOne(pausing)
  }

  /**
   * Puts a paused job back on the queue.
   *
   * There is no "unpause the existing process" here because there is no
   * process left - pausing killed it. Resume instead re-enters the pipeline
   * from the top: `requeue()` appends the job to the *back* of the queue,
   * `maybeProcessNextJob()` eventually picks it up like any other pending
   * job, and `download()` runs again in the same `/download/videos/<jobId>`
   * working directory, where yt-dlp's default `--continue` finds the leftover
   * `.part` file and resumes from its byte offset rather than refetching.
   *
   * That re-runs the metadata fetch that already succeeded once, which is
   * deliberate. Skipping it would mean a second entry point into `download()`
   * whose only distinguishing feature is being subtly different from the
   * first - a duplicated code path for the sake of one avoidable HTTP
   * request.
   */
  async resumeVideoDownloadJob(id: string): Promise<DownloadJob> {
    const action = 'resumeVideoDownloadJob'
    const job = this.downloadStateService.jobs.get(id)

    if (!job) {
      this.logger.warn({ action, jobId: id }, 'Job not found')
      throw new NotFoundException(`Job with ID '${id}' not found`)
    }

    if (job.type !== DownloadType.Video) {
      this.logger.warn(
        { action, jobId: id, type: job.type },
        'Job is not a video job',
      )
      throw new BadRequestException(`Job '${id}' is not a video job`)
    }

    const logArgs = {
      action,
      jobId: id,
      mediaId: job.mediaId,
      type: job.type,
    }

    // `Pausing` is explicitly not resumable: the old process is still winding
    // down and has not yet been accounted for, so requeueing now would run a
    // second yt-dlp against the same `.part` file.
    if (job.status !== DownloadJobStatus.Paused) {
      this.logger.warn(
        { ...logArgs, status: job.status },
        'Job is not resumable',
      )
      throw new ConflictException(
        `Job '${id}' cannot be resumed while it is '${job.status}'; only a paused job can be resumed`,
      )
    }

    // Belt-and-braces: the scheduler's interrupt branch already cleared this
    // when it landed the job in `Paused`. A note that somehow survived would
    // be read by the *next* process exit, throwing the resumed job straight
    // back into `Paused` the moment its fresh yt-dlp finished.
    this.downloadStateService.clearInterruption(id)

    // Pending before requeue, not after: `requeue()` pumps the queue
    // synchronously, so a job left reading `Paused` could be picked up and
    // overwritten with `Downloading` before this line ran.
    const pending = this.downloadStateService.updateJob(id, {
      status: DownloadJobStatus.Pending,
    })

    this.downloadScheduler.requeue(id)
    this.metrics.jobResumed()

    this.logger.log(logArgs, 'Video job resumed')

    // Re-read rather than hydrating `pending`, because by now it may already
    // be stale: with a free download slot, `requeue()` runs the scheduler far
    // enough into `download()` - synchronously, before its first `await` - to
    // write `Downloading`. Returning the `Pending` snapshot would hand the
    // caller a status the job has already left, and one that races the
    // `Updated` broadcast the same transition emitted.
    const resumed = this.downloadStateService.jobs.get(id) ?? pending

    return this.downloadStateService.hydrateOne(resumed)
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

    // A paused job is the one cancellable state with neither a live process
    // nor a queue entry - pausing killed the one and consumed the other - so
    // it can't go through the kill path below, and the "has not started"
    // guard there would reject it outright. Without this branch a user could
    // pause a job into a corner it could never be abandoned from.
    if (job.status === DownloadJobStatus.Paused) {
      const cancelled = this.downloadStateService.updateJob(id, {
        status: DownloadJobStatus.Cancelled,
      })
      this.metrics.jobCompleted('cancelled')

      this.logger.log(logArgs, 'Paused job cancelled')

      return this.downloadStateService.hydrateOne(cancelled)
    }

    const proc = this.downloadStateService.getProc(id)
    if (!proc) {
      this.logger.warn(logArgs, 'Job not started')
      throw new Error(`Job '${id}' has not started`)
    }

    // Same primitive as pause, differing only in the recorded intent - and
    // notably *without* the `removeAllListeners('close')` dance this used to
    // do. That stripped the very listener `runProcess()` settles its promise
    // from, so `download()` never returned, the scheduler's `finally` never
    // ran, and the cancelled job held its `inProgressJobs` slot (and its open
    // log file stream) forever. At MAX_DOWNLOADS=1 a single cancel wedged the
    // queue until the process restarted.
    this.downloadStateService.setInterruption(id, 'cancel')
    proc.kill()
    this.metrics.jobCompleted('cancelled')

    this.downloadScheduler.delete(id)
    // `Cancelling`, not `Cancelled`: the scheduler's interrupt branch owns
    // the final transition, once the process it just signalled has actually
    // exited.
    const cancelling = this.downloadStateService.updateJob(id, {
      status: DownloadJobStatus.Cancelling,
    })

    return this.downloadStateService.hydrateOne(cancelling)
  }

  /**
   * Removes a video download for good: stops it if it is still running,
   * deletes the MinIO objects it produced, and clears the `videos` row's
   * `downloadUrls` so nothing keeps advertising a link that 404s.
   *
   * This is the video counterpart of `DELETE /movies/:id` and
   * `DELETE /shows/:id`, and it is what those two already had and video
   * didn't: `cancel` 404s once a job reaches `Completed`, and
   * `DELETE /media/:id/files` rejects a `video:` key outright
   * (`parseReleaseTarget`), so a finished video had no route that could
   * remove it at all. The objects had to be deleted by hand, which left the
   * gallery pointing at a `downloadUrl` with nothing behind it.
   *
   * The `videos` row itself deliberately survives. It is keyed on
   * `(sourceUrl, timeRange)`, so other jobs may point at the same row, and
   * every job's `mediaId` is a foreign key to it in all but name - deleting
   * it would orphan history rather than clean it up. Clearing
   * `downloadUrls` is what actually answers "there is no file here anymore".
   *
   * Order is load-bearing: objects first, row second. The reverse would lose
   * the only record of which objects to delete the moment the MinIO call
   * failed.
   */
  async deleteVideoDownloadJob(id: string): Promise<DownloadJob> {
    const action = 'deleteVideoDownloadJob'

    // Adopted rather than read, because a video worth deleting is very often
    // one that finished before the last restart - see `adoptJob()`.
    const job = this.downloadStateService.adoptJob(id)

    if (!job) {
      this.logger.warn({ action, jobId: id }, 'Job not found')
      throw new NotFoundException(`Job with ID '${id}' not found`)
    }

    if (job.type !== DownloadType.Video) {
      this.logger.warn(
        { action, jobId: id, type: job.type },
        'Job is not a video job',
      )
      throw new BadRequestException(`Job '${id}' is not a video job`)
    }

    const logArgs = { action, jobId: id, mediaId: job.mediaId }

    // A live job has to be stopped before its output is removed, or the
    // pipeline uploads more objects behind the delete. Best-effort: `cancel`
    // refuses a job that exists but has not started, and "it wasn't running"
    // is not a reason to refuse a delete.
    if (!isTerminalDownloadJobStatus(job.status)) {
      try {
        await this.cancelVideoDownloadJob(id)
      } catch (err) {
        this.logger.warn(
          { ...logArgs, error: getErrorMessage(err), status: job.status },
          'Could not cancel the job before deleting it - continuing',
        )
      }
    }

    const deletedObjects = await this.mediaFileService.deleteVideoObjects(
      job.mediaId,
    )

    this.downloadStateService.updateVideo(id, { downloadUrls: [] })

    // `Cancelled`, the same terminal status `DELETE /movies/:id` lands on:
    // the job row stays as history, and the gallery keeps a card that now
    // honestly has nothing to download.
    const deleted = this.downloadStateService.updateJob(id, {
      status: DownloadJobStatus.Cancelled,
    })

    this.logger.log({ ...logArgs, deletedObjects }, 'Video download deleted')

    return this.downloadStateService.hydrateOne(deleted)
  }
}
