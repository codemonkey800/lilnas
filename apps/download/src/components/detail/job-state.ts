import type { DownloadJob, VideoProgress } from '@lilnas/utils/download/types'
import {
  DownloadJobStatus,
  DownloadType,
  isManagedMedia,
} from '@lilnas/utils/download/types'

import {
  formatBytes,
  formatEta,
  formatSpeed,
  isInProgress,
  UNKNOWN_VALUE,
} from 'src/lib/format'

/**
 * The per-job logic `AttemptList` renders, kept in a module of its own rather
 * than beside the component.
 *
 * `attempt-list.tsx` is `'use client'`, and every export of a `'use client'`
 * module reaches a server component as an opaque client *reference* - calling
 * one from a server page throws. A detail page legitimately needs some of this
 * on the server (picking the newest job, say), so the pure half lives here,
 * where both sides of the boundary can call it.
 */

/**
 * The seven things a detail page can offer to do to a job. `watch` and `save`
 * are navigations rather than mutations, but they are part of the same state
 * table, because "which of these does this status offer" is one question and
 * answering it in two places is how the three detail pages would drift apart.
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

/**
 * The newest job for a media key.
 *
 * `MediaDetailResponse.jobs` is every job ever run for a media key, newest
 * first. This is exported so a page needing the newest job for its own reasons
 * picks it the same way rather than reaching for `jobs[0]` and quietly
 * disagreeing the day the ordering is revisited. It says nothing about the
 * media's state - that is `mediaState(media)`.
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
   * The counter for the note slot. For a video, yt-dlp's own counters —
   * `file 1 of 2`, `fragment 4 of 123`, both joined by ` · ` — and for a movie
   * or show, Radarr's/Sonarr's queue status word (`downloading`, `warning`,
   * `delay`…) verbatim. `null` when there is nothing to count or say.
   */
  note: string | null
  /** 0-100, already rounded upstream to two decimals. */
  pct: number
  /**
   * `~2m left` for a video, already phrased (see `formatEta`); upstream's
   * `hh:mm:ss` verbatim for a movie or show. `null` when there is no estimate.
   */
  timeLeft: string | null
  /**
   * The mono line under the bar — `412 MB / ~640 MB · 3.1 MB/s` for a video.
   * Always `null` for a movie or show: the queue carries no bytes.
   */
  detail: string | null
}

/**
 * The bytes-and-rate line for a video — `412 MB / ~640 MB · 3.1 MB/s`, or
 * `412 MB · 3.1 MB/s` without a total. A segment that would only read `—` is
 * dropped rather than drawn, and `null` comes back when nothing is left.
 */
function transferLine(progress: VideoProgress): string | null {
  const downloaded = formatBytes(progress.downloadedBytes)
  const total = formatBytes(progress.totalBytes)
  const bytes =
    total === UNKNOWN_VALUE
      ? downloaded === UNKNOWN_VALUE
        ? null
        : downloaded
      : `${downloaded} / ${progress.totalIsEstimate ? '~' : ''}${total}`

  const speed =
    progress.speedBps == null ? UNKNOWN_VALUE : formatSpeed(progress.speedBps)

  const line = [bytes, speed === UNKNOWN_VALUE ? null : speed]
    .filter(Boolean)
    .join(' · ')

  return line || null
}

/**
 * yt-dlp's counters, in the order they nest: which file of the grab (a
 * video+audio merge is two), then which fragment of that file (HLS/DASH).
 *
 * A file counter only when it says something — `file 1 of 1` is noise, and a
 * lone `file 1` says less than nothing, but a lone `file 2` still tells the
 * reader the first file is behind them. The numbers are yt-dlp's verbatim, so
 * the fragment index stays 0-based the way the log prints it.
 */
function videoNote(progress: VideoProgress): string | null {
  const { fileCount, fileIndex, fragmentCount, fragmentIndex } = progress

  const file =
    fileCount != null
      ? fileCount > 1
        ? `file ${fileIndex} of ${fileCount}`
        : null
      : fileIndex > 1
        ? `file ${fileIndex}`
        : null

  const fragment =
    fragmentIndex != null && fragmentCount != null
      ? `fragment ${fragmentIndex} of ${fragmentCount}`
      : null

  const note = [file, fragment].filter(Boolean).join(' · ')
  return note || null
}

/**
 * The progress a job can actually prove.
 *
 * Two sources, one per kind of media:
 *
 * - A video reads `job.progress` — yt-dlp's own tick for the current file,
 *   which the backend keeps only while the process lives (a paused job still
 *   has one). Bytes, rate, ETA and counters all come from there.
 * - A movie or show reads `ManagedMediaBase.queueSnapshot` — the
 *   Radarr/Sonarr queue entry, which has a percentage, a status word and an
 *   `hh:mm:ss` estimate but no bytes, so `detail` is always `null`.
 *
 * `null` means "draw no bar at all", which is the honest rendering of an
 * unknown percentage - a `0%` bar is a claim. That includes a video whose
 * total yt-dlp does not know yet: it has bytes and a rate but no percentage,
 * and {@link jobTransferLine} carries its activity instead.
 */
