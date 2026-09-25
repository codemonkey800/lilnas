import type {
  Episode,
  Media,
  Movie,
  Season,
  Show,
} from '@lilnas/utils/download/types'
import {
  DownloadJobStatus,
  DownloadType,
  isMovie,
  isShow,
  isTerminalDownloadJobStatus,
} from '@lilnas/utils/download/types'
import { Injectable } from '@nestjs/common'

import type { DerivedState } from 'src/media/media-state.util'
import {
  deriveManagedStateFromItems,
  deriveVideoState,
} from 'src/media/media-state.util'
import type { PollableQueueItem } from 'src/media/queue-status.util'
import {
  aggregateQueueItems,
  matchesScope,
  toQueueSnapshot,
} from 'src/media/queue-status.util'

export type QueueSource = 'radarr' | 'sonarr'

/**
 * Plan 021. The in-memory facts a media's state is derived from, and the two
 * annotators that derive it.
 *
 * A **fed cache**: it fetches nothing and injects nothing. The poller writes
 * the full Radarr and Sonarr queues into it every tick, and
 * `DownloadStateService` writes the status of every in-flight video job.
 * Injecting nothing is the point - `DownloadStateService` already reaches
 * into this module through the `DownloadModule` <-> `MediaModule` forwardRef,
 * and the resolver annotates through this service, so if this in turn
 * injected `DownloadStateService` the cycle would need a second forwardRef
 * pair. Having the writers push instead keeps the graph as it is.
 *
 * Both annotators are synchronous and mutate in place, the same shape as
 * `EmbyStatusService.annotate()` - they only read memory, so there is nothing
 * to await and nothing that can fail.
 */
@Injectable()
export class MediaStateService {
  private readonly queues: Record<QueueSource, readonly PollableQueueItem[]> = {
    radarr: [],
    sonarr: [],
  }

  /** Media id -> status of that video's in-flight job. Never terminal. */
  private readonly videoActivity = new Map<string, DownloadJobStatus>()

  /**
   * Replaces - never merges - the stored queue for `source`, so an item that
   * left the queue since the last tick is gone. Copied, so the caller reusing
   * its array can't change what was stored.
   */
  setQueue(source: QueueSource, items: readonly PollableQueueItem[]): void {
    this.queues[source] = [...items]
  }

  /** The last queue stored for `source`; empty before the first `setQueue`. */
  getQueue(source: QueueSource): readonly PollableQueueItem[] {
    return this.queues[source]
  }

  /**
   * Every stored queue item for one Radarr movie (`movieId`, from the Radarr
   * queue) or one Sonarr series (`seriesId`, from the Sonarr queue).
   */
  queueItemsFor(
    type: DownloadType.Movie | DownloadType.Show,
    upstreamId: number,
  ): PollableQueueItem[] {
    return type === DownloadType.Movie
      ? this.queues.radarr.filter(item => item.movieId === upstreamId)
      : this.queues.sonarr.filter(item => item.seriesId === upstreamId)
  }

  /**
   * Records the status of a video's in-flight job. `undefined` or a terminal
   * status clears the entry - a finished job has no say in the video's state
   * (`deriveVideoState` would ignore it anyway), and keeping it would leak an
   * entry per video ever downloaded.
   */
  setVideoActivity(
    mediaId: string,
    status: DownloadJobStatus | undefined,
  ): void {
    if (status === undefined || isTerminalDownloadJobStatus(status)) {
      this.videoActivity.delete(mediaId)
      return
    }

    this.videoActivity.set(mediaId, status)
  }

