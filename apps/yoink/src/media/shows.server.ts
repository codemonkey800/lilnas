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

/**
 * Fetches full show details by TVDB ID. If the show is already in the
 * Sonarr library, returns enriched data including episodes, files, queue
 * state, and search results. Otherwise returns metadata-only details.
 */
export async function getShow(tvdbId: number): Promise<ShowDetail> {
  const client = getSonarrClient()

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

/**
 * Loads a library show's full details: series metadata, episodes, files,
 * queue state, and "not found" search results. Automatically cleans up
 * stale search results for episodes that now have files on disk.
 */
async function getShowById(
  seriesId: number,
  tvdbId: number,
  client: ReturnType<typeof getSonarrClient>,
): Promise<ShowDetail> {
  const [
    seriesResult,
    episodesResult,
    filesResult,
    queueResult,
    searchResultsMap,
  ] = await Promise.all([
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

  // Find episodes that now have files but still have "not found" records.
  // Remove the stale entries from both the in-memory map (so they don't
  // show in this response) and the DB (fire-and-forget).
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

  return buildShowDetail(
    series,
    episodes,
    files,
    queueItems,
    true,
    searchResultsMap,
  )
}
