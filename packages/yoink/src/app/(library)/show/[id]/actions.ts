'use server'

import {
  deleteApiV3EpisodefileBulk,
  deleteApiV3EpisodefileById,
  deleteApiV3QueueBulk,
  deleteApiV3QueueById,
  deleteApiV3SeriesById,
  type EpisodeResource,
  getApiV3Episode,
  getApiV3EpisodeById,
  getApiV3Qualityprofile,
  getApiV3QueueDetails,
  getApiV3Rootfolder,
  getApiV3SeriesLookup,
  postApiV3Command,
  postApiV3Release,
  postApiV3Series,
  putApiV3EpisodeById,
  putApiV3EpisodeMonitor,
  type QueueResource,
  type ReleaseResource,
  type SeriesResource,
} from '@lilnas/media/sonarr'
import { revalidatePath } from 'next/cache'

import {
  getSonarrClient,
  searchShowReleases,
  type ShowRelease,
} from 'src/media'
import {
  clearAllShowSearchResults,
  clearEpisodeSearchResult,
} from 'src/media/search-results'
import {
  clearSearches,
  getSearchingEpisodeIds,
  registerEpisodeSearches,
} from 'src/media/show-search-store'

/** Builds the Sonarr command body for searching specific episodes. */
function episodeSearchBody(episodeIds: number[]) {
  return { name: 'EpisodeSearch', episodeIds } as Record<string, unknown>
}

/** Builds the Sonarr command body for searching an entire series. */
function seriesSearchBody(seriesId: number) {
  return { name: 'SeriesSearch', seriesId } as Record<string, unknown>
}

/**
 * Fetches the set of episode IDs currently queued for download in Sonarr.
 * Returns an empty set on error to allow callers to proceed gracefully.
 */
async function getQueuedEpisodeIdsForSeries(
  seriesId: number,
): Promise<Set<number>> {
  try {
    const client = getSonarrClient()
    const result = await getApiV3QueueDetails({
      client,
      query: { seriesId, includeEpisode: false },
      cache: 'no-store',
    })
    const items = (result.data ?? []) as QueueResource[]
    return new Set(
      items.map(q => q.episodeId).filter((id): id is number => id != null),
    )
  } catch {
    return new Set()
  }
}

/**
 * Monitors a single episode and triggers a Sonarr search for it.
 * Registers the episode in the in-memory search store so the UI can
 * track search progress and detect "not found" timeouts.
 */
export async function triggerEpisodeDownload(
  episodeId: number,
  tvdbId: number,
): Promise<void> {
  const client = getSonarrClient()
  // Sonarr ignores searches for unmonitored episodes, so enable first
  const epResult = await getApiV3EpisodeById({
    client,
    path: { id: episodeId },
  })
  const episode = epResult.data as EpisodeResource

  await putApiV3EpisodeById({
    client,
    path: { id: episodeId },
    body: { ...episode, monitored: true },
  })

  await postApiV3Command({
    client,
    body: episodeSearchBody([episodeId]),
  })

  registerEpisodeSearches([
    {
      episodeId,
      seriesId: episode.seriesId ?? 0,
      tvdbId,
      seasonNumber: episode.seasonNumber ?? 0,
      episodeNumber: episode.episodeNumber ?? 0,
    },
  ])

  revalidatePath(`/show/${tvdbId}`)
}

/**
 * Monitors and triggers a Sonarr search for all missing, aired episodes
 * in a season. Skips episodes that already have a file, are queued, or
 * are already being searched.
 * @returns The list of episode IDs that were registered for search.
 */
export async function triggerSeasonDownload(
  seriesId: number,
  seasonNumber: number,
  tvdbId: number,
): Promise<{ registeredEpisodeIds: number[] }> {
  const client = getSonarrClient()

  // Fetch season episodes and current queue in parallel
  const [episodesResult, queuedIds] = await Promise.all([
    getApiV3Episode({ client, query: { seriesId, seasonNumber } }),
    getQueuedEpisodeIdsForSeries(seriesId),
  ])
  const allEpisodes = (episodesResult.data ?? []) as EpisodeResource[]
  const alreadySearchingIds = getSearchingEpisodeIds()

  // Only search episodes that are missing a file, have aired, and are not
  // already downloading or being searched
  const now = new Date()
  const eligible = allEpisodes.filter(ep => {
    if (ep.hasFile) return false
    if (!ep.airDate || new Date(ep.airDate) > now) return false
    const id = ep.id ?? 0
    if (id <= 0) return false
    if (queuedIds.has(id)) return false
    if (alreadySearchingIds.has(id)) return false
    return true
  })

  if (eligible.length === 0) return { registeredEpisodeIds: [] }

  const episodeIds = eligible.map(ep => ep.id!)

  await putApiV3EpisodeMonitor({
    client,
    body: { episodeIds, monitored: true },
  })

  await postApiV3Command({
    client,
    body: episodeSearchBody(episodeIds),
  })

  registerEpisodeSearches(
    eligible.map(ep => ({
      episodeId: ep.id!,
      seriesId,
      tvdbId,
      seasonNumber: ep.seasonNumber ?? seasonNumber,
      episodeNumber: ep.episodeNumber ?? 0,
    })),
  )

  revalidatePath(`/show/${tvdbId}`)
  return { registeredEpisodeIds: episodeIds }
}

