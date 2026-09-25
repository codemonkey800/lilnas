import type { EpisodeResource, QueueResource } from '@lilnas/media/sonarr'
import type { ShowScope } from '@lilnas/utils/download/types'

/** How far up the series a delete reaches once it removes what was asked. */
export type ShowDeleteCascade = 'none' | 'season' | 'series'

export interface ShowDeletePlan {
  /** Widest level this delete reaches. `'series'` means remove the series. */
  cascade: ShowDeleteCascade
  /**
   * Unique episode-file ids to delete (empty when `cascade === 'series'` -
   * Sonarr deletes the folder).
   */
  fileIds: number[]
  /**
   * Files on disk this delete removes, for `deletedCount` - counted even when
   * `cascade === 'series'`.
   */
  fileCount: number
  /**
   * Season numbers whose `monitored` flag goes off (empty when
   * `cascade === 'series'`).
   */
  seasonNumbersToUnmonitor: number[]
  /**
   * The scope to hand `unmonitorScope`: the season when the cascade reached
   * it, else the episode. `undefined` when `cascade === 'series'`.
   */
  unmonitorScope?: ShowScope
}

/**
 * An episode Sonarr told us enough about to place in a season. Episodes with
 * no `id` or no `seasonNumber` can neither be matched to a queue item nor
 * counted towards a season, so they are dropped before any rule runs.
 */
interface PlacedEpisode {
  /** Truthy only when Sonarr has a file on disk - `0` is its "no file". */
  fileId: number | undefined
  hasFile: boolean
  id: number
  seasonNumber: number
}

function placeEpisodes(episodes: readonly EpisodeResource[]): PlacedEpisode[] {
  return episodes.flatMap(episode =>
    episode.id == null || episode.seasonNumber == null
      ? []
      : [
          {
            fileId: episode.episodeFileId || undefined,
            hasFile: episode.hasFile === true,
            id: episode.id,
            seasonNumber: episode.seasonNumber,
          },
        ],
  )
}

/**
 * One file can back several episodes (a multi-episode file), so the same
 * `episodeFileId` appears on each of them - list it once.
 */
function uniqueFileIds(episodes: readonly PlacedEpisode[]): number[] {
  const ids = new Set<number>()

  for (const episode of episodes) {
    if (episode.fileId) {
      ids.add(episode.fileId)
    }
  }

  return [...ids]
}

/**
 * The queue, split by how precisely each item can be placed: an item naming
 * an episode belongs to that episode, one naming only a season belongs to the
 * season, and one naming neither belongs to the series as a whole.
 */
interface QueuePlacement {
  episodeIds: Set<number>
  seasonNumbers: Set<number>
  seriesLevel: boolean
}

function placeQueue(queue: readonly QueueResource[]): QueuePlacement {
  const placement: QueuePlacement = {
    episodeIds: new Set(),
    seasonNumbers: new Set(),
    seriesLevel: false,
  }

  for (const item of queue) {
    if (item.episodeId != null) {
      placement.episodeIds.add(item.episodeId)
    } else if (item.seasonNumber != null) {
      placement.seasonNumbers.add(item.seasonNumber)
    } else {
      placement.seriesLevel = true
    }
  }

  return placement
}

/** Has a file on disk, or a download in flight that will become one. */
function isRemaining(episode: PlacedEpisode, queue: QueuePlacement): boolean {
  return (
    episode.hasFile ||
    episode.fileId != null ||
    queue.episodeIds.has(episode.id)
  )
}

/**
 * Whether anything in `seasonNumber` is left once `excludedEpisodeId` goes:
 * another remaining episode, or a season-level queue item that has not been
 * pinned to an episode yet.
 */
function seasonRemains(
  episodes: readonly PlacedEpisode[],
  queue: QueuePlacement,
  seasonNumber: number,
  excludedEpisodeId: number,
): boolean {
  return (
    queue.seasonNumbers.has(seasonNumber) ||
    episodes.some(
      episode =>
        episode.seasonNumber === seasonNumber &&
        episode.id !== excludedEpisodeId &&
        isRemaining(episode, queue),
    )
  )
}

