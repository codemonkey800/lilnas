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

/**
 * Which episode files a scope names, narrowest first: one episode, one
 * season, or every file of the series.
 *
 * Sonarr's episode-file list carries `seasonNumber` but no episode id, so a
 * single-episode scope resolves the other way round - find the episode, then
 * take the file it points at - while a season or series scope narrows the
 * file list directly. That asymmetry is the whole reason this is one shared
 * function: `ReleaseService`'s replace path and `ShowService`'s delete need
 * byte-identical behaviour, and two copies would drift the first time either
 * changed.
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
): Promise<number[]> {
  if (scope.episodeId != null) {
    const episodes = await sonarr.getEpisodes(sonarrId, {
      seasonNumber: scope.seasonNumber,
    })

    // `episodeFileId: 0` is Sonarr's "no file", so truthiness is the right
    // check here rather than a null guard.
    const fileId = episodes.find(
      episode => episode.id === scope.episodeId,
    )?.episodeFileId

    return fileId ? [fileId] : []
  }

  const files = await sonarr.getEpisodeFiles(sonarrId)

  return files
    .filter(
      file =>
        scope.seasonNumber == null || file.seasonNumber === scope.seasonNumber,
    )
    .map(file => file.id)
    .filter((id): id is number => id != null)
}
