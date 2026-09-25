import type { EpisodeResource } from '@lilnas/media/sonarr'
import type {
  DownloadQueueSnapshot,
  EpisodeStateEntry,
  MediaState,
} from '@lilnas/utils/download/types'
import {
  DownloadJobStatus,
  MEDIA_STATE_PRECEDENCE,
} from '@lilnas/utils/download/types'

import type { PollableQueueItem } from 'src/media/queue-status.util'
import {
  deriveStatusFromQueueItem,
  describeQueueItemError,
  matchesScope,
  toQueueSnapshot,
} from 'src/media/queue-status.util'

/**
 * What a Radarr movie or a Sonarr episode's state is derived from: the
 * library's own facts plus the (at most one) queue item for it.
 */
export interface ManagedStateInput {
  hasFile: boolean
  item?: PollableQueueItem
  monitored: boolean
}

export interface DerivedState {
  /** Present exactly when a queue item was, so a page can draw progress. */
  queueSnapshot?: DownloadQueueSnapshot
  state: MediaState
  /** Only ever set for `needs_attention` - the reason a human must act. */
  stateReason?: string
}

/**
 * State for one Radarr movie or one Sonarr episode.
 *
 * A queue item wins over the library: a movie that already has a file *and*
 * a downloading item is an upgrade in flight, and reads `downloading` with
 * its snapshot rather than `available`. The item is classified through the
 * same `deriveStatusFromQueueItem` the poller uses for jobs, so a media's
 * state can never disagree with its attempt's status. The current status
 * passed in is `Downloading` - non-terminal - but it is irrelevant here: a
 * present item decides on its own.
 *
 * - `Failed`/`NeedsAttention` -> `needs_attention`, with Radarr/Sonarr's own
 *   sentence as `stateReason`. A failed queue item sits in the queue until
 *   someone removes or retries it, which is a human's call just like a
 *   blocked import.
 * - `Importing` -> `importing`, `Paused` -> `paused`.
 * - `Downloading`, and any status the classifier might learn to return in
 *   future -> `downloading`: an item is present in the queue, so something
 *   is under way, and "downloading" is the least surprising thing to say
 *   about it.
 *
 * No item: a file on disk is `available`, else monitored is `wanted`, else
 * `absent`.
 */
export function deriveManagedState(input: ManagedStateInput): DerivedState {
  const { hasFile, item, monitored } = input

  if (!item) {
    if (hasFile) return { state: 'available' }
    return { state: monitored ? 'wanted' : 'absent' }
  }

  const queueSnapshot = toQueueSnapshot(item)
  const status = deriveStatusFromQueueItem(DownloadJobStatus.Downloading, item)

  switch (status) {
    case DownloadJobStatus.Failed:
    case DownloadJobStatus.NeedsAttention: {
      const stateReason = describeQueueItemError(item)
      return {
        queueSnapshot,
        state: 'needs_attention',
        ...(stateReason ? { stateReason } : {}),
      }
    }
    case DownloadJobStatus.Importing:
      return { queueSnapshot, state: 'importing' }
    case DownloadJobStatus.Paused:
      return { queueSnapshot, state: 'paused' }
    default:
      return { queueSnapshot, state: 'downloading' }
  }
}

/**
 * What each job status says about a video while it is the video's latest
 * attempt. `null` means the job has no opinion - it is over (or never
 * existed) - and the video's own file decides. A `Record` so a new
 * `DownloadJobStatus` fails type-check here until someone decides.
 *
 * `Importing` and `Requested`/`Searching` are Radarr/Sonarr job statuses a
 * video job never reaches today; they are mapped the way they read for a
 * movie so the table stays honest if one ever does.
 */
