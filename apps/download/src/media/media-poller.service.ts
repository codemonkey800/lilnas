import type { MovieFileResource } from '@lilnas/media/radarr'
import type { EpisodeFileResource, EpisodeResource } from '@lilnas/media/sonarr'
import {
  DownloadJobRecord,
  DownloadJobStatus,
  type DownloadQueueSnapshot,
  DownloadType,
  type EpisodeStateEntry,
  isManagedMedia,
  isMovie,
  Media,
  MEDIA_EVENT_TYPE,
  type MediaEvent,
  type Movie,
  type Show,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'

import { didJobComplete } from './job-completion.util'
import { MediaResolverService } from './media-resolver.service'
import { MediaStateService, type QueueSource } from './media-state.service'
import { toEpisodeStateEntries } from './media-state.util'
import {
  aggregateQueueItems,
  deriveStatusFromQueueItem,
  describeQueueItemError,
  isQueueSnapshotEqual,
  LEFT_QUEUE_WITHOUT_FILE_ERROR,
  matchesScope,
  PollableQueueItem,
  settleWithoutQueueItem,
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

/** The media type whose upstream library ids a queue source's items carry. */
const SOURCE_TYPE = {
  radarr: DownloadType.Movie,
  sonarr: DownloadType.Show,
} as const satisfies Record<QueueSource, DownloadType>

/** `SOURCE_TYPE`, inverted: the queue source a media type's items come from. */
const SOURCE_OF = {
  [DownloadType.Movie]: 'radarr',
  [DownloadType.Show]: 'sonarr',
} as const satisfies Record<DownloadType.Movie | DownloadType.Show, QueueSource>

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
 * Reads Radarr's and Sonarr's **whole** queues every tick, hands them to
 * `MediaStateService` (so a download this app didn't start - grabbed in
 * Radarr's own UI, from Discord, from another tab - still shows up on its
 * media), and drives the movie/show jobs tracked in DownloadStateService
 * through Requested -> Searching -> Downloading -> Importing/NeedsAttention ->
 * Completed/Failed.
 *
 * A job's queue item says where it is; a job with **no** item is settled
 * from the library instead - `completed` only once a file for its scope
 * landed after it was created, `failed` once a grabbed job has been gone
 * from the queue for `QUEUE_ABSENCE_GRACE_MS` with nothing to show for it.
 * See `settleAbsentJobs`.
 *
 * Also broadcasts a `MediaEvent` for every movie/show whose state moved this
 * tick - owned by a job or not - so an open page follows a download it
 * never asked for. See `broadcastMediaChanges`.
 *
 * Writes only `status`/`error` to the job. The queue snapshot is never
 * stored against the job at all: a job's `media.queueSnapshot` is the
 * resolver's, read off the queue cache this poller feeds, so a progress-only
 * change just re-broadcasts the job (`DownloadStateService.touchJob()`) and
 * the hydrate that broadcast runs picks the new number up.
 *
 * Runs every 10s via @Cron (this codebase has no @Interval precedent - see
 * ytdlp-update.service.ts). A tick with work to do first asks upstream to
 * refresh its queue, which otherwise only moves once a minute. On error,
 * backs off exponentially from 10s up to a 2min cap; a success resets the
 * backoff immediately.
 */
@Injectable()
export class MediaPollerService {
  private logger = new Logger(MediaPollerService.name)
  private nextAllowedRunAt = 0
  private backoffMs = BASE_BACKOFF_MS

  /**
   * Per source, every media id that had a queue item as of the last media
   * diff, with the upstream id (Radarr `movieId` / Sonarr `seriesId`) it was
   * queued under. What tells a media that just left the queue - and so owes
   * one last event - apart from one that was never in it.
   *
   * A job settling on a landed file puts its media back in here too (see
   * `settleAbsentJobs`), so it owes that last event again.
   */
  private readonly queuedMedia: Record<QueueSource, Map<string, number>> = {
    radarr: new Map(),
    sonarr: new Map(),
  }

  /** Media id -> digest of the last media event broadcast for it. */
  private readonly lastDigest = new Map<string, string>()

  /**
   * Job id -> when (epoch ms, wall-clock) a tracked job was first seen with
   * no queue item, for as long as it stays that way. An item reappearing
   * clears it; so does the job settling or no longer being tracked.
   */
  private readonly absentSince = new Map<string, number>()

  /**
   * Job id -> the snapshot of the job's own queue item(s) as of the last
   * frame this poller caused for it. Only a change detector: what goes on
   * the wire is the media's snapshot, which the broadcast's resolve derives
   * from the queue cache. Dropped once the job has no item, and once it
   * settles or is no longer tracked.
   */
  private readonly lastSnapshot = new Map<string, DownloadQueueSnapshot>()

  constructor(
    private readonly downloadGateway: DownloadGateway,
    private readonly downloadStateService: DownloadStateService,
    private readonly mediaResolverService: MediaResolverService,
    private readonly mediaStateService: MediaStateService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  @Cron('*/10 * * * * *')
  async poll(): Promise<void> {
    const action = 'poll'

    if (Date.now() < this.nextAllowedRunAt) {
      return
    }

    // The sources whose queue was stored this tick. Only those are diffed, so
    // a source whose read failed - its previous queue kept - can't make every
    // one of its media look like it just left the queue.
    const stored = new Set<QueueSource>()

    try {
      // allSettled rather than all, so the media diff below never starts
      // while the other source is still mid-tick.
      const results = await Promise.allSettled([
        this.pollMovies(stored),
        this.pollShows(stored),
      ])
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      )
      if (failure) throw failure.reason

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

    this.forgetUntrackedJobs()
    await this.broadcastMediaChanges(stored)
  }

  /**
   * Radarr keeps `find()`: a movie is one file and one queue item, so there
   * is nothing to aggregate and routing it through `aggregateQueueItems`
   * would only obscure that.
   */
  private async pollMovies(stored: Set<QueueSource>): Promise<void> {
    const tracked = await this.trackedJobs(DownloadType.Movie)

    await this.requestQueueRefresh('radarr', tracked, () =>
      this.radarrService.refreshMonitoredDownloads(),
    )

    // Unfiltered: the tracked jobs are only some of what's in flight, and the
    // rest is exactly what the media state cache is for.
    const queue = await this.radarrService.getQueue()
    this.mediaStateService.setQueue('radarr', queue)
    stored.add('radarr')

    const absent: TrackedJob[] = []
    for (const job of tracked) {
      const item = queue.find(q => q.movieId === job.upstreamId)
      if (item) {
        this.absentSince.delete(job.record.id)
        this.applyUpdate(job.record, item)
      } else {
        absent.push(job)
      }
    }

    const settled = await this.settleAbsentJobs(DownloadType.Movie, absent)
    this.touchDequeuedJobs(absent, settled)
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
  private async pollShows(stored: Set<QueueSource>): Promise<void> {
    const tracked = await this.trackedJobs(DownloadType.Show)

    await this.requestQueueRefresh('sonarr', tracked, () =>
      this.sonarrService.refreshMonitoredDownloads(),
    )

    const queue = await this.sonarrService.getQueue()
    this.mediaStateService.setQueue('sonarr', queue)
    stored.add('sonarr')

    const absent: TrackedJob[] = []
    for (const job of tracked) {
      const matches = queue.filter(
        q => q.seriesId === job.upstreamId && matchesScope(q, job.record.scope),
      )
      const item = aggregateQueueItems(matches)
      if (item) {
        this.absentSince.delete(job.record.id)
        this.applyUpdate(job.record, item)
      } else {
        absent.push(job)
      }
    }

    const settled = await this.settleAbsentJobs(DownloadType.Show, absent)
    this.touchDequeuedJobs(absent, settled)
  }

  /**
   * Settles the tracked jobs that had no queue item this tick, from the
   * files upstream holds for them. See `settleWithoutQueueItem` for the
   * rule; this supplies its two inputs - `didJobComplete`'s verdict and how
   * long the job has been missing from the queue.
   *
   * Never throws. A job whose files can't be read is left exactly as it is,
   * past the grace period or not: without the listing there is no telling a
   * finished import from a dropped download, and guessing either way is
   * worse than asking again next tick.
   *
   * Returns the ids of the jobs whose status it wrote.
   */
  private async settleAbsentJobs(
    type: DownloadType.Movie | DownloadType.Show,
    jobs: readonly TrackedJob[],
  ): Promise<Set<string>> {
    const settled = new Set<string>()
    if (jobs.length === 0) return settled

    const now = Date.now()
    for (const { record } of jobs) {
      if (!this.absentSince.has(record.id)) {
        this.absentSince.set(record.id, now)
      }
    }

    const inputs = await this.completionInputs(type, jobs)

    for (const { record: tracked, upstreamId } of jobs) {
      const data = inputs.get(tracked.id)
      if (!data) continue

      // Re-read: the file listing was awaited, and a cancel may have landed
      // in the meantime. A job that settled elsewhere is not ours to move.
      const record = this.downloadStateService.jobs.get(tracked.id)
      if (!record || TERMINAL_STATUSES.has(record.status)) continue

      const fileLanded = didJobComplete({
        createdAt: new Date(record.createdAt),
        episodes: data.episodes,
        files: data.files,
        scope: record.scope,
      })
      const absentForMs = now - (this.absentSince.get(record.id) ?? now)

      const next = settleWithoutQueueItem(
        record.status,
        fileLanded,
        absentForMs,
      )
      if (next === undefined) continue

      const error =
        next === DownloadJobStatus.Failed
          ? LEFT_QUEUE_WITHOUT_FILE_ERROR
          : undefined

      this.logger.log(
        {
          action: 'settleAbsentJobs',
          absentForMs,
          error,
          fileLanded,
          jobId: record.id,
          mediaId: record.mediaId,
          newStatus: next,
          oldStatus: record.status,
        },
        'Media job settled without a queue item',
      )

      this.absentSince.delete(record.id)
      this.writeStatus(record, next, error)
      settled.add(record.id)

      // The media's vanish event may already be out - sent the tick its item
      // left, before Radarr/Sonarr listed the import - and after it nothing
      // else would tell an open page the file landed. Owing the media one
      // more event makes this tick's diff re-read it (invalidated, so with
      // the file) and send it; when the vanish is this same tick, it is
      // already owed and this changes nothing.
      if (next === DownloadJobStatus.Completed) {
        this.queuedMedia[SOURCE_OF[type]].set(record.mediaId, upstreamId)
      }
    }

    return settled
  }

  /**
   * Re-broadcasts each job whose queue item left this tick, so its media
   * frame drops the progress the last one carried. A job `settleAbsentJobs`
   * just moved is skipped - its status write already broadcast, and that
   * hydrate reads the same, item-less, cache.
   */
  private touchDequeuedJobs(
    absent: readonly TrackedJob[],
    settled: ReadonlySet<string>,
  ): void {
    for (const { record } of absent) {
      if (this.lastSnapshot.delete(record.id) && !settled.has(record.id)) {
        this.downloadStateService.touchJob(record.id)
      }
    }
  }

  /**
   * Drops the absence timer and remembered snapshot of every job that is no
   * longer in flight, so both maps only ever hold jobs the poller still
   * tracks. Runs every tick, failed or not: a job cancelled while upstream
   * was down still goes.
   */
  private forgetUntrackedJobs(): void {
    for (const byJob of [this.absentSince, this.lastSnapshot]) {
      for (const jobId of byJob.keys()) {
        const record = this.downloadStateService.jobs.get(jobId)
        if (!record || TERMINAL_STATUSES.has(record.status)) {
          byJob.delete(jobId)
        }
      }
    }
  }

  /**
   * Nudges Radarr/Sonarr to re-read the download client, so the queue this
   * tick reads is at most one tick old rather than up to a minute. See
   * `RadarrService.refreshMonitoredDownloads`.
   *
   * Sent only while there is something to watch move: a tracked job, or
   * anything at all in the queue as of the previous tick - which covers a
   * download this app didn't start, until it leaves the queue. An idle
   * Radarr/Sonarr is sent nothing, rather than a command six times a minute
   * forever. The previous queue is read here, so this must run before the
   * tick's own `setQueue`.
   *
   * Best-effort: a refused refresh just means reading the queue as upstream
   * last refreshed it, which is exactly the old behavior, so it is logged
   * and swallowed rather than tripping `poll()`'s backoff. If upstream is
   * genuinely down, the `getQueue` right after it throws and the backoff
   * happens there.
   */
  private async requestQueueRefresh(
    source: QueueSource,
    tracked: readonly TrackedJob[],
    refresh: () => Promise<void>,
  ): Promise<void> {
    const previousQueue = this.mediaStateService.getQueue(source)
    if (tracked.length === 0 && previousQueue.length === 0) return

    try {
      await refresh()
    } catch (err) {
      this.logger.warn(
        { action: 'requestQueueRefresh', error: getErrorMessage(err), source },
        'Queue refresh request failed, reading the queue as-is',
      )
    }
  }

  /**
   * Broadcasts a `MediaEvent` for each movie/show whose state moved since the
   * last tick, for every source whose queue was stored this tick.
   *
   * Never throws: this runs after the job updates, and a media event that
   * can't be built is a missed frame the next tick re-sends, never a reason
   * to back off the poll or stall job tracking.
   */
  private async broadcastMediaChanges(
    stored: ReadonlySet<QueueSource>,
  ): Promise<void> {
    await Promise.all(
      Array.from(stored, async source => {
        try {
          await this.broadcastSourceChanges(source)
        } catch (err) {
          this.logger.warn(
            {
              action: 'broadcastMediaChanges',
              error: getErrorMessage(err),
              source,
            },
            'Media event diff failed, retrying next tick',
          )
        }
      }),
    )
  }

  /**
   * The media diff for one source. Covers every media id with a queue item
   * this tick **or last**: the second half is what sends the event a
   * finished download ends on - `available`, with the file path the import
   * just produced - and the first is what makes a download started outside
   * this app, with no job to track it, reach every open page at all.
   *
   * Costs one batched `resolve()` per tick while anything is queued (served
   * from the resolver's library cache), plus one `getEpisodes` per series
   * with activity - a series is one event however many episodes it has
   * queued, carrying every episode's state. A source with nothing queued
   * this tick or last costs nothing.
   *
   * A media left the queue when its upstream id did, not when its media id
   * stopped resolving: a library read that fails or lags must not read as
   * every download finishing at once.
   */
  private async broadcastSourceChanges(source: QueueSource): Promise<void> {
    const type = SOURCE_TYPE[source]
    const queuedIds = new Set(
      this.mediaStateService.getQueue(source).flatMap(item => {
        const upstreamId = source === 'radarr' ? item.movieId : item.seriesId
        return upstreamId == null ? [] : [upstreamId]
      }),
    )
    const previous = this.queuedMedia[source]
    if (queuedIds.size === 0 && previous.size === 0) return

    // Media id -> upstream id. Anything seen last tick already knows its
    // media id; only an upstream id new this tick needs the library.
    const batch = new Map(previous)
    const known = new Set(previous.values())
    const unknown = Array.from(queuedIds).filter(id => !known.has(id))
    for (const [mediaId, upstreamId] of await this.mediaIdsFor(type, unknown)) {
      batch.set(mediaId, upstreamId)
    }
    if (batch.size === 0) return

    // Before resolve(), so a media that just left the queue is read fresh
    // from upstream rather than as the cache last saw it - mid-download, no
    // file, no Emby link.
    for (const [mediaId, upstreamId] of batch) {
      if (!queuedIds.has(upstreamId)) {
        this.mediaResolverService.invalidate(mediaId)
      }
    }

    const { degradedSources, media } = await this.mediaResolverService.resolve(
      Array.from(batch.keys(), mediaId => ({ mediaId, type })),
    )

    // A degraded source hands back placeholders, and broadcasting one would
    // replace a subscriber's real copy with a bare id. Nothing is recorded,
    // so the whole batch - vanished ids included - is retried next tick.
    if (degradedSources.includes(type)) {
      this.logger.warn(
        { action: 'broadcastSourceChanges', source },
        'Media resolve degraded, skipping media events this tick',
      )
      return
    }

    const next = new Map<string, number>()

    await Promise.all(
      Array.from(batch, async ([mediaId, upstreamId]) => {
        const digest = await this.broadcastIfChanged(
          type,
          mediaId,
          media.get(mediaId),
          upstreamId,
        )

        // Unsent: kept, whether still queued or just gone, so the next tick
        // tries it again.
        if (digest === undefined) {
          next.set(mediaId, upstreamId)
          return
        }

        // Gone and its last event sent (or unneeded): forgotten, so it costs
        // nothing until it is queued again.
        if (!queuedIds.has(upstreamId)) {
          this.lastDigest.delete(mediaId)
          return
        }

        this.lastDigest.set(mediaId, digest)
        next.set(mediaId, upstreamId)
      }),
    )

    this.queuedMedia[source] = next
  }

  /**
   * Media id -> upstream id for the given Radarr/Sonarr ids, read off the
   * resolver's cached library rather than asked of upstream per item. An id
   * the library doesn't hold yet (added since the cache filled) is simply
   * absent and gets another try next tick; a library that can't be read
   * yields nothing, for the same reason.
   */
  private async mediaIdsFor(
    type: DownloadType.Movie | DownloadType.Show,
    upstreamIds: readonly number[],
  ): Promise<Map<string, number>> {
    const found = new Map<string, number>()
    if (upstreamIds.length === 0) return found

    let library: ReadonlyMap<number, Movie | Show>
    try {
      library =
        type === DownloadType.Movie
          ? await this.mediaResolverService.getMovieLibrary()
          : await this.mediaResolverService.getShowLibrary()
    } catch (err) {
      this.logger.warn(
        { action: 'mediaIdsFor', error: getErrorMessage(err), type },
        'Library read failed, new queue items wait for the next tick',
      )
      return found
    }

    const wanted = new Set(upstreamIds)
    for (const item of library.values()) {
      const upstreamId = upstreamLibraryId(item)
      if (upstreamId != null && wanted.has(upstreamId)) {
        found.set(item.id, upstreamId)
      }
    }

    return found
  }

  /**
   * Broadcasts one media's event if its state moved since the last one sent,
   * and returns the digest it was compared by - or `undefined` when no event
   * could be built, which the caller retries.
   *
   * The digest covers only what the poller moves - state, reason, snapshot,
   * episodes - so a tick that changed nothing sends nothing even though the
   * media object is rebuilt each time. A show's episodes come from one
   * `getEpisodes` call, not one per queued episode.
   */
  private async broadcastIfChanged(
    type: DownloadType.Movie | DownloadType.Show,
    mediaId: string,
    media: Media | undefined,
    upstreamId: number,
  ): Promise<string | undefined> {
    if (!media || !isManagedMedia(media)) return undefined

    // Read before the await below: `media` is the resolver's cached object,
    // which another resolve() may re-annotate in the meantime.
    const { queueSnapshot, state, stateReason } = media

    let episodes: EpisodeStateEntry[] | undefined
    if (type === DownloadType.Show) {
      try {
        episodes = toEpisodeStateEntries(
          await this.sonarrService.getEpisodes(upstreamId),
          this.mediaStateService.queueItemsFor(DownloadType.Show, upstreamId),
        )
      } catch (err) {
        this.logger.warn(
          {
            action: 'broadcastIfChanged',
            error: getErrorMessage(err),
            mediaId,
          },
          'Episode read failed, skipping this media event',
        )
        return undefined
      }
    }

    const digest = JSON.stringify({
      state,
      stateReason,
      queueSnapshot,
      episodes,
    })
    if (digest === this.lastDigest.get(mediaId)) return digest

    const event: MediaEvent = { media, ...(episodes ? { episodes } : {}) }
    this.downloadGateway.broadcast({ data: event, type: MEDIA_EVENT_TYPE })

    return digest
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
   * Never throws. A title whose read fails is logged and left out of the
   * map, so its jobs stay exactly as they are this tick while every other
   * title's jobs still settle - one flaky title must not hold up the rest,
   * nor trip `poll()`'s backoff, which the queue read already owns.
   */
  private async completionInputs(
    type: DownloadType.Movie | DownloadType.Show,
    jobs: readonly TrackedJob[],
  ): Promise<Map<string, PollableCompletionData>> {
    const byJobId = new Map<string, PollableCompletionData>()
    if (jobs.length === 0) return byJobId

    const upstreamIds = Array.from(new Set(jobs.map(job => job.upstreamId)))
    const byUpstreamId = new Map<number, PollableCompletionData>()

    await Promise.all(
      upstreamIds.map(async upstreamId => {
        try {
          byUpstreamId.set(
            upstreamId,
            await this.fetchCompletionData(type, upstreamId),
          )
        } catch (err) {
          this.logger.warn(
            {
              action: 'completionInputs',
              error: getErrorMessage(err),
              type,
              upstreamId,
            },
            'File listing failed, leaving its jobs unsettled this tick',
          )
        }
      }),
    )

    for (const job of jobs) {
      const inputs = byUpstreamId.get(job.upstreamId)
      if (inputs) byJobId.set(job.record.id, inputs)
    }

    return byJobId
  }

  private async fetchCompletionData(
    type: DownloadType.Movie | DownloadType.Show,
    upstreamId: number,
  ): Promise<PollableCompletionData> {
    if (type === DownloadType.Movie) {
      return { files: await this.radarrService.getMovieFiles(upstreamId) }
    }

    const [files, episodes] = await Promise.all([
      this.sonarrService.getEpisodeFiles(upstreamId),
      this.sonarrService.getEpisodes(upstreamId),
    ])
    return { episodes, files }
  }

  /** Moves a job that has a queue item this tick to what the item says. */
  private applyUpdate(
    record: DownloadJobRecord,
    item: PollableQueueItem,
  ): void {
    const previousSnapshot = this.lastSnapshot.get(record.id)
    const newStatus = deriveStatusFromQueueItem(record.status, item)
    const newSnapshot = toQueueSnapshot(item)

    // The two statuses that carry upstream's own sentence: a failure says
    // why it failed, and a blocked import says why Radarr/Sonarr refused it
    // ("was not found in the grabbed release"). Without this the one line
    // that tells a person what to do in the manual-import dialog is dropped.
    const carriesReason =
      newStatus === DownloadJobStatus.Failed ||
      newStatus === DownloadJobStatus.NeedsAttention
    const error = carriesReason ? describeQueueItemError(item) : undefined

    // A job can sit in NeedsAttention for hours while upstream re-parses the
    // release and changes its mind about *why* it's stuck. That is a real
    // change with no status move and no snapshot move behind it, so without
    // this the early return below would pin the first sentence forever.
    const reasonChanged =
      newStatus === DownloadJobStatus.NeedsAttention &&
      record.status === DownloadJobStatus.NeedsAttention &&
      error !== record.error

    if (
      newStatus === record.status &&
      !reasonChanged &&
      isQueueSnapshotEqual(newSnapshot, previousSnapshot)
    ) {
      return
    }

    this.logger.log(
      {
        action: 'applyUpdate',
        jobId: record.id,
        mediaId: record.mediaId,
        oldStatus: record.status,
        newStatus,
        snapshot: newSnapshot,
      },
      'Media job status changed',
    )

    this.lastSnapshot.set(record.id, newSnapshot)

    // One frame either way. A status move broadcasts from updateJob, and
    // that hydrate already carries the new snapshot off the queue cache; a
    // progress-only tick (same status, new percentage) re-broadcasts the job
    // instead of making a pointless job-row write.
    if (newStatus === record.status && !reasonChanged) {
      this.downloadStateService.touchJob(record.id)
      return
    }

    this.writeStatus(record, newStatus, error)
  }

  /**
   * Writes a status move to the job. `error` is the reason a Failed or
   * NeedsAttention status carries, when there is one; any other status
   * leaves `error` alone, except that leaving NeedsAttention clears it.
   */
  private writeStatus(
    record: DownloadJobRecord,
    newStatus: DownloadJobStatus,
    error: string | undefined,
  ): void {
    const carriesReason =
      newStatus === DownloadJobStatus.Failed ||
      newStatus === DownloadJobStatus.NeedsAttention

    // Before updateJob, because updateJob is what broadcasts: a detail page
    // re-renders the moment it hears `completed`, and the resolver's library
    // cache would otherwise hand it the pre-import copy - no file, no Watch
    // link - for up to a minute.
    if (newStatus === DownloadJobStatus.Completed) {
      this.mediaResolverService.invalidate(record.mediaId)
    }

    this.downloadStateService.updateJob(record.id, {
      // Leaving NeedsAttention must drop the reason explicitly - updateJob
      // spreads the patch over the record and never touches `error` on its
      // own, and buildJobRow persists `record.error ?? null`, so only an
      // explicit `undefined` clears both the record and the row. Without it
      // a job that finally imported would carry "was not found in the
      // grabbed release" into history forever.
      ...(carriesReason
        ? error
          ? { error }
          : {}
        : record.status === DownloadJobStatus.NeedsAttention
          ? { error: undefined }
          : {}),
      status: newStatus,
    })
  }
}

function upstreamLibraryId(media: Media | undefined): number | undefined {
  if (!media || !isManagedMedia(media)) return undefined
  return isMovie(media) ? media.radarrId : media.sonarrId
}
