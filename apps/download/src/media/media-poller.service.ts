import {
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  isManagedMedia,
  isMovie,
  Media,
  type ShowScope,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

import { DownloadStateService } from 'src/download/download-state.service'

import { MediaResolverService } from './media-resolver.service'
import {
  aggregateQueueItems,
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

  /**
   * Radarr keeps `find()`: a movie is one file and one queue item, so there
   * is nothing to aggregate and routing it through `aggregateQueueItems`
   * would only obscure that.
   */
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

  /**
   * Unlike movies, a show job can match **several** queue items - Sonarr
   * queues one per episode - so the matches are filtered by the job's scope
   * and then folded into one synthetic item.
   *
   * The old `find(q => q.seriesId === ...)` took an arbitrary first hit.
   * That was already lossy for a series-wide search and outright wrong once
   * two episode-scoped jobs can exist for the same series: both would read
   * the same arbitrary item.
   */
  private async pollShows(): Promise<void> {
    const tracked = await this.trackedJobs(DownloadType.Show)
    if (tracked.length === 0) return

    const queue = await this.sonarrService.getQueue(
      tracked.map(job => job.upstreamId),
    )

    for (const job of tracked) {
      const matches = queue.filter(
        q => q.seriesId === job.upstreamId && matchesScope(q, job.record.scope),
      )

      this.applyUpdate(job.record, aggregateQueueItems(matches))
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

/**
 * Whether a Sonarr queue item falls inside a job's scope, narrowest first:
 * an exact episode match, an exact season match, or - for an unscoped job -
 * every item of the series.
 *
 * A queue item with a null/absent `episodeId` can never match an
 * episode-scoped job. Strict equality gives that for free, and it's the
 * right answer: an item Sonarr can't attribute to an episode is not
 * evidence about *this* episode.
 */
function matchesScope(
  item: PollableQueueItem,
  scope: ShowScope | undefined,
): boolean {
  if (scope?.episodeId != null) {
    return item.episodeId === scope.episodeId
  }

  // `!= null`, not truthiness - season 0 is Sonarr's specials season.
  if (scope?.seasonNumber != null) {
    return item.seasonNumber === scope.seasonNumber
  }

  return true
}