const VIDEO_JOB_STATE: Record<DownloadJobStatus, MediaState | null> = {
  [DownloadJobStatus.Cancelled]: null,
  [DownloadJobStatus.Cancelling]: 'downloading',
  [DownloadJobStatus.Cleaning]: 'importing',
  [DownloadJobStatus.Completed]: null,
  [DownloadJobStatus.Converting]: 'importing',
  [DownloadJobStatus.Downloading]: 'downloading',
  [DownloadJobStatus.Failed]: null,
  [DownloadJobStatus.Importing]: 'importing',
  [DownloadJobStatus.NeedsAttention]: 'needs_attention',
  [DownloadJobStatus.Paused]: 'paused',
  [DownloadJobStatus.Pausing]: 'paused',
  [DownloadJobStatus.Pending]: 'wanted',
  [DownloadJobStatus.Requested]: 'wanted',
  [DownloadJobStatus.Searching]: 'downloading',
  [DownloadJobStatus.Uploading]: 'importing',
}

/**
 * State for one video, from whether its row has a file and the status of its
 * latest job. An in-flight job wins - a re-download of a video that already
 * has a file reads as the re-download. A finished, failed or cancelled job
 * (or none at all) leaves it to the file: `available` or `absent`.
 */
export function deriveVideoState(
  hasFile: boolean,
  jobStatus: DownloadJobStatus | undefined,
): MediaState {
  const fromJob = jobStatus ? VIDEO_JOB_STATE[jobStatus] : null
  if (fromJob) return fromJob
  return hasFile ? 'available' : 'absent'
}

const precedence = (state: MediaState) => MEDIA_STATE_PRECEDENCE.indexOf(state)

/**
 * State for one movie, series or episode given *every* queue item that
 * belongs to it (already filtered by the caller). Each item is derived on its
 * own with {@link deriveManagedState} and the highest-precedence result wins,
 * keeping that item's snapshot and reason; no items leaves it to the library.
 *
 * The library's own state never needs to join the contest: every state an
 * item can produce (`needs_attention`, `downloading`, `importing`, `paused`)
 * outranks every state the library can (`available`, `wanted`, `absent`), so
 * "the best item, else the library" *is* the rollup over both.
 */
export function deriveManagedStateFromItems(
  library: Omit<ManagedStateInput, 'item'>,
  items: readonly PollableQueueItem[],
): DerivedState {
  if (items.length === 0) return deriveManagedState(library)

  return items
    .map(item => deriveManagedState({ ...library, item }))
    .reduce((best, next) =>
      precedence(next.state) < precedence(best.state) ? next : best,
    )
}

/**
 * One state entry per Sonarr episode.
 *
 * Items are matched to an episode one by one with `matchesScope`, *before*
 * any fold - `aggregateQueueItems` would collapse a season's items into one
 * synthetic item with no episode id, which is exactly the attribution this
 * needs. Sonarr normally queues one item per episode, but a re-grab can
 * leave two; then each is derived on its own and the highest-precedence
 * state wins, with that item's snapshot. (An entry carries no reason - the
 * series-level `stateReason` is the rollup's job.)
 *
 * An episode Sonarr returned without an `id` or `seasonNumber` is skipped:
 * it can't be keyed, and `EpisodeStateEntrySchema` would reject it anyway.
 * `toEpisode` throws on the same shape; a poll shouldn't.
 */
export function toEpisodeStateEntries(
  episodes: readonly EpisodeResource[],
  items: readonly PollableQueueItem[],
): EpisodeStateEntry[] {
  const entries: EpisodeStateEntry[] = []

  for (const episode of episodes) {
    const { id: episodeId, seasonNumber } = episode
    if (episodeId == null || seasonNumber == null) continue

    const library = {
      hasFile: episode.hasFile ?? false,
      monitored: episode.monitored ?? false,
    }
    const matches = items.filter(item => matchesScope(item, { episodeId }))

    const derived = deriveManagedStateFromItems(library, matches)

    entries.push({
      episodeId,
      seasonNumber,
      state: derived.state,
      ...(derived.queueSnapshot
        ? { queueSnapshot: derived.queueSnapshot }
        : {}),
    })
  }

  return entries
}
