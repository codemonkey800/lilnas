import type { DownloadJob } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'

import { isInProgress, statusTone } from 'src/lib/format'

/**
 * One row of the feed, and whether it is on its way off it.
 *
 * `departing` is the whole answer to "a job that reaches a terminal status must
 * *leave*, and it has to read as a departure rather than as a glitch": the row
 * stays mounted for one beat wearing its final status — `completed`, `failed`,
 * `cancelled` — and only then is evicted. A row that simply vanished the
 * instant a frame arrived would look like a rendering bug, and would never tell
 * anyone *why* it went.
 */
export type ActivityRow = {
  departing: boolean
  job: DownloadJob
}

export type BuildActivityRowsOptions = {
  /**
   * Terminal jobs whose departure has already played out. Applied to terminal
   * jobs only, so an id in here can never suppress a job that is still working.
   */
  evicted: ReadonlySet<string>
  /** The live map from `useJobEvents()`, keyed by `job.id`. */
  live: ReadonlyMap<string, DownloadJob>
  /** The server-rendered first page, plus anything `LoadMore` appended. */
  pages: readonly DownloadJob[]
  /** The URL's type filter. Empty means every type. */
  types: readonly DownloadType[]
}

/**
 * Descending `(createdAt, id)` — the exact ordering `listJobsPage` gives the
 * paginated feed (`db.select()…orderBy(desc(jobs.createdAt), desc(jobs.id))`).
 *
 * Re-deriving it here rather than trusting the server's array order is what
 * lets a job *created* while the page is open land in its right place instead
 * of being stapled to one end: the gateway broadcasts it with no notion of
 * where the list currently sits, and the only shared truth between the two
 * sides is the sort key itself.
 *
 * An unparseable `createdAt` sorts as epoch 0 — last — rather than poisoning
 * every comparison it takes part in with `NaN`, which would leave `sort()`
 * free to produce any order at all.
 */
function compareRows(a: ActivityRow, b: ActivityRow): number {
  const byCreatedAt = createdAtMs(b.job) - createdAtMs(a.job)

  return byCreatedAt !== 0 ? byCreatedAt : compareIdsDescending(a.job, b.job)
}

function createdAtMs(job: DownloadJob): number {
  const parsed = Date.parse(job.createdAt)

  return Number.isNaN(parsed) ? 0 : parsed
}

function compareIdsDescending(a: DownloadJob, b: DownloadJob): number {
  return b.id.localeCompare(a.id)
}

/**
 * Reconciles the server-rendered pages with the live gateway feed into the rows
 * `/activity` actually shows.
 *
 * ## How the two sources meet
 *
 * They are keyed by the same `job.id`, and **live always wins**: a
 * `DownloadJobEvent.job` is documented as a full current snapshot, so a live
 * entry is by construction at least as fresh as the page that was rendered
 * before the socket opened. Jobs the live feed knows about and the pages do not
 * are genuinely new — created while the page was open — and join the list at
 * whatever position their `createdAt` earns them.
 *
 * ## How a job leaves
 *
 * The hook upserts and never evicts, so eviction is this function's job.
 * `isInProgress` decides it, and it is the *complement* of
 * `TERMINAL_DOWNLOAD_JOB_STATUSES` rather than a list written out here — which
 * is exactly why `paused` and `pausing` stay on the feed. They are not
 * terminal; a paused download is still an open piece of work, and dropping it
 * would tell the user their download is gone at the one moment they most need
 * to see that it isn't.
 *
 * A terminal job is not dropped on sight. It is returned once more with
 * `departing: true`, and the caller evicts it (by adding its id to `evicted`)
 * once the departure has been shown.
 *
 * ## What the filter applies to
 *
 * The type filter is applied to live jobs too, not just to the fetched pages.
 * Without that, `/activity?type=movie` would start accumulating videos the
 * moment anyone else started one — the server honoured the filter and the
 * socket, which broadcasts everything, would quietly undo it.
 */
export function buildActivityRows({
  evicted,
  live,
  pages,
  types,
}: BuildActivityRowsOptions): ActivityRow[] {
  const byId = new Map<string, DownloadJob>()

  for (const job of pages) {
    byId.set(job.id, job)
  }

  for (const [id, job] of live) {
    byId.set(id, job)
  }

  const rows: ActivityRow[] = []

  for (const job of byId.values()) {
    if (types.length > 0 && !types.includes(job.media.type)) {
      continue
    }

    const open = isInProgress(job.status)

    if (!open && evicted.has(job.id)) {
      continue
    }

    rows.push({ departing: !open, job })
  }

  return rows.sort(compareRows)
}

/**
 * Whether the machine is actively moving this job along right now — the rows
 * that wear the breathing `live` dot in `downloads-activity.pug`.
 *
 * Derived from `statusTone`'s own grouping rather than from a second list of
 * statuses: `uv` is defined there as "the machine is working on it"
 * (`searching`, `downloading`, `converting`, `uploading`, `importing`,
 * `cleaning`), while `mute` is inert, `warn` is a user intervention and `ok`/
 * `bad` are terminal. A new status therefore picks up the right dot from the
 * one place tones are decided, instead of silently defaulting to "still".
 */
export function isMoving(job: DownloadJob): boolean {
  return statusTone(job.status) === 'uv'
}

/**
 * The job's progress as a whole-number percentage, or `null` when there is
 * none to show.
 *
 * The figure comes from one of two places, depending on who is doing the
 * downloading:
 *
 * - **Movies and shows** — the *media's* `ManagedMediaBase.queueSnapshot`,
 *   which the Radarr/Sonarr queue poller maintains.
 * - **Videos** — the *job's* own `progress`, yt-dlp's snapshot of the current
 *   file. It exists only while the yt-dlp process lives (and is kept while
 *   paused), and its `percent` is absent whenever yt-dlp does not know the
 *   total — in both cases the cell renders the em dash the rest of the app uses
 *   for "unknown" rather than an invented figure.
 *
 * ⚠️ Only an in-progress job has one. For movies and shows the snapshot lives
 * on the *media*, not the job, so every job for the same title carries the
 * same live figure — without this guard a finished or failed attempt in a
 * history table would wear (and keep updating with) the percentage of
 * whichever attempt is downloading now. A video's snapshot is its own, but a
 * terminal job has no business showing one either.
 */
export function jobProgressPct(job: DownloadJob): number | null {
  if (!isInProgress(job.status)) {
    return null
  }

  const progress =
    job.media.type === DownloadType.Video
      ? job.progress?.percent
      : job.media.queueSnapshot?.progress

  return progress === undefined || !Number.isFinite(progress)
    ? null
    : Math.round(progress)
}

/**
 * The status chip's label on a **stacked** (mobile) row, where there is no
 * separate progress column for the percentage to live in.
 *
 * Follows `downloads-activity.mjs`'s `mobileState`: a moving row is already
 * saying "working" with its live dot, so the percentage is the more useful half
 * and stands alone; a stalled row that still has progress needs both, because
 * `18%` on its own would read as moving.
 */
export function mobileStatusLabel(job: DownloadJob): string {
  const pct = jobProgressPct(job)

  if (pct === null) {
    return job.status
  }

  return isMoving(job) ? `${pct}%` : `${job.status} · ${pct}%`
}
