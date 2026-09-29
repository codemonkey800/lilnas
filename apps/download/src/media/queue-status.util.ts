import type {
  DownloadQueueSnapshot,
  DownloadQueueStage,
  ShowScope,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'

import type { SabPhase, SabReading } from 'src/sabnzbd/sab-readings.util'

import { describeClientFailure } from './client-failure.util'
import type { QueueSource } from './media-state.service'

/**
 * Looks up SABnzbd's live reading for a queue item's `downloadId` (SAB's
 * `nzo_id`) - `MediaStateService.clientReading`, passed in so this module
 * stays pure. `undefined` = no reading, and the snapshot keeps
 * Radarr's/Sonarr's numbers.
 */
export type ClientReadingLookup = (downloadId: string) => SabReading | undefined

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
   * Set only on a fold built by `aggregateQueueItems`: every distinct
   * `downloadId` it covers, so `toQueueSnapshot` can merge SABnzbd's
   * readings per download. Absent when any folded row had no `downloadId` -
   * a download that can't be named can't be read, so the fold keeps
   * Radarr's/Sonarr's numbers. Never on a real queue row.
   */
  downloadIds?: readonly string[]
  /**
   * Sonarr-only, like `seasonNumber` below: Radarr's queue has neither, and
   * a movie is one file and one queue item anyway. Both are absent rather
   * than null on a Radarr item - the structural type documents itself as
   * the shared *subset*, so a field only one side has is simply optional.
   */
  episodeId?: number | null
  /**
   * Sonarr-only: whether the episode the item was grabbed for already has a
   * file in the library.
   */
  episodeHasFile?: boolean
  /**
   * The download client's own reason for a failed or warning item, when it
   * gave one. Often the only explanation there is - `statusMessages` is empty
   * for a plain client-side failure.
   */
  errorMessage?: string | null
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

// `done` of `total` as a percentage, clamped to 0-100 and rounded to two
// decimals; `undefined` when there is no total to measure against.
function toPercent(done: number, total: number): number | undefined {
  if (total <= 0) return undefined
  return (
    Math.round(Math.min(100, Math.max(0, (done / total) * 100)) * 100) / 100
  )
}

/**
 * A queue item's snapshot. `progress`, `status` and `timeLeft` are
 * Radarr's/Sonarr's; with `reading`, SABnzbd's live numbers for the item's
 * download(s) - its own `downloadId`, or every one of a fold's
 * `downloadIds` - are merged over them (see `mergeClientReadings`).
 *
 * `status` and `timeLeft` always stay Radarr's/Sonarr's: they decide the
 * job's status, and whatever reads `timeLeft` keeps reading the same
 * string. With a reading, `progress` is SAB's bytes downloaded over its
 * total instead, unless SAB doesn't know the total.
 */
export function toQueueSnapshot(
  item: PollableQueueItem,
  reading?: ClientReadingLookup,
): DownloadQueueSnapshot {
  const size = item.size ?? 0
  const sizeleft = item.sizeleft ?? 0

  const snapshot: DownloadQueueSnapshot = {
    progress: toPercent(size - sizeleft, size),
    status: item.status,
    timeLeft: item.timeleft ?? undefined,
  }

  const downloadIds =
    item.downloadIds ?? (item.downloadId ? [item.downloadId] : [])
  const client = reading ? mergeClientReadings(downloadIds, reading) : undefined

  return client ? { ...snapshot, ...client } : snapshot
}

/**
 * Free space on SABnzbd's download disk, in GB, below which a queue pause is
 * put down to the disk filling up (`clientDiskLow`).
 */
export const SAB_LOW_DISK_GB = 5

// Least advanced first: an aggregate's stage is its slowest download's.
const STAGE_ORDER: readonly DownloadQueueStage[] = [
  'queued',
  'paused',
  'downloading',
  'post_processing',
]

// The snapshot stage of each SAB phase. `completed`, `failed` and `gone` have
// none: Radarr/Sonarr's status already says what happens next. A `Record`, so
// a new phase fails type-check here until someone decides.
const PHASE_STAGE: Record<SabPhase, DownloadQueueStage | undefined> = {
  completed: undefined,
  downloading: 'downloading',
  failed: undefined,
  gone: undefined,
  paused: 'paused',
  post_processing: 'post_processing',
  queued: 'queued',
}

/**
 * SABnzbd's side of a snapshot for one or more downloads, or `undefined`
 * when any of them has no reading - part SAB, part Radarr would mix two
 * clocks and two notions of size, so the whole snapshot then stays
 * Radarr's/Sonarr's. Ids are de-duplicated first: a Sonarr season pack is
 * one download behind many queue rows and is counted once.
 *
 * - `downloadedBytes`/`totalBytes` summed, and `progress` their ratio
 *   (clamped and rounded like Radarr's) - all three only when every download
 *   has a known size (`totalBytes > 0`; a job SAB first saw in history has
 *   none). Otherwise `progress` stays Radarr's and no bytes are sent.
 * - `speedBps` summed over the downloads that have one; `etaSeconds` the
 *   largest one known. Each absent when no download has one.
 * - `stage` the least advanced download's, in `STAGE_ORDER`. A `completed`,
 *   `failed` or `gone` download still counts its bytes - it is still part
 *   of the grab - but has no stage, and neither does a set of only those.
 * - `stageDetail` only when exactly one download is post-processing: two
 *   action lines can't share one line of text.
 * - `clientPaused` when SABnzbd's own queue pause is what holds the grab:
 *   the merged `stage` is `paused` and at least one `paused` download was
 *   read while SAB's whole queue was paused. A Force-priority download that
 *   keeps going through a global pause reads `downloading`, so it never
 *   counts; nor does a download paused on its own with the queue running.
 * - `clientDiskLow` with `clientPaused` only, when the lowest free space
 *   those paused readings report is under `SAB_LOW_DISK_GB` - the likely
 *   reason for the pause. An unknown free space (`null`) never counts.
 *
 * Both flags are left out rather than `false`, like every other SAB field.
 */
function mergeClientReadings(
  downloadIds: readonly string[],
  reading: ClientReadingLookup,
): Omit<DownloadQueueSnapshot, 'status' | 'timeLeft'> | undefined {
  const readings: SabReading[] = []
  for (const downloadId of new Set(downloadIds)) {
    const found = reading(downloadId)
    if (!found) return undefined
    readings.push(found)
  }
  if (readings.length === 0) return undefined

  const merged: Omit<DownloadQueueSnapshot, 'status' | 'timeLeft'> = {}

  if (readings.every(r => r.totalBytes > 0)) {
    const downloadedBytes = sum(readings.map(r => r.downloadedBytes))
    const totalBytes = sum(readings.map(r => r.totalBytes))
    merged.progress = toPercent(downloadedBytes, totalBytes)
    merged.downloadedBytes = downloadedBytes
    merged.totalBytes = totalBytes
  }

  const speeds = readings.flatMap(r => (r.speedBps == null ? [] : [r.speedBps]))
  if (speeds.length > 0) merged.speedBps = sum(speeds)

  const etas = readings.flatMap(r =>
    r.etaSeconds == null ? [] : [r.etaSeconds],
  )
  if (etas.length > 0) merged.etaSeconds = Math.max(...etas)

  const stages = readings.flatMap(r => {
    const stage = PHASE_STAGE[r.phase]
    return stage ? [stage] : []
  })
  if (stages.length > 0) {
    merged.stage = STAGE_ORDER.find(stage => stages.includes(stage))
  }

  const processing = readings.filter(r => r.phase === 'post_processing')
  const stageDetail =
    processing.length === 1 ? processing[0]?.stageDetail : null
  if (stageDetail) merged.stageDetail = stageDetail

  if (merged.stage === 'paused') {
    const heldBySab = readings.filter(
      r => r.phase === 'paused' && r.globallyPaused,
    )
    if (heldBySab.length > 0) {
      merged.clientPaused = true
      const diskFree = heldBySab.flatMap(r =>
        r.diskFreeGb == null ? [] : [r.diskFreeGb],
      )
      if (diskFree.length > 0 && Math.min(...diskFree) < SAB_LOW_DISK_GB) {
        merged.clientDiskLow = true
      }
    }
  }

  return merged
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/** How finely `isQueueSnapshotEqual` tells speeds apart: 10 KiB/s. */
const SPEED_BUCKET_BPS = 10_240

const speedBucket = (speedBps: number | undefined) =>
  speedBps === undefined ? undefined : Math.round(speedBps / SPEED_BUCKET_BPS)

/**
 * Whether two snapshots would draw the same, field by field. `speedBps` is
 * compared in 10 KiB/s buckets, so the jitter of SAB's smoothed speed alone
 * never sends a frame; `downloadedBytes` is exact, so a download that is
 * moving still sends one every tick.
 */
export function isQueueSnapshotEqual(
  a: DownloadQueueSnapshot | undefined,
  b: DownloadQueueSnapshot | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return false

  return (
    a.progress === b.progress &&
    a.status === b.status &&
    a.timeLeft === b.timeLeft &&
    a.downloadedBytes === b.downloadedBytes &&
    a.totalBytes === b.totalBytes &&
    speedBucket(a.speedBps) === speedBucket(b.speedBps) &&
    a.etaSeconds === b.etaSeconds &&
    a.stage === b.stage &&
    a.stageDetail === b.stageDetail &&
    a.clientPaused === b.clientPaused &&
    a.clientDiskLow === b.clientDiskLow
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
 * - `size`/`sizeleft` summed once per `downloadId`, so progress is over the
 *   whole scope. Sonarr emits one queue row per episode of a season pack,
 *   and every one of them carries the whole pack's size - summing each row
 *   would count the pack once per episode. Rows with no `downloadId` can't
 *   be told apart, so each counts on its own.
 * - `downloadIds`: every distinct `downloadId`, so `toQueueSnapshot` merges
 *   SABnzbd's readings over the same downloads the sizes were summed over.
 *   Absent when any row has no `downloadId` (see the field).
 * - `errorMessage` from the first item that has one, so the client's own
 *   reason survives the fold.
 * - `episodeHasFile` true only when every item says so, false when any item
 *   reports it at all, and absent when none does (Radarr).
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
 * `settleAbsentJob` the same way.
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

  // One entry per download: the first row seen speaks for its pack.
  const sized = new Map<string, PollableQueueItem>()
  const unkeyed: PollableQueueItem[] = []
  for (const item of items) {
    if (item.downloadId == null) {
      unkeyed.push(item)
    } else if (!sized.has(item.downloadId)) {
      sized.set(item.downloadId, item)
    }
  }
  const distinct = [...sized.values(), ...unkeyed]

  const errorMessage = items.find(item => item.errorMessage)?.errorMessage
  const reportsEpisodeFile = items.some(item => item.episodeHasFile != null)

  return {
    ...(unkeyed.length === 0 ? { downloadIds: [...sized.keys()] } : {}),
    episodeHasFile: reportsEpisodeFile
      ? items.every(item => item.episodeHasFile === true)
      : undefined,
    errorMessage: errorMessage ?? undefined,
    estimatedCompletionTime: slowest.estimatedCompletionTime,
    size: distinct.reduce((total, item) => total + (item.size ?? 0), 0),
    sizeleft: distinct.reduce((total, item) => total + (item.sizeleft ?? 0), 0),
    status: dominant.status,
    statusMessages: statusMessages.length > 0 ? statusMessages : undefined,
    timeleft: slowest.timeleft,
    trackedDownloadState: dominant.trackedDownloadState,
    trackedDownloadStatus: dominant.trackedDownloadStatus,
  }
}

/**
 * The most specific explanation a queue item carries for being in trouble,
 * or `undefined` when it carries none. Sources, first non-empty wins:
 *
 * - `errorMessage`: the download client's own reason.
 * - The `title` of every `statusMessages` entry with no `messages` - how
 *   Radarr/Sonarr record an item-level warning ("No files found are
 *   eligible for import", ...), as opposed to a per-file entry whose title
 *   is just the file name.
 * - Every entry's `messages`, joined - the per-file reasons.
 *
 * Worded by `describeClientFailure`, so a disk-full reason reads that the
 * NAS ran out of space rather than SABnzbd's unpack text.
 */
export function describeQueueItemError(
  item: PollableQueueItem,
): string | undefined {
  const reason = rawQueueItemError(item)
  return reason === undefined ? undefined : describeClientFailure(reason).text
}

// `describeQueueItemError`'s sources, first non-empty wins, unworded.
function rawQueueItemError(item: PollableQueueItem): string | undefined {
  if (item.errorMessage) return item.errorMessage

  const statusMessages = item.statusMessages ?? []

  const titles = statusMessages
    .filter(m => (m.messages ?? []).every(message => !message))
    .map(m => m.title)
    .filter((title): title is string => !!title)

  if (titles.length > 0) return titles.join('; ')

  const messages = statusMessages
    .flatMap(m => m.messages ?? [])
    .filter((m): m is string => !!m)

  return messages.length > 0 ? messages.join('; ') : undefined
}

/**
 * Maps a job's current status plus its queue entry to the next
 * `DownloadJobStatus`, per the
 * `Requested -> Searching -> Downloading -> Importing/NeedsAttention ->
 * Completed/Failed` lifecycle. The entry is required: a job with **no**
 * entry is `settleAbsentJob`'s question, because the queue alone can't tell
 * a finished import from a download that vanished.
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
 *   it drops out of the queue entirely (see `settleAbsentJob`).
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
 *
 * This is the queue-era reading, where the queue alone decides a failure.
 * The job poller uses `deriveQueueItemState` instead, where history decides
 * outcomes and the queue only reports progress; the media page and adoption
 * still classify with this one, and `aggregateQueueItems` ranks with it
 * because it needs no clock.
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
 * How long a queue item must hold a troubled-but-maybe-transient state before
 * it is put in front of a person as NeedsAttention: an `importPending` import
 * carrying a warning, a client warning with its own `errorMessage`, or a
 * failed item whose history `failed` event never came. Radarr/Sonarr retry an
 * import on their own every minute, and SABnzbd reports a warning while it
 * repairs or unpacks, so a shorter wait would flash the status on work that
 * sorts itself out.
 */
export const ATTENTION_DELAY_MS = 120_000

/** How Radarr/Sonarr are named in text a person reads. */
const APP_NAMES = {
  radarr: 'Radarr',
  sonarr: 'Sonarr',
} as const satisfies Record<QueueSource, string>

/** What one queue item says about its job, for `deriveQueueItemState`. */
export interface QueueItemState {
  status: DownloadJobStatus
  /**
   * The reason a NeedsAttention status carries, when the item gave one. Set
   * with NeedsAttention only.
   */
  errorMessage?: string
  /**
   * A short note on a non-error status, e.g. "Delayed by Radarr until
   * 14:05" on a job Radarr is holding under a delay profile.
   */
  statusNote?: string
}

/** The inputs `deriveQueueItemState` needs besides the job and its item. */
export interface QueueItemStateContext {
  /** Which app the item came from, for the text of a note. */
  app: QueueSource
  /** The poll's clock, epoch ms. */
  now: number
  /**
   * Epoch ms when the item first showed its current tracked state/status.
   * Absent reads as "just started": nothing time-gated escalates.
   */
  stateSince?: number
}

// Queue statuses meaning Radarr/Sonarr is holding the release rather than
// downloading it: a delay profile, or the download client unreachable at
// grab time. Nothing is on the wire yet, so the job is still searching.
const HELD_QUEUE_STATUSES = new Set(['delay', 'downloadClientUnavailable'])

// Statuses a failed queue item may keep while history decides its outcome.
const HOLDABLE_STATUSES = new Set<DownloadJobStatus>([
  DownloadJobStatus.Downloading,
  DownloadJobStatus.Importing,
  DownloadJobStatus.NeedsAttention,
  DownloadJobStatus.Paused,
])

/**
 * Maps a job's current status plus one (possibly aggregated) queue item to
 * where the job stands, for the history-era poller. The
 * queue reports progress and import trouble here; whether a download
 * finished, failed or was removed comes from Radarr's/Sonarr's history.
 *
 * In order:
 * - Failed at the client - `status: 'failed'`, `trackedDownloadState:
 *   'failedPending'`/`'failed'` or `trackedDownloadStatus: 'error'`: not
 *   Failed. The history `failed` event decides that, and whether a retry
 *   follows. Until it arrives the job keeps its grabbed status (Downloading,
 *   Importing, NeedsAttention or Paused; Downloading from anything else). If
 *   the item is still failed after `ATTENTION_DELAY_MS` - failed-download
 *   handling is off, so no event is coming - NeedsAttention with the
 *   client's reason, since only a person can move it now.
 * - `delay` / `downloadClientUnavailable` queue status: Searching, noted
 *   "Delayed by <App> until HH:MM" (local time of `estimatedCompletionTime`),
 *   or "Delayed by <App>" when there is no time.
 * - `trackedDownloadState: 'importBlocked'`: NeedsAttention at once.
 *   Radarr/Sonarr has decided it cannot import on its own.
 * - `trackedDownloadState: 'importPending'`, or a `status: 'completed'`
 *   item: Importing - Radarr/Sonarr retries a pending import by itself. With
 *   a warning that has persisted `ATTENTION_DELAY_MS`: NeedsAttention.
 * - `trackedDownloadState: 'importing'`/`'imported'`: Importing.
 * - A warning (`status` or `trackedDownloadStatus`) with a non-empty
 *   `errorMessage` that has persisted `ATTENTION_DELAY_MS`: NeedsAttention
 *   with that message - SABnzbd's "unpacking failed" or "disk full", the
 *   latter worded by `describeClientFailure`. Before then it reads as the
 *   rules below.
 * - `status: 'paused'`: Paused.
 * - Anything else: Downloading.
 */
export function deriveQueueItemState(
  current: DownloadJobStatus,
  item: PollableQueueItem,
  context: QueueItemStateContext,
): QueueItemState {
  const persisted =
    context.stateSince != null &&
    context.now - context.stateSince >= ATTENTION_DELAY_MS
  const needsAttention = (): QueueItemState => ({
    errorMessage: describeQueueItemError(item),
    status: DownloadJobStatus.NeedsAttention,
  })

  if (isFailedAtClient(item)) {
    if (persisted) return needsAttention()
    return {
      status: HOLDABLE_STATUSES.has(current)
        ? current
        : DownloadJobStatus.Downloading,
    }
  }

  if (item.status != null && HELD_QUEUE_STATUSES.has(item.status)) {
    return {
      status: DownloadJobStatus.Searching,
      statusNote: delayNote(context.app, item.estimatedCompletionTime),
    }
  }

  if (item.trackedDownloadState === 'importBlocked') return needsAttention()

  const warned =
    item.status === 'warning' || item.trackedDownloadStatus === 'warning'

  if (
    item.trackedDownloadState === 'importPending' ||
    item.status === 'completed'
  ) {
    return warned && persisted
      ? needsAttention()
      : { status: DownloadJobStatus.Importing }
  }

  if (
    item.trackedDownloadState === 'importing' ||
    item.trackedDownloadState === 'imported'
  ) {
    return { status: DownloadJobStatus.Importing }
  }

  const clientError = item.errorMessage?.trim()
  if (warned && clientError && persisted) {
    return {
      errorMessage: describeClientFailure(clientError).text,
      status: DownloadJobStatus.NeedsAttention,
    }
  }

  if (item.status === 'paused') return { status: DownloadJobStatus.Paused }

  return { status: DownloadJobStatus.Downloading }
}

// "Delayed by Radarr until 14:05", or without the time when there is none.
function delayNote(
  app: QueueSource,
  estimatedCompletionTime: string | null | undefined,
): string {
  const name = APP_NAMES[app]
  const until =
    estimatedCompletionTime != null ? new Date(estimatedCompletionTime) : null

  if (until == null || Number.isNaN(until.getTime())) {
    return `Delayed by ${name}`
  }

  const hh = String(until.getHours()).padStart(2, '0')
  const mm = String(until.getMinutes()).padStart(2, '0')
  return `Delayed by ${name} until ${hh}:${mm}`
}

// A download the client itself failed. What history decides the outcome of,
// never the queue.
function isFailedAtClient(item: PollableQueueItem): boolean {
  return (
    item.status === 'failed' ||
    item.trackedDownloadState === 'failedPending' ||
    item.trackedDownloadState === 'failed' ||
    item.trackedDownloadStatus === 'error'
  )
}

/**
 * How long a queue item may read the same - its `sizeleft` and its tracked
 * state unchanged - before `isQueueItemMoving` stops counting it. Long enough
 * to ride out a SABnzbd repair or unpack, which holds `sizeleft` still for a
 * while; short enough that an item nobody will clear stops costing a
 * refresh within a minute.
 */
export const STALL_MS = 60_000

/**
 * Whether one queue item is worth asking Radarr/Sonarr to refresh their queue
 * for (plan 024 · 3·F1). A refresh makes them re-read SABnzbd and retry every
 * pending import - a folder scan and an ffprobe per file - so it is spent
 * only on an item a person could see move:
 *
 * - an import running now (`trackedDownloadState: 'importing'`), however
 *   long it takes;
 * - anything else that reads as Downloading or Importing and changed within
 *   `STALL_MS` of `now` - `changedAt` is when its `sizeleft` or tracked state
 *   last did. A transfer that stalled, or an import Radarr/Sonarr keep
 *   rejecting, stops counting a minute after it last moved.
 *
 * Never an item failed at the client, held by a delay profile, blocked from
 * import or paused: none of those move until a person, history, or
 * Radarr's/Sonarr's own once-a-minute refresh does something.
 */
export function isQueueItemMoving(
  item: PollableQueueItem,
  app: QueueSource,
  changedAt: number,
  now: number,
): boolean {
  if (isFailedAtClient(item)) return false

  const { status } = deriveQueueItemState(DownloadJobStatus.Downloading, item, {
    app,
    now,
    stateSince: changedAt,
  })
  if (
    status !== DownloadJobStatus.Downloading &&
    status !== DownloadJobStatus.Importing
  ) {
    return false
  }

  if (item.trackedDownloadState === 'importing') return true
  return now - changedAt < STALL_MS
}

/**
 * How long a `cancelling` job must stay missing from the queue, with no file
 * and no removal or failure recorded on its links, before the cancel is
 * called done. Wall-clock.
 *
 * The wait exists only for a late grab: a Radarr/Sonarr search command
 * already running when the cancel was pressed can still grab a release
 * afterwards. Indexer requests time out at about 30 s, so a search that has
 * not grabbed by then is very unlikely to. Much below 20 s this would be a
 * couple of poll ticks - the same as `CANCEL_CONFIRM_MS` - and no longer a
 * grace window at all.
 */
export const CANCEL_GRACE_MS = 30_000

/**
 * How long a `cancelling` job whose links say its downloads were removed or
 * failed must stay missing from the queue before the cancel is taken as
 * done: long enough that two separate queue reads agreed, so one read that
 * briefly came back without it can't end the job early.
 */
const CANCEL_CONFIRM_MS = 5_000

/**
 * What a `cancelling` job's download links say became of its downloads,
 * once they have left the queue:
 *
 * - `imported`: an import was recorded, so the file is on its way into the
 *   library listing.
 * - `failed`: the download client failed it, or someone removed it with a
 *   blocklist, with the reason when there is one.
 * - `removed`: taken out of the queue with nothing recorded.
 */
export type DequeuedOutcome =
  | { kind: 'failed'; reason?: string }
  | { kind: 'imported' }
  | { kind: 'removed' }

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

// `settleAbsentJob`'s answer for a `cancelling` job: Completed if a file
// landed anyway - the cancel came too late. Otherwise Cancelled once
// `CANCEL_CONFIRM_MS` has passed if `outcome` says the download was removed
// or failed, or once `CANCEL_GRACE_MS` has passed with any other outcome or
// none (never grabbed, an import on its way, or nothing recorded), since a
// search still running at the press may yet grab a release.
function settleCancelling(
  fileLanded: boolean,
  absentForMs: number,
  outcome: DequeuedOutcome | undefined,
): DownloadJobStatus | undefined {
  if (fileLanded) return DownloadJobStatus.Completed

  const confirmed =
    outcome != null &&
    outcome.kind !== 'imported' &&
    absentForMs >= CANCEL_CONFIRM_MS

  return confirmed || absentForMs >= CANCEL_GRACE_MS
    ? DownloadJobStatus.Cancelled
    : undefined
}

/**
 * How long a job with a live download link must be missing from the queue,
 * with the download client healthy the whole time and no history outcome,
 * before it is taken as removed at the client. Long, because the queue drops
 * items for reasons that are not removals - a SABnzbd blip, a Radarr/Sonarr
 * restart, SABnzbd's history rolling past its last 60 items - and a removal
 * made in Radarr/Sonarr itself writes no history to go on.
 */
export const ABSENT_REMOVED_MS = 600_000

/** Why a job was cancelled when its download vanished from the client. */
export const REMOVED_FROM_CLIENT_ERROR = 'Removed from the download client'

/**
 * One download a job grabbed, as persisted in `job_downloads`: the
 * download client's id, and when history recorded its import or failure.
 */
export interface JobDownloadLink {
  downloadId: string
  failedAt?: string | null
  importedAt?: string | null
}

/** What `settleAbsentJob` knows about a job with no queue item this tick. */
export interface AbsentJobFacts {
  /** How long the job has had no queue item, wall-clock ms. */
  absentForMs: number
  /** How long the download client has been continuously healthy, ms. */
  clientHealthyForMs: number
  /** Whether a file for the job's scope landed after it was created. */
  fileLanded: boolean
  /** Every download the job grabbed. */
  links: readonly JobDownloadLink[]
}

const linkResolved = (link: JobDownloadLink) =>
  link.importedAt != null || link.failedAt != null

/**
 * Where a movie/show job goes when no queue item matches it this tick, or
 * `undefined` to leave it where it is. An empty queue proves nothing by
 * itself, so the answer comes from the library (`fileLanded`) and from the
 * job's persisted download links, which history fills in.
 *
 * - Cancelling: `settleCancelling`, reading the links as its outcome - every
 *   link resolved with an import as `imported`, with only failures as
 *   `failed`, anything else as no outcome.
 * - Terminal, or a video-only status a movie/show job never holds:
 *   unchanged.
 * - A file landed: Completed.
 * - No link: unchanged. A requested or searching job has nothing to lose
 *   from the queue, so absence never settles it.
 * - Every link imported or failed, at least one imported: Completed.
 * - Every link failed: unchanged. Whether that ends the job or a retry
 *   follows is the poller's call, made on the history `failed` event.
 * - A link still open, absent `ABSENT_REMOVED_MS` or longer, and the client
 *   healthy for all of that time: the open downloads were removed at the
 *   client. Completed if another link already imported (what the job got
 *   has landed, and nothing more is coming), otherwise Cancelled with
 *   `REMOVED_FROM_CLIENT_ERROR`. A client outage during the absence resets
 *   the clock - SABnzbd unreachable for 20 minutes settles nothing - which
 *   is why the caller counts `absentForMs` only from when the client was
 *   last seen healthy.
 * - Otherwise unchanged.
 */
export function settleAbsentJob(
  current: DownloadJobStatus,
  facts: AbsentJobFacts,
): DownloadJobStatus | undefined {
  const { absentForMs, clientHealthyForMs, fileLanded, links } = facts

  if (current === DownloadJobStatus.Cancelling) {
    return settleCancelling(fileLanded, absentForMs, linkOutcome(links))
  }

  if (!GRABBED_STATUSES.has(current) && !WAITING_STATUSES.has(current)) {
    return undefined
  }

  if (fileLanded) return DownloadJobStatus.Completed

  if (links.length === 0) return undefined

  const imported = links.some(link => link.importedAt != null)

  if (links.every(linkResolved)) {
    return imported ? DownloadJobStatus.Completed : undefined
  }

  const removedAtClient =
    absentForMs >= ABSENT_REMOVED_MS && clientHealthyForMs >= absentForMs

  if (!removedAtClient) return undefined

  return imported ? DownloadJobStatus.Completed : DownloadJobStatus.Cancelled
}

// The links read as the outcome `settleCancelling` expects.
function linkOutcome(
  links: readonly JobDownloadLink[],
): DequeuedOutcome | undefined {
  if (links.length === 0 || !links.every(linkResolved)) return undefined

  return links.some(link => link.importedAt != null)
    ? { kind: 'imported' }
    : { kind: 'failed' }
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