/**
 * Monitors all missing, aired episodes and issues a full SeriesSearch
 * command in Sonarr. Unlike season download, this lets Sonarr decide
 * which episodes to grab across all seasons.
 * @returns The list of episode IDs that were registered for search.
 */
export async function triggerSeriesDownload(
  seriesId: number,
  tvdbId: number,
): Promise<{ registeredEpisodeIds: number[] }> {
  const client = getSonarrClient()

  const [episodesResult, queuedIds] = await Promise.all([
    getApiV3Episode({ client, query: { seriesId } }),
    getQueuedEpisodeIdsForSeries(seriesId),
  ])
  const allEpisodes = (episodesResult.data ?? []) as EpisodeResource[]
  const alreadySearchingIds = getSearchingEpisodeIds()

  const now = new Date()
  const eligible = allEpisodes.filter(ep => {
    if (ep.hasFile) return false
    if (!ep.airDate || new Date(ep.airDate) > now) return false
    const id = ep.id ?? 0
    if (id <= 0) return false
    if (queuedIds.has(id)) return false
    if (alreadySearchingIds.has(id)) return false
    return true
  })

  const episodeIds = eligible.map(ep => ep.id!)

  if (episodeIds.length > 0) {
    await putApiV3EpisodeMonitor({
      client,
      body: { episodeIds, monitored: true },
    })
  }

  // SeriesSearch covers the whole series — Sonarr decides which episodes to grab
  await postApiV3Command({
    client,
    body: seriesSearchBody(seriesId),
  })

  if (eligible.length > 0) {
    registerEpisodeSearches(
      eligible.map(ep => ({
        episodeId: ep.id!,
        seriesId,
        tvdbId,
        seasonNumber: ep.seasonNumber ?? 0,
        episodeNumber: ep.episodeNumber ?? 0,
      })),
    )
  }

  revalidatePath(`/show/${tvdbId}`)
  return { registeredEpisodeIds: episodeIds }
}

/** Clears all active in-memory search trackers for a series. */
export async function clearShowSearches(seriesId: number): Promise<void> {
  clearSearches(seriesId)
}

/** Cancels a single queued download by removing it from the Sonarr queue. */
export async function cancelDownload(queueId: number, tvdbId: number) {
  const client = getSonarrClient()
  await deleteApiV3QueueById({
    client,
    path: { id: queueId },
    query: { removeFromClient: true, blocklist: false },
  })
  revalidatePath(`/show/${tvdbId}`)
}

/**
 * Cancels every queued download for a series. Removes queue entries from
 * the download client and unmonitors the corresponding episodes.
 * @returns The list of episode IDs whose downloads were cancelled.
 */
export async function cancelAllShowDownloads(
  seriesId: number,
  tvdbId: number,
): Promise<{ cancelledEpisodeIds: number[] }> {
  const client = getSonarrClient()

  const result = await getApiV3QueueDetails({
    client,
    query: { seriesId, includeEpisode: false },
    cache: 'no-store',
  })
  const items = (result.data ?? []) as QueueResource[]

  const activeItems = items.filter(q => q.id != null && q.episodeId != null)
  if (activeItems.length === 0) {
    revalidatePath(`/show/${tvdbId}`)
    return { cancelledEpisodeIds: [] }
  }

  const queueIds = activeItems.map(q => q.id!)
  const episodeIds = activeItems.map(q => q.episodeId!)

  // Remove from download client and unmonitor in parallel
  await Promise.all([
    deleteApiV3QueueBulk({
      client,
      body: { ids: queueIds },
      query: { removeFromClient: true, blocklist: false },
    }),
    putApiV3EpisodeMonitor({
      client,
      body: { episodeIds, monitored: false },
    }),
  ])

  revalidatePath(`/show/${tvdbId}`)
  return { cancelledEpisodeIds: episodeIds }
}

/**
 * Deletes a downloaded episode file and unmonitors the associated episode(s).
 * A single episode file can back multiple episodes (e.g. multi-episode files).
 */
export async function deleteEpisodeFile(episodeFileId: number, tvdbId: number) {
  const client = getSonarrClient()

  // Look up which episodes reference this file so we can unmonitor them
  const episodesResult = await getApiV3Episode({
    client,
    query: { episodeFileId },
  })
  const episodes = (episodesResult.data ?? []) as EpisodeResource[]
  const episodeIds = episodes.map(ep => ep.id ?? 0).filter(id => id > 0)

  // Unmonitor and delete the file in parallel
  await Promise.all([
    episodeIds.length > 0
      ? putApiV3EpisodeMonitor({
          client,
          body: { episodeIds, monitored: false },
        })
      : Promise.resolve(),
    deleteApiV3EpisodefileById({ client, path: { id: episodeFileId } }),
  ])

  revalidatePath(`/show/${tvdbId}`)
}

