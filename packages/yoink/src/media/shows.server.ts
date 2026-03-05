import {
  type EpisodeFileResource,
  type EpisodeResource,
  getApiV3Episode,
  getApiV3Episodefile,
  getApiV3QueueDetails,
  getApiV3SeriesById,
  getApiV3SeriesLookup,
  type QueueResource,
  type SeriesResource,
} from '@lilnas/media/sonarr'

import { getSonarrClient } from 'src/media/clients'
import {
  clearEpisodeSearchResultsBulk,
  getShowSearchResults,
} from 'src/media/search-results'

import { buildShowDetail, type ShowDetail } from './shows'

export async function getShow(idStr: string): Promise<ShowDetail> {
  const client = getSonarrClient()
  const tvdbId = Number(idStr)

  const libraryResult = await getApiV3SeriesLookup({
    client,
    query: { term: `tvdb:${tvdbId}` },
  })
  const series = ((libraryResult.data ?? []) as SeriesResource[])[0]
  if (!series) throw new Error(`No series found for tvdbId ${tvdbId}`)

  if (series.id) {
    return getShowById(series.id, tvdbId, client)
  }

  return buildShowDetail(series, [], [], [], false, new Map())
}

async function getShowById(
  seriesId: number,
  tvdbId: number,
  client: ReturnType<typeof getSonarrClient>,
): Promise<ShowDetail> {
  const [seriesResult, episodesResult, filesResult, queueResult, searchResultsMap] =
    await Promise.all([
      getApiV3SeriesById({ client, path: { id: seriesId } }),
      getApiV3Episode({ client, query: { seriesId } }),
      getApiV3Episodefile({ client, query: { seriesId } }),
      getApiV3QueueDetails({
        client,
        query: { seriesId, includeEpisode: false },
      }),
      getShowSearchResults(tvdbId),
    ])

  const series = seriesResult.data as SeriesResource
  const episodes = (episodesResult.data ?? []) as EpisodeResource[]
  const files = (filesResult.data ?? []) as EpisodeFileResource[]
  const queueItems = (queueResult.data ?? []) as QueueResource[]

  const filesById = new Map<number, EpisodeFileResource>()
  for (const f of files) {
    if (f.id) filesById.set(f.id, f)
  }

  const staleKeys: { seasonNumber: number; episodeNumber: number }[] = []
  for (const ep of episodes) {
    if (ep.hasFile && ep.seasonNumber != null && ep.episodeNumber != null) {
      const key = `S${ep.seasonNumber}E${ep.episodeNumber}`

      if (searchResultsMap.has(key)) {
        staleKeys.push({
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
        })
        searchResultsMap.delete(key)
      }
    }
  }
  if (staleKeys.length > 0) {
    void clearEpisodeSearchResultsBulk(tvdbId, staleKeys)
  }

  return buildShowDetail(series, episodes, files, queueItems, true, searchResultsMap)
}
