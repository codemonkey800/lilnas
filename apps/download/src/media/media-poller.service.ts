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
  type MediaState,
  type Movie,
  type Show,
  type ShowScope,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { nanoid } from 'nanoid'

import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'

import {
  type AdoptionCandidate,
  isAdoptable,
  planAdoptions,
} from './adoption.util'
import { didJobComplete } from './job-completion.util'
import { MediaResolverService } from './media-resolver.service'
import { MediaStateService, type QueueSource } from './media-state.service'
import { toEpisodeStateEntries } from './media-state.util'
import {
  aggregateQueueItems,
  type DequeuedOutcome,
  dequeuedOutcome,
  deriveStatusFromQueueItem,
  describeQueueItemError,
  isQueueSnapshotEqual,
  LEFT_QUEUE_WITHOUT_FILE_ERROR,
  matchesScope,
  PollableQueueItem,
  QUEUE_ABSENCE_GRACE_MS,
  REMOVED_FROM_QUEUE_ERROR,
  settleWithoutQueueItem,
  toQueueSnapshot,
} from './queue-status.util'
import { RadarrService } from './radarr.service'
import type { HistoryRecordLike } from './release-history.util'
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

/** An adoption candidate the library mapped, with the scope to mint it at. */
interface MappedCandidate {
  candidate: AdoptionCandidate
  mediaId: string
  scope: ShowScope | undefined
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
 * landed after it was created, `cancelled`/`failed` as soon as the history
 * of its own downloads says someone removed them or the client failed them,
 * and otherwise `failed` once a grabbed job has been gone from the queue for
 * `QUEUE_ABSENCE_GRACE_MS` with nothing to show for it. See
 * `settleAbsentJobs`.
 *
 * A `cancelling` job - cancel pressed here, its queue items already removed
 * - is carried the rest of the way. A queue item it still has (a search
 * running at the press can grab a release seconds later) is removed rather
 * than followed, and once the queue has none it settles `cancelled`, or
 * `completed` if a file landed anyway. See `removeLateGrab`.
 *
 * Adopts every download no in-flight job covers - one grabbed in
 * Radarr's/Sonarr's own UI, by their RSS sync, or by a search this app did
 * not send - by minting a job for it, so it can be followed and cancelled
 * like one requested here. Upgrades of a file already on disk are left
 * alone. See `adoptUnownedDownloads`.
 *
 * Also broadcasts a `MediaEvent` for every movie/show whose state moved this
 * tick - owned by a job or not - so an open page follows a download it
 * never asked for, through to the file it lands. See
 * `broadcastSourceChanges`.
 *
 * Writes only `status`/`error` to the job. The queue snapshot is never
 * stored against the job at all: a job's `media.queueSnapshot` is the
 * resolver's, read off the queue cache this poller feeds, so a progress-only
 * change just re-broadcasts the job (`DownloadStateService.touchJob()`) and
 * the hydrate that broadcast runs picks the new number up.
 *
 * Runs every 1s via @Cron (this codebase has no @Interval precedent - see
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
   * Per source, every media id the media diff is watching, with the upstream
   * id (Radarr `movieId` / Sonarr `seriesId`) it was queued under: each one
   * with a queue item as of the last diff, plus each one that left the queue
   * and hasn't landed its file yet (see `vanishedAt`). What tells a media
   * that is - or just was - downloading apart from one that never was.
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
   * Media id -> when (epoch ms, wall-clock) a watched media was first seen
   * with no queue item. Radarr/Sonarr can drop the item a tick before they
   * list the import, so a media stays watched - re-read fresh every tick -
   * until its file lands or `QUEUE_ABSENCE_GRACE_MS` passes without one.
   */
  private readonly vanishedAt = new Map<string, number>()

  /**
   * Series media id -> the Sonarr episode ids it had queued the last tick it
   * had any, or `null` when an item carried no episode id. How a series that
   * already had files - `available` before the grab even started - tells
   * that *this* download landed. See `hasLanded`.
   */
  private readonly queuedEpisodes = new Map<
    string,
    ReadonlySet<number> | null
  >()

  /**
   * Job id -> when (epoch ms, wall-clock) a tracked job was first seen with
   * no queue item, for as long as it stays that way. An item reappearing
   * clears it - except on a `cancelling` job, whose late grab is removed
   * without restarting its grace period - and so does the job settling or
   * no longer being tracked.
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

  /**
   * Job id -> every download-client id its queue items have carried. What
   * picks the job's own downloads out of the title's history once they leave
   * the queue (see `dequeuedOutcomes`). In memory only: a job whose items
   * left before a restart has none, and settles on the grace period.
   */
  private readonly downloadIds = new Map<string, Set<string>>()

  /**
   * Per source, the queued upstream ids `mediaIdsFor` already re-read the
   * library for. Each id gets one early re-read, not one a tick: an item
   * whose title isn't in the library at all would otherwise refetch the whole
   * library every second. It still resolves once the cache expires on its
   * own. An id is dropped once it leaves the queue.
   */
  private readonly refetchedFor: Record<QueueSource, Set<number>> = {
    radarr: new Set(),
    sonarr: new Set(),
  }

  constructor(
    private readonly downloadGateway: DownloadGateway,
    private readonly downloadStateService: DownloadStateService,
    private readonly mediaResolverService: MediaResolverService,
    private readonly mediaStateService: MediaStateService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  @Cron('*/1 * * * * *')
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
      if (!item) {
        absent.push(job)
      } else if (job.record.status === DownloadJobStatus.Cancelling) {
        // Every row for the movie, not just the first: none of them is
        // wanted any more.
        const items = queue.filter(q => q.movieId === job.upstreamId)
        this.rememberDownloads(job.record.id, items)
        await this.removeLateGrab(DownloadType.Movie, job.record, items)
      } else {
        this.absentSince.delete(job.record.id)
        this.rememberDownloads(job.record.id, [item])
        this.applyUpdate(job.record, item)
      }
    }

    const settled = await this.settleAbsentJobs(DownloadType.Movie, absent)
    this.touchDequeuedJobs(absent, settled)

    await this.adoptUnownedDownloads(DownloadType.Movie, queue)
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
      if (!item) {
        absent.push(job)
      } else if (job.record.status === DownloadJobStatus.Cancelling) {
        // `matches` is already narrowed to the job's scope, so a sibling
        // episode's download is never touched.
        this.rememberDownloads(job.record.id, matches)
        await this.removeLateGrab(DownloadType.Show, job.record, matches)
      } else {
        this.absentSince.delete(job.record.id)
        this.rememberDownloads(job.record.id, matches)
        this.applyUpdate(job.record, item)
      }
    }