  /**
   * Sets `state` on every item in `media` - and `stateReason`/`queueSnapshot`
   * where they apply - **mutating each in place**. The input is iterated
   * exactly once, so `Map.values()` is fine.
   *
   * Idempotent: a field that no longer applies is deleted rather than left
   * over from the previous call, so re-annotating after the queue empties
   * clears the stale snapshot and reason. `embyStatus` is never touched.
   *
   * A placeholder (no `radarrId`/`sonarrId`, no file, no `monitored` - what
   * the resolver returns for a source it couldn't reach) has no queue items
   * and nothing in the library, so it falls through to `absent` with no
   * special case.
   */
  annotate(media: Iterable<Media>): void {
    for (const item of media) {
      if (isMovie(item)) {
        applyDerived(item, this.deriveMovie(item))
      } else if (isShow(item)) {
        applyDerived(item, this.deriveShow(item))
      } else {
        // A video has no `queueSnapshot` field at all - its progress rides on
        // the job - `DownloadJob.progress`, attached by
        // `DownloadStateService.toJob()` - so there is none to set or clear
        // here.
        item.state = deriveVideoState(
          (item.downloadUrls?.length ?? 0) > 0,
          this.videoActivity.get(item.id),
        )
        delete item.stateReason
      }
    }
  }

  /**
   * Sets `state` and `queueSnapshot` on every episode of one Sonarr series,
   * in place, by the same rules as `toEpisodeStateEntries`: each queue item
   * is attributed to its own episode with `matchesScope`, the
   * highest-precedence one wins with its snapshot, and an episode with no
   * item is decided by its own `hasFile`/`monitored`. Episodes carry no
   * reason - the series-level `stateReason` is `annotate()`'s job.
   */
  annotateEpisodes(sonarrId: number, seasons: Season[]): void {
    const items = this.queueItemsFor(DownloadType.Show, sonarrId)

    for (const season of seasons) {
      for (const episode of season.episodes) {
        const matches = items.filter(item =>
          matchesScope(item, { episodeId: episode.id }),
        )
        const derived = deriveManagedStateFromItems(
          { hasFile: episode.hasFile, monitored: episode.monitored },
          matches,
        )

        episode.state = derived.state
        setSnapshot(episode, derived)
      }
    }
  }

  /**
   * Movie: `filePath` is the file signal - a `Movie` has no `hasFile`, and
   * Radarr only reports a path once there is a file.
   */
  private deriveMovie(movie: Movie): DerivedState {
    const items =
      movie.radarrId == null
        ? []
        : this.queueItemsFor(DownloadType.Movie, movie.radarrId)

    return deriveManagedStateFromItems(
      { hasFile: !!movie.filePath, monitored: movie.monitored ?? false },
      items,
    )
  }

  /**
   * Series: the rollup over every item for the series plus the library.
   * `episodeFileCount > 0` is the file signal - **never** `filePath`, which
   * on a `Show` is the series folder and is set for every library series.
   *
   * The winning item's state and reason stand, but when there are several
   * items the snapshot is taken from all of them folded through
   * `aggregateQueueItems` rather than from the winner alone: a season grab
   * is one item per episode, and the progress a series page shows should be
   * the whole grab's (summed bytes, the last-to-finish ETA), not whichever
   * single episode happened to win.
   */
  private deriveShow(show: Show): DerivedState {
    const items =
      show.sonarrId == null
        ? []
        : this.queueItemsFor(DownloadType.Show, show.sonarrId)

    const derived = deriveManagedStateFromItems(
      {
        hasFile: (show.episodeFileCount ?? 0) > 0,
        monitored: show.monitored ?? false,
      },
      items,
    )

    const aggregate = items.length > 1 ? aggregateQueueItems(items) : undefined
    if (!derived.queueSnapshot || !aggregate) return derived

    return { ...derived, queueSnapshot: toQueueSnapshot(aggregate) }
  }
}

function applyDerived(media: Movie | Show, derived: DerivedState): void {
  media.state = derived.state

  if (derived.stateReason) {
    media.stateReason = derived.stateReason
  } else {
    delete media.stateReason
  }

  setSnapshot(media, derived)
}

function setSnapshot(
  target: Movie | Show | Episode,
  derived: DerivedState,
): void {
  if (derived.queueSnapshot) {
    target.queueSnapshot = derived.queueSnapshot
  } else {
    delete target.queueSnapshot
  }
}
