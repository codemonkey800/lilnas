import type { DownloadQueueSnapshot } from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'

/**
 * Structural subset of Radarr's and Sonarr's (nominally distinct, but
 * field-identical) generated `QueueResource` types - just the fields the
 * poller needs to derive a job status and a snapshot. Using a shared
 * structural type here lets `MediaPollerService` treat both queues the same
 * way instead of duplicating this logic per-client.
 */
export interface PollableQueueItem {
  /**
   * Sonarr-only, like `seasonNumber` below: Radarr's queue has neither, and
   * a movie is one file and one queue item anyway. Both are absent rather
   * than null on a Radarr item - the structural type documents itself as
   * the shared *subset*, so a field only one side has is simply optional.
   */
  episodeId?: number | null
  estimatedCompletionTime?: string | null
  seasonNumber?: number | null
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
const IMPORTING_TRACKED_STATES = new Set([
  'importBlocked',
  'importPending',
  'importing',
])

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
const STATUS_PRECEDENCE: DownloadJobStatus[] = [
  DownloadJobStatus.Failed,
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
 * thing `queue.find()` used to return for "no entry" - so
 * `deriveStatusFromQueueItem`'s existing no-entry branch (and its
 * disappeared-means-completed rule) keeps working untouched.
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
 * Maps a job's current status plus its latest (possibly absent) queue entry
 * to the next `DownloadJobStatus`, per the
 * `Requested -> Searching -> Downloading -> Importing -> Completed/Failed`
 * lifecycle:
 *
 * - No entry: if we'd already seen it downloading/importing, its
 *   disappearance means Radarr/Sonarr finished the import and dropped it
 *   from the queue, so we call it Completed. Otherwise (still
 *   Requested/Searching) we haven't been grabbed yet - stay put.
 * - `status: 'failed'` or `trackedDownloadStatus: 'error'`: Failed.
 * - `trackedDownloadState` in the importing family: Importing.
 * - `trackedDownloadState: 'imported'` or `status: 'completed'`: the file
 *   landed but may still be finishing import bookkeeping - Importing until
 *   it drops out of the queue entirely (see the "no entry" branch above).
 * - `status: 'paused'`: Paused. This is Radarr's/Sonarr's own queue reporting
 *   that the *backing download client* (qBittorrent, SABnzbd, ...) paused the
 *   item - independent of, and unrelated to, this app's video-only
 *   pause/resume (Phase 5). It can be paused from Radarr's/Sonarr's queue UI
 *   or the client's own UI, with no way for this app to have caused it.
 * - Anything else (queued, downloading, warning, delay, ...): Downloading.
 */
export function deriveStatusFromQueueItem(
  currentStatus: DownloadJobStatus,
  item: PollableQueueItem | undefined,
): DownloadJobStatus {
  if (!item) {
    if (
      currentStatus === DownloadJobStatus.Downloading ||
      currentStatus === DownloadJobStatus.Importing
    ) {
      return DownloadJobStatus.Completed
    }

    return currentStatus
  }

  if (item.status === 'failed' || item.trackedDownloadStatus === 'error') {
    return DownloadJobStatus.Failed
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