    const settled = await this.settleAbsentJobs(DownloadType.Show, absent)
    this.touchDequeuedJobs(absent, settled)

    await this.adoptUnownedDownloads(DownloadType.Show, queue)
  }

  /** Adds the download-client ids of a job's queue items to `downloadIds`. */
  private rememberDownloads(
    jobId: string,
    items: readonly PollableQueueItem[],
  ): void {
    for (const { downloadId } of items) {
      if (!downloadId) continue

      const known = this.downloadIds.get(jobId)
      if (known) known.add(downloadId)
      else this.downloadIds.set(jobId, new Set([downloadId]))
    }
  }

  /**
   * Removes the queue items a `cancelling` job still has - a release the
   * search already running at the press grabbed afterwards, or a removal
   * that hadn't shown in the queue yet. The job's status is left alone and
   * so is its absence timer: `settleAbsentJobs` moves it once the queue has
   * nothing for it, and a late grab must not restart the grace period.
   *
   * Best-effort and never throws: an item with no id can't be named to
   * Radarr/Sonarr, and a refused removal is logged and tried again next tick
   * rather than tripping `poll()`'s backoff.
   */
  private async removeLateGrab(
    type: DownloadType.Movie | DownloadType.Show,
    record: DownloadJobRecord,
    items: readonly PollableQueueItem[],
  ): Promise<void> {
    const action = 'removeLateGrab'
    const source = SOURCE_OF[type]

    const queueIds: number[] = []
    for (const item of items) {
      if (item.id != null) {
        queueIds.push(item.id)
        continue
      }

      this.logger.warn(
        { action, jobId: record.id, mediaId: record.mediaId, source },
        'Queue item of a cancelling job has no id, cannot remove it',
      )
    }
    if (queueIds.length === 0) return

    const removals = await Promise.allSettled(
      queueIds.map(queueId =>
        type === DownloadType.Movie
          ? this.radarrService.removeQueueItem(queueId)
          : this.sonarrService.removeQueueItem(queueId),
      ),
    )

    for (const [index, result] of removals.entries()) {
      const queueId = queueIds[index]
      if (result.status === 'fulfilled') {
        this.logger.log(
          {
            action,
            jobId: record.id,
            mediaId: record.mediaId,
            queueId,
            source,
          },
          'Removed a queue item from a cancelling job',
        )
        continue
      }

      this.logger.warn(
        {
          action,
          error: getErrorMessage(result.reason),
          jobId: record.id,
          mediaId: record.mediaId,
          queueId,
          source,
        },
        'Failed to remove a queue item from a cancelling job, retrying next tick',
      )
    }
  }

  /**
   * Mints a job for each download in this tick's `queue` that no in-flight
   * job covers - see adoption.util.ts for which ones those are. From then on
   * it is an ordinary tracked job: the next tick follows its queue item, and
   * its download ids are remembered here so its history settles it once the
   * item leaves. `addJob` persists the row, so a restart re-adopts the job
   * through `DownloadStateService.adoptOpenJobs` rather than minting another.
   *
   * Ownership is checked three ways. A `cancelling` job counts, so a late
   * grab `removeLateGrab` is removing is never adopted. A download id any job
   * has carried is claimed. And a job whose title did not resolve this tick -
   * which `trackedJobs` drops - still owns its media id, checked once the
   * library maps the candidate.
   *
   * Nothing past the first, pure pass costs anything while every queued
   * download is one a tracked job just remembered; a show's episodes are
   * read only for a series with a candidate left.
   *
   * The ownership re-check and the write run with no `await` between them,
   * so a job minted meanwhile - by an overlapping tick (the cron has no
   * overlap guard) or by a request - wins.
   *
   * Never throws: a failed read is logged and the download waits a tick,
   * rather than tripping `poll()`'s backoff.
   */
  private async adoptUnownedDownloads(
    type: DownloadType.Movie | DownloadType.Show,
    queue: readonly PollableQueueItem[],
  ): Promise<void> {
    const action = 'adoptUnownedDownloads'

    try {
      const claimed = this.claimedDownloadIds()
      if (planAdoptions(type, queue, [], claimed).length === 0) return

      const openJobs = (await this.resolveOpenJobs(type)).flatMap(
        ({ record, upstreamId }) =>
          upstreamId == null ? [] : [{ scope: record.scope, upstreamId }],
      )
      const planned = planAdoptions(type, queue, openJobs, claimed)
      if (planned.length === 0) return

      const mediaIds = await this.mediaIdsFor(
        type,
        Array.from(new Set(planned.map(candidate => candidate.upstreamId))),
      )
      const mediaIdOf = new Map(
        Array.from(mediaIds, ([mediaId, upstreamId]) => [upstreamId, mediaId]),
      )

      // A title the library can't map yet is skipped - `mediaIdsFor` gives it
      // an early re-read, and it is asked about again next tick.
      const mapped = planned.flatMap(candidate => {
        const mediaId = mediaIdOf.get(candidate.upstreamId)
        return mediaId === undefined ||
          this.isOwned(type, mediaId, candidate.items)
          ? []
          : [{ candidate, mediaId, scope: candidate.scope }]
      })
      if (mapped.length === 0) return

      const adoptable =
        type === DownloadType.Movie
          ? await this.adoptableMovies(mapped)
          : await this.adoptableShows(mapped)

      for (const entry of adoptable) this.adopt(type, entry)
    } catch (err) {
      this.logger.warn(
        { action, error: getErrorMessage(err), type },
        'Adopting upstream downloads failed, retrying next tick',
      )
    }
  }

  /**
   * The movie candidates that are not upgrades, by the resolved media's file
   * signal - the frontend's `movieHasFile`: a `filePath`, or an Emby status,
   * which is only ever looked up for a title with a file (the library cache
   * can hold a movie without its expanded file). A degraded resolve hands
   * back placeholders with neither, so nothing is adopted off one.
   */
  private async adoptableMovies(
    mapped: readonly MappedCandidate[],
  ): Promise<MappedCandidate[]> {
    const { degradedSources, media } = await this.mediaResolverService.resolve(
      mapped.map(({ mediaId }) => ({ mediaId, type: DownloadType.Movie })),
    )
    if (degradedSources.includes(DownloadType.Movie)) {
      this.logger.warn(
        { action: 'adoptableMovies' },
        'Media resolve degraded, adopting no movie downloads this tick',
      )
      return []
    }

    return mapped.filter(entry => {
      const movie = media.get(entry.mediaId)
      if (!movie || !isManagedMedia(movie) || !isMovie(movie)) return false

      return isAdoptable(
        entry.candidate,
        () => movie.filePath !== undefined || movie.embyStatus !== undefined,
      )
    })
  }

  /**
   * The show candidates that are not upgrades, from one `getEpisodes` per
   * series - which also supplies the `episodeNumber` an episode-scoped job
   * is displayed by. A series whose episodes can't be read is logged and its
   * candidates wait a tick.
   */
  private async adoptableShows(
    mapped: readonly MappedCandidate[],
  ): Promise<MappedCandidate[]> {
    const seriesIds = Array.from(
      new Set(mapped.map(({ candidate }) => candidate.upstreamId)),
    )
    const episodesBySeries = new Map<number, Map<number, EpisodeResource>>()

    await Promise.all(
      seriesIds.map(async seriesId => {
        try {
          const episodes = await this.sonarrService.getEpisodes(seriesId)
          episodesBySeries.set(
            seriesId,
            new Map(
              episodes.flatMap(episode =>
                episode.id == null ? [] : [[episode.id, episode] as const],
              ),
            ),
          )
        } catch (err) {
          this.logger.warn(
            {
              action: 'adoptableShows',
              error: getErrorMessage(err),
              seriesId,
            },
            'Episode read failed, adopting its downloads next tick',
          )
        }
      }),
    )

    return mapped.flatMap(entry => {
      const episodes = episodesBySeries.get(entry.candidate.upstreamId)
      if (!episodes) return []

      const adoptable = isAdoptable(entry.candidate, episodeId =>
        episodeId == null ? false : episodes.get(episodeId)?.hasFile === true,
      )
      if (!adoptable) return []

      const episodeId = entry.scope?.episodeId
      const episode = episodeId == null ? undefined : episodes.get(episodeId)
      if (!episode) return [entry]

      return [
        {
          ...entry,
          scope: {
            ...entry.scope,
            ...(episode.episodeNumber != null
              ? { episodeNumber: episode.episodeNumber }
              : {}),
            ...(entry.scope?.seasonNumber == null &&
            episode.seasonNumber != null
              ? { seasonNumber: episode.seasonNumber }
              : {}),
          },
        },
      ]
    })
  }

  /**
   * Mints the job for one candidate - synchronously, so nothing can slip in
   * between the ownership re-check and the write. Its status is the one the
   * queue derives (it is already grabbed, so never `requested`/`searching`).
   * No audit row: nobody here asked for it.
   */
  private adopt(
    type: DownloadType.Movie | DownloadType.Show,
    { candidate, mediaId, scope }: MappedCandidate,
  ): void {
    const action = 'adoptUnownedDownloads'
    const { downloadId, items, status } = candidate

    if (this.isOwned(type, mediaId, items)) return
    if (downloadId != null && this.claimedDownloadIds().has(downloadId)) return

    const id = nanoid()
    const now = new Date().toISOString()
    const record: DownloadJobRecord = {
      completedAt: null,
      createdAt: now,
      discordRequester: null,
      hiddenAttribution: false,
      id,
      linkedDiscord: null,
      mediaId,
      requester: null,
      ...(type === DownloadType.Show && scope ? { scope } : {}),
      startedUpstream: true,
      status,
      type,
      updatedAt: now,
    }

    try {
      this.downloadStateService.addJob(record)
    } catch (err) {
      this.logger.warn(
        { action, downloadId, error: getErrorMessage(err), mediaId },
        'Failed to store an adopted download, retrying next tick',
      )
      return
    }
    this.rememberDownloads(id, items)

    this.logger.log(
      { action, downloadId, jobId: id, mediaId, scope, status },
      'Adopted a download started upstream',
    )
  }

  /**
   * Whether an in-flight job of `type` on `mediaId` covers every one of
   * `items`: any job for a movie; for a show, one whose scope matches each.
   * Read straight off the job Map, so it counts a job that did not resolve
   * this tick, and one minted since the tick started.
   */
  private isOwned(
    type: DownloadType.Movie | DownloadType.Show,
    mediaId: string,
    items: readonly PollableQueueItem[],
  ): boolean {
    for (const record of this.downloadStateService.jobs.values()) {
      if (
        record.type !== type ||
        record.mediaId !== mediaId ||
        TERMINAL_STATUSES.has(record.status)
      ) {
        continue
      }

      if (
        type === DownloadType.Movie ||
        items.every(item => matchesScope(item, record.scope))
      ) {
        return true
      }
    }

    return false
  }

  /** Every download id remembered for a job the job Map still holds. */
  private claimedDownloadIds(): Set<string> {
    const claimed = new Set<string>()
    for (const [jobId, ids] of this.downloadIds) {
      if (!this.downloadStateService.jobs.has(jobId)) continue
      for (const downloadId of ids) claimed.add(downloadId)
    }
    return claimed
  }

  /**
   * Settles the tracked jobs that had no queue item this tick, from the
   * files upstream holds for them and the history of their downloads. See
   * `settleWithoutQueueItem` for the rule; this supplies its inputs -
   * `didJobComplete`'s verdict, how long the job has been missing from the
   * queue, and its `DequeuedOutcome`.
   *
   * That includes a `cancelling` job, which is not terminal: it settles
   * `cancelled` - with no `error`, the cancel being the user's own - once
   * its removal is confirmed or `CANCEL_GRACE_MS` passes, or `completed` if
   * its file landed anyway. Its absence is timed from the first tick it had
   * no item, however many late grabs `removeLateGrab` has removed since.
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
    const landed = new Map<string, boolean>()
    for (const { record } of jobs) {
      const data = inputs.get(record.id)
      if (!data) continue

      landed.set(
        record.id,
        didJobComplete({
          createdAt: new Date(record.createdAt),
          episodes: data.episodes,
          files: data.files,
          scope: record.scope,
        }),
      )
    }
    const outcomes = await this.dequeuedOutcomes(
      type,
      jobs.filter(({ record }) => landed.get(record.id) === false),
    )

    for (const { record: tracked, upstreamId } of jobs) {
      const fileLanded = landed.get(tracked.id)
      if (fileLanded === undefined) continue

      // Re-read: the file listing was awaited, and a cancel may have landed
      // in the meantime. A job that settled elsewhere is not ours to move.
      const record = this.downloadStateService.jobs.get(tracked.id)
      if (!record || TERMINAL_STATUSES.has(record.status)) continue

      const absentForMs = now - (this.absentSince.get(record.id) ?? now)
      const outcome = outcomes.get(record.id)

      const next = settleWithoutQueueItem(
        record.status,
        fileLanded,
        absentForMs,
        outcome,
      )
      if (next === undefined) continue

      const error = settledError(next, outcome, SOURCE_OF[type], record.status)

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

      // The media may no longer be watched - its watch can end on a file
      // that was already there (an upgrade) or on the grace period - and
      // then nothing else would tell an open page this file landed. Owing
      // the media one more event makes this tick's diff re-read it
      // (invalidated, so with the file) and send it; while it is still
      // watched this changes nothing.
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
    for (const byJob of [
      this.absentSince,
      this.downloadIds,
      this.lastSnapshot,
    ]) {
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
   * this tick, and every one that left the queue and is still watched: the
   * second half is what sends the event a finished download ends on -
   * `available`, with the file path the import just produced - and the
   * first is what makes a download started outside this app, with no job to
   * track it, reach every open page at all.
   *
   * A media that left the queue is re-read fresh (invalidated) every tick
   * until its file lands, or for `QUEUE_ABSENCE_GRACE_MS` if it never does:
   * the item can go a tick before Radarr/Sonarr list the import, and the
   * frame sent then - truthfully "no file" - must not be the last one.
   * Events still go out only when the digest moves.
   *
   * Costs one batched `resolve()` per tick while anything is queued (served
   * from the resolver's library cache) - plus, while anything is watched
   * after leaving the queue, one library read per tick for that source -
   * and one `getEpisodes` per series with activity; a series is one event
   * however many episodes it has queued, carrying every episode's state. A
   * source with nothing queued or watched costs nothing.
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
    // Before the early return below, so an id that left the queue gets its
    // early re-read again if it is queued again.
    for (const upstreamId of this.refetchedFor[source]) {
      if (!queuedIds.has(upstreamId))
        this.refetchedFor[source].delete(upstreamId)
    }

    const previous = this.queuedMedia[source]
    if (queuedIds.size === 0 && previous.size === 0) return

    const now = Date.now()
    const episodesBySeries =
      source === 'sonarr'
        ? queuedEpisodeIds(this.mediaStateService.getQueue(source))
        : undefined

    // Media id -> upstream id. Anything seen last tick already knows its
    // media id; only an upstream id new this tick needs the library.
    const batch = new Map(previous)
    const known = new Set(previous.values())
    const unknown = Array.from(queuedIds).filter(id => !known.has(id))
    for (const [mediaId, upstreamId] of await this.mediaIdsFor(type, unknown)) {
      batch.set(mediaId, upstreamId)
    }
    if (batch.size === 0) return

    // Before resolve(), so a media that has left the queue is read fresh
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
        const result = await this.broadcastIfChanged(
          type,
          mediaId,
          media.get(mediaId),
          upstreamId,
        )

        // Unsent: kept, whether still queued or gone, so the next tick tries
        // it again.
        if (result === undefined) {
          next.set(mediaId, upstreamId)
          return
        }

        this.lastDigest.set(mediaId, result.digest)
        next.set(mediaId, upstreamId)

        if (queuedIds.has(upstreamId)) {
          this.vanishedAt.delete(mediaId)
          if (episodesBySeries) {
            this.queuedEpisodes.set(
              mediaId,
              episodesBySeries.get(upstreamId) ?? null,
            )
          }
          return
        }

        // Gone: watched until its file lands, or for the grace period if it
        // never does, then forgotten - so it costs nothing until it is
        // queued again.
        const since = this.vanishedAt.get(mediaId) ?? now
        if (result.landed || now - since >= QUEUE_ABSENCE_GRACE_MS) {
          next.delete(mediaId)
          this.lastDigest.delete(mediaId)
          this.vanishedAt.delete(mediaId)
          this.queuedEpisodes.delete(mediaId)
          return
        }
        this.vanishedAt.set(mediaId, since)
      }),
    )

    this.queuedMedia[source] = next
  }

  /**
   * Media id -> upstream id for the given Radarr/Sonarr ids, read off the
   * resolver's cached library rather than asked of upstream per item.
   *
   * An id the cache doesn't hold is usually a title added upstream since the
   * cache filled - say, in Radarr's own UI, which searches and grabs within
   * seconds of the add. Waiting out the TTL would keep that download off
   * every open page for up to a minute, so the library is invalidated and
   * read again, once per missing id (see `refetchedFor`). An id still
   * missing after that, or a library that can't be read, gets another try
   * next tick.
   *
   * Two callers: the media diff (`broadcastSourceChanges`), and
   * `adoptUnownedDownloads`, which runs earlier in the same tick - so a
   * title the adoption re-read the library for is already in the cache when
   * the diff asks, and is not re-read twice.
   */
  private async mediaIdsFor(
    type: DownloadType.Movie | DownloadType.Show,
    upstreamIds: readonly number[],
  ): Promise<Map<string, number>> {
    const found = new Map<string, number>()
    if (upstreamIds.length === 0) return found

    const refetched = this.refetchedFor[SOURCE_OF[type]]
    try {
      matchLibrary(await this.readLibrary(type), upstreamIds, found)

      const matched = new Set(found.values())
      const unrefetched = upstreamIds.filter(
        id => !matched.has(id) && !refetched.has(id),
      )
      if (unrefetched.length > 0) {
        for (const upstreamId of unrefetched) refetched.add(upstreamId)
        this.mediaResolverService.invalidateLibrary(type)
        matchLibrary(await this.readLibrary(type), unrefetched, found)
      }
    } catch (err) {
      this.logger.warn(
        { action: 'mediaIdsFor', error: getErrorMessage(err), type },
        'Library read failed, new queue items wait for the next tick',
      )
    }

    return found
  }

  private readLibrary(
    type: DownloadType.Movie | DownloadType.Show,
  ): Promise<ReadonlyMap<number, Movie | Show>> {
    return type === DownloadType.Movie
      ? this.mediaResolverService.getMovieLibrary()
      : this.mediaResolverService.getShowLibrary()
  }

  /**
   * Broadcasts one media's event if its state moved since the last one sent,
   * and returns the digest it was compared by, with whether the download
   * has landed its file (see `hasLanded`) - or `undefined` when no event
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
  ): Promise<{ digest: string; landed: boolean } | undefined> {
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
    const landed = hasLanded(state, episodes, this.queuedEpisodes.get(mediaId))
    if (digest === this.lastDigest.get(mediaId)) return { digest, landed }

    const event: MediaEvent = { media, ...(episodes ? { episodes } : {}) }
    this.downloadGateway.broadcast({ data: event, type: MEDIA_EVENT_TYPE })

    return { digest, landed }
  }

  /**
   * The in-flight jobs of one media type, each paired with its upstream
   * library id. That id is no longer a persisted column - it's Radarr's own
   * primary key, so it comes from the resolved media, in one batched call
   * per tick rather than one per job. A title with no library entry yet
   * (requested but not added) simply isn't pollable and is skipped.
   */
  private async trackedJobs(type: DownloadType): Promise<TrackedJob[]> {
    return (await this.resolveOpenJobs(type)).flatMap(
      ({ record, upstreamId }) =>
        upstreamId == null ? [] : [{ record, upstreamId }],
    )
  }

  /**
   * Every in-flight job of one media type, with the upstream library id its
   * title resolved to this tick - `undefined` for one that didn't. One
   * batched `resolve()`, for `trackedJobs` and `adoptUnownedDownloads`.
   */
  private async resolveOpenJobs(
    type: DownloadType,
  ): Promise<
    Array<{ record: DownloadJobRecord; upstreamId: number | undefined }>
  > {
    const records = Array.from(this.downloadStateService.jobs.values()).filter(
      record => record.type === type && !TERMINAL_STATUSES.has(record.status),
    )

    if (records.length === 0) return []

    const { media } = await this.mediaResolverService.resolve(
      records.map(record => ({ mediaId: record.mediaId, type: record.type })),
    )

    return records.map(record => ({
      record,
      upstreamId: upstreamLibraryId(media.get(record.mediaId)),
    }))
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

  /**
   * The `DequeuedOutcome` of each of `jobs` whose downloads are known (see
   * `downloadIds`), keyed by job id. Asked only about jobs with no queue item
   * and no file, and fetches each title's history once however many of its
   * jobs are asking.
   *
   * Never throws. A title whose history can't be read is logged and left
   * out, so its jobs fall back to the grace period this tick.
   */
  private async dequeuedOutcomes(
    type: DownloadType.Movie | DownloadType.Show,
    jobs: readonly TrackedJob[],
  ): Promise<Map<string, DequeuedOutcome>> {
    const byJobId = new Map<string, DequeuedOutcome>()
    const known = jobs.filter(({ record }) => this.downloadIds.has(record.id))
    if (known.length === 0) return byJobId

    const upstreamIds = Array.from(new Set(known.map(job => job.upstreamId)))
    const histories = new Map<number, HistoryRecordLike[]>()

    await Promise.all(
      upstreamIds.map(async upstreamId => {
        try {
          histories.set(
            upstreamId,
            type === DownloadType.Movie
              ? await this.radarrService.getMovieHistory(upstreamId)
              : await this.sonarrService.getSeriesHistory(upstreamId),
          )
        } catch (err) {
          this.logger.warn(
            {
              action: 'dequeuedOutcomes',
              error: getErrorMessage(err),
              type,
              upstreamId,
            },
            'History read failed, leaving its jobs to the grace period',
          )
        }
      }),
    )

    for (const { record, upstreamId } of known) {
      const history = histories.get(upstreamId)
      const downloadIds = this.downloadIds.get(record.id)
      if (history && downloadIds) {
        byJobId.set(record.id, dequeuedOutcome(history, downloadIds))
      }
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
   * Writes a status move to the job. `error` is the reason a Cancelled,
   * Failed or NeedsAttention status carries, when there is one; any other
   * status leaves `error` alone, except that leaving NeedsAttention clears
   * it. Leaving Cancelling without a reason clears it too, whatever the new
   * status: the cancel action already did, and nothing from before the press
   * is why the job ended.
   */
  private writeStatus(
    record: DownloadJobRecord,
    newStatus: DownloadJobStatus,
    error: string | undefined,
  ): void {
    const carriesReason =
      newStatus === DownloadJobStatus.Cancelled ||
      newStatus === DownloadJobStatus.Failed ||
      newStatus === DownloadJobStatus.NeedsAttention
    const dropsReason =
      record.status === DownloadJobStatus.Cancelling ||
      (record.status === DownloadJobStatus.NeedsAttention && !carriesReason)

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
      ...(carriesReason && error
        ? { error }
        : dropsReason
          ? { error: undefined }
          : {}),
      status: newStatus,
    })
  }
}