export function jobProgress(job: DownloadJob): JobProgress | null {
  if (!isManagedMedia(job.media)) {
    const progress = job.progress
    const pct = progress?.percent

    if (!progress || pct === undefined || !Number.isFinite(pct)) {
      return null
    }

    return {
      detail: transferLine(progress),
      note: videoNote(progress),
      pct,
      timeLeft: formatEta(progress.etaSeconds),
    }
  }

  const snapshot = job.media.queueSnapshot
  const pct = snapshot?.progress

  if (pct === undefined || !Number.isFinite(pct)) {
    return null
  }

  return {
    detail: null,
    note: snapshot?.status ?? null,
    pct,
    timeLeft: snapshot?.timeLeft ?? null,
  }
}

/**
 * The transfer line alone, for a video that has bytes moving but no
 * percentage to draw a bar with (yt-dlp does not know the total yet) — still
 * activity worth showing, just not a bar. `null` for everything else: a video
 * with a percentage (its line is {@link JobProgress.detail}), a movie or show
 * (no bytes on the wire), or a job with no progress at all.
 */
export function jobTransferLine(job: DownloadJob): string | null {
  if (isManagedMedia(job.media) || !job.progress) {
    return null
  }

  const pct = job.progress.percent
  if (pct !== undefined && Number.isFinite(pct)) {
    return null
  }

  return transferLine(job.progress)
}

/**
 * The stretch between a full bar and a file in the library, when every byte is
 * down but the title is not playable yet:
 *
 * - `finishing` - the queue still says `downloading` at 100%. The download
 *   client is wrapping up (unpacking, verifying, moving the finished files)
 *   and has not handed the release to Radarr/Sonarr yet.
 * - `importing` - Radarr/Sonarr has the files and is moving them into the
 *   library.
 * - `processing` - a video's bytes are down and this app is converting,
 *   uploading or cleaning up after it. yt-dlp's progress ends with the
 *   transfer, so there is nothing left to count.
 *
 * None has a percentage or an estimate of its own - the queue's ETA reads
 * `00:00:00` the whole way through, and a video's ETA is gone with its
 * process - so a handoff draws a settling bar and a sentence instead of a
 * countdown that has already run out.
 */
export type Handoff = 'finishing' | 'importing' | 'processing'

/** The percentage a download has to reach before it is a `finishing` one. */
export const FINISHED_PCT = 100

/** A video's post-transfer work - see `processing` in {@link Handoff}. */
const PROCESSING_STATUSES: ReadonlySet<DownloadJobStatus> = new Set([
  DownloadJobStatus.Cleaning,
  DownloadJobStatus.Converting,
  DownloadJobStatus.Uploading,
])

/** See {@link Handoff}. `null` while the download is still transferring. */
export function jobHandoff(
  status: DownloadJobStatus,
  pct: number | null | undefined,
): Handoff | null {
  if (status === DownloadJobStatus.Importing) {
    return 'importing'
  }

  // Past the transfer whatever the last tick said - the percentage is gone
  // with the yt-dlp process, and a settling bar is still true.
  if (PROCESSING_STATUSES.has(status)) {
    return 'processing'
  }

  return status === DownloadJobStatus.Downloading &&
    pct != null &&
    pct >= FINISHED_PCT
    ? 'finishing'
    : null
}

/**
 * The chip text for a handoff. `importing` and `processing` are left to the
 * status tables, which already name them (`converting`, `uploading`,
 * `cleaning up`); only a `downloading` that has nothing left to download
 * needs a word of its own.
 */
export const FINISHING_LABEL = 'finishing up'

/** Who takes the files into the library, by the media's type. */
const IMPORTERS: Record<DownloadType, string | null> = {
  [DownloadType.Movie]: 'Radarr',
  [DownloadType.Show]: 'Sonarr',
  [DownloadType.Video]: null,
}

/**
 * The line under a settling bar: what is happening now, in place of the
 * `~00:00:00 left` the queue keeps reporting. `null` for `processing` - the
 * chip already names the step, and there is no importer to hand off to - and
 * for a video generally, which Radarr/Sonarr never take.
 */
export function handoffDetail(
  handoff: Handoff,
  type: DownloadType,
): string | null {
  const importer = IMPORTERS[type]
  if (handoff === 'processing' || !importer) {
    return null
  }

  return handoff === 'finishing'
    ? `All downloaded. ${importer} imports it next.`
    : `${importer} is moving it into the library.`
}
