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
 * The six things a detail page can offer to do to a job. `watch` and `save`
 * are navigations rather than mutations - see `JobLifecycleLink` - but they
 * are part of the same state table, because "which of these does this status
 * offer" is one question and answering it in two places is how the three
 * detail pages would drift apart.
 */
export type JobActionKey =
  | 'cancel'
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
 * The four statuses named explicitly are named because they are genuinely
 * specific, not because the set was enumerated:
 *
 * - `Downloading` is the *only* status a pause is legal in; the API answers
 *   409 for a pause on anything else, so offering the button anywhere else
 *   would be offering an error.
 * - `Pausing` and `Cancelling` are acknowledgements of a request already in
 *   flight.
 * - `Completed` is the only status with a file to watch or save.
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
 * somebody who did not write the queue.
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
