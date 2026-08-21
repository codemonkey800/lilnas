import {
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  isManagedMedia,
  isMovie,
  Media,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

import { DownloadStateService } from 'src/download/download-state.service'

import { MediaResolverService } from './media-resolver.service'
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

/** A tracked job paired with the upstream library id to poll it by. */
interface TrackedJob {
  record: DownloadJobRecord
  upstreamId: number
}

/**
 * Polls Radarr's/Sonarr's queues for movie/show jobs tracked in
 * DownloadStateService and drives them through
 * Requested -> Searching -> Downloading -> Importing -> Completed/Failed.
 *
 * Writes only `status`/`error` to the job. The queue snapshot goes to
 * `DownloadStateService.setQueueSnapshot()` instead of onto the job row -
 * it's live upstream state, which is where it was always coming from, so
 * persisting a copy of it was only ever a way for the two to disagree.
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
    private readonly mediaResolverService: MediaResolverService,
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
    const tracked = await this.trackedJobs(DownloadType.Movie)
    if (tracked.length === 0) return

    const queue = await this.radarrService.getQueue(
      tracked.map(job => job.upstreamId),
    )

    for (const job of tracked) {
      this.applyUpdate(
        job.record,
        queue.find(q => q.movieId === job.upstreamId),
      )
    }
  }

  private async pollShows(): Promise<void> {
    const tracked = await this.trackedJobs(DownloadType.Show)
    if (tracked.length === 0) return

    const queue = await this.sonarrService.getQueue(
      tracked.map(job => job.upstreamId),
    )

    for (const job of tracked) {
      this.applyUpdate(
        job.record,
        queue.find(q => q.seriesId === job.upstreamId),
      )
    }
  }

  /**
   * The in-flight jobs of one media type, each paired with its upstream
   * library id. That id is no longer a persisted column - it's Radarr's own
   * primary key, so it comes from the resolved media, in one batched call
   * per tick rather than one per job. A title with no library entry yet
   * (requested but not added) simply isn't pollable and is skipped.
   */
  private async trackedJobs(type: DownloadType): Promise<TrackedJob[]> {
    const records = Array.from(this.downloadStateService.jobs.values()).filter(
      record => record.type === type && !TERMINAL_STATUSES.has(record.status),
    )

    if (records.length === 0) return []

    const { media } = await this.mediaResolverService.resolve(
      records.map(record => ({ mediaId: record.mediaId, type: record.type })),
    )

    return records.flatMap(record => {
      const upstreamId = upstreamLibraryId(media.get(record.mediaId))
      return upstreamId == null ? [] : [{ record, upstreamId }]
    })
  }

  private applyUpdate(
    record: DownloadJobRecord,
    item: PollableQueueItem | undefined,
  ): void {
    const action = 'applyUpdate'
    const previousSnapshot = this.downloadStateService.getQueueSnapshot(
      record.id,
    )
    const newStatus = deriveStatusFromQueueItem(record.status, item)
    const newSnapshot = item ? toQueueSnapshot(item) : previousSnapshot

    if (
      newStatus === record.status &&
      isQueueSnapshotEqual(newSnapshot, previousSnapshot)
    ) {
      return
    }

    this.logger.log(
      {
        action,
        jobId: record.id,
        mediaId: record.mediaId,
        oldStatus: record.status,
        newStatus,
        snapshot: newSnapshot,
      },
      'Media job status changed',
    )

    // Snapshot first: it broadcasts on its own, so a progress-only tick
    // (same status, new percentage) still reaches subscribers without a
    // pointless job-row write.
    if (item && newSnapshot) {
      this.downloadStateService.setQueueSnapshot(record.id, newSnapshot)
    }

    if (newStatus === record.status) return

    const error =
      item && newStatus === DownloadJobStatus.Failed
        ? describeQueueItemError(item)
        : undefined

    this.downloadStateService.updateJob(record.id, {
      ...(error ? { error } : {}),
      status: newStatus,
    })
  }
}

function upstreamLibraryId(media: Media | undefined): number | undefined {
  if (!media || !isManagedMedia(media)) return undefined
  return isMovie(media) ? media.radarrId : media.sonarrId
}