/**
 * The reason a job settled without a queue item carries: Radarr's/Sonarr's
 * own failure message when there is one, which queue a cancelled job was
 * removed from, and otherwise that it left the queue with nothing to show.
 *
 * A job settling out of `previous` Cancelling carries none short of a
 * failure: its downloads were removed by the cancel pressed here, and "Removed
 * from Radarr's queue" is the sentence for a removal someone made upstream.
 */
function settledError(
  status: DownloadJobStatus,
  outcome: DequeuedOutcome | undefined,
  source: QueueSource,
  previous: DownloadJobStatus,
): string | undefined {
  if (
    previous === DownloadJobStatus.Cancelling &&
    status !== DownloadJobStatus.Failed
  ) {
    return undefined
  }

  if (status === DownloadJobStatus.Cancelled) {
    return REMOVED_FROM_QUEUE_ERROR[source]
  }

  if (status !== DownloadJobStatus.Failed) return undefined

  return outcome?.kind === 'failed' && outcome.reason
    ? outcome.reason
    : LEFT_QUEUE_WITHOUT_FILE_ERROR
}

/**
 * Sonarr series id -> the episode ids its queue items name, or `null` for a
 * series with an item that names none (an unparsed release), whose episodes
 * then can't be told apart.
 */
function queuedEpisodeIds(
  items: readonly PollableQueueItem[],
): Map<number, ReadonlySet<number> | null> {
  const bySeries = new Map<number, Set<number> | null>()

  for (const item of items) {
    if (item.seriesId == null) continue

    const known = bySeries.get(item.seriesId)
    if (known === null) continue
    if (item.episodeId == null) {
      bySeries.set(item.seriesId, null)
      continue
    }

    bySeries.set(item.seriesId, (known ?? new Set()).add(item.episodeId))
  }

  return bySeries
}