/**
 * Whether anything outside `excludedSeasonNumber` is left: a remaining
 * episode in another season, a season-level queue item for another season,
 * or a series-level queue item that could land anywhere.
 */
function seriesRemains(
  episodes: readonly PlacedEpisode[],
  queue: QueuePlacement,
  excludedSeasonNumber: number,
): boolean {
  if (queue.seriesLevel) {
    return true
  }

  for (const seasonNumber of queue.seasonNumbers) {
    if (seasonNumber !== excludedSeasonNumber) {
      return true
    }
  }

  return episodes.some(
    episode =>
      episode.seasonNumber !== excludedSeasonNumber &&
      isRemaining(episode, queue),
  )
}

function seriesPlan(fileCount: number): ShowDeletePlan {
  return {
    cascade: 'series',
    fileCount,
    fileIds: [],
    seasonNumbersToUnmonitor: [],
    unmonitorScope: undefined,
  }
}

function seasonPlan(seasonNumber: number, fileIds: number[]): ShowDeletePlan {
  return {
    cascade: 'season',
    fileCount: fileIds.length,
    fileIds,
    seasonNumbersToUnmonitor: [seasonNumber],
    unmonitorScope: { seasonNumber },
  }
}

function episodePlan(episodeId: number, fileIds: number[]): ShowDeletePlan {
  return {
    cascade: 'none',
    fileCount: fileIds.length,
    fileIds,
    seasonNumbersToUnmonitor: [],
    unmonitorScope: { episodeId },
  }
}

/**
 * Decide how far a show delete reaches, narrowest scope first - the same
 * order as `resolveEpisodeFileIds`: one episode, one season, or the series.
 *
 * Deleting the last remaining episode of a season also unmonitors the
 * season, and deleting the last remaining season of a series removes the
 * series from Sonarr entirely. "Remaining" means the episode has a file on
 * disk OR has an in-flight Sonarr queue item - a queue item is a file that is
 * about to exist, and a delete must never cancel a sibling's in-flight
 * download by unmonitoring the season (or removing the series) it is landing
 * in. Queue items Sonarr could not pin to an episode still count: one naming
 * only a season keeps that season, and one naming neither keeps the series.
 *
 * Pure on purpose: the caller reads one snapshot of the series' episodes and
 * queue and this decides everything from it, so the plan is consistent with
 * itself even if Sonarr moves underneath the caller between reads. An empty
 * `fileIds` is a legitimate answer - a zero-delete is a success, and the
 * caller still unmonitors the scope it was given.
 */
export function planShowDelete(
  episodes: readonly EpisodeResource[],
  queue: readonly QueueResource[],
  scope: ShowScope,
): ShowDeletePlan {
  const placed = placeEpisodes(episodes)
  const placedQueue = placeQueue(queue)

  if (scope.episodeId != null) {
    const target = placed.find(episode => episode.id === scope.episodeId)

    // An episode we cannot place in a season cannot cascade to one.
    if (target == null) {
      return episodePlan(scope.episodeId, [])
    }

    const fileIds = target.fileId ? [target.fileId] : []

    if (seasonRemains(placed, placedQueue, target.seasonNumber, target.id)) {
      return episodePlan(target.id, fileIds)
    }

    if (seriesRemains(placed, placedQueue, target.seasonNumber)) {
      return seasonPlan(target.seasonNumber, fileIds)
    }

    return seriesPlan(fileIds.length)
  }

  if (scope.seasonNumber != null) {
    const { seasonNumber } = scope
    const fileIds = uniqueFileIds(
      placed.filter(episode => episode.seasonNumber === seasonNumber),
    )

    if (seriesRemains(placed, placedQueue, seasonNumber)) {
      return seasonPlan(seasonNumber, fileIds)
    }

    return seriesPlan(fileIds.length)
  }

  return seriesPlan(uniqueFileIds(placed).length)
}
