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
  TERMINAL_DOWNLOAD_JOB_STATUSES,
  type UpstreamCommandKind,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { nanoid } from 'nanoid'

import { getCursor, setCursor } from 'src/db/history-cursors.repo'
import {
  claimedDownloadIds as readClaimedDownloadIds,
  findJobsByDownloadId,
  keptDownloadIds,
  linkDownload,
  listForJob,
  markFailed,
  markImported,
} from 'src/db/job-downloads.repo'
import type { JobDownloadRow } from 'src/db/schema'
import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import type { SabTransition } from 'src/sabnzbd/sab-readings.util'

import {
  type AdoptionCandidate,
  isAdoptable,
  pickReopenableJob,
  planAdoptions,
} from './adoption.util'
import type { CommandSnapshot } from './arr-command.types'
import { describeClientFailure } from './client-failure.util'
import { isCommandEnded } from './command-wait.util'
import {
  type ArrEvent,
  type ArrHistoryRecord,
  type ClaimableJob,
  claimGrab,
  normalizeHistory,
} from './history-events.util'
import {
  type CompletionImport,
  completionImports,
  didJobComplete,
  hasFileAddedAfter,
} from './job-completion.util'
import { MediaResolverService } from './media-resolver.service'
import { MediaStateService, type QueueSource } from './media-state.service'
import { toEpisodeStateEntries } from './media-state.util'
import { KEPT_PACK_NOTE, planQueueCancel } from './queue-cancel.util'
import {
  aggregateQueueItems,
  deriveQueueItemState,
  isQueueItemMoving,
  isQueueSnapshotEqual,
  matchesScope,
  PollableQueueItem,
  REMOVED_FROM_CLIENT_ERROR,
  settleAbsentJob,
  toQueueSnapshot,
} from './queue-status.util'
import { RadarrService } from './radarr.service'
import { SonarrService } from './sonarr.service'
import {
  startSearch,
  type StartSearchDeps,
  type StartSearchResult,
} from './start-search'

const BASE_BACKOFF_MS = 10_000
const MAX_BACKOFF_MS = 120_000

/** How often each app's history is read for new events. */
export const HISTORY_POLL_MS = 5_000

/**
 * How often each app is asked to refresh a queue with something moving in it
 * (see `requestQueueRefresh`). The same pace as the history read, which is
 * what settles an outcome; this only keeps progress numbers fresh.
 */
export const QUEUE_REFRESH_MS = 5_000

/**
 * The same, while a detail page is open on a title with a moving download -
 * the one place a person is watching the number tick.
 */
export const WATCHED_QUEUE_REFRESH_MS = 1_000

/**
 * While SABnzbd is read directly, the least time between two refreshes one
 * app is sent for SAB phase changes (see `requestQueueRefresh`). A burst of
 * changes inside it collapses into the next refresh allowed.
 */
export const EVENT_REFRESH_MIN_MS = 2_000

/**
 * How early a refresh may come against its interval. The 1 s cron's ticks
 * land a few ms either side of the second, and without this a 1 s interval
 * would skip every other tick.
 */
const QUEUE_REFRESH_SLACK_MS = 500

/**
 * How often each app is asked whether its download client is healthy - the
 * one thing that tells a download removed at the client apart from a queue
 * that is empty only because SABnzbd can't be reached.
 */
export const HEALTH_POLL_MS = 30_000

/** How far back the first history read reaches when no cursor is stored. */
export const HISTORY_FIRST_READ_MS = 86_400_000

/**
 * How far back a later boot catches up from its stored cursor, at most. A
 * process down longer than this skips the rest rather than replaying weeks
 * of history against jobs that have long moved on.
 */
export const HISTORY_MAX_CATCH_UP_MS = 7 * 86_400_000

/** How often the command a job is waiting on is read, at most, per job. */
export const COMMAND_POLL_MS = 2_000

/**
 * How long a job waits for the refresh Radarr/Sonarr run when a title is
 * added - Sonarr creates a new show's episodes during it - before it gives
 * up. Timed from when the refresh was queued (`upstreamCommandAt`).
 */
export const REFRESH_WAIT_TIMEOUT_MS = 600_000

/**
 * How long after a failed download a job waits to see the search
 * Radarr/Sonarr queue on their own to replace it, before it ends
 * `not_found`. Timed from the failure's history date.
 */
export const RETRY_SEARCH_TIMEOUT_MS = 1_800_000

/**
 * How long after a search command ended a history read has to start before
 * it is trusted to hold every grab the search made. Radarr/Sonarr write the
 * grab before the command ends, so this only covers the clocks disagreeing.
 */
const HISTORY_AFTER_COMMAND_SLACK_MS = 2_000

/**
 * How much earlier than the failure's history date a retry search may be
 * queued and still be taken for its retry: Radarr/Sonarr record the failure
 * and queue the search from two handlers of one event, in either order, and
 * the history date is cut to whole seconds.
 */
const RETRY_QUEUED_SLACK_MS = 2_000

/** The search commands Radarr/Sonarr queue themselves after a failure. */
const RETRY_SEARCH_NAMES = {
  radarr: new Set(['MoviesSearch']),
  sonarr: new Set(['EpisodeSearch', 'SeasonSearch']),
} as const satisfies Record<QueueSource, ReadonlySet<string>>

/** How a title of each app is named in text a person reads. */
const TITLE_NOUNS = {
  radarr: 'movie',
  sonarr: 'show',
} as const satisfies Record<QueueSource, string>

/**
 * The statuses a job waits for a search in. A job past them has something
 * grabbed, so there is nothing left to search for or to judge.
 */
const SEARCH_STATUSES: ReadonlySet<DownloadJobStatus> = new Set([
  DownloadJobStatus.Requested,
  DownloadJobStatus.Searching,
])

/** How long an app's failed-download settings are trusted once read. */
const FAILED_CONFIG_TTL_MS = 600_000

/**
 * How long a media that left the queue with no file is still watched for
 * one - Radarr/Sonarr drop the queue row a tick or so before the file
 * listing reports the import, so the frame a vanish sends must not be the
 * last one. Only the media diff reads it; no job settles on it.
 */
const LANDING_WATCH_MS = 60_000

/** How Radarr/Sonarr are named in text a person reads. */
const APP_NAMES = {
  radarr: 'Radarr',
  sonarr: 'Sonarr',
} as const satisfies Record<QueueSource, string>

/** How every note `retryNote` writes starts - what a later grab clears. */
const RETRY_NOTE_PREFIX = 'Last download failed'

/**
 * How the note a reopened job carries starts ("The download came back in
 * Radarr") - what `applyUpdate` keeps while the job holds the status the
 * reopen gave it.
 */
const REOPEN_NOTE_PREFIX = 'The download came back in'

/**
 * The statuses a job with no download links is looked up in history for at
 * boot: it was grabbed, but the link that says so was never recorded - a job
 * from before links were persisted, or one whose grab went unread.
 */
const BACKFILL_STATUSES: ReadonlySet<DownloadJobStatus> = new Set([
  DownloadJobStatus.Cancelling,
  DownloadJobStatus.Downloading,
  DownloadJobStatus.Importing,
  DownloadJobStatus.NeedsAttention,
  DownloadJobStatus.Paused,
])

/**
 * Statuses a job can never leave - the shared list as a `Set`, so a terminal
 * status added upstream (plan 024's `not_found`) stops being polled with no
 * edit here.
 */
const TERMINAL_STATUSES: ReadonlySet<DownloadJobStatus> =
  new Set<DownloadJobStatus>(TERMINAL_DOWNLOAD_JOB_STATUSES)

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

/** Whether Radarr/Sonarr search again on their own after a failure. */
interface FailedDownloadConfig {
  autoRedownloadFailed: boolean
  fromInteractive: boolean
}

/** One app's download-client health, as last checked. */
interface ClientHealth {
  /** When the last check started (epoch ms), whatever it found. */
  checkedAt: number
  /**
   * When the client was first seen healthy in the current healthy run, or
   * `null` while it is unhealthy or its health is unknown.
   */
  healthySince: number | null
  inFlight: boolean
}

/** One app's history reading, in memory. The cursor itself is persisted. */
interface HistorySync {
  /** Whether this boot's link backfill has run to the end. */
  backfilled: boolean
  inFlight: boolean
  /** When the last read started (epoch ms). */
  readAt: number
  /**
   * When the last read that applied everything it found started (epoch ms)
   * - every grab dated before then is linked. What a search is judged by.
   */
  syncedFrom: number
}

/** A job and the upstream library id its title resolved to, if it did. */
interface PendingJob {
  record: DownloadJobRecord
  upstreamId: number | undefined
}

/** How a command a job waited on ended, as far as judging it goes. */
interface CommandEnd {
  /** When it ended (epoch ms) - or was found gone, for a lost one. */
  endedAt: number
  message: string | undefined
  /** When it started (ISO), when upstream still knows. */
  started: string | undefined
}

/** Why `writeStatus` writes, beyond the status and its reason. */
interface StatusWriteOptions {
  /**
   * Also clears the upstream command the job was waiting on - a retry is
   * Radarr's/Sonarr's own search, not one this app sent.
   */
  clearUpstreamCommand?: boolean
  /**
   * The note the job carries from now on, `undefined` for none. Left out,
   * the current note stays while the status does and goes when it moves.
   */
  statusNote?: string | undefined
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
  /**
   * The title's imports, read only when one of its jobs has a download link
   * and a file newer than that job - the only time a file needs tying back
   * to the download that wrote it.
   */
  imports?: CompletionImport[]
}

