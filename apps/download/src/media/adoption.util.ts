/**
 * Adopting downloads started upstream: a grab made in Radarr's/Sonarr's own
 * UI (or by their RSS sync) has no job here, so nothing on the detail page
 * can cancel it. The poller already reads every queue item each tick; this
 * file decides which of them should become a job. It is pure - the poller
 * reads the queue, the open jobs and the library's file facts, and acts on
 * the answer.
 *
 * The rules:
 * - One candidate per download: queue items are grouped by upstream title
 *   (movieId / seriesId) and `downloadId`, so a season pack Sonarr queues as
 *   one item per episode becomes one job. An item with no `downloadId` is its
 *   own group.
 * - Only live downloads: a group whose aggregate status is terminal (a
 *   `failed` item lingering in the queue) is skipped, or it would mint a job
 *   that settles failed and is re-adopted on the next tick, forever.
 * - Never twice: a group is skipped when an open job of the same title
 *   already covers it (any job for a movie; for a show, one whose scope
 *   matches every item in the group), or when its `downloadId` is linked
 *   to an open job in `job_downloads`.
 * - Never an upgrade: see `isAdoptable`, applied once the file facts are
 *   read.
 * - Back to its own job first: a download linked to a job that ended
 *   cancelled or failed within `REOPEN_WINDOW_MS` - SABnzbd came back, or a
 *   cancel raced a grab - reopens that job rather than minting an `upstream`
 *   one beside it, so it keeps its requester. See `pickReopenableJob`.
 */
import type { ShowScope } from '@lilnas/utils/download/types'
import {
  DownloadJobStatus,
  DownloadType,
  isTerminalDownloadJobStatus,
} from '@lilnas/utils/download/types'

import {
  aggregateQueueItems,
  deriveStatusFromQueueItem,
  matchesScope,
  type PollableQueueItem,
} from './queue-status.util'

/** A download in Radarr's/Sonarr's queue that no job here covers. */
export interface AdoptionCandidate {
  /** Absent for a queue item the download client gave no id. */
  downloadId: string | undefined
  /** Every queue item of this download for one title, in queue order. */
  items: PollableQueueItem[]
  /**
   * Shows only - always `undefined` for a movie. Never carries
   * `episodeNumber`: the queue has no such field, so the caller fills it
   * from the episodes it reads.
   */
  scope: ShowScope | undefined
  /** The status the group derives today; never terminal. */
  status: DownloadJobStatus
  /** The `type` it was planned for - what `isAdoptable` branches on. */
  type: DownloadType.Movie | DownloadType.Show
  /** Radarr's movieId or Sonarr's seriesId. */
  upstreamId: number
}

/**
 * How long after a job ended cancelled or failed a download it was linked
 * to can still come back to it. Past this the job is history and the
 * download is adopted like any other.
 */
export const REOPEN_WINDOW_MS = 3_600_000

/** The ended statuses a download coming back can reopen. */
const REOPENABLE_STATUSES: ReadonlySet<DownloadJobStatus> = new Set([
  DownloadJobStatus.Cancelled,
  DownloadJobStatus.Failed,
])

/** What `pickReopenableJob` reads off a job. */
export interface ReopenableJob {
  createdAt: string
  status: DownloadJobStatus
  /** When the job last changed - for an ended job, when it settled. */
  updatedAt: string
}

/**
 * Of the jobs a download that is back in the queue was linked to, the one
 * it goes back to: the newest (by `createdAt`) that ended cancelled or
 * failed at most `REOPEN_WINDOW_MS` before `now` (epoch ms). `undefined`
 * when none did - a completed job is never reopened, nor one that ended
 * longer ago.
 *
 * A job's settle time is its `updatedAt`: `completedAt` is stamped for a
 * completed job only, and the job pipeline writes nothing more to a job
 * once it has ended.
 */
export function pickReopenableJob<T extends ReopenableJob>(
  jobs: readonly T[],
  now: number,
): T | undefined {
  let newest: T | undefined

  for (const job of jobs) {
    if (!REOPENABLE_STATUSES.has(job.status)) continue

    const settledAt = Date.parse(job.updatedAt)
    if (Number.isNaN(settledAt) || now - settledAt > REOPEN_WINDOW_MS) {
      continue
    }

    if (!newest || Date.parse(job.createdAt) > Date.parse(newest.createdAt)) {
      newest = job
    }
  }

  return newest
}

