import type {
  DownloadQueueSnapshot,
  ShowScope,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'

import type { QueueSource } from './media-state.service'
import { type HistoryRecordLike, historyValue } from './release-history.util'

/**
 * Structural subset of Radarr's and Sonarr's (nominally distinct, but
 * field-identical) generated `QueueResource` types - just the fields the
 * poller needs to derive a job status and a snapshot. Using a shared
 * structural type here lets `MediaPollerService` treat both queues the same
 * way instead of duplicating this logic per-client.
 */
export interface PollableQueueItem {
  /**
   * The download client's own id for the grab. On `QueueResource` already;
   * the manual importer needs it to ask Radarr/Sonarr for the candidate
   * files of a download that finished but never got imported.
   */
  downloadId?: string | null
  /**
   * Sonarr-only, like `seasonNumber` below: Radarr's queue has neither, and
   * a movie is one file and one queue item anyway. Both are absent rather
   * than null on a Radarr item - the structural type documents itself as
   * the shared *subset*, so a field only one side has is simply optional.
   */
  episodeId?: number | null
  estimatedCompletionTime?: string | null
  /** The queue row's own id, used to remove the row once it is imported. */
  id?: number
  /**
   * The Radarr movie the item was grabbed for - Radarr-only, the movie-side
   * counterpart of `seriesId`. What `MediaStateService` keys a movie's queue
   * items on.
   */
  movieId?: number | null
  seasonNumber?: number | null
  /** Sonarr-only: the series the item was grabbed for. */
  seriesId?: number | null
  sizeleft?: number
  size?: number
  status?: string
  statusMessages?: Array<{
    title?: string | null
    messages?: string[] | null
  }> | null
  timeleft?: string | null
  trackedDownloadState?: string
  trackedDownloadStatus?: string
}

// trackedDownloadState values that mean Radarr/Sonarr has the file and is
// moving it into the library, per the SDK's generated union.
const IMPORTING_TRACKED_STATES = new Set(['importing'])

// trackedDownloadState values that mean the opposite: the file is on disk
// and nothing is moving it. Radarr/Sonarr has decided it cannot import the
// release on its own - usually because it can't match the release to the
// movie/episode it was grabbed for - and will sit there until a human picks
// the destination in the manual-import dialog. Not `Failed` (the bytes are
// there, and a retry would only re-grab them) and not `Importing` (nothing
// is in flight), so these get their own status.
const ATTENTION_TRACKED_STATES = new Set(['importBlocked', 'importPending'])

export function toQueueSnapshot(
  item: PollableQueueItem,
): DownloadQueueSnapshot {
  const size = item.size ?? 0
  const sizeleft = item.sizeleft ?? 0
  const progress =
    size > 0
      ? Math.round(
          Math.min(100, Math.max(0, ((size - sizeleft) / size) * 100)) * 100,
        ) / 100
      : undefined

  return {
    progress,
    status: item.status,
    timeLeft: item.timeleft ?? undefined,
  }
}

export function isQueueSnapshotEqual(
  a: DownloadQueueSnapshot | undefined,
  b: DownloadQueueSnapshot | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return false

  return (
    a.progress === b.progress &&
    a.status === b.status &&
    a.timeLeft === b.timeLeft
  )
}

// How the aggregate resolves a disagreement between queue items, worst
// first. A single failed episode has to surface as a failure rather than
// being averaged away, and anything still downloading outranks a sibling
// that has already reached the import stage - otherwise a season job would
// report "Importing" while half of it is still on the wire.
//
// `NeedsAttention` sits just under `Failed`, above `Downloading`, because it
// is the one thing in this list a person can act on *now*: a season with one
// blocked episode and nine still transferring should say so immediately
// rather than only once the ninth lands, minutes later. The summed
// size/sizeleft still drive the progress bar, so the card reads "9 of 10 -
// needs your decision", which is exactly true.
const STATUS_PRECEDENCE: DownloadJobStatus[] = [
  DownloadJobStatus.Failed,
  DownloadJobStatus.NeedsAttention,
  DownloadJobStatus.Downloading,
  DownloadJobStatus.Importing,
]

/**
 * Folds every queue item matching a job into the single synthetic item the
 * status/snapshot derivation expects.
 *
 * Sonarr queues one item *per episode*, so a season job routinely has
 * several. Taking the first would let a season flip to `Completed` the
 * moment its first episode landed, with nine still downloading - which is
 * exactly the bug this exists to prevent.
 *
 * The fold:
 * - `size`/`sizeleft` summed, so progress is over the whole scope.
 * - `status`/`trackedDownloadState`/`trackedDownloadStatus` copied from the
 *   **dominant** item under `STATUS_PRECEDENCE`, so the derived status is
 *   one a real item actually had rather than a synthesized combination.
 * - `timeleft`/`estimatedCompletionTime` from the item with the largest
 *   `sizeleft` - the one that will finish last, and therefore the one that
 *   answers "when is this done".
 * - `statusMessages` concatenated, so `describeQueueItemError` still reports
 *   every failure rather than whichever happened to sort first.
 *
 * Returns `undefined` for an empty list, which is deliberately the same
 * thing `queue.find()` returns for "no entry" - so the poller hands both to
 * `settleWithoutQueueItem` the same way.
 */
export function aggregateQueueItems(
  items: PollableQueueItem[],
): PollableQueueItem | undefined {
  if (items.length === 0) return undefined
  if (items.length === 1) return items[0]

  const rank = (item: PollableQueueItem) => {
    // Classified through the same function the poller uses, so the
    // aggregate can never disagree with a per-item derivation. The current
    // status is irrelevant for an item that exists.
    const index = STATUS_PRECEDENCE.indexOf(
      deriveStatusFromQueueItem(DownloadJobStatus.Requested, item),
    )
    return index === -1 ? STATUS_PRECEDENCE.length : index
  }

  let dominant = items[0] as PollableQueueItem
  let slowest = items[0] as PollableQueueItem

  for (const item of items.slice(1)) {
    if (rank(item) < rank(dominant)) {
      dominant = item
    }
    if ((item.sizeleft ?? 0) > (slowest.sizeleft ?? 0)) {
      slowest = item
    }
  }

  const statusMessages = items.flatMap(item => item.statusMessages ?? [])

  return {
    estimatedCompletionTime: slowest.estimatedCompletionTime,
    size: items.reduce((total, item) => total + (item.size ?? 0), 0),
    sizeleft: items.reduce((total, item) => total + (item.sizeleft ?? 0), 0),
    status: dominant.status,
    statusMessages: statusMessages.length > 0 ? statusMessages : undefined,
    timeleft: slowest.timeleft,
    trackedDownloadState: dominant.trackedDownloadState,
    trackedDownloadStatus: dominant.trackedDownloadStatus,
  }
}

export function describeQueueItemError(
  item: PollableQueueItem,
): string | undefined {
  const messages = item.statusMessages
    ?.flatMap(m => m.messages ?? [])
    .filter((m): m is string => !!m)

  return messages && messages.length > 0 ? messages.join('; ') : undefined
}

/**
 * Maps a job's current status plus its queue entry to the next
 * `DownloadJobStatus`, per the
 * `Requested -> Searching -> Downloading -> Importing/NeedsAttention ->
 * Completed/Failed` lifecycle. The entry is required: a job with **no**
 * entry is `settleWithoutQueueItem`'s question, because the queue alone
 * can't tell a finished import from a download that vanished.
 *
 * - `status: 'failed'` or `trackedDownloadStatus: 'error'`: Failed.
 * - `trackedDownloadState: 'importBlocked'`/`'importPending'`, or a
 *   `status: 'completed'` item carrying `trackedDownloadStatus: 'warning'`:
 *   NeedsAttention. The file is on disk and Radarr/Sonarr has stopped -
 *   only a human working the manual-import dialog moves it now. This has to
 *   be checked before the two branches below, because the live shape of a
 *   stuck import is `status: 'completed'` *and*
 *   `trackedDownloadState: 'importPending'` at once.
 * - `trackedDownloadState: 'importing'`: Importing.
 * - `trackedDownloadState: 'imported'` or `status: 'completed'`: the file
 *   landed but may still be finishing import bookkeeping - Importing until
 *   it drops out of the queue entirely (see `settleWithoutQueueItem`).
 * - `status: 'paused'`: Paused. This is Radarr's/Sonarr's own queue reporting
 *   that the *backing download client* (qBittorrent, SABnzbd, ...) paused the
 *   item - independent of, and unrelated to, this app's video-only
 *   pause/resume (Phase 5). It can be paused from Radarr's/Sonarr's queue UI
 *   or the client's own UI, with no way for this app to have caused it.
 * - Anything else (queued, downloading, warning, delay, ...): Downloading.
 *   A warning on an item that is still transferring stays here on purpose -
 *   Radarr/Sonarr warns about a stalled torrent, a missing category or an
 *   unpack in progress, and none of those are fixed by a manual import.
 *   Only import-stage signals count as NeedsAttention.
 */
export function deriveStatusFromQueueItem(
  // Unread since the no-entry branch moved out - every present item decides
  // on its own - but kept so a caller still states where the job stands.
  _current: DownloadJobStatus,
  item: PollableQueueItem,
): DownloadJobStatus {
  if (item.status === 'failed' || item.trackedDownloadStatus === 'error') {
    return DownloadJobStatus.Failed
  }

  // Must precede both importing branches: a stuck import is reported as
  // `status: 'completed'` *and* `trackedDownloadState: 'importPending'`, so
  // the `status === 'completed'` branch below would otherwise swallow it.
  if (
    (item.trackedDownloadState &&
      ATTENTION_TRACKED_STATES.has(item.trackedDownloadState)) ||
    (item.status === 'completed' && item.trackedDownloadStatus === 'warning')
  ) {
    return DownloadJobStatus.NeedsAttention
  }

  if (
    item.trackedDownloadState &&
    IMPORTING_TRACKED_STATES.has(item.trackedDownloadState)
  ) {
    return DownloadJobStatus.Importing
  }

  if (item.trackedDownloadState === 'imported' || item.status === 'completed') {
    return DownloadJobStatus.Importing
  }

  // Reuses the same `Paused` a video job gets from Phase 5 rather than a
  // second status: it's already non-terminal, so a paused movie/show job
  // stays on the Activity feed exactly like a paused video does. The two
  // are resumed differently - a video job through this app's own
  // `PATCH /videos/:id/resume`, a movie/show by unpausing at Radarr/Sonarr
  // or the download client directly, since this app has no such route for
  // them - but that distinction lives in the job's `type`, not its status.
  if (item.status === 'paused') {
    return DownloadJobStatus.Paused
  }

  return DownloadJobStatus.Downloading
}

/**
 * How long a grabbed job may be missing from the queue, with no file to show
 * for it, before it is called failed. Wall-clock, so a run of failed polls
 * counts toward it rather than pausing it.
 *
 * Long enough to cover the one honest reason for the gap: Radarr/Sonarr drop
 * the queue row at the end of an import slightly before the file listing
 * reports the new file, so a tick can land in between.
 */
export const QUEUE_ABSENCE_GRACE_MS = 60_000

/**
 * How long a `cancelling` job must stay missing from the queue, with no file
 * and no removal or failure in its history, before the cancel is called done.
 * Wall-clock, like `QUEUE_ABSENCE_GRACE_MS`.
 *
 * The wait exists only for a late grab: a Radarr/Sonarr search command
 * already running when the cancel was pressed can still grab a release
 * afterwards. Indexer requests time out at about 30 s, so a search that has
 * not grabbed by then is very unlikely to. Reusing the 60 s absence grace
 * would double the wait for no gain, and much below 20 s this would be two
 * poll ticks - the same as `QUEUE_REMOVAL_CONFIRM_MS` - and no longer a grace
 * window at all.
 */
export const CANCEL_GRACE_MS = 30_000

/**
 * How long a job whose history says it was removed or failed (see
 * `DequeuedOutcome`) must stay missing from the queue before that is taken
 * as final: long enough that two separate queue reads agreed, so one read
 * that briefly came back without it can't end a live download.
 */
export const QUEUE_REMOVAL_CONFIRM_MS = 5_000

/** The error a job fails with when it left the queue and nothing landed. */
export const LEFT_QUEUE_WITHOUT_FILE_ERROR =
  'Left the queue without producing a file'

/** Why a job was cancelled when someone removed its download upstream. */
export const REMOVED_FROM_QUEUE_ERROR = {
  radarr: "Removed from Radarr's queue",
  sonarr: "Removed from Sonarr's queue",
} as const satisfies Record<QueueSource, string>

/**
 * What Radarr's/Sonarr's history says became of the downloads a job had
 * queued, once they have left the queue:
 *
 * - `imported`: an import was recorded, so the file is on its way into the
 *   library listing and the grace period still applies.
 * - `failed`: the download client failed it, with its reason if it gave one.
 * - `removed`: a person took it out of the queue in Radarr/Sonarr. A plain
 *   removal writes no history at all, so "nothing after the grab" reads as
 *   this, and so do blocklisting (a *manual* `downloadFailed`) and ignoring
 *   (`downloadIgnored`).
 */
export type DequeuedOutcome =
  | { kind: 'failed'; reason?: string }
  | { kind: 'imported' }
  | { kind: 'removed' }

/** The `downloadFailed` message Radarr/Sonarr write for a blocklisted removal. */
const MANUALLY_FAILED_MESSAGE = 'Manually marked as failed'

/**
 * Reads a `DequeuedOutcome` off a title's history, looking only at the
 * records for `downloadIds` (the queue items the job had).
 */
export function dequeuedOutcome(
  records: readonly HistoryRecordLike[],
  downloadIds: ReadonlySet<string>,
): DequeuedOutcome {
  const own = records.filter(
    record => record.downloadId != null && downloadIds.has(record.downloadId),
  )

  if (own.some(record => record.eventType === 'downloadFolderImported')) {
    return { kind: 'imported' }
  }

  const failure = own.find(
    record =>
      record.eventType === 'downloadFailed' &&
      historyValue(record, 'message') !== MANUALLY_FAILED_MESSAGE,
  )

  return failure
    ? { kind: 'failed', reason: historyValue(failure, 'message') }
    : { kind: 'removed' }
}

// Statuses that mean a release was grabbed: the job has been seen in the
// queue, so leaving it is the end of the attempt one way or the other.
// `Paused` is here because only a queue item can report it.
const GRABBED_STATUSES = new Set<DownloadJobStatus>([
  DownloadJobStatus.Downloading,
  DownloadJobStatus.Importing,
  DownloadJobStatus.Paused,
])

// Statuses where an empty queue is the expected reading: nothing grabbed
// yet, or a blocked import waiting on a human.
const WAITING_STATUSES = new Set<DownloadJobStatus>([
  DownloadJobStatus.Requested,
  DownloadJobStatus.Searching,
  DownloadJobStatus.NeedsAttention,
])

/**
 * Where a movie/show job goes when no queue item matches it this tick, or
 * `undefined` to leave it where it is.
 *
 * An empty queue is ambiguous on its own - "never grabbed", "grabbed and
 * imported between two ticks" and "grabbed and then dropped" all look the
 * same - so the answer comes from the library instead: `fileLanded` is
 * `didJobComplete`'s verdict on whether a file for the job's scope was added
 * after the job was created.
 *
 * - Cancelling (someone pressed cancel here, and the queue items were
 *   removed), checked first: Completed if a file landed anyway - the cancel
 *   came too late. Otherwise Cancelled once `QUEUE_REMOVAL_CONFIRM_MS` has
 *   passed if `outcome` says the download was removed or failed, or once
 *   `CANCEL_GRACE_MS` has passed with any other outcome or none (never
 *   grabbed, an import on its way, or history lost to a restart), since a
 *   search still running at the press may yet grab a release.
 * - A file landed: Completed, whatever the status. That includes a
 *   `searching` job whose whole download happened between two ticks, and a
 *   `needs_attention` job a human imported by hand.
 * - No file, and `outcome` (the history of the job's own downloads, known
 *   only for a job that was seen in the queue) says it was removed or
 *   failed upstream: Cancelled or Failed once `QUEUE_REMOVAL_CONFIRM_MS`
 *   has passed. That includes a needs_attention job someone gave up on in
 *   Radarr's/Sonarr's own UI.
 * - Grabbed (downloading/importing/paused), no file: unchanged for
 *   `QUEUE_ABSENCE_GRACE_MS`, since the import may still be racing the file
 *   listing, then Failed.
 * - Waiting (requested/searching/needs_attention), no file: unchanged.
 *   Nothing was grabbed, or a person has not acted yet.
 * - Anything else - terminal, or a video-only status a movie/show job never
 *   holds: unchanged.
 */
export function settleWithoutQueueItem(
  current: DownloadJobStatus,
  fileLanded: boolean,
  absentForMs: number,
  outcome?: DequeuedOutcome,
): DownloadJobStatus | undefined {
  if (current === DownloadJobStatus.Cancelling) {
    return settleCancelling(fileLanded, absentForMs, outcome)
  }

  const grabbed = GRABBED_STATUSES.has(current)

  if (!grabbed && !WAITING_STATUSES.has(current)) return undefined

  if (fileLanded) return DownloadJobStatus.Completed

  if (
    outcome &&
    outcome.kind !== 'imported' &&
    absentForMs >= QUEUE_REMOVAL_CONFIRM_MS
  ) {
    return outcome.kind === 'removed'
      ? DownloadJobStatus.Cancelled
      : DownloadJobStatus.Failed
  }

  if (grabbed && absentForMs >= QUEUE_ABSENCE_GRACE_MS) {
    return DownloadJobStatus.Failed
  }

  return undefined
}

// `settleWithoutQueueItem`'s answer for a `cancelling` job.
function settleCancelling(
  fileLanded: boolean,
  absentForMs: number,
  outcome: DequeuedOutcome | undefined,
): DownloadJobStatus | undefined {
  if (fileLanded) return DownloadJobStatus.Completed

  const confirmed =
    outcome != null &&
    outcome.kind !== 'imported' &&
    absentForMs >= QUEUE_REMOVAL_CONFIRM_MS

  return confirmed || absentForMs >= CANCEL_GRACE_MS
    ? DownloadJobStatus.Cancelled
    : undefined
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
export function matchesScope(
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
