/**
 * What a cancel does to the queue rows it found for a job. Pure: the caller
 * reads the queue and sends the DELETEs.
 *
 * Sonarr's queue has one row per episode, and a season pack is N rows that
 * share one `downloadId`. Deleting any one of them makes Sonarr drop the
 * whole tracked download from the client (`QueueController.cs`), so rows are
 * handled one download at a time:
 *
 * - A download whose rows also carry an episode outside the job's scope is
 *   **kept**: removing it would cancel episodes nobody asked to stop. The
 *   job settles cancelled with `KEPT_PACK_NOTE` instead.
 * - Any other download is removed with **one** DELETE, named by one of its
 *   rows - never one per row, which would only 404 after the first.
 *
 * A row with no `downloadId` is a download of its own (Sonarr has not handed
 * it to the client yet), removed by its own id.
 */
import type { PollableQueueItem } from './queue-status.util'

/**
 * The note a job cancelled out of a season pack carries: its episodes stay
 * in a download that is still running, so the file may still land.
 */
export const KEPT_PACK_NOTE =
  'Part of a season download that is still running — this episode may still import'

/** A queue row that can be named to Radarr/Sonarr. */
export type RemovableQueueItem = PollableQueueItem & { id: number }

export interface QueueCancelPlan {
  /** The downloads left running because they reach outside the scope. */
  kept: string[]
  /** One row per download to remove - its `id` is what the DELETE names. */
  remove: RemovableQueueItem[]
  /** One row per download to remove that has no row id to name it by. */
  unnamed: PollableQueueItem[]
}

/**
 * Plans the cancel of `targets` - the rows that belong to the job - against
 * the whole `queue` they were read from. `inScope` says whether a row is the
 * job's own; left out (a movie), no download is ever kept.
 */
export function planQueueCancel(
  targets: readonly PollableQueueItem[],
  queue: readonly PollableQueueItem[],
  inScope?: (item: PollableQueueItem) => boolean,
): QueueCancelPlan {
  const groups = new Map<string, PollableQueueItem[]>()

  targets.forEach((item, index) => {
    const key =
      item.downloadId != null
        ? `download:${item.downloadId}`
        : `queue:${item.id ?? `index:${index}`}`
    const group = groups.get(key)
    if (group) {
      group.push(item)
    } else {
      groups.set(key, [item])
    }
  })

  const plan: QueueCancelPlan = { kept: [], remove: [], unnamed: [] }

  for (const rows of groups.values()) {
    const [first] = rows
    if (!first) continue

    const { downloadId } = first
    if (
      downloadId != null &&
      inScope &&
      queue.some(row => row.downloadId === downloadId && !inScope(row))
    ) {
      plan.kept.push(downloadId)
      continue
    }

    const named = rows.find((row): row is RemovableQueueItem => row.id != null)
    if (named) {
      plan.remove.push(named)
    } else {
      plan.unnamed.push(first)
    }
  }

  return plan
}