/**
 * Deletes all downloaded files for a season and unmonitors the episodes.
 * No-ops if the season has no downloaded files.
 */
export async function deleteSeasonFiles(
  seriesId: number,
  seasonNumber: number,
  tvdbId: number,
): Promise<void> {
  const client = getSonarrClient()

  const episodesResult = await getApiV3Episode({
    client,
    query: { seriesId, seasonNumber },
  })

  const episodes = (episodesResult.data ?? []) as EpisodeResource[]
  const episodeIds = episodes.map(ep => ep.id ?? 0).filter(id => id > 0)
  const episodeFileIds = episodes
    .map(ep => ep.episodeFileId ?? 0)
    .filter(id => id > 0)

  if (episodeFileIds.length === 0) return

  await Promise.all([
    episodeIds.length > 0
      ? putApiV3EpisodeMonitor({
          client,
          body: { episodeIds, monitored: false },
        })
      : Promise.resolve(),
    deleteApiV3EpisodefileBulk({ client, body: { episodeFileIds } }),
  ])

  revalidatePath(`/show/${tvdbId}`)
}

/** Searches indexers for available releases matching the given episode. */
export async function searchEpisodeReleases(
  episodeId: number,
): Promise<ShowRelease[]> {
  return searchShowReleases(episodeId)
}

/** Tells Sonarr to grab a specific release for download by its GUID. */
export async function grabEpisodeRelease(
  guid: string,
  indexerId: number,
  tvdbId: number,
) {
  const client = getSonarrClient()
  await postApiV3Release({
    client,
    body: { guid, indexerId } as ReleaseResource,
  })
  revalidatePath(`/show/${tvdbId}`)
}

/** Unmonitors a batch of episodes in Sonarr so they won't be auto-searched. */
export async function unmonitorEpisodes(
  episodeIds: number[],
  tvdbId: number,
): Promise<void> {
  if (episodeIds.length === 0) return

  const client = getSonarrClient()

  await putApiV3EpisodeMonitor({
    client,
    body: { episodeIds, monitored: false },
  })

  revalidatePath(`/show/${tvdbId}`)
}

/** Toggles the monitored flag on a single episode in Sonarr. */
export async function setEpisodeMonitored(
  episodeId: number,
  monitored: boolean,
  tvdbId: number,
) {
  const client = getSonarrClient()
  const result = await getApiV3EpisodeById({ client, path: { id: episodeId } })
  const episode = result.data as EpisodeResource
  await putApiV3EpisodeById({
    client,
    path: { id: episodeId },
    body: { ...episode, monitored },
  })
  revalidatePath(`/show/${tvdbId}`)
}

/** Removes the persisted "not found" search result for a specific episode. */
export async function clearShowEpisodeNotFound(
  tvdbId: number,
  seasonNumber: number,
  episodeNumber: number,
): Promise<void> {
  await clearEpisodeSearchResult(tvdbId, seasonNumber, episodeNumber)
}

/**
 * Adds a show to the Sonarr library. Looks up the series by TVDB ID, then
 * uses the first configured root folder and quality profile to create it.
 * The show is added unmonitored to prevent automatic downloads.
 * @returns The Sonarr series ID of the newly added show.
 */
export async function addShowToLibrary(tvdbId: number): Promise<number> {
  const client = getSonarrClient()

  // Fetch series metadata, root folders, and quality profiles in parallel
  const [lookupResult, rootFolderResult, qualityProfileResult] =
    await Promise.all([
      getApiV3SeriesLookup({ client, query: { term: `tvdb:${tvdbId}` } }),
      getApiV3Rootfolder({ client }),
      getApiV3Qualityprofile({ client }),
    ])

  const series = ((lookupResult.data ?? []) as SeriesResource[])[0]
  if (!series) throw new Error(`No series found for tvdbId ${tvdbId}`)

  const rootFolders = rootFolderResult.data as Array<{ path?: string | null }>
  const qualityProfiles = qualityProfileResult.data as Array<{ id?: number }>

  // Default to first available root folder and quality profile
  const rootFolderPath = rootFolders[0]?.path ?? '/shows'
  const qualityProfileId = qualityProfiles[0]?.id ?? 1

  const result = await postApiV3Series({
    client,
    body: {
      ...series,
      rootFolderPath,
      qualityProfileId,
      monitored: false,
      addOptions: { searchForMissingEpisodes: false, monitor: 'none' },
    } as SeriesResource,
  })

  const created = result.data as SeriesResource
  return created.id ?? 0
}

/**
 * Removes a show from the Sonarr library, deleting its files from disk,
 * and clears all persisted "not found" search results for its episodes.
 */
export async function removeShowFromLibrary(seriesId: number, tvdbId: number) {
  const client = getSonarrClient()
  await Promise.all([
    deleteApiV3SeriesById({
      client,
      path: { id: seriesId },
      query: { deleteFiles: true, addImportListExclusion: false },
    }),
    clearAllShowSearchResults(tvdbId),
  ])
  revalidatePath(`/show/${tvdbId}`)
}