/** An open (non-terminal) job, with the upstream id it resolved to. */
export interface AdoptionOpenJob {
  scope?: ShowScope
  upstreamId: number
}

/**
 * The queue items no open job covers, grouped one candidate per download,
 * in the order each group first appears in the queue.
 *
 * `openJobs` are the non-terminal jobs of `type`; `claimedDownloadIds` is
 * every `downloadId` linked to one of them in `job_downloads`. An item with no
 * movieId/seriesId (Radarr/Sonarr could not match the release to a title)
 * is ignored - there is nothing to attach a job to.
 */
export function planAdoptions(
  type: DownloadType.Movie | DownloadType.Show,
  queue: readonly PollableQueueItem[],
  openJobs: readonly AdoptionOpenJob[],
  claimedDownloadIds: ReadonlySet<string>,
): AdoptionCandidate[] {
  const groups = new Map<
    string,
    {
      downloadId: string | undefined
      items: PollableQueueItem[]
      upstreamId: number
    }
  >()

  queue.forEach((item, index) => {
    const upstreamId =
      type === DownloadType.Movie ? item.movieId : item.seriesId
    if (upstreamId == null) return

    const downloadId = item.downloadId ?? undefined
    // The queue row id stands in for a missing downloadId; the index only
    // for a row with neither, so two such rows never merge.
    const groupKey = downloadId ?? `queue:${item.id ?? `index:${index}`}`
    const key = `${upstreamId}:${groupKey}`

    const group = groups.get(key)
    if (group) {
      group.items.push(item)
    } else {
      groups.set(key, { downloadId, items: [item], upstreamId })
    }
  })

  const candidates: AdoptionCandidate[] = []

  for (const { downloadId, items, upstreamId } of groups.values()) {
    if (downloadId != null && claimedDownloadIds.has(downloadId)) continue

    const owned = openJobs.some(
      job =>
        job.upstreamId === upstreamId &&
        (type === DownloadType.Movie ||
          items.every(item => matchesScope(item, job.scope))),
    )
    if (owned) continue

    const aggregate = aggregateQueueItems(items) as PollableQueueItem
    const status = deriveStatusFromQueueItem(
      DownloadJobStatus.Requested,
      aggregate,
    )
    if (isTerminalDownloadJobStatus(status)) continue

    candidates.push({
      downloadId,
      items,
      scope: type === DownloadType.Show ? scopeOf(items) : undefined,
      status,
      type,
      upstreamId,
    })
  }

  return candidates
}

/**
 * The narrowest scope that covers a show group: one episode, one season,
 * or the whole series (no scope) when its episodes span seasons or none of
 * them can be attributed. Items with no `episodeId` count toward neither,
 * since Sonarr could not say what they are.
 */
function scopeOf(items: readonly PollableQueueItem[]): ShowScope | undefined {
  const episodes = new Map<number, number | null | undefined>()
  for (const item of items) {
    if (item.episodeId != null) episodes.set(item.episodeId, item.seasonNumber)
  }

  const [first] = episodes
  if (!first) return undefined

  // `!= null`, not truthiness - season 0 is Sonarr's specials season.
  if (episodes.size === 1) {
    const [episodeId, seasonNumber] = first
    return seasonNumber != null ? { episodeId, seasonNumber } : { episodeId }
  }

  const seasons = new Set(episodes.values())
  const [seasonNumber] = seasons
  return seasons.size === 1 && seasonNumber != null
    ? { seasonNumber }
    : undefined
}

/**
 * The upgrade filter, applied once the file facts are read: a grab for a
 * title that already has its file is Radarr/Sonarr replacing it, not a new
 * download, and is left alone.
 *
 * - Movie: not adoptable when `hasFile()` says the movie has a file.
 * - Show: not adoptable only when every episode the candidate covers
 *   already has a file - one missing episode makes it a real download.
 *   A candidate with any item Sonarr could not attribute to an episode is
 *   adoptable: nothing proves that item is an upgrade.
 */
export function isAdoptable(
  candidate: AdoptionCandidate,
  hasFile: (episodeId?: number) => boolean,
): boolean {
  if (candidate.type === DownloadType.Movie) return !hasFile()

  const episodeIds: number[] = []
  for (const item of candidate.items) {
    if (item.episodeId == null) return true
    episodeIds.push(item.episodeId)
  }

  return !episodeIds.every(episodeId => hasFile(episodeId))
}
