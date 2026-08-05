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
  estimatedCompletionTime?: string | null
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
 * - Anything else (queued, downloading, paused, warning, delay, ...):
 *   Downloading.
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

  return DownloadJobStatus.Downloading
}
