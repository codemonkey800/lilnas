import type { MovieFileResource } from '@lilnas/media/radarr'
import type { EpisodeFileResource, EpisodeResource } from '@lilnas/media/sonarr'
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
export interface TrackedJob {
  record: DownloadJobRecord
  upstreamId: number
}

/**
 * The upstream state one job's completion check reads: the files the target
 * currently holds and - for a show - the episodes that point at them.
 *
 * Sonarr's `EpisodeFileResource` carries `id`, `seasonNumber` and `dateAdded`
 * but **no** `episodeId`. The link runs the other way, from
 * `Episode.episodeFileId` to a file's `id` - the join `resolveEpisodeFileIds`
 * performs in episode-files.util.ts - so an episode-scoped job cannot be
 * answered from the file list alone and the episodes have to come with it.
 * Radarr has no such indirection: a movie is one file, so `episodes` is
 * absent for movies rather than empty.
 *
 * Named at arm's length from `job-completion.util.ts`'s `CompletionInput`
 * deliberately. That type is the *decision's* structural input; this one is
 * the *poller's* raw fetch, and the two are kept uncoupled - a pair of names
 * one letter apart would only invite importing the wrong one.
 */
export interface PollableCompletionData {
  episodes?: EpisodeResource[]
  files: MovieFileResource[] | EpisodeFileResource[]
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

  /**
   * The upstream files - and, for shows, episodes - needed to decide whether
   * each of `jobs` has already finished, keyed by job id.
   *
   * Only ever asked about jobs with **no queue entry this tick**, because an
   * empty queue is the one ambiguous reading: it means either "nothing
   * grabbed yet" or "grabbed, downloaded and imported between two ticks". A
   * usenet grab of a small file can run that whole way in ~6s, so at a 10s
   * cadence the queue is empty every time the poller looks and the job wedges
   * at `searching` with its file already on disk. Every other tick has a
   * queue item saying exactly where the job is, which is why this costs
   * nothing in the steady state: zero jobs in, zero upstream calls out.
   *
   * Fetches **once per distinct `upstreamId`, not once per job**. Four
   * episode-scoped jobs on one series all read the same series-wide file
   * list, so they share one `getEpisodeFiles` call; fanning out per job is
   * what would turn a rare fallback into a per-tick load spike.
   *
   * Deliberately hands back the raw resources rather than routing through
   * `resolveEpisodeFileIds`: that helper narrows per *scope*, which is a call
   * per job again, and it reduces to file ids, dropping the `dateAdded` the
   * "did a file appear since this job started?" question turns on. Scope
   * narrowing belongs to the caller, applied to this shared list.
   *
   * Errors propagate untouched - `poll()` already owns the exponential
   * backoff, and a second one here would only let the two disagree about
   * when to retry.
   *
   * Public, not `private`, only because nothing calls it yet:
   * `noUnusedLocals` rejects an uncalled private member, and this landed
   * ahead of the queue-empty check that consumes it. Narrow it back to
   * `private` the moment `pollMovies`/`pollShows` call it.
   */
  async completionInputs(
    type: DownloadType,
    jobs: readonly TrackedJob[],
  ): Promise<Map<string, PollableCompletionData>> {
    const byJobId = new Map<string, PollableCompletionData>()
    if (jobs.length === 0) return byJobId

    const upstreamIds = Array.from(new Set(jobs.map(job => job.upstreamId)))

    const fetched = await Promise.all(
      upstreamIds.map(
        async (upstreamId): Promise<[number, PollableCompletionData]> => {
          if (type === DownloadType.Movie) {
            const files = await this.radarrService.getMovieFiles(upstreamId)
            return [upstreamId, { files }]
          }

          const [files, episodes] = await Promise.all([
            this.sonarrService.getEpisodeFiles(upstreamId),
            this.sonarrService.getEpisodes(upstreamId),
          ])
          return [upstreamId, { episodes, files }]
        },
      ),
    )

    const byUpstreamId = new Map(fetched)

    for (const job of jobs) {
      const inputs = byUpstreamId.get(job.upstreamId)
      if (inputs) byJobId.set(job.record.id, inputs)
    }

    return byJobId
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