/**
 * Reads Radarr's and Sonarr's **whole** queues every tick, hands them to
 * `MediaStateService` (so a download this app didn't start - grabbed in
 * Radarr's own UI, from Discord, from another tab - still shows up on its
 * media), and drives the movie/show jobs tracked in DownloadStateService
 * through Requested -> Searching -> Downloading -> Importing/NeedsAttention ->
 * Completed/Failed.
 *
 * **History decides outcomes; the queue reports progress.** Radarr's/
 * Sonarr's `/queue` is rebuilt in memory and drops items whenever SABnzbd is
 * briefly unreachable, after any Radarr/Sonarr restart, and once SABnzbd's
 * history rolls past its last 60 items - so a download missing from it is
 * not evidence of anything. Every `HISTORY_POLL_MS` each app's history is
 * read from a persisted cursor (`arr_history_cursors`) and applied in order
 * (see `syncHistory`):
 *
 * - `grabbed`: the job `claimGrab` picks is linked to the download in
 *   `job_downloads` - a link that survives a restart;
 * - `imported`: the link is marked imported;
 * - `failed`: the link is marked failed, and the job goes back to
 *   `searching` with a note if Radarr/Sonarr retry on their own, or to
 *   `failed` if they don't;
 * - `manualFailed` / `ignored`: someone removed it upstream - `cancelled`.
 *
 * **A search ends somewhere.** A job waiting on a Radarr/Sonarr command
 * (`upstreamCommandId`) has it read every `COMMAND_POLL_MS` (see
 * `trackCommands`): a finished add-time `refresh` sends the job's search
 * (`startSearch`), and a finished `search` with no grab linked since it
 * started ends the job `not_found`. After a failed download, the search
 * Radarr/Sonarr queue themselves is found in their command list and
 * followed the same way.
 *
 * A job's queue item, matched by its links first and its title/scope second,
 * says where it stands (`deriveQueueItemState`). A job with **no** item is
 * settled by `settleAbsentJob` from its links and the library: `completed`
 * once a file for its scope landed or its links say it imported, and
 * `cancelled` ("Removed from the download client") only after its download
 * has been gone `ABSENT_REMOVED_MS` with the download client healthy the
 * whole time - see `checkClientHealth` - or `CLIENT_GONE_CONFIRM_MS` once
 * SABnzbd reports it deleted. A requested/searching job, or one with no
 * links, is never settled by absence.
 *
 * A `cancelling` job - cancel pressed here, its queue items already removed
 * - is carried the rest of the way. A queue item it still has (a search
 * running at the press can grab a release seconds later) is removed rather
 * than followed, and once the queue has none it settles `cancelled`, or
 * `completed` if a file landed anyway. A season pack that also carries
 * episodes outside its scope is kept rather than removed, and the job
 * settles `cancelled` with a note saying the episode may still import. See
 * `removeLateGrab`.
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
 * Writes only `status`/`error`/`statusNote` to the job, and the upstream
 * command it waits on. The queue snapshot is never stored against
 * the job at all: a job's `media.queueSnapshot` is the resolver's, read off
 * the queue cache this poller feeds, so a progress-only change just
 * re-broadcasts the job (`DownloadStateService.touchJob()`) and the hydrate
 * that broadcast runs picks the new number up.
 *
 * Runs every 1s via @Cron (this codebase has no @Interval precedent - see
 * ytdlp-update.service.ts). Radarr/Sonarr only re-read SABnzbd once a minute
 * on their own, so a tick may first ask one to refresh its queue (see
 * `requestQueueRefresh`): with SABnzbd read directly and healthy, once per
 * SAB phase change of one of its downloads, at most every 2 s - the live
 * progress already comes from SABnzbd; with SABnzbd unset or unhealthy,
 * while something in its queue is moving, every 5 s, or every second while
 * a detail page is open on it. On a failed
 * queue read, backs off exponentially from 10s up to a 2min cap; a success
 * resets the backoff immediately. A failed history read or health check
 * never backs off the poll - each is simply tried again at its own interval.
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
   * until its file lands or `LANDING_WATCH_MS` passes without one.
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
   * no longer being tracked. In memory only: a restart restarts every
   * absence, which can only delay a settle.
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
   * Per queue item, the tracked state (`status` / `trackedDownloadState` /
   * `trackedDownloadStatus`) it was last seen in and since when (epoch ms) -
   * the `stateSince` `deriveQueueItemState` escalates a lingering warning by.
   * Keyed by source and download id(s) (see `queueStateKey`), reset whenever
   * the state changes, and dropped once the item is no longer matched. In
   * memory only: a restart restarts the clock, which only delays an
   * escalation.
   */
  private readonly stateSince = new Map<
    string,
    { since: number; state: string }
  >()

  /** Per app, its download client's health. See `checkClientHealth`. */
  private readonly clientHealth: Record<QueueSource, ClientHealth> = {
    radarr: { checkedAt: -Infinity, healthySince: null, inFlight: false },
    sonarr: { checkedAt: -Infinity, healthySince: null, inFlight: false },
  }

  /** Per app, its history reading. See `syncHistory`. */
  private readonly historySync: Record<QueueSource, HistorySync> = {
    radarr: {
      backfilled: false,
      inFlight: false,
      readAt: -Infinity,
      syncedFrom: -Infinity,
    },
    sonarr: {
      backfilled: false,
      inFlight: false,
      readAt: -Infinity,
      syncedFrom: -Infinity,
    },
  }

  /**
   * Job id -> when (epoch ms) the command it waits on was last read. What
   * holds each job to one read every `COMMAND_POLL_MS`.
   */
  private readonly commandCheckedAt = new Map<string, number>()

  /**
   * The jobs whose command is being read or acted on right now - so an
   * overlapping tick never starts a second search off the same refresh.
   */
  private readonly commandInFlight = new Set<string>()

  /**
   * Job id -> the command it waits on and when (epoch ms) that command was
   * first read as ended with no `ended` date, or as gone (404). What such a
   * command is judged by in place of its end, which the next read must not
   * push later.
   */
  private readonly commandEndSeenAt = new Map<
    string,
    { at: number; commandId: number }
  >()

  /** Per app, its failed-download settings and when they were read. */
  private readonly failedConfig: Partial<
    Record<QueueSource, { config: FailedDownloadConfig; readAt: number }>
  > = {}

  /**
   * Per source, queue item (`queueProgressKey`) -> what it last read as - its
   * `sizeleft` and tracked state - and when that last changed. What
   * `isQueueItemMoving` times a stall by. An item is dropped once it leaves
   * the queue.
   */
  private readonly queueProgress: Record<
    QueueSource,
    Map<string, { changedAt: number; reading: string }>
  > = {
    radarr: new Map(),
    sonarr: new Map(),
  }

  /** Per source, when `requestQueueRefresh` last sent a refresh (epoch ms). */
  private readonly queueRefreshedAt: Record<QueueSource, number> = {
    radarr: -Infinity,
    sonarr: -Infinity,
  }

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
        this.pollSource('radarr', stored),
        this.pollSource('sonarr', stored),
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
   * One app's tick: its download-client health and history first - so a
   * grab or failure recorded since the last read is linked or applied
   * before the queue is matched - then the commands its jobs wait on
   * (`trackCommands`), then its queue.
   *
   * A job's queue items are the ones carrying a download it is linked to,
   * plus the ones of its title (and, for a show, its scope) that no other
   * in-flight job is linked to; an item whose download already failed for
   * this job is history's business and never read again. The matched items
   * are folded into one (`aggregateQueueItems`): Sonarr queues one item per
   * episode, and even a movie can briefly carry two downloads. A title-matched
   * download is linked to the job right away, so its outcome is known even if
   * its grab event is never read.
   */
  private async pollSource(
    source: QueueSource,
    stored: Set<QueueSource>,
  ): Promise<void> {
    const type = SOURCE_TYPE[source]
    const tracked = await this.trackedJobs(type)

    // Neither throws nor backs the poll off: an unknown health reads as
    // unhealthy, and a failed history read keeps its cursor.
    await this.checkClientHealth(source)
    await this.syncHistory(source, tracked)
    // Never throws either: a command that can't be read is read again at
    // its next interval.
    await this.trackCommands(source, tracked)

    await this.requestQueueRefresh(source, () =>
      source === 'radarr'
        ? this.radarrService.refreshMonitoredDownloads()
        : this.sonarrService.refreshMonitoredDownloads(),
    )

    // Unfiltered: the tracked jobs are only some of what's in flight, and the
    // rest is exactly what the media state cache is for.
    const queue: PollableQueueItem[] =
      source === 'radarr'
        ? await this.radarrService.getQueue()
        : await this.sonarrService.getQueue()
    this.mediaStateService.setQueue(source, queue)
    stored.add(source)

    const now = Date.now()
    const claimed = this.claimedDownloadIds(source)
    const seenStates = new Set<string>()
    const absent: TrackedJob[] = []
    const queuedWithFile: TrackedJob[] = []

    for (const { record: trackedRecord, upstreamId } of tracked) {
      // Re-read: the history sync above may have moved it since `tracked`
      // was resolved.
      const record = this.downloadStateService.jobs.get(trackedRecord.id)
      if (!record || TERMINAL_STATUSES.has(record.status)) continue

      const links = this.linksOf(record.id)
      const items = matchJobItems(
        source,
        record,
        upstreamId,
        queue,
        links,
        claimed,
      )
      if (items.length === 0) {
        absent.push({ record, upstreamId })
        continue
      }

      this.linkQueuedDownloads(source, record.id, items, links, claimed)

      if (record.status === DownloadJobStatus.Cancelling) {
        // `items` is already narrowed to the job's scope, so a sibling
        // episode's download is never touched.
        await this.removeLateGrab(type, { record, upstreamId }, items, queue)
        continue
      }

      this.absentSince.delete(record.id)
      const key = queueStateKey(source, record.id, items)
      seenStates.add(key)
      const item = aggregateQueueItems(items) as PollableQueueItem
      this.applyUpdate(record, item, { key, now, source })

      if (record.scope?.episodeId != null && item.episodeHasFile === true) {
        queuedWithFile.push({ record, upstreamId })
      }
    }

    this.forgetQueueStates(source, seenStates)
    await this.completeQueuedEpisodes(type, queuedWithFile)

    const settled = await this.settleAbsentJobs(type, absent)
    this.touchDequeuedJobs(absent, settled)

    await this.adoptUnownedDownloads(type, queue)
  }

  /** Every download linked to one job, oldest link first. */
  private linksOf(jobId: string): JobDownloadRow[] {
    return listForJob(this.downloadStateService.db, jobId)
  }

  /**
   * Links a job to each download among its title-matched `items` that no
   * in-flight job is linked to yet - what the in-memory id set this replaces
   * did for a download first seen in the queue, persisted. Every job that
   * matches the item this tick links it, as each of them followed it before:
   * a season pack can cover a season job and an episode job at once.
   */
  private linkQueuedDownloads(
    source: QueueSource,
    jobId: string,
    items: readonly PollableQueueItem[],
    links: readonly JobDownloadRow[],
    claimed: ReadonlySet<string>,
  ): void {
    const own = new Set(links.map(link => link.downloadId))
    for (const { downloadId } of items) {
      if (!downloadId || own.has(downloadId) || claimed.has(downloadId)) {
        continue
      }
      own.add(downloadId)
      this.link(source, jobId, downloadId, null)
    }
  }

  /**
   * `linkDownload`, logged rather than thrown: a link that can't be written
   * is retried by the next grab or queue read, and must not stop the tick or
   * the history batch it belongs to. Returns whether it was written.
   */
  private link(
    source: QueueSource,
    jobId: string,
    downloadId: string,
    grabbedAt: string | null,
    interactive?: boolean,
  ): boolean {
    try {
      linkDownload(this.downloadStateService.db, {
        app: source,
        downloadId,
        grabbedAt,
        jobId,
        ...(interactive != null ? { interactive } : {}),
      })
      return true
    } catch (err) {
      this.logger.warn(
        {
          action: 'linkDownload',
          downloadId,
          error: getErrorMessage(err),
          jobId,
          source,
        },
        'Failed to link a download to its job',
      )
      return false
    }
  }

  /**
   * When the queue item behind `key` entered `state`, recording `now` for an
   * item that is new or whose state just changed.
   */
  private stateSinceFor(key: string, state: string, now: number): number {
    const entry = this.stateSince.get(key)
    if (entry && entry.state === state) return entry.since

    this.stateSince.set(key, { since: now, state })
    return now
  }

  /** Drops the state clocks of `source`'s items that were not matched now. */
  private forgetQueueStates(
    source: QueueSource,
    seen: ReadonlySet<string>,
  ): void {
    const prefix = `${source}:`
    for (const key of this.stateSince.keys()) {
      if (key.startsWith(prefix) && !seen.has(key)) {
        this.stateSince.delete(key)
      }
    }
  }

  /**
   * Removes the queue items a `cancelling` job still has - a release the
   * search already running at the press grabbed afterwards, or a removal
   * that hadn't shown in the queue yet. The job's status is left alone and
   * so is its absence timer: `settleAbsentJobs` moves it once the queue has
   * nothing for it, and a late grab must not restart the grace period.
   *
   * Each download is removed once, by one of its rows (`planQueueCancel`) -
   * except a show download that also carries episodes outside the job's
   * scope, a season pack, which is kept: removing any of its rows removes
   * all of it. Once only kept packs are left, the job's fileless episodes
   * are unmonitored and it settles `cancelled` with `KEPT_PACK_NOTE` - the
   * pack would otherwise hold it in `cancelling` until it imported.
   *
   * Best-effort and never throws: an item with no id can't be named to
   * Radarr/Sonarr, and a refused removal is logged and tried again next tick
   * rather than tripping `poll()`'s backoff.
   */
  private async removeLateGrab(
    type: DownloadType.Movie | DownloadType.Show,
    { record, upstreamId }: TrackedJob,
    items: readonly PollableQueueItem[],
    queue: readonly PollableQueueItem[],
  ): Promise<void> {
    const action = 'removeLateGrab'
    const source = SOURCE_OF[type]

    const plan = planQueueCancel(
      items,
      queue,
      type === DownloadType.Show
        ? item => matchesScope(item, record.scope)
        : undefined,
    )

    if (plan.unnamed.length > 0) {
      this.logger.warn(
        {
          action,
          count: plan.unnamed.length,
          jobId: record.id,
          mediaId: record.mediaId,
          source,
        },
        'Queue item of a cancelling job has no id, cannot remove it',
      )
    }

    if (
      plan.kept.length > 0 &&
      plan.remove.length === 0 &&
      plan.unnamed.length === 0
    ) {
      await this.settleKeptPack(record, upstreamId, plan.kept)
      return
    }

    const queueIds = plan.remove.map(item => item.id)
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
   * Settles a `cancelling` show job whose only queued downloads are season
   * packs it was left out of: its episodes with no file are unmonitored (so
   * nothing grabs them again once the pack is done), then it is `cancelled`
   * with `KEPT_PACK_NOTE` and no `error`. Its link to the pack stays, which
   * is what keeps adoption off it (`keptDownloadIds`).
   *
   * A refused unmonitor is logged and tried again next tick, the job left
   * `cancelling` meanwhile.
   */
  private async settleKeptPack(
    tracked: DownloadJobRecord,
    sonarrId: number,
    kept: readonly string[],
  ): Promise<void> {
    const action = 'settleKeptPack'

    try {
      await this.sonarrService.unmonitorScope(sonarrId, tracked.scope ?? {}, {
        withoutFileOnly: true,
      })
    } catch (err) {
      this.logger.warn(
        { action, error: getErrorMessage(err), jobId: tracked.id },
        'Failed to unmonitor a pack-cancelled job, retrying next tick',
      )
      return
    }
    this.mediaResolverService.invalidate(tracked.mediaId)

    // Re-read after the unmonitor: a job that moved meanwhile is not ours.
    const record = this.downloadStateService.jobs.get(tracked.id)
    if (record?.status !== DownloadJobStatus.Cancelling) return

    this.logger.log(
      {
        action,
        downloadIds: kept,
        jobId: record.id,
        mediaId: record.mediaId,
      },
      'Cancelled a job whose season download is still running',
    )
    this.writeStatus(record, DownloadJobStatus.Cancelled, undefined, {
      statusNote: KEPT_PACK_NOTE,
    })
  }

  /**
   * Mints a job for each download in this tick's `queue` that no in-flight
   * job covers - see adoption.util.ts for which ones those are. From then on
   * it is an ordinary tracked job: the next tick follows its queue item, and
   * its download is linked in `job_downloads` so history settles it once the
   * item leaves. `addJob` persists the row, so a restart re-adopts the job
   * through `DownloadStateService.adoptOpenJobs` rather than minting another.
   *
   * Ownership is checked three ways. A `cancelling` job counts, so a late
   * grab `removeLateGrab` is removing is never adopted. A download linked to
   * any in-flight job is claimed (`claimedDownloadIds`). And a job whose
   * title did not resolve this tick - which `trackedJobs` drops - still owns
   * its media id, checked once the library maps the candidate.
   *
   * A download linked to a job that ended cancelled or failed moments ago
   * reopens that job instead (`reopenEndedJob`), before any of the reads
   * below - except a season pack a cancel left running on purpose
   * (`KEPT_PACK_NOTE`), which counts as claimed: that job ended by choice
   * with its pack still going, so the pack is neither adopted nor reopens
   * it. A pack stays claimed that way until its download fails.
   *
   * Nothing past the first, pure pass costs anything while every queued
   * download is one a tracked job is linked to; a show's episodes are read
   * only for a series with a candidate left.
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
      const source = SOURCE_OF[type]
      // A season pack a cancel left running is still the cancelled job's:
      // neither adopted as a new job nor reopening that one.
      const claimed = this.claimedDownloadIds(source)
      for (const downloadId of keptDownloadIds(
        this.downloadStateService.db,
        source,
        KEPT_PACK_NOTE,
      )) {
        claimed.add(downloadId)
      }
      if (planAdoptions(type, queue, [], claimed).length === 0) return

      const openJobs = (await this.resolveOpenJobs(type)).flatMap(
        ({ record, upstreamId }) =>
          upstreamId == null ? [] : [{ scope: record.scope, upstreamId }],
      )
      // A download that goes back to the job it was linked to is that job's,
      // whether or not the reopen goes ahead - never one to adopt.
      const now = Date.now()
      const planned = planAdoptions(type, queue, openJobs, claimed).filter(
        candidate => !this.reopenEndedJob(type, candidate, now),
      )
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
   * between the ownership re-check and the write - and links it to the
   * candidate's download, which is what claims that download from then on.
   * Its status is the one the queue derives (it is already grabbed, so never
   * `requested`/`searching`). No audit row: nobody here asked for it.
   */
  private adopt(
    type: DownloadType.Movie | DownloadType.Show,
    { candidate, mediaId, scope }: MappedCandidate,
  ): void {
    const action = 'adoptUnownedDownloads'
    const { downloadId, items, status } = candidate

    const source = SOURCE_OF[type]
    if (this.isOwned(type, mediaId, items)) return
    if (downloadId != null && this.claimedDownloadIds(source).has(downloadId)) {
      return
    }

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
    if (downloadId != null) this.link(source, id, downloadId, null)

    this.logger.log(
      { action, downloadId, jobId: id, mediaId, scope, status },
      'Adopted a download started upstream',
    )
  }

  /**
   * Gives a download back to the job it was linked to, when that job ended
   * cancelled or failed within `REOPEN_WINDOW_MS` - SABnzbd came back, or a
   * cancel raced a grab. The newest such job is moved to the status the
   * queue derives for the candidate, its `error` cleared and noted "The
   * download came back in <App>"; it keeps its requester, and its link -
   * now an open job's - claims the download, so the next tick tracks it like
   * any other. Returns whether the candidate is such a job's, reopened or
   * not: either way it is not one to adopt.
   *
   * A link whose download already failed or imported is passed over:
   * `matchJobItems` never reads that download for the job again, so a job
   * reopened on it could not follow it.
   *
   * Synchronous throughout, like `adopt` - the ownership re-check and the
   * write have no `await` between them. A download another job claimed, or
   * whose title and scope an in-flight job now covers, reopens nothing.
   */
  private reopenEndedJob(
    type: DownloadType.Movie | DownloadType.Show,
    { downloadId, items, status }: AdoptionCandidate,
    now: number,
  ): boolean {
    if (downloadId == null) return false

    const action = 'reopenEndedJob'
    const source = SOURCE_OF[type]
    const { db } = this.downloadStateService
    const ended = findJobsByDownloadId(db, source, downloadId).flatMap(link => {
      if (link.failedAt != null || link.importedAt != null) return []
      const record = this.downloadStateService.resolveJobRecord(link.jobId)
      return record?.type === type ? [record] : []
    })
    const job = pickReopenableJob(ended, now)
    if (!job) return false

    if (
      this.claimedDownloadIds(source).has(downloadId) ||
      this.isOwned(type, job.mediaId, items)
    ) {
      return true
    }

    this.downloadStateService.adoptJob(job.id)
    try {
      this.downloadStateService.updateJob(job.id, {
        error: undefined,
        status,
        statusNote: reopenNote(source),
        upstreamCommandAt: undefined,
        upstreamCommandId: undefined,
        upstreamCommandKind: undefined,
      })
    } catch (err) {
      this.logger.warn(
        { action, downloadId, error: getErrorMessage(err), jobId: job.id },
        'Failed to reopen a job whose download came back, retrying next tick',
      )
      return true
    }

    this.logger.log(
      {
        action,
        downloadId,
        jobId: job.id,
        mediaId: job.mediaId,
        oldStatus: job.status,
        status,
      },
      'Reopened a job whose download came back',
    )
    return true
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

  /**
   * Every download of `source` linked to an in-flight job, read off
   * `job_downloads` - so a restart forgets none of them.
   */
  private claimedDownloadIds(source: QueueSource): Set<string> {
    return readClaimedDownloadIds(this.downloadStateService.db, source)
  }

  /**
   * Settles the tracked jobs that had no queue item this tick, from the
   * files upstream holds for them and their download links. See
   * `settleAbsentJob` for the rule; this supplies its inputs -
   * `didJobComplete`'s verdict, the job's links as history left them, how
   * long it has been missing from the queue, and how long the download
   * client has been healthy.
   *
   * The absence of a job that is not `cancelling` is counted only from when
   * the client was last seen healthy - `min(absent, healthy)` - so a queue
   * that was empty because SABnzbd could not be reached settles nothing, and
   * the job settles once it has been gone `ABSENT_REMOVED_MS` with the
   * client healthy throughout - or `CLIENT_GONE_CONFIRM_MS`, once SABnzbd
   * itself has reported every open download `gone`
   * (`MediaStateService.isClientGone`).
   *
   * That includes a `cancelling` job, which is not terminal: it settles
   * `cancelled` - with no `error`, the cancel being the user's own - once
   * its links confirm the removal or `CANCEL_GRACE_MS` passes, or
   * `completed` if its file landed anyway. Its absence is timed from the
   * first tick it had no item, however many late grabs `removeLateGrab` has
   * removed since.
   *
   * Never throws. A job whose files can't be read is left exactly as it is:
   * without the listing there is no telling a finished import from a
   * dropped download, and guessing either way is worse than asking again
   * next tick.
   *
   * Returns the ids of the jobs whose status it wrote.
   */
  private async settleAbsentJobs(
    type: DownloadType.Movie | DownloadType.Show,
    jobs: readonly TrackedJob[],
  ): Promise<Set<string>> {
    const settled = new Set<string>()
    if (jobs.length === 0) return settled

    const source = SOURCE_OF[type]
    const now = Date.now()
    for (const { record } of jobs) {
      if (!this.absentSince.has(record.id)) {
        this.absentSince.set(record.id, now)
      }
    }

    const inputs = await this.completionInputs(type, jobs, true)
    const clientHealthyForMs = this.clientHealthyForMs(source, now)

    for (const { record: tracked, upstreamId } of jobs) {
      const data = inputs.get(tracked.id)
      if (!data) continue

      // Re-read, with nothing awaited from here to the write: the file
      // listing was awaited, and a cancel or a history event may have
      // landed in the meantime. A job that settled elsewhere is not ours to
      // move.
      const record = this.downloadStateService.jobs.get(tracked.id)
      if (!record || TERMINAL_STATUSES.has(record.status)) continue

      const absentForMs = now - (this.absentSince.get(record.id) ?? now)
      const links = this.linksOf(record.id)
      const fileLanded = didJobComplete({
        createdAt: new Date(record.createdAt),
        episodes: data.episodes,
        files: data.files,
        imports: data.imports,
        links,
        scope: record.scope,
      })

      const next = settleAbsentJob(record.status, {
        absentForMs:
          record.status === DownloadJobStatus.Cancelling
            ? absentForMs
            : Math.min(absentForMs, clientHealthyForMs),
        clientHealthyForMs,
        fileLanded,
        goneAtClient: new Set(
          links
            .map(link => link.downloadId)
            .filter(id => this.mediaStateService.isClientGone(id)),
        ),
        links,
      })
      if (next === undefined) continue

      // A cancel pressed here carries no reason; a download that vanished
      // from a healthy client says so.
      const error =
        next === DownloadJobStatus.Cancelled &&
        record.status !== DownloadJobStatus.Cancelling
          ? REMOVED_FROM_CLIENT_ERROR
          : undefined

      this.logger.log(
        {
          action: 'settleAbsentJobs',
          absentForMs,
          clientHealthyForMs,
          error,
          fileLanded,
          jobId: record.id,
          links: links.length,
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
      // that was already there (an upgrade) or on `LANDING_WATCH_MS` - and
      // then nothing else would tell an open page this file landed. Owing
      // the media one more event makes this tick's diff re-read it
      // (invalidated, so with the file) and send it; while it is still
      // watched this changes nothing.
      if (next === DownloadJobStatus.Completed) {
        this.queuedMedia[source].set(record.mediaId, upstreamId)
      }
    }

    return settled
  }

  /**
   * Completes each episode job whose episode landed while its queue item is
   * still there - a season pack held up on another episode, or the row
   * Sonarr keeps after a partial manual import. `jobs` are the ones whose
   * item says the episode has a file (`episodeHasFile`); `didJobComplete`
   * confirms that file is newer than the job, so an upgrade of an episode
   * that already had one is not taken for its result.
   *
   * Never throws: a title whose files can't be read is asked about again
   * next tick (`completionInputs`).
   */
  private async completeQueuedEpisodes(
    type: DownloadType.Movie | DownloadType.Show,
    jobs: readonly TrackedJob[],
  ): Promise<void> {
    if (jobs.length === 0) return

    const inputs = await this.completionInputs(type, jobs, false)

    for (const { record: tracked, upstreamId } of jobs) {
      const data = inputs.get(tracked.id)
      if (!data) continue

      // Re-read after the listing: a cancel or a history event may have
      // moved the job meanwhile, and a cancelling job is its cancel's.
      const record = this.downloadStateService.jobs.get(tracked.id)
      if (
        !record ||
        TERMINAL_STATUSES.has(record.status) ||
        record.status === DownloadJobStatus.Cancelling
      ) {
        continue
      }

      const landed = didJobComplete({
        createdAt: new Date(record.createdAt),
        episodes: data.episodes,
        files: data.files,
        queueItem: { episodeHasFile: true },
        scope: record.scope,
      })
      if (!landed) continue

      this.logger.log(
        {
          action: 'completeQueuedEpisodes',
          jobId: record.id,
          mediaId: record.mediaId,
          newStatus: DownloadJobStatus.Completed,
          oldStatus: record.status,
        },
        'Media job episode landed while its queue item remains',
      )

      this.writeStatus(record, DownloadJobStatus.Completed, undefined)
      this.queuedMedia[SOURCE_OF[type]].set(record.mediaId, upstreamId)
    }
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
   * Drops the absence timer, command bookkeeping and remembered snapshot of
   * every job that is no longer in flight, so those maps only ever hold jobs
   * the poller still tracks. Runs every tick, failed or not: a job cancelled while upstream
   * was down still goes.
   */
  private forgetUntrackedJobs(): void {
    for (const byJob of [
      this.absentSince,
      this.commandCheckedAt,
      this.commandEndSeenAt,
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
   * tick reads is fresh rather than up to a minute old. See
   * `RadarrService.refreshMonitoredDownloads`.
   *
   * Each refresh costs upstream a SABnzbd read, two command rows and a retry
   * of every pending import, so it is sent only when it buys something:
   *
   * - SABnzbd read directly and healthy (`MediaStateService.clientHealth()`
   *   is `ok`): the live progress comes from SABnzbd, so all a refresh still
   *   buys is Radarr/Sonarr noticing a phase change - above all a finished
   *   download, ready to import - sooner than their own once-a-minute
   *   refresh. One refresh per SAB phase change of a download in this app's
   *   queue, at most every `EVENT_REFRESH_MIN_MS`. See `requestEventRefresh`.
   * - SABnzbd unset or unhealthy: only while something in the queue as of
   *   the previous tick is moving (`isQueueItemMoving`) - a download this app
   *   didn't start included - and at most every `QUEUE_REFRESH_MS`, or every
   *   `WATCHED_QUEUE_REFRESH_MS` while a detail page is open on a title with
   *   a moving item.
   *
   * Either way a tracked job with nothing moving sends nothing: Radarr/Sonarr
   * refresh on their own a few seconds after a grab or an import, and history
   * settles the outcome. The previous queue is read here, so this must run
   * before the tick's own `setQueue`.
   *
   * Best-effort: a refused refresh just means reading the queue as upstream
   * last refreshed it, so it is logged and swallowed rather than tripping
   * `poll()`'s backoff - and, like a sent one, it still counts against its
   * interval. If upstream is genuinely down, the `getQueue` right after it
   * throws and the backoff happens there.
   */
  private async requestQueueRefresh(
    source: QueueSource,
    refresh: () => Promise<void>,
  ): Promise<void> {
    if (this.mediaStateService.clientHealth() === 'ok') {
      await this.requestEventRefresh(source, refresh)
      return
    }

    const now = Date.now()
    const moving = this.movingQueueItems(source, now)
    if (moving.length === 0) return

    const interval = this.isWatchedQueue(source, moving)
      ? WATCHED_QUEUE_REFRESH_MS
      : QUEUE_REFRESH_MS
    if (
      now - this.queueRefreshedAt[source] <
      interval - QUEUE_REFRESH_SLACK_MS
    ) {
      return
    }
    await this.sendQueueRefresh(source, now, refresh)
  }

  /**
   * `requestQueueRefresh` while SABnzbd is healthy: one refresh for any SAB
   * phase changes of `source`'s downloads, once `EVENT_REFRESH_MIN_MS` has
   * passed since its last refresh.
   *
   * A change is `source`'s when its `nzo_id` is the `downloadId` of an item
   * in `source`'s queue as of the previous tick (what `getQueue` holds before
   * this tick's `setQueue`). The pending changes are taken whole and split:
   *
   * - `source`'s own are spent by the refresh sent now, or put back for a
   *   later tick while the limit holds - a burst collapses into one refresh;
   * - the other app's are put back untouched, for that app's pass;
   * - one that neither app's queue lists - a SABnzbd job neither app tracks,
   *   or one that has since left the queue - is dropped.
   *
   * What goes back keeps its order. Each pass only ever spends its own, and
   * the other app's queue it checks is whichever that app stored last, so
   * the two passes of one tick neither drop nor keep bouncing a change the
   * other owns: a change is put back only while an app's queue still lists
   * it.
   */
  private async requestEventRefresh(
    source: QueueSource,
    refresh: () => Promise<void>,
  ): Promise<void> {
    const now = Date.now()
    const own = queueDownloadIds(this.mediaStateService.getQueue(source))
    const other = queueDownloadIds(
      this.mediaStateService.getQueue(
        source === 'radarr' ? 'sonarr' : 'radarr',
      ),
    )
    const allowed =
      now - this.queueRefreshedAt[source] >=
      EVENT_REFRESH_MIN_MS - QUEUE_REFRESH_SLACK_MS

    let changed = false
    const kept: SabTransition[] = []
    for (const transition of this.mediaStateService.takeClientTransitions()) {
      if (own.has(transition.nzoId)) {
        changed = true
        if (!allowed) kept.push(transition)
      } else if (other.has(transition.nzoId)) {
        kept.push(transition)
      }
    }
    if (kept.length > 0) this.mediaStateService.pushClientTransitions(kept)

    if (changed && allowed) await this.sendQueueRefresh(source, now, refresh)
  }

  /**
   * Sends one refresh and stamps it at `now` - before it is sent, so a
   * refused one counts against the interval too. Never throws.
   */
  private async sendQueueRefresh(
    source: QueueSource,
    now: number,
    refresh: () => Promise<void>,
  ): Promise<void> {
    this.queueRefreshedAt[source] = now

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
   * The items of `source`'s queue, as of the previous tick, that are moving -
   * recording when each one's reading last changed, and forgetting items
   * that have left the queue.
   */
  private movingQueueItems(
    source: QueueSource,
    now: number,
  ): PollableQueueItem[] {
    const progress = this.queueProgress[source]
    const seen = new Set<string>()
    const moving: PollableQueueItem[] = []

    for (const item of this.mediaStateService.getQueue(source)) {
      const key = queueProgressKey(item)
      const reading = `${item.sizeleft ?? ''}|${queueItemState(item)}`
      seen.add(key)

      let entry = progress.get(key)
      if (!entry || entry.reading !== reading) {
        entry = { changedAt: now, reading }
        progress.set(key, entry)
      }
      if (isQueueItemMoving(item, source, entry.changedAt, now)) {
        moving.push(item)
      }
    }

    for (const key of progress.keys()) {
      if (!seen.has(key)) progress.delete(key)
    }
    return moving
  }

  /**
   * Whether any of `items` belongs to a title a connected client has a
   * detail page open for, by the upstream ids the media diff last mapped
   * (`queuedMedia`).
   */
  private isWatchedQueue(
    source: QueueSource,
    items: readonly PollableQueueItem[],
  ): boolean {
    const watched = this.downloadGateway.watchedMediaIds()
    if (watched.size === 0) return false

    const upstreamIds = new Set<number>()
    for (const [mediaId, upstreamId] of this.queuedMedia[source]) {
      if (watched.has(mediaId)) upstreamIds.add(upstreamId)
    }

    return items.some(item => {
      const upstreamId = source === 'radarr' ? item.movieId : item.seriesId
      return upstreamId != null && upstreamIds.has(upstreamId)
    })
  }

  /**
   * Asks `source` whether its download client is healthy, at most every
   * `HEALTH_POLL_MS`, and keeps `healthySince` - when the current healthy
   * run was first seen - which is what lets `settleAbsentJobs` tell a
   * download removed at the client from a queue that is empty only because
   * the client can't be reached. A check that fails leaves the health
   * unknown, which counts as unhealthy: an absence then settles nothing
   * until the client is seen healthy again.
   *
   * At most one check per app is in flight - the cron has no overlap guard -
   * and none ever throws.
   */
  private async checkClientHealth(source: QueueSource): Promise<void> {
    const health = this.clientHealth[source]
    const now = Date.now()
    if (health.inFlight || now - health.checkedAt < HEALTH_POLL_MS) return

    health.inFlight = true
    health.checkedAt = now
    try {
      const healthy =
        source === 'radarr'
          ? await this.radarrService.isDownloadClientHealthy()
          : await this.sonarrService.isDownloadClientHealthy()

      if (!healthy) {
        if (health.healthySince != null) {
          this.logger.warn(
            { action: 'checkClientHealth', source },
            'Download client reported unhealthy, holding absent downloads',
          )
        }
        health.healthySince = null
      } else if (health.healthySince == null) {
        health.healthySince = now
      }
    } catch (err) {
      if (health.healthySince != null) {
        this.logger.warn(
          { action: 'checkClientHealth', error: getErrorMessage(err), source },
          'Download client health unknown, holding absent downloads',
        )
      }
      health.healthySince = null
    } finally {
      health.inFlight = false
    }
  }

  /** How long `source`'s download client has been healthy, as of `now`. */
  private clientHealthyForMs(source: QueueSource, now: number): number {
    const { healthySince } = this.clientHealth[source]
    return healthySince == null ? 0 : Math.max(0, now - healthySince)
  }

  /**
   * Reads and applies `source`'s history, at most every `HISTORY_POLL_MS` -
   * on this boot's first read, after backfilling the links of jobs grabbed
   * before any were recorded (`backfillLinks`).
   *
   * At most one read per app is in flight, so two overlapping ticks never
   * apply the same events at once. Never throws: a failure is logged, and
   * the next interval starts again from the stored cursor.
   */
  private async syncHistory(
    source: QueueSource,
    tracked: readonly TrackedJob[],
  ): Promise<void> {
    const sync = this.historySync[source]
    const now = Date.now()
    if (sync.inFlight || now - sync.readAt < HISTORY_POLL_MS) return

    sync.inFlight = true
    sync.readAt = now
    try {
      if (!sync.backfilled) {
        sync.backfilled = await this.backfillLinks(source, tracked)
      }
      if (await this.ingestHistory(source, tracked, now)) {
        sync.syncedFrom = now
      }
    } catch (err) {
      this.logger.warn(
        { action: 'syncHistory', error: getErrorMessage(err), source },
        'History sync failed, retrying next interval',
      )
    } finally {
      sync.inFlight = false
    }
  }

  /**
   * One read of `source`'s `/history/since`, applied in `(date, id)` order.
   *
   * The read starts at the stored cursor - inclusive, so the events already
   * applied at exactly that date come back and are skipped by id - capped at
   * `HISTORY_MAX_CATCH_UP_MS` back; with no cursor, `HISTORY_FIRST_READ_MS`
   * back. Once the batch is applied the cursor moves to the last event's
   * date and the ids applied at it. An event that fails to apply stops the
   * batch there, with the cursor covering only what went before it, so it
   * is tried again next interval; every write an event makes is idempotent
   * on replay (`linkDownload`, and `markImported`/`markFailed` returning only
   * the rows they changed), so a partly applied event is harmless.
   *
   * Never logs a record: a grab's `data.downloadUrl` carries the indexer's
   * API key.
   *
   * Returns whether it read and applied everything there was - what lets a
   * search that ended before `now` be judged by the links alone.
   */
  private async ingestHistory(
    source: QueueSource,
    tracked: readonly TrackedJob[],
    now: number,
  ): Promise<boolean> {
    const { db } = this.downloadStateService
    const cursor = getCursor(db, source)
    const cursorMs = cursor ? Date.parse(cursor.date) : undefined
    const from =
      cursorMs != null
        ? Math.max(cursorMs, now - HISTORY_MAX_CATCH_UP_MS)
        : now - HISTORY_FIRST_READ_MS

    let records: ArrHistoryRecord[]
    try {
      records =
        source === 'radarr'
          ? await this.radarrService.getHistorySince(new Date(from))
          : await this.sonarrService.getHistorySince(new Date(from))
    } catch (err) {
      this.logger.warn(
        { action: 'ingestHistory', error: getErrorMessage(err), source },
        'History read failed, retrying from the same cursor next interval',
      )
      return false
    }

    const appliedAtCursor = new Set(cursor?.ids ?? [])
    const events = normalizeHistory(source, records).filter(event => {
      const at = Date.parse(event.date)
      return (
        cursorMs == null ||
        at > cursorMs ||
        (at === cursorMs && !appliedAtCursor.has(event.id))
      )
    })

    if (events.length === 0) {
      // Nothing new. A first read still records where it started, so a
      // restart days from now resumes here rather than a day back; a stored
      // cursor stays put - an idle app writes nothing every interval.
      if (cursorMs == null) {
        setCursor(db, source, new Date(from).toISOString(), [])
      }
      return true
    }

    let complete = true
    let applied: { date: string; ids: number[]; ms: number } | undefined
    for (const event of events) {
      try {
        await this.applyEvent(source, event, tracked)
      } catch (err) {
        this.logger.warn(
          {
            action: 'ingestHistory',
            downloadId: event.downloadId,
            error: getErrorMessage(err),
            eventId: event.id,
            kind: event.kind,
            source,
          },
          'Applying a history event failed, retrying from it next interval',
        )
        complete = false
        break
      }

      const ms = Date.parse(event.date)
      if (applied?.ms === ms) applied.ids.push(event.id)
      else applied = { date: event.date, ids: [event.id], ms }
    }

    if (applied) setCursor(db, source, applied.date, applied.ids)
    return complete
  }

  /** Applies one history event. Throws only when it must be retried. */
  private async applyEvent(
    source: QueueSource,
    event: ArrEvent,
    tracked: readonly TrackedJob[],
  ): Promise<void> {
    switch (event.kind) {
      case 'grabbed':
        this.applyGrab(source, event, tracked)
        return
      case 'imported':
        this.applyImport(source, event)
        return
      case 'failed':
        await this.applyFailure(source, event)
        return
      case 'manualFailed':
        this.applyRemoval(
          source,
          event,
          `Removed and blocklisted in ${APP_NAMES[source]}`,
        )
        return
      case 'ignored':
        this.applyRemoval(source, event, `Ignored in ${APP_NAMES[source]}`)
        return
    }
  }

  /**
   * Links a grab to the job `claimGrab` picks, with its date and whether a
   * human picked the release (which decides whether a later failure
   * retries). No job claims a grab this app did not cause - that is
   * adoption's business, once it shows in the queue. A season pack's grab
   * arrives once per episode and links once.
   *
   * A job that went back to `searching` after a failure has its retry note
   * cleared by its next new grab: the replacement it was waiting for.
   */
  private applyGrab(
    source: QueueSource,
    event: ArrEvent,
    tracked: readonly TrackedJob[],
  ): void {
    const jobId = claimGrab(event, this.claimableJobs(tracked))
    if (jobId === undefined) return

    // A grab already recorded - a season pack's next episode, or an event
    // read again - changes nothing; only a new one is news.
    const known = this.linksOf(jobId).some(
      link => link.downloadId === event.downloadId && link.grabbedAt != null,
    )
    if (
      !this.link(source, jobId, event.downloadId, event.date, event.interactive)
    ) {
      return
    }
    if (known) return

    this.logger.log(
      {
        action: 'applyGrab',
        downloadId: event.downloadId,
        interactive: event.interactive,
        jobId,
        source,
      },
      'Linked a grab to its job',
    )

    const record = this.downloadStateService.jobs.get(jobId)
    if (
      record?.status === DownloadJobStatus.Searching &&
      record.statusNote?.startsWith(RETRY_NOTE_PREFIX)
    ) {
      this.downloadStateService.updateJob(jobId, { statusNote: undefined })
    }
  }

  /**
   * Records an import on every job linked to the download. The job itself
   * moves on the queue and the library: once its item is gone, a job whose
   * links all resolved with an import settles `completed`.
   */
  private applyImport(source: QueueSource, event: ArrEvent): void {
    const changed = markImported(
      this.downloadStateService.db,
      source,
      event.downloadId,
      event.date,
    )
    if (changed.length === 0) return

    this.logger.log(
      {
        action: 'applyImport',
        downloadId: event.downloadId,
        jobIds: changed.map(row => row.jobId),
        source,
      },
      'Recorded an import',
    )
  }

  /**
   * A download the client failed. The link is marked failed, and each open
   * job it belongs to goes either back to `searching` - noted "Last download
   * failed: <reason>. <App> is trying another release." - when Radarr/Sonarr
   * will look for another release on their own, or to `failed` with the
   * client's reason when they won't. A disk-full reason is reworded by
   * `describeClientFailure` either way: the link keeps the client's text,
   * the job reads that the NAS ran out of space.
   *
   * Every read comes first - the app's failed-download settings, and
   * whether the release was picked by hand - so a read that fails throws
   * with nothing written, and the event is retried whole. The writes that
   * follow have no `await` between them and the job re-reads they act on.
   *
   * A job with another download still in flight is left to it (a season
   * whose other episodes are still coming), and so is one with another
   * download already imported when no retry follows - it settles
   * `completed` on what landed. A `cancelling` job only has its link marked:
   * its cancel settles it.
   */
  private async applyFailure(
    source: QueueSource,
    event: ArrEvent,
  ): Promise<void> {
    const { db } = this.downloadStateService
    const links = findJobsByDownloadId(db, source, event.downloadId)
    const affects = links.some(
      link => link.failedAt == null && this.isSettleable(link.jobId),
    )

    const retrying = affects
      ? await this.retriesAfterFailure(source, event.downloadId, links)
      : false

    const changed = markFailed(
      db,
      source,
      event.downloadId,
      event.date,
      event.message ?? null,
    )

    for (const { jobId } of changed) {
      const record = this.downloadStateService.jobs.get(jobId)
      if (!record || !this.isSettleable(jobId)) continue

      const others = this.linksOf(jobId).filter(
        link => link.downloadId !== event.downloadId,
      )
      if (others.some(link => link.importedAt == null && link.failedAt == null))
        continue
      if (!retrying && others.some(link => link.importedAt != null)) continue

      this.logger.log(
        {
          action: 'applyFailure',
          downloadId: event.downloadId,
          jobId,
          mediaId: record.mediaId,
          oldStatus: record.status,
          retrying,
          source,
        },
        retrying
          ? 'Download failed, upstream is retrying'
          : 'Download failed, no retry follows',
      )

      if (retrying) {
        this.writeStatus(record, DownloadJobStatus.Searching, undefined, {
          clearUpstreamCommand: true,
          statusNote: retryNote(source, event.message),
        })
      } else {
        this.writeStatus(
          record,
          DownloadJobStatus.Failed,
          event.message == null
            ? `Download failed in ${APP_NAMES[source]}`
            : describeClientFailure(event.message).text,
        )
      }
    }
  }

  /**
   * Someone removed the download upstream - blocklisted it
   * (`manualFailed`) or ignored it (`ignored`). The link is marked failed
   * with upstream's message, and each open job it belongs to is cancelled
   * with `reason`, unless it has another download still in flight. A
   * `cancelling` job is left to its own cancel.
   */
  private applyRemoval(
    source: QueueSource,
    event: ArrEvent,
    reason: string,
  ): void {
    const changed = markFailed(
      this.downloadStateService.db,
      source,
      event.downloadId,
      event.date,
      event.message ?? reason,
    )

    for (const { jobId } of changed) {
      const record = this.downloadStateService.jobs.get(jobId)
      if (!record || !this.isSettleable(jobId)) continue

      const inFlight = this.linksOf(jobId).some(
        link =>
          link.downloadId !== event.downloadId &&
          link.importedAt == null &&
          link.failedAt == null,
      )
      if (inFlight) continue

      this.logger.log(
        {
          action: 'applyRemoval',
          downloadId: event.downloadId,
          jobId,
          kind: event.kind,
          mediaId: record.mediaId,
          oldStatus: record.status,
          source,
        },
        'Download removed upstream, job cancelled',
      )
      this.writeStatus(record, DownloadJobStatus.Cancelled, reason)
    }
  }

  /**
   * Whether a history outcome may move this job: it is in flight and not
   * `cancelling` - a cancel pressed here settles itself.
   */
  private isSettleable(jobId: string): boolean {
    const record = this.downloadStateService.jobs.get(jobId)
    return (
      record != null &&
      !TERMINAL_STATUSES.has(record.status) &&
      record.status !== DownloadJobStatus.Cancelling
    )
  }

  /**
   * Whether Radarr/Sonarr will search again on their own after this
   * download failed: failed-download redownload is on, and - for a release
   * a human picked in interactive search - so is redownloading those.
   * Throws when the settings can't be read, so the event is retried.
   */
  private async retriesAfterFailure(
    source: QueueSource,
    downloadId: string,
    links: readonly JobDownloadRow[],
  ): Promise<boolean> {
    const config = await this.failedDownloadConfig(source)
    if (!config.autoRedownloadFailed) return false
    if (config.fromInteractive) return true

    return !(await this.wasInteractive(source, downloadId, links))
  }

  /** `source`'s failed-download settings, re-read every 10 minutes. */
  private async failedDownloadConfig(
    source: QueueSource,
  ): Promise<FailedDownloadConfig> {
    const now = Date.now()
    const cached = this.failedConfig[source]
    if (cached && now - cached.readAt < FAILED_CONFIG_TTL_MS) {
      return cached.config
    }

    const config =
      source === 'radarr'
        ? await this.radarrService.getFailedDownloadConfig()
        : await this.sonarrService.getFailedDownloadConfig()
    this.failedConfig[source] = { config, readAt: now }
    return config
  }

  /**
   * Whether the failed download's release was picked by hand: off its link
   * when the grab event recorded it, else off the download's own history.
   * Unknown - no grab found, or the history unreadable - reads as automatic.
   */
  private async wasInteractive(
    source: QueueSource,
    downloadId: string,
    links: readonly JobDownloadRow[],
  ): Promise<boolean> {
    const known = links.find(link => link.interactive != null)?.interactive
    if (known != null) return known

    try {
      const records =
        source === 'radarr'
          ? await this.radarrService.getHistoryByDownloadId(downloadId)
          : await this.sonarrService.getHistoryByDownloadId(downloadId)
      const grab = normalizeHistory(source, records).find(
        event => event.kind === 'grabbed' && event.interactive != null,
      )
      return grab?.interactive ?? false
    } catch (err) {
      this.logger.warn(
        {
          action: 'wasInteractive',
          downloadId,
          error: getErrorMessage(err),
          source,
        },
        'Download history read failed, treating the grab as automatic',
      )
      return false
    }
  }

  /**
   * `tracked`, as `claimGrab` sees it - each job re-read, so a status an
   * event earlier in the batch wrote counts.
   */
  private claimableJobs(tracked: readonly TrackedJob[]): ClaimableJob[] {
    return tracked.flatMap(({ record: { id }, upstreamId }) => {
      const record = this.downloadStateService.jobs.get(id)
      if (!record || TERMINAL_STATUSES.has(record.status)) return []

      return [
        {
          createdAt: record.createdAt,
          id,
          scope: record.scope ?? null,
          status: record.status,
          type: record.type,
          upstreamCommandAt: record.upstreamCommandAt ?? null,
          upstreamId,
        },
      ]
    })
  }

  /**
   * Once per boot: links each grabbed job that has no download links yet -
   * one from before links were persisted, or whose grab event was never
   * read - to the grabs in its title's own history, claimed by the same rules
   * as a live grab, and records what history says became of them (imported,
   * failed). No job moves here; the queue and the absence rules take it from
   * the links.
   *
   * A job in `needs_attention` or `paused` is offered to `claimGrab` as
   * `downloading`, the status it was grabbed in. Sonarr's per-series history
   * carries no season numbers, so the series' episodes supply them.
   *
   * Returns whether it ran to the end: a title whose history could not be
   * read is tried again next interval.
   */
  private async backfillLinks(
    source: QueueSource,
    tracked: readonly TrackedJob[],
  ): Promise<boolean> {
    const { db } = this.downloadStateService
    const unlinked = new Map<number, Set<string>>()

    for (const {
      record: { id },
      upstreamId,
    } of tracked) {
      const record = this.downloadStateService.jobs.get(id)
      if (!record || !BACKFILL_STATUSES.has(record.status)) continue
      if (this.linksOf(id).length > 0) continue

      const jobIds = unlinked.get(upstreamId) ?? new Set<string>()
      unlinked.set(upstreamId, jobIds.add(id))
    }

    let complete = true
    for (const [upstreamId, jobIds] of unlinked) {
      let events: ArrEvent[]
      try {
        events = normalizeHistory(
          source,
          await this.titleHistory(source, upstreamId),
        )
      } catch (err) {
        this.logger.warn(
          {
            action: 'backfillLinks',
            error: getErrorMessage(err),
            source,
            upstreamId,
          },
          'Title history read failed, backfilling its links next interval',
        )
        complete = false
        continue
      }

      const claimable = this.claimableJobs(
        tracked.filter(job => job.upstreamId === upstreamId),
      ).map(job =>
        job.status === DownloadJobStatus.NeedsAttention ||
        job.status === DownloadJobStatus.Paused
          ? { ...job, status: DownloadJobStatus.Downloading }
          : job,
      )

      const linked = new Set<string>()
      for (const event of events) {
        if (event.kind !== 'grabbed') continue

        const jobId = claimGrab(event, claimable)
        if (jobId === undefined || !jobIds.has(jobId)) continue
        if (
          this.link(
            source,
            jobId,
            event.downloadId,
            event.date,
            event.interactive,
          )
        ) {
          linked.add(event.downloadId)
        }
      }

      for (const event of events) {
        if (!linked.has(event.downloadId)) continue
        if (event.kind === 'imported') {
          markImported(db, source, event.downloadId, event.date)
        } else if (event.kind !== 'grabbed') {
          markFailed(
            db,
            source,
            event.downloadId,
            event.date,
            event.message ?? null,
          )
        }
      }

      if (linked.size > 0) {
        this.logger.log(
          {
            action: 'backfillLinks',
            downloadIds: Array.from(linked),
            source,
            upstreamId,
          },
          'Backfilled download links from title history',
        )
      }
    }

    return complete
  }

  /**
   * One title's whole history. Sonarr's records gain the season and episode
   * numbers `claimGrab` matches a scope by, from the series' episodes.
   */
  private async titleHistory(
    source: QueueSource,
    upstreamId: number,
  ): Promise<ArrHistoryRecord[]> {
    if (source === 'radarr') {
      return this.radarrService.getMovieHistory(upstreamId)
    }

    const [records, episodes] = await Promise.all([
      this.sonarrService.getSeriesHistory(upstreamId),
      this.sonarrService.getEpisodes(upstreamId),
    ])
    const byId = new Map(
      episodes.flatMap(episode =>
        episode.id == null ? [] : [[episode.id, episode] as const],
      ),
    )

    return records.map((record): ArrHistoryRecord => {
      const episode =
        record.episodeId != null ? byId.get(record.episodeId) : undefined
      if (!episode || record.episode != null) return record

      return {
        ...record,
        episode: {
          ...(episode.episodeNumber != null
            ? { episodeNumber: episode.episodeNumber }
            : {}),
          ...(episode.seasonNumber != null
            ? { seasonNumber: episode.seasonNumber }
            : {}),
        },
      }
    })
  }

  /**
   * Follows the Radarr/Sonarr command each open job of `source` waits on
   * (`upstreamCommandId`), read at most every `COMMAND_POLL_MS` per job -
   * see `checkCommand` - and looks for the search Radarr/Sonarr queue on
   * their own after a failed download, for each job waiting on one - see
   * `findRetrySearches`.
   *
   * Every open job is looked at, not only the `tracked` ones: a job whose
   * title has not resolved yet still has a refresh to time out. `tracked`
   * only supplies each job's upstream id, where it has one.
   *
   * Runs after the history sync, so a grab a search made is linked before
   * the search is judged. A `cancelling` job is left to its cancel. Never
   * throws.
   */
  private async trackCommands(
    source: QueueSource,
    tracked: readonly TrackedJob[],
  ): Promise<void> {
    const type = SOURCE_TYPE[source]
    const upstreamIds = new Map(
      tracked.map(({ record, upstreamId }) => [record.id, upstreamId]),
    )
    const now = Date.now()
    const waiting: Array<PendingJob & { commandId: number }> = []
    const retrying: PendingJob[] = []

    for (const record of this.downloadStateService.jobs.values()) {
      if (record.type !== type || !this.isSettleable(record.id)) continue

      const upstreamId = upstreamIds.get(record.id)
      const commandId = record.upstreamCommandId
      if (commandId == null) {
        if (isAwaitingRetrySearch(record)) {
          retrying.push({ record, upstreamId })
        }
        continue
      }

      const checkedAt = this.commandCheckedAt.get(record.id) ?? -Infinity
      if (
        this.commandInFlight.has(record.id) ||
        now - checkedAt < COMMAND_POLL_MS
      ) {
        continue
      }
      this.commandCheckedAt.set(record.id, now)
      waiting.push({ commandId, record, upstreamId })
    }

    await Promise.all([
      ...waiting.map(async job => {
        this.commandInFlight.add(job.record.id)
        try {
          await this.checkCommand(source, job, job.commandId)
        } catch (err) {
          this.logger.warn(
            {
              action: 'trackCommands',
              commandId: job.commandId,
              error: getErrorMessage(err),
              jobId: job.record.id,
              source,
            },
            'Following a job command failed, trying again shortly',
          )
        } finally {
          this.commandInFlight.delete(job.record.id)
        }
      }),
      retrying.length > 0
        ? this.findRetrySearches(source, retrying).catch((err: unknown) => {
            this.logger.warn(
              { action: 'trackCommands', error: getErrorMessage(err), source },
              'Looking for retry searches failed, trying again next tick',
            )
          })
        : null,
    ])
  }

  /**
   * Reads the command one job waits on and acts on how it stands:
   *
   * - still queued or running: nothing, unless it is the add-time `refresh`
   *   and `REFRESH_WAIT_TIMEOUT_MS` has passed - then `failed`, "<App> never
   *   finished adding the movie/show";
   * - `failed` / `aborted` / `cancelled` / `orphaned`: `failed`, with the
   *   command's message;
   * - `completed`: a `refresh` starts the job's search (`searchAfterRefresh`),
   *   a `search` is judged by the grabs linked since (`judgeSearch`).
   *
   * An id upstream no longer knows (404 - Radarr/Sonarr restarted and lost
   * it) counts as completed, started when the job sent it.
   */
  private async checkCommand(
    source: QueueSource,
    { record, upstreamId }: PendingJob,
    commandId: number,
  ): Promise<void> {
    const kind: UpstreamCommandKind = record.upstreamCommandKind ?? 'search'
    let command: CommandSnapshot | null
    try {
      command =
        source === 'radarr'
          ? await this.radarrService.getCommand(commandId)
          : await this.sonarrService.getCommand(commandId)
    } catch (err) {
      this.logger.warn(
        {
          action: 'checkCommand',
          commandId,
          error: getErrorMessage(err),
          jobId: record.id,
          source,
        },
        'Command read failed, trying again shortly',
      )
      return
    }
    const observedAt = Date.now()

    if (command && !isCommandEnded(command)) {
      if (kind === 'refresh') {
        this.failStalledRefresh(source, record.id, commandId, observedAt)
      }
      return
    }

    if (command && command.status !== 'completed') {
      this.failForCommand(source, record.id, commandId, kind, command)
      return
    }

    if (kind === 'refresh') {
      await this.searchAfterRefresh(source, record.id, commandId, upstreamId)
      return
    }

    const endedMs = command?.ended ? Date.parse(command.ended) : NaN
    this.judgeSearch(source, record.id, commandId, {
      endedAt: Number.isNaN(endedMs)
        ? this.endSeenAt(record.id, commandId, observedAt)
        : endedMs,
      message: command?.message,
      started: command?.started ?? command?.queued,
    })
  }

  /**
   * When a job's command was first read as ended with no end date, or gone
   * - `now`, the first time. See `commandEndSeenAt`.
   */
  private endSeenAt(jobId: string, commandId: number, now: number): number {
    const seen = this.commandEndSeenAt.get(jobId)
    if (seen?.commandId === commandId) return seen.at

    this.commandEndSeenAt.set(jobId, { at: now, commandId })
    return now
  }

  /**
   * A finished `search`: the job goes on if anything was grabbed for it
   * since the command started - a link whose grab is dated at or after the
   * start (cut to the whole second history dates grabs to), or one linked
   * off the queue whose grab event hasn't been read - or once it has moved
   * past searching at all. The command is then cleared, keeping
   * `upstreamCommandAt`, which `claimGrab` still ranks the job by.
   *
   * Nothing grabbed ends the job `not_found`, with no note - its chip
   * already says "no release found" - or, for the search Radarr/Sonarr ran
   * after a failed download (the job still carries its retry note), the
   * note "<App>'s retry found no other release". Never
   * concluded before a history read that started after the command ended
   * has been applied: the search can end between two reads, before the one
   * that would show its grab. Until then the job waits, and the command is
   * read again next interval.
   *
   * The command's own message ("N reports downloaded") is logged, never
   * read: upstream drops it ~5 minutes after the command ends.
   */
  private judgeSearch(
    source: QueueSource,
    jobId: string,
    commandId: number,
    end: CommandEnd,
  ): void {
    const record = this.waitingOn(jobId, commandId)
    if (!record) return

    const started = floorToSecond(
      Date.parse(end.started ?? record.upstreamCommandAt ?? record.createdAt),
    )
    const grabbed = this.linksOf(jobId).some(link =>
      grabbedSince(link, Number.isNaN(started) ? -Infinity : started),
    )

    if (grabbed || !SEARCH_STATUSES.has(record.status)) {
      this.logger.log(
        {
          action: 'judgeSearch',
          commandId,
          commandMessage: end.message,
          jobId,
          source,
          status: record.status,
        },
        'Search command finished with a grab',
      )
      this.downloadStateService.updateJob(jobId, {
        upstreamCommandId: undefined,
        upstreamCommandKind: undefined,
      })
      return
    }

    if (
      this.historySync[source].syncedFrom <
      end.endedAt + HISTORY_AFTER_COMMAND_SLACK_MS
    ) {
      return
    }

    const statusNote = record.statusNote?.startsWith(RETRY_NOTE_PREFIX)
      ? retryNotFound(source)
      : undefined
    this.logger.log(
      {
        action: 'judgeSearch',
        commandId,
        commandMessage: end.message,
        jobId,
        mediaId: record.mediaId,
        oldStatus: record.status,
        source,
        statusNote,
      },
      'Search command finished without a grab',
    )
    this.writeStatus(record, DownloadJobStatus.NotFound, undefined, {
      clearUpstreamCommand: true,
      statusNote,
    })
  }

  /**
   * A finished add-time `refresh`: the title's episodes exist now, so the
   * job's search is started (`startSearch`) and its "Waiting for ..." note
   * cleared, in one write with the scope `startSearch` resolved. Then, by
   * its outcome:
   *
   * - `search`: the job waits on that command instead (kind `search`);
   * - `grabbed` (a title with flagged releases, picked here): no command
   *   to wait on - the grabs are claimed from history; the grab time is
   *   kept as `upstreamCommandAt`, which ranks the job for them;
   * - `not_found` / `failed`: the job ends there, with the note / error.
   *
   * A job something was already grabbed for just stops waiting.
   *
   * A search that can't be started is tried again next interval - and once
   * `REFRESH_WAIT_TIMEOUT_MS` has passed since the refresh was queued, the
   * job fails with the reason.
   */
  private async searchAfterRefresh(
    source: QueueSource,
    jobId: string,
    refreshId: number,
    upstreamId: number | undefined,
  ): Promise<void> {
    const action = 'searchAfterRefresh'
    const record = this.waitingOn(jobId, refreshId)
    if (!record) return

    if (!SEARCH_STATUSES.has(record.status)) {
      this.downloadStateService.updateJob(jobId, {
        upstreamCommandId: undefined,
        upstreamCommandKind: undefined,
      })
      return
    }

    let result: StartSearchResult
    try {
      result = await startSearch(this.searchDeps(), record, upstreamId)
    } catch (err) {
      const error = getErrorMessage(err)
      const current = this.waitingOn(jobId, refreshId)
      if (current && refreshTimedOut(current, Date.now())) {
        this.logger.warn(
          { action, error, jobId, source },
          'Search could not be started, giving up',
        )
        this.writeStatus(
          current,
          DownloadJobStatus.Failed,
          `Couldn't start the search in ${APP_NAMES[source]}: ${error}`,
          { clearUpstreamCommand: true },
        )
        return
      }

      this.logger.warn(
        { action, error, jobId, source },
        'Search could not be started, trying again shortly',
      )
      return
    }

    // Re-read, with nothing awaited from here to the write: a cancel or a
    // history event may have moved the job while the search was sent.
    const current = this.waitingOn(jobId, refreshId)
    if (!current) {
      this.logger.warn(
        {
          action,
          commandId:
            result.outcome === 'search' ? result.command.id : undefined,
          jobId,
          outcome: result.outcome,
          source,
        },
        'Job moved on while its search was being started',
      )
      return
    }

    const scope = result.scope ? { scope: result.scope } : {}
    switch (result.outcome) {
      case 'search':
        this.downloadStateService.updateJob(jobId, {
          ...scope,
          statusNote: undefined,
          upstreamCommandAt: result.command.queuedAt,
          upstreamCommandId: result.command.id,
          upstreamCommandKind: 'search',
        })
        this.commandCheckedAt.set(jobId, Date.now())
        return
      case 'grabbed':
        this.downloadStateService.updateJob(jobId, {
          ...scope,
          statusNote: undefined,
          upstreamCommandAt: result.grabbedAt,
          upstreamCommandId: undefined,
          upstreamCommandKind: undefined,
        })
        return
      case 'not_found':
      case 'failed': {
        if (result.scope) {
          this.downloadStateService.updateJob(jobId, scope)
        }
        const record = this.downloadStateService.jobs.get(jobId) ?? current
        this.logger.log(
          { action, jobId, outcome: result.outcome, source },
          'Search ended before it started',
        )
        this.writeStatus(
          record,
          result.outcome === 'failed'
            ? DownloadJobStatus.Failed
            : DownloadJobStatus.NotFound,
          result.outcome === 'failed' ? result.error : undefined,
          {
            clearUpstreamCommand: true,
            statusNote:
              result.outcome === 'not_found' ? result.statusNote : undefined,
          },
        )
        return
      }
    }
  }

  /** `startSearch`'s dependencies, from what the poller already holds. */
  private searchDeps(): StartSearchDeps {
    return {
      db: this.downloadStateService.db,
      logger: this.logger,
      radarrService: this.radarrService,
      sonarrService: this.sonarrService,
    }
  }

  /**
   * Fails a job whose add-time refresh has been queued or running for
   * `REFRESH_WAIT_TIMEOUT_MS`.
   */
  private failStalledRefresh(
    source: QueueSource,
    jobId: string,
    commandId: number,
    now: number,
  ): void {
    const record = this.waitingOn(jobId, commandId)
    if (!record || !refreshTimedOut(record, now)) return

    const reason = `${APP_NAMES[source]} never finished adding the ${TITLE_NOUNS[source]}`
    this.logger.warn(
      {
        action: 'failStalledRefresh',
        commandId,
        jobId,
        mediaId: record.mediaId,
        source,
      },
      'Add-time refresh never finished, job failed',
    )
    this.writeStatus(record, DownloadJobStatus.Failed, reason, {
      clearUpstreamCommand: true,
    })
  }

  /** Fails a job whose command ended any way but `completed`. */
  private failForCommand(
    source: QueueSource,
    jobId: string,
    commandId: number,
    kind: UpstreamCommandKind,
    command: CommandSnapshot,
  ): void {
    const record = this.waitingOn(jobId, commandId)
    if (!record) return

    const reason =
      command.message?.trim() ||
      `${APP_NAMES[source]} ${kind} ${command.status}`
    this.logger.warn(
      {
        action: 'failForCommand',
        commandId,
        commandStatus: command.status,
        jobId,
        kind,
        mediaId: record.mediaId,
        reason,
        source,
      },
      'Job command did not complete, job failed',
    )
    this.writeStatus(record, DownloadJobStatus.Failed, reason, {
      clearUpstreamCommand: true,
    })
  }

  /**
   * The job, re-read, when it is still open, not `cancelling`, and still
   * waiting on `commandId` - the check every command write makes first, with
   * no `await` between it and the write.
   */
  private waitingOn(
    jobId: string,
    commandId: number,
  ): DownloadJobRecord | undefined {
    const record = this.downloadStateService.jobs.get(jobId)
    return record &&
      this.isSettleable(jobId) &&
      record.upstreamCommandId === commandId
      ? record
      : undefined
  }

  /**
   * For each job back in `searching` after a failed download - carrying its
   * retry note, with no command of its own - finds the search Radarr/Sonarr
   * queued themselves to replace the download: one of `RETRY_SEARCH_NAMES`,
   * `trigger: 'unspecified'`, for the job's title and scope, queued no
   * earlier than the failure. The job waits on it from then on like on a
   * search of its own, and its retry note is what later words its
   * `not_found`.
   *
   * `listCommands` only holds a command ~5 minutes after it ends, so it is
   * read every tick while any job is looking - one call per app. A job that
   * sees no such search within `RETRY_SEARCH_TIMEOUT_MS` of the failure,
   * with history read past that too, ends `not_found`, noted "<App>'s retry
   * found no other release". A grab in the meantime clears the note, which ends
   * the looking.
   */
  private async findRetrySearches(
    source: QueueSource,
    jobs: readonly PendingJob[],
  ): Promise<void> {
    const action = 'findRetrySearches'
    let commands: CommandSnapshot[]
    try {
      commands =
        source === 'radarr'
          ? await this.radarrService.listCommands()
          : await this.sonarrService.listCommands()
    } catch (err) {
      this.logger.warn(
        { action, error: getErrorMessage(err), source },
        'Command list read failed, looking for retry searches next tick',
      )
      return
    }

    const retries = commands
      .filter(
        command =>
          command.trigger === 'unspecified' &&
          RETRY_SEARCH_NAMES[source].has(command.name) &&
          !Number.isNaN(Date.parse(command.queued ?? '')),
      )
      .sort((a, b) => Date.parse(a.queued ?? '') - Date.parse(b.queued ?? ''))
    const episodeIds = new Map<
      string,
      Promise<ReadonlySet<number> | undefined>
    >()

    for (const { record: pending, upstreamId } of jobs) {
      const failedAt = latestFailure(this.linksOf(pending.id))
      if (failedAt === undefined) continue

      let retry: CommandSnapshot | undefined
      if (upstreamId != null) {
        for (const command of retries) {
          if (
            Date.parse(command.queued ?? '') <
            failedAt - RETRY_QUEUED_SLACK_MS
          ) {
            continue
          }
          if (
            await this.isRetryFor(
              source,
              command,
              pending,
              upstreamId,
              episodeIds,
            )
          ) {
            retry = command
            break
          }
        }
      }

      // Re-read, with nothing awaited from here to the write.
      const record = this.downloadStateService.jobs.get(pending.id)
      if (
        !record ||
        !this.isSettleable(record.id) ||
        !isAwaitingRetrySearch(record)
      ) {
        continue
      }

      if (retry) {
        this.logger.log(
          {
            action,
            command: retry.name,
            commandId: retry.id,
            jobId: record.id,
            source,
          },
          'Following the retry search upstream queued',
        )
        this.downloadStateService.updateJob(record.id, {
          upstreamCommandAt: retry.queued,
          upstreamCommandId: retry.id,
          upstreamCommandKind: 'search',
        })
        continue
      }

      const deadline = failedAt + RETRY_SEARCH_TIMEOUT_MS
      if (
        Date.now() < deadline ||
        this.historySync[source].syncedFrom < deadline
      ) {
        continue
      }

      const statusNote = retryNotFound(source)
      this.logger.log(
        {
          action,
          jobId: record.id,
          mediaId: record.mediaId,
          source,
          statusNote,
        },
        'No retry search seen, job not found',
      )
      this.writeStatus(record, DownloadJobStatus.NotFound, undefined, {
        clearUpstreamCommand: true,
        statusNote,
      })
    }
  }

  /**
   * Whether a search Radarr/Sonarr queued themselves is for this job, by its
   * body: Radarr's `MoviesSearch` names the movie; Sonarr's `SeasonSearch`
   * names the series and a season the job covers, and its `EpisodeSearch`
   * an episode the job covers - which, for a season or whole-series job,
   * takes the series' episodes (read once per series and season, shared
   * through `episodeIds`). Episodes that can't be read match nothing this
   * tick.
   */
  private async isRetryFor(
    source: QueueSource,
    command: CommandSnapshot,
    record: DownloadJobRecord,
    upstreamId: number,
    episodeIds: Map<string, Promise<ReadonlySet<number> | undefined>>,
  ): Promise<boolean> {
    const { body } = command
    if (source === 'radarr') return numberList(body.movieIds).has(upstreamId)

    const scope = record.scope
    if (command.name === 'SeasonSearch') {
      return (
        body.seriesId === upstreamId &&
        (scope?.seasonNumber == null ||
          body.seasonNumber === scope.seasonNumber)
      )
    }

    const searched = numberList(body.episodeIds)
    if (scope?.episodeId != null) return searched.has(scope.episodeId)

    const season = scope?.seasonNumber
    const key = `${upstreamId}:${season ?? '*'}`
    let inScope = episodeIds.get(key)
    if (!inScope) {
      inScope = this.sonarrService.getEpisodes(upstreamId).then(
        episodes =>
          new Set(
            episodes.flatMap(episode =>
              episode.id != null &&
              (season == null || episode.seasonNumber === season)
                ? [episode.id]
                : [],
            ),
          ),
        (err: unknown) => {
          this.logger.warn(
            {
              action: 'isRetryFor',
              error: getErrorMessage(err),
              seriesId: upstreamId,
            },
            'Episode read failed, matching retry searches next tick',
          )
          return undefined
        },
      )
      episodeIds.set(key, inScope)
    }

    const covered = await inScope
    return covered != null && Array.from(searched).some(id => covered.has(id))
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
   * until its file lands, or for `LANDING_WATCH_MS` if it never does:
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

        // Gone: watched until its file lands, or for `LANDING_WATCH_MS` if it
        // never does, then forgotten - so it costs nothing until it is
        // queued again.
        const since = this.vanishedAt.get(mediaId) ?? now
        if (result.landed || now - since >= LANDING_WATCH_MS) {
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
          downloadId => this.mediaStateService.clientReading(downloadId),
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
   * With `withImports`, a title one of whose jobs has a download link also
   * gets its import history (`imports`) - read only once a file newer than
   * the earliest such job is listed, since until then there is nothing to
   * tie back to a download.
   *
   * Never throws. A title whose read fails is logged and left out of the
   * map, so its jobs stay exactly as they are this tick while every other
   * title's jobs still settle - one flaky title must not hold up the rest,
   * nor trip `poll()`'s backoff, which the queue read already owns.
   */
  private async completionInputs(
    type: DownloadType.Movie | DownloadType.Show,
    jobs: readonly TrackedJob[],
    withImports = false,
  ): Promise<Map<string, PollableCompletionData>> {
    const byJobId = new Map<string, PollableCompletionData>()
    if (jobs.length === 0) return byJobId

    const upstreamIds = Array.from(new Set(jobs.map(job => job.upstreamId)))
    const byUpstreamId = new Map<number, PollableCompletionData>()

    // Per title, the creation of its earliest linked job: the "since" a new
    // file has to beat before the title's history is worth a read.
    const linkedSince = new Map<number, number>()
    if (withImports) {
      for (const { record, upstreamId } of jobs) {
        const createdAtMs = Date.parse(record.createdAt)
        if (Number.isNaN(createdAtMs) || this.linksOf(record.id).length === 0) {
          continue
        }
        const earliest = linkedSince.get(upstreamId)
        if (earliest === undefined || createdAtMs < earliest) {
          linkedSince.set(upstreamId, createdAtMs)
        }
      }
    }

    await Promise.all(
      upstreamIds.map(async upstreamId => {
        try {
          const since = linkedSince.get(upstreamId)
          byUpstreamId.set(
            upstreamId,
            await this.fetchCompletionData(
              type,
              upstreamId,
              since === undefined ? undefined : new Date(since),
            ),
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
   * One title's completion inputs. `importsSince` asks for its import
   * history too, once a file newer than it is listed.
   */
  private async fetchCompletionData(
    type: DownloadType.Movie | DownloadType.Show,
    upstreamId: number,
    importsSince?: Date,
  ): Promise<PollableCompletionData> {
    const data: PollableCompletionData =
      type === DownloadType.Movie
        ? { files: await this.radarrService.getMovieFiles(upstreamId) }
        : await Promise.all([
            this.sonarrService.getEpisodeFiles(upstreamId),
            this.sonarrService.getEpisodes(upstreamId),
          ]).then(([files, episodes]) => ({ episodes, files }))

    if (importsSince && hasFileAddedAfter(data.files, importsSince)) {
      data.imports = completionImports(
        type === DownloadType.Movie
          ? await this.radarrService.getMovieHistory(upstreamId)
          : await this.sonarrService.getSeriesHistory(upstreamId),
      )
    }

    return data
  }

  /**
   * Moves a job that has a queue item this tick to what the item says -
   * `deriveQueueItemState`, timed by how long the item has held its current
   * state (`stateSince`), so a warning that lingers escalates to
   * NeedsAttention while one that clears on its own never shows. A failed
   * item keeps the job where it is: history's `failed` event decides that.
   */
  private applyUpdate(
    record: DownloadJobRecord,
    item: PollableQueueItem,
    context: { key: string; now: number; source: QueueSource },
  ): void {
    const { key, now, source } = context
    const previousSnapshot = this.lastSnapshot.get(record.id)
    const stateSince = this.stateSinceFor(key, queueItemState(item), now)
    const next = deriveQueueItemState(record.status, item, {
      app: source,
      now,
      stateSince,
    })
    // With SAB's live readings merged in, so a job whose bytes moved sends a
    // frame every tick even while Radarr's/Sonarr's own numbers stand still.
    const newSnapshot = toQueueSnapshot(item, downloadId =>
      this.mediaStateService.clientReading(downloadId),
    )

    // NeedsAttention carries upstream's own sentence - why Radarr/Sonarr
    // refused the import ("was not found in the grabbed release"), or the
    // client's reason. Without it the one line that tells a person what to
    // do in the manual-import dialog is dropped.
    const error =
      next.status === DownloadJobStatus.NeedsAttention
        ? next.errorMessage
        : undefined

    // A job can sit in NeedsAttention for hours while upstream re-parses the
    // release and changes its mind about *why* it's stuck. That is a real
    // change with no status move and no snapshot move behind it, so without
    // this the early return below would pin the first sentence forever.
    const reasonChanged =
      next.status === DownloadJobStatus.NeedsAttention &&
      record.status === DownloadJobStatus.NeedsAttention &&
      error !== undefined &&
      error !== record.error

    // The queue never says a download came back, so a reopened job's note
    // stays for as long as the status the reopen gave it does.
    const statusNote =
      next.statusNote ??
      (next.status === record.status &&
      record.statusNote?.startsWith(REOPEN_NOTE_PREFIX)
        ? record.statusNote
        : undefined)

    // "Delayed by Radarr until 14:05" appearing, moving or clearing.
    const noteChanged = statusNote !== record.statusNote

    if (
      next.status === record.status &&
      !reasonChanged &&
      !noteChanged &&
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
        newStatus: next.status,
        snapshot: newSnapshot,
        statusNote,
      },
      'Media job status changed',
    )

    this.lastSnapshot.set(record.id, newSnapshot)

    // One frame either way. A status move broadcasts from updateJob, and
    // that hydrate already carries the new snapshot off the queue cache; a
    // progress-only tick (same status, new percentage) re-broadcasts the job
    // instead of making a pointless job-row write.
    if (next.status === record.status && !reasonChanged && !noteChanged) {
      this.downloadStateService.touchJob(record.id)
      return
    }

    this.writeStatus(record, next.status, error, { statusNote })
  }

  /**
   * Writes a status move to the job. `error` is the reason a Cancelled,
   * Failed or NeedsAttention status carries, when there is one; any other
   * status leaves `error` alone, except that leaving NeedsAttention clears
   * it. Leaving Cancelling without a reason clears it too, whatever the new
   * status: the cancel action already did, and nothing from before the press
   * is why the job ended.
   *
   * NotFound never carries an `error`: the mockups draw it with a warn chip
   * and a grey note, never red. What more it has to say - "<App>'s retry
   * found no other release", or "No usable release — every result is
   * flagged or rejected" - goes in `options.statusNote`, and the plain case
   * has none, its chip already reading "no release found".
   *
   * The note follows `options.statusNote` when it is given, and otherwise
   * stays while the status does and goes when it moves: "Delayed by Radarr"
   * or "Last download failed: ..." describe the status they were written
   * with, never the next one.
   */
  private writeStatus(
    record: DownloadJobRecord,
    newStatus: DownloadJobStatus,
    error: string | undefined,
    options: StatusWriteOptions = {},
  ): void {
    const carriesReason =
      newStatus === DownloadJobStatus.Cancelled ||
      newStatus === DownloadJobStatus.Failed ||
      newStatus === DownloadJobStatus.NeedsAttention
    const dropsReason =
      record.status === DownloadJobStatus.Cancelling ||
      (record.status === DownloadJobStatus.NeedsAttention && !carriesReason)
    const statusNote = Object.hasOwn(options, 'statusNote')
      ? options.statusNote
      : newStatus === record.status
        ? record.statusNote
        : undefined

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
      // grabbed release" into history forever. The note, likewise.
      ...(carriesReason && error
        ? { error }
        : dropsReason
          ? { error: undefined }
          : {}),
      ...(statusNote !== record.statusNote ? { statusNote } : {}),
      ...(options.clearUpstreamCommand
        ? { upstreamCommandId: undefined, upstreamCommandKind: undefined }
        : {}),
      status: newStatus,
    })
  }
}

/**
 * The queue items that belong to one job this tick: every item carrying a
 * download the job is linked to, plus every item of its title that no other
 * in-flight job is linked to - narrowed, for a show, to the job's scope. An
 * item whose download has already failed for this job is left out: history
 * settled it, and reading it again would drag a job that is back to
 * `searching` for a retry onto the dead download.
 */
function matchJobItems(
  source: QueueSource,
  record: DownloadJobRecord,
  upstreamId: number,
  queue: readonly PollableQueueItem[],
  links: readonly JobDownloadRow[],
  claimed: ReadonlySet<string>,
): PollableQueueItem[] {
  const own = new Set(links.map(link => link.downloadId))
  const failed = new Set(
    links.flatMap(link => (link.failedAt != null ? [link.downloadId] : [])),
  )

  return queue.filter(item => {
    if (source === 'sonarr' && !matchesScope(item, record.scope)) return false

    const downloadId = item.downloadId ?? undefined
    if (downloadId != null) {
      if (failed.has(downloadId)) return false
      if (own.has(downloadId)) return true
      // Linked to another in-flight job: that job's, not this one's.
      if (claimed.has(downloadId)) return false
    }

    const itemUpstreamId = source === 'radarr' ? item.movieId : item.seriesId
    return itemUpstreamId === upstreamId
  })
}

/**
 * The `stateSince` key for a job's matched items: its source and the
 * download ids they carry, or the job itself for items that carry none.
 */
function queueStateKey(
  source: QueueSource,
  jobId: string,
  items: readonly PollableQueueItem[],
): string {
  const downloadIds = Array.from(
    new Set(items.flatMap(item => (item.downloadId ? [item.downloadId] : []))),
  ).sort()

  return `${source}:${downloadIds.length > 0 ? downloadIds.join(',') : `job:${jobId}`}`
}

/**
 * The `queueProgress` key for one queue item: its row id and download, with
 * what it was grabbed for, so a Sonarr pack's per-episode rows are timed
 * apart.
 */
function queueProgressKey(item: PollableQueueItem): string {
  return [item.id, item.downloadId, item.movieId, item.seriesId, item.episodeId]
    .map(value => value ?? '')
    .join('|')
}

/**
 * The download ids a queue lists - which, for a SABnzbd download, are its
 * `nzo_id`s.
 */
function queueDownloadIds(
  queue: readonly PollableQueueItem[],
): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const { downloadId } of queue) {
    if (downloadId) ids.add(downloadId)
  }
  return ids
}

/** The tracked state a queue item's `stateSince` clock runs for. */
function queueItemState(item: PollableQueueItem): string {
  return [
    item.status ?? '',
    item.trackedDownloadState ?? '',
    item.trackedDownloadStatus ?? '',
  ].join('|')
}

/**
 * The note a job reopened by `reopenEndedJob` carries: its download is back
 * in `source`'s queue.
 */
function reopenNote(source: QueueSource): string {
  return `${REOPEN_NOTE_PREFIX} ${APP_NAMES[source]}`
}

/**
 * The note a job goes back to `searching` with when its download failed and
 * Radarr/Sonarr are looking for another release on their own. A disk-full
 * failure says so, and that the retry fails the same way: Radarr/Sonarr
 * blocklist a release SABnzbd could not unpack for want of space, and the
 * next one lands on the same full disk.
 */
function retryNote(source: QueueSource, message: string | undefined): string {
  const app = APP_NAMES[source]
  if (describeClientFailure(message).kind === 'disk_space') {
    return `${RETRY_NOTE_PREFIX}: the NAS ran out of disk space. ${app} is trying another release, which will fail the same way until space is freed.`
  }

  const reason = message?.trim().replace(/\.+$/, '')
  const retrying = `${app} is trying another release.`
  return reason
    ? `${RETRY_NOTE_PREFIX}: ${reason}. ${retrying}`
    : `${RETRY_NOTE_PREFIX}. ${retrying}`
}

/**
 * The note a job ends `not_found` with when the search Radarr/Sonarr ran
 * after its failed download grabbed nothing.
 */
function retryNotFound(source: QueueSource): string {
  return `${APP_NAMES[source]}'s retry found no other release`
}

/**
 * Whether a job is back in `searching` after a failed download, waiting on
 * the search Radarr/Sonarr queue to replace it - and not following that
 * search yet.
 */
function isAwaitingRetrySearch(record: DownloadJobRecord): boolean {
  return (
    record.status === DownloadJobStatus.Searching &&
    record.upstreamCommandId == null &&
    record.statusNote?.startsWith(RETRY_NOTE_PREFIX) === true
  )
}

/**
 * Whether the add-time refresh a job waits on was queued at least
 * `REFRESH_WAIT_TIMEOUT_MS` before `now`. A job with no queue time never
 * times out.
 */
function refreshTimedOut(record: DownloadJobRecord, now: number): boolean {
  const queuedAt = Date.parse(record.upstreamCommandAt ?? '')
  return !Number.isNaN(queuedAt) && now - queuedAt >= REFRESH_WAIT_TIMEOUT_MS
}

/**
 * Whether a download link shows a grab at or after `since` (epoch ms): its
 * grab is dated then or later, or it was linked off the queue, is still in
 * flight, and its grab event just hasn't been read.
 */
function grabbedSince(link: JobDownloadRow, since: number): boolean {
  if (link.grabbedAt == null) {
    return link.failedAt == null && link.importedAt == null
  }
  return Date.parse(link.grabbedAt) >= since
}

/** When a job's latest download failed (epoch ms), if one did. */
function latestFailure(links: readonly JobDownloadRow[]): number | undefined {
  let latest: number | undefined
  for (const link of links) {
    const failedAt = Date.parse(link.failedAt ?? '')
    if (!Number.isNaN(failedAt) && (latest === undefined || failedAt > latest))
      latest = failedAt
  }
  return latest
}

/** Cuts a time to the whole second, as Radarr/Sonarr date history. */
function floorToSecond(ms: number): number {
  return Math.floor(ms / 1000) * 1000
}

/** The numbers in a command body's id list, ignoring anything else. */
function numberList(value: unknown): ReadonlySet<number> {
  return new Set(
    Array.isArray(value)
      ? value.filter((item): item is number => typeof item === 'number')
      : [],
  )
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