/**
 * Whether a media that left the queue has its file. A movie: it is
 * `available`. A series is `available` as soon as it has *any* file, which
 * a series with older episodes was before this grab started - so it has
 * landed once every episode it last had queued reads `available`, and only
 * falls back to the series state when those episodes aren't known.
 */
function hasLanded(
  state: MediaState | undefined,
  episodes: readonly EpisodeStateEntry[] | undefined,
  queued: ReadonlySet<number> | null | undefined,
): boolean {
  if (!episodes || !queued || queued.size === 0) return state === 'available'

  const available = new Set(
    episodes
      .filter(entry => entry.state === 'available')
      .map(entry => entry.episodeId),
  )
  return Array.from(queued).every(id => available.has(id))
}

/** Adds `media id -> upstream id` to `found` for each wanted id `library` holds. */
function matchLibrary(
  library: ReadonlyMap<number, Movie | Show>,
  upstreamIds: readonly number[],
  found: Map<string, number>,
): void {
  const wanted = new Set(upstreamIds)
  for (const item of library.values()) {
    const upstreamId = upstreamLibraryId(item)
    if (upstreamId != null && wanted.has(upstreamId)) {
      found.set(item.id, upstreamId)
    }
  }
}

function upstreamLibraryId(media: Media | undefined): number | undefined {
  if (!media || !isManagedMedia(media)) return undefined
  return isMovie(media) ? media.radarrId : media.sonarrId
}
