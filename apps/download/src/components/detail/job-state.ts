import type { DownloadJob } from '@lilnas/utils/download/types'
import { DownloadJobStatus, isManagedMedia } from '@lilnas/utils/download/types'

import { isInProgress } from 'src/lib/format'

/**
 * The lifecycle logic `JobLifecycle` renders, kept in a module of its own
 * rather than beside the component.
 *
 * `job-lifecycle.tsx` is `'use client'`, and every export of a `'use client'`
 * module reaches a server component as an opaque client *reference* - calling
 * one from a server page throws. A detail page legitimately needs some of this
 * on the server (deciding whether to render a Delete control at all, say), so
 * the pure half lives here, where both sides of the boundary can call it.
 */

/**
 * The seven things a detail page can offer to do to a job. `watch` and `save`
 * are navigations rather than mutations - see `JobLifecycleLink` - but they
 * are part of the same state table, because "which of these does this status
 * offer" is one question and answering it in two places is how the three
 * detail pages would drift apart.
 */
export type JobActionKey =
  | 'cancel'
  | 'import'
  | 'pause'
  | 'resume'
  | 'retry'
  | 'save'
  | 'watch'

/**
 * - `offered` - render the control live.
 * - `acknowledged` - the action already fired and the backend has said so by
 *   moving the job into `pausing`/`cancelling`. The control stays on screen,
 *   inert, rather than vanishing or inviting a second press.
 * - `none` - this status does not offer this action; render nothing.
 */
export type JobActionAvailability = 'acknowledged' | 'none' | 'offered'

/**
 * Whether a status offers an action, and in what form.
 *
 * Derived rather than hand-listed wherever it can be. `cancel` and `retry`
 * both key off `isInProgress`, which `@lilnas/utils` computes as the
 * complement of `TERMINAL_DOWNLOAD_JOB_STATUSES` - so a status added to the
 * enum lands on the correct side of both without an edit here.
 *
 * The five statuses named explicitly are named because they are genuinely
 * specific, not because the set was enumerated:
 *
 * - `Downloading` is the *only* status a pause is legal in; the API answers
 *   409 for a pause on anything else, so offering the button anywhere else
 *   would be offering an error.
 * - `Pausing` and `Cancelling` are acknowledgements of a request already in
 *   flight.
 * - `Completed` is the only status with a file to watch or save.
 * - `NeedsAttention` is the only status with a decision outstanding, so it is
 *   the only one an import can resolve - anywhere else there is either
 *   nothing on disk to import or nobody waiting on a choice.
 */
export function jobActionState(
  status: DownloadJobStatus,
  action: JobActionKey,
): JobActionAvailability {
  switch (action) {
    case 'cancel':
      if (!isInProgress(status)) {
        return 'none'
      }

      return status === DownloadJobStatus.Cancelling
        ? 'acknowledged'
        : 'offered'

    case 'import':
      return status === DownloadJobStatus.NeedsAttention ? 'offered' : 'none'

    case 'pause':
      if (status === DownloadJobStatus.Pausing) {
        return 'acknowledged'
      }

      return status === DownloadJobStatus.Downloading ? 'offered' : 'none'

    case 'resume':
      return status === DownloadJobStatus.Paused ? 'offered' : 'none'

    case 'retry':
      // Everything terminal except success: a failed job and a cancelled one
      // are both "this did not produce a file, ask again".
      return !isInProgress(status) && status !== DownloadJobStatus.Completed
        ? 'offered'
        : 'none'

    case 'save':
    case 'watch':
      return status === DownloadJobStatus.Completed ? 'offered' : 'none'
  }
}

/**
 * What a status chip reads. A `Record<DownloadJobStatus, string>` rather than
 * a `switch` with a fallback, for the same reason `STATUS_TONES` is one: a new
 * enum member should fail type-check here rather than render its raw wire
 * value at a user.
 *
 * Mostly the enum's own word, which is already the plain-English one. The two
 * acknowledgement states carry an ellipsis because they describe a request in
 * flight rather than a resting state, and `pending` reads `queued` because
 * that is what the mockups call the wait for a slot and what it means to
 * somebody who did not write the queue. `needs_attention` reads `needs your
 * decision` for the same reason: the wire word names the condition, the chip
 * has to name what the reader is supposed to do about it.
 */
const JOB_STATUS_LABELS: Record<DownloadJobStatus, string> = {
  [DownloadJobStatus.Cancelled]: 'cancelled',
  [DownloadJobStatus.Cancelling]: 'cancelling…',
  [DownloadJobStatus.Cleaning]: 'cleaning up',
  [DownloadJobStatus.Completed]: 'completed',
  [DownloadJobStatus.Converting]: 'converting',
  [DownloadJobStatus.Downloading]: 'downloading',
  [DownloadJobStatus.Failed]: 'failed',
  [DownloadJobStatus.Importing]: 'importing',
  [DownloadJobStatus.NeedsAttention]: 'needs your decision',
  [DownloadJobStatus.Paused]: 'paused',
  [DownloadJobStatus.Pausing]: 'pausing…',
  [DownloadJobStatus.Pending]: 'queued',
  [DownloadJobStatus.Requested]: 'requested',
  [DownloadJobStatus.Searching]: 'searching',
  [DownloadJobStatus.Uploading]: 'uploading',
}

