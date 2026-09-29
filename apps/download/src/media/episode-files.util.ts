import type { EpisodeResource } from '@lilnas/media/sonarr'
import type { ShowScope } from '@lilnas/utils/download/types'

import type { SonarrService } from './sonarr.service'

/**
 * The two reads this resolution needs, and nothing else - narrower than the
 * whole service so a caller (and a test) can hand over a stub without
 * standing up a `SonarrService`.
 */
export type EpisodeFileReader = Pick<
  SonarrService,
  'getEpisodeFiles' | 'getEpisodes'
>

/** The files a scope names, and every episode those files back. */
export interface ResolvedEpisodeFiles {
  /** Unique Sonarr episode-file ids, in the order Sonarr listed them. */
  fileIds: number[]
  /**
   * Every episode backed by one of `fileIds` - wider than the scope when a
   * multi-episode file (`S01E01E02.mkv`) is involved, since deleting that
   * file takes each of its episodes' footage with it.
   */
  episodeIds: number[]
}

/**
 * Sonarr reports `episodeFileId: 0` for "no file", so truthiness rather than
 * a null guard is the right test for a real file id.
 */
function episodesBacking(
  episodes: readonly EpisodeResource[],
  fileIds: ReadonlySet<number>,
): number[] {
  return episodes.flatMap(episode =>
    episode.id != null &&
    episode.episodeFileId &&
    fileIds.has(episode.episodeFileId)
      ? [episode.id]
      : [],
  )
}

/**
 * Which episode files a scope names, narrowest first: one episode, one
 * season, or every file of the series - plus every episode those files back.
 *
 * Sonarr's episode-file list carries `seasonNumber` but no episode id, so a
 * single-episode scope resolves the other way round - find the episode, then
 * take the file it points at - while a season or series scope narrows the
 * file list directly. That asymmetry is the whole reason this is one shared
 * function: `ReleaseService`'s replace path and `ShowService`'s delete need
 * byte-identical behaviour, and two copies would drift the first time either
 * changed.
 *
 * One file can back several episodes (a multi-episode file), so the episode
 * list is joined back from the files rather than taken from the scope: an
 * episode scope naming E01 of an `S01E01E02.mkv` resolves to one file and
 * both E01 and E02.
 *
 * An empty result is a legitimate answer, never an error: an episode with no
 * file, a season with nothing downloaded and a series with an empty library
 * folder all mean "there is nothing here to delete", which is a state the
 * caller was asking for anyway.
 */
export async function resolveEpisodeFileIds(
  sonarr: EpisodeFileReader,
  sonarrId: number,
  scope: ShowScope,
): Promise<ResolvedEpisodeFiles> {
  if (scope.episodeId != null) {
    const episodes = await sonarr.getEpisodes(sonarrId, {
      seasonNumber: scope.seasonNumber,
    })

    // `episodeFileId: 0` is Sonarr's "no file", so truthiness is the right
    // check here rather than a null guard.
    const fileId = episodes.find(
      episode => episode.id === scope.episodeId,
    )?.episodeFileId

    if (!fileId) {
      return { episodeIds: [], fileIds: [] }
    }

    return {
      episodeIds: episodesBacking(episodes, new Set([fileId])),
      fileIds: [fileId],
    }
  }

  // The episode read only joins files back to episodes; the file list stays
  // the source of truth for which files the scope names.
  const [files, episodes] = await Promise.all([
    sonarr.getEpisodeFiles(sonarrId),
    sonarr.getEpisodes(sonarrId, { seasonNumber: scope.seasonNumber }),
  ])

  const fileIds = files
    .filter(
      file =>
        scope.seasonNumber == null || file.seasonNumber === scope.seasonNumber,
    )
    .map(file => file.id)
    .filter((id): id is number => id != null)

  return {
    episodeIds: episodesBacking(episodes, new Set(fileIds)),
    fileIds,
  }
}
