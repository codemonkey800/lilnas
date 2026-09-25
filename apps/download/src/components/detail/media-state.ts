import type { Media, MediaState } from '@lilnas/utils/download/types'
import { DownloadType, isManagedMedia } from '@lilnas/utils/download/types'

import type { Handoff, JobProgress } from 'src/components/detail/job-state'
import { FINISHED_PCT } from 'src/components/detail/job-state'

/**
 * Plan 021's media-state vocabulary — what the chip at the top of a movie,
 * show or video page reads. The tone lives beside the job-status tones in
 * `src/lib/format.ts` (`mediaStateTone`); this module owns the words.
 *
 * Pure and free of React so a server page can call it too — see the note at
 * the top of `job-state.ts` for why that matters.
 */

/**
 * The movie/show wording. Radarr and Sonarr both "import" a finished download
 * into a library, so `importing` and `available` say so.
 */
const MANAGED_MEDIA_STATE_LABELS: Record<MediaState, string> = {
  absent: 'not downloaded',
  available: 'in library',
  downloading: 'downloading',
  importing: 'importing…',
  needs_attention: 'needs your decision',
  paused: 'paused',
  wanted: 'wanted',
}

/**
 * The video wording. A video has no library to be "in" and nothing imports
 * it — `importing` is yt-dlp's convert/upload/clean — so those two differ;
 * every other state reads the same as a movie's.
 */
const VIDEO_MEDIA_STATE_LABELS: Record<MediaState, string> = {
  ...MANAGED_MEDIA_STATE_LABELS,
  available: 'downloaded',
  importing: 'processing…',
}

/**
 * Per type rather than one table with a video override bolted on, so a new
 * `DownloadType` fails type-check here as surely as a new state does.
 */
const MEDIA_STATE_LABELS: Record<DownloadType, Record<MediaState, string>> = {
  [DownloadType.Movie]: MANAGED_MEDIA_STATE_LABELS,
  [DownloadType.Show]: MANAGED_MEDIA_STATE_LABELS,
  [DownloadType.Video]: VIDEO_MEDIA_STATE_LABELS,
}

/** The chip text for a media state on a page of the given type. */
export function mediaStateLabel(state: MediaState, type: DownloadType): string {
  return MEDIA_STATE_LABELS[type][state]
}

/**
 * Whether the chip carries the breathing live dot — the machine is working on
 * this right now. Deliberately narrower than `isMediaInFlight`:
 * `needs_attention` and `paused` are in flight but *stopped*, and a live dot
 * would promise movement that is not coming.
 */
const LIVE_MEDIA_STATES: Record<MediaState, boolean> = {
  absent: false,
  available: false,
  downloading: true,
  importing: true,
  needs_attention: false,
  paused: false,
  wanted: false,
}

/** See {@link LIVE_MEDIA_STATES}. */
export function mediaStateIsLive(state: MediaState): boolean {
  return LIVE_MEDIA_STATES[state]
}

/**
 * The progress a title's Radarr/Sonarr queue item reports, read off the media
 * itself — so a download this app did not start (Radarr's own UI, another tab)
 * still draws a bar. The same rules as `jobProgress` in `job-state.ts`, which
 * read the snapshot through a job instead.
 *
 * `null` means "draw no bar at all": a video (nothing on the wire carries its
 * progress), no queue item, or a queue item with no finite percentage — a
 * `0%` bar is a claim.
 */
export function mediaProgress(media: Media): JobProgress | null {
  if (!isManagedMedia(media)) {
    return null
  }

  const snapshot = media.queueSnapshot
  const pct = snapshot?.progress

  if (pct === undefined || !Number.isFinite(pct)) {
    return null
  }

  return {
    // The queue carries no bytes, so there is no transfer line to draw.
    detail: null,
    note: snapshot?.status ?? null,
    pct,
    timeLeft: snapshot?.timeLeft ?? null,
  }
}

/**
 * {@link Handoff}, read off a media state instead of a job's status - so a
 * download this app did not start settles the same way one it did.
 */
export function mediaHandoff(
  state: MediaState,
  pct: number | null | undefined,
): Handoff | null {
  if (state === 'importing') {
    return 'importing'
  }

  return state === 'downloading' && pct != null && pct >= FINISHED_PCT
    ? 'finishing'
    : null
}