/** The chip text for a job status. See {@link JOB_STATUS_LABELS}. */
export function jobStatusLabel(status: DownloadJobStatus): string {
  return JOB_STATUS_LABELS[status]
}

/** What the lifecycle panel reads when a title has never been downloaded. */
export const JOB_LIFECYCLE_EMPTY_LABEL = 'not downloaded'

/**
 * The job a detail page is *about*.
 *
 * `MediaDetailResponse.jobs` is every job ever run for a media key, newest
 * first; the panel renders the newest and `JobHistory` renders the rest. This
 * is exported so a page needing the same job for its own reasons picks it the
 * same way rather than reaching for `jobs[0]` and quietly disagreeing the day
 * the ordering is revisited.
 *
 * `null` for an empty list - a movie sitting in the library that this app
 * never fetched is a real state on the movie page, not a bug.
 */
export function latestJob(jobs: readonly DownloadJob[]): DownloadJob | null {
  return jobs[0] ?? null
}

/**
 * `latestJob`, discounted against whether the file it claims to have
 * produced is actually still there.
 *
 * A delete removes the title from Radarr/Sonarr and the file on disk, but
 * `ShowService.deleteFiles` deliberately leaves a terminal `DownloadJob` row
 * untouched - it is kept as history, not as a live claim. So a `Completed`
 * job whose title has no file any more is stale: `null` reads exactly like
 * "no current job", which is the state a re-deleted title should present as.
 * Any other status - including `Failed` and `Cancelled` - is trusted as-is,
 * because those never claimed a file existed in the first place.
 *
 * `hasFile` is optional because not every caller has the concept: a video job
 * has no library-backed file signal to reconcile against (see
 * `VideoSchema`), so passing nothing here keeps `latestJob`'s original,
 * unconditional behaviour.
 */
export function currentJob(
  jobs: readonly DownloadJob[],
  hasFile?: boolean,
): DownloadJob | null {
  const job = latestJob(jobs)
  return job?.status === DownloadJobStatus.Completed && hasFile === false
    ? null
    : job
}

/** What {@link mergeLiveMediaJobs} hands a movie or show page. */
export type LiveMediaJobs = {
  /** The server's list with every live frame folded in, in the server's order. */
  jobs: DownloadJob[]
  /**
   * Ids a live frame says `completed` that the server render does not. Only a
   * fresh server render can catch the page up once one lands, because the file,
   * the Emby link and the current release all arrive on the *media*, not on
   * the job frame.
   */
  landed: string[]
}

/**
 * The server's job list for a movie or show with every live frame folded in.
 *
 * Replacement in place, keyed by `job.id`, live copy winning, for the same
 * reasons as `mergeVideoJobs`: no re-sort, no insertion, no eviction.
 *
 * ⚠️ One difference, and it is why this is not `mergeVideoJobs`. A job that
 * turned `completed` live is held at `importing` until the page re-renders.
 * The media prop still predates the import, so it says there is no file, and
 * `currentJob` reads "completed with no file" as a deleted title. Passed
 * through as-is, the page would flash "not downloaded" and a Download button
 * for as long as the refresh takes. `importing` is also simply true: Radarr
 * or Sonarr has the file and this page has not been told where it landed yet.
 */
export function mergeLiveMediaJobs(
  jobs: readonly DownloadJob[],
  live: ReadonlyMap<string, DownloadJob>,
): LiveMediaJobs {
  const landed: string[] = []

  const merged = jobs.map(job => {
    const next = live.get(job.id)

    if (!next) {
      return job
    }

    if (
      next.status === DownloadJobStatus.Completed &&
      job.status !== DownloadJobStatus.Completed
    ) {
      landed.push(job.id)
      return { ...next, status: DownloadJobStatus.Importing }
    }

    return next
  })

  return { jobs: merged, landed }
}

/** Everything a progress block draws, or `null` when there is nothing to draw. */
export type JobProgress = {
  /**
   * Radarr's/Sonarr's own queue status word (`downloading`, `warning`,
   * `delay`…), passed through verbatim. `null` when the queue did not report
   * one.
   */
  note: string | null
  /** 0-100, already rounded upstream to two decimals. */
  pct: number
  /** Upstream's `hh:mm:ss` estimate, verbatim. `null` when it has none. */
  timeLeft: string | null
}

/**
 * The progress a job can actually prove, which is less than the mockups draw.
 *
 * ⚠️ The only progress the wire carries is `ManagedMediaBase.queueSnapshot` -
 * a Radarr/Sonarr queue entry, so **movies and shows only**. A video job has
 * no progress field anywhere in `DownloadJob`, and no byte counter, transfer
 * rate or fragment counter exists for any type. `video-detail.pug`'s
 * `fragment 4 of 9` / `412 MB / 640 MB · 3.1 MB/s` line is mockup data with
 * nothing behind it; where a mockup and the API disagree about content, the
 * API wins.
 *
 * `null` means "draw no bar at all", which is the honest rendering of an
 * unknown percentage - a `0%` bar is a claim.
 */
export function jobProgress(job: DownloadJob): JobProgress | null {
  if (!isManagedMedia(job.media)) {
    return null
  }

  const snapshot = job.media.queueSnapshot
  const pct = snapshot?.progress

  if (pct === undefined || !Number.isFinite(pct)) {
    return null
  }

  return {
    note: snapshot?.status ?? null,
    pct,
    timeLeft: snapshot?.timeLeft ?? null,
  }
}
