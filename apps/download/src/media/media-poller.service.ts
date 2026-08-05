import {
  DownloadJobStatus,
  isMovieDownloadJob,
  isShowDownloadJob,
  MovieDownloadJob,
  ShowDownloadJob,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

import { DownloadStateService } from 'src/download/download-state.service'

import {
  deriveStatusFromQueueItem,
  describeQueueItemError,
  isQueueSnapshotEqual,
  PollableQueueItem,
  toQueueSnapshot,
} from './queue-status.util'
import { RadarrService } from './radarr.service'
import { SonarrService } from './sonarr.service'

const BASE_BACKOFF_MS = 10_000
const MAX_BACKOFF_MS = 120_000

const TERMINAL_STATUSES = new Set<DownloadJobStatus>([
  DownloadJobStatus.Cancelled,
  DownloadJobStatus.Completed,
  DownloadJobStatus.Failed,
])

/**
 * Polls Radarr's/Sonarr's queues for movie/show jobs tracked in
 * DownloadStateService and drives them through
 * Requested -> Searching -> Downloading -> Importing -> Completed/Failed.
 *
 * Runs every 10s via @Cron (this codebase has no @Interval precedent - see
 * ytdlp-update.service.ts). On error, backs off exponentially from 10s up to
 * a 2min cap; a success resets the backoff immediately.
 */
@Injectable()
export class MediaPollerService {
  private logger = new Logger(MediaPollerService.name)
  private nextAllowedRunAt = 0
  private backoffMs = BASE_BACKOFF_MS

  constructor(
    private readonly downloadStateService: DownloadStateService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  @Cron('*/10 * * * * *')
  async poll(): Promise<void> {
    const action = 'poll'

    if (Date.now() < this.nextAllowedRunAt) {
      return
    }

    try {
      await Promise.all([this.pollMovies(), this.pollShows()])

      if (this.backoffMs !== BASE_BACKOFF_MS) {
        this.logger.log({ action }, 'Media queue poll recovered, backoff reset')
      }
      this.backoffMs = BASE_BACKOFF_MS
      this.nextAllowedRunAt = 0
    } catch (err) {
      const error = getErrorMessage(err)

      this.nextAllowedRunAt = Date.now() + this.backoffMs
      this.logger.error(
        { action, error, nextRetryInMs: this.backoffMs },
        'Media queue poll failed, backing off',
      )
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
    }
  }

  private async pollMovies(): Promise<void> {
    const trackedJobs = Array.from(
      this.downloadStateService.jobs.values(),
    ).filter(
      (job): job is MovieDownloadJob =>
        isMovieDownloadJob(job) &&
        job.radarrId != null &&
        !TERMINAL_STATUSES.has(job.status),
    )

    if (trackedJobs.length === 0) {
      return
    }

    const movieIds = trackedJobs.map(job => job.radarrId as number)
    const queue = await this.radarrService.getQueue(movieIds)

    for (const job of trackedJobs) {
      const item = queue.find(q => q.movieId === job.radarrId)
      this.applyUpdate(job, item)
    }
  }

  private async pollShows(): Promise<void> {
    const trackedJobs = Array.from(
      this.downloadStateService.jobs.values(),
    ).filter(
      (job): job is ShowDownloadJob =>
        isShowDownloadJob(job) &&
        job.sonarrId != null &&
        !TERMINAL_STATUSES.has(job.status),
    )

    if (trackedJobs.length === 0) {
      return
    }

    const seriesIds = trackedJobs.map(job => job.sonarrId as number)
    const queue = await this.sonarrService.getQueue(seriesIds)

    for (const job of trackedJobs) {
      const item = queue.find(q => q.seriesId === job.sonarrId)
      this.applyUpdate(job, item)
    }
  }

  private applyUpdate(
    job: MovieDownloadJob | ShowDownloadJob,
    item: PollableQueueItem | undefined,
  ): void {
    const action = 'applyUpdate'
    const newStatus = deriveStatusFromQueueItem(job.status, item)
    const newSnapshot = item ? toQueueSnapshot(item) : job.queueSnapshot

    if (
      newStatus === job.status &&
      isQueueSnapshotEqual(newSnapshot, job.queueSnapshot)
    ) {
      return
    }

    // Note: this intentionally omits `type` - MovieDownloadJob['type'] and
    // ShowDownloadJob['type'] are different literals, so Movie & Show (and
    // therefore Partial<Movie & Show>) collapses to `never`. status/
    // queueSnapshot/error are shared, non-conflicting fields on both, so a
    // standalone structural type sidesteps the discriminant entirely.
    const updates: {
      status: DownloadJobStatus
      queueSnapshot?: MovieDownloadJob['queueSnapshot']
      error?: string
    } = {
      status: newStatus,
    }

    if (item) {
      updates.queueSnapshot = newSnapshot

      if (newStatus === DownloadJobStatus.Failed) {
        const error = describeQueueItemError(item)
        if (error) {
          updates.error = error
        }
      }
    }

    this.logger.log(
      {
        action,
        jobId: job.id,
        oldStatus: job.status,
        newStatus,
        snapshot: newSnapshot,
      },
      'Media job status changed',
    )

    this.downloadStateService.updateJob(job.id, updates)
  }
}
