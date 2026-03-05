import {
  type EpisodeFileResource,
  type EpisodeResource,
  getApiV3Release,
  type MediaCover,
  type QueueResource,
  type ReleaseResource,
  type SeriesResource,
} from '@lilnas/media/sonarr'

import { getSonarrClient } from 'src/media/clients'

import { type MovieDownloadInfo, type MovieRelease } from './movies'

// Re-export these so callers can use them without importing from movies
export type { MovieDownloadInfo as EpisodeDownloadInfo }
export type ShowRelease = MovieRelease

export interface EpisodeInfo {
  id: number
  episodeFileId: number | null
  seasonNumber: number
  episodeNumber: number
  title: string | null
  airDate: string | null
  hasFile: boolean
  monitored: boolean
  quality: string | null
  fileSize: number | null
  relativePath: string | null
  download: MovieDownloadInfo | null
  /** ISO timestamp of the last search that found no results. Null means never searched or was found. */
  lastSearchedAt: string | null
}

export interface SeasonInfo {
  seasonNumber: number
  episodeCount: number
  downloadedCount: number
  monitored: boolean
  sizeOnDisk: number
  episodes: EpisodeInfo[]
  imageUrl: string | null
}

export interface ShowDetail {
  id: number
  tvdbId: number | null
  title: string
  year: number
  overview: string | null
  posterUrl: string | null
  fanartUrl: string | null
  bannerUrl: string | null
  network: string | null
  status: string | null
  seriesType: string | null
  genres: string[]
  ratings: { value: number | null }
  certification: string | null
  runtime: number | null
  isInLibrary: boolean
  sizeOnDisk: number
  seasons: SeasonInfo[]
  firstAired: string | null
  lastAired: string | null
  imdbId: string | null
  tmdbId: number | null
  tvMazeId: number | null
  originalLanguage: string | null
  totalEpisodeCount: number
  episodeFileCount: number
  screenshots: string[]
}

function getImageUrl(
  images: Array<MediaCover> | null | undefined,
  type: 'poster' | 'fanart' | 'banner' | 'screenshot',
): string | null {
  const img = images?.find(i => i.coverType === type)
  return img?.remoteUrl ?? img?.url ?? null
}

function queueItemToDownloadInfo(q: QueueResource): MovieDownloadInfo {
  return {
    id: q.id ?? 0,
    title: q.title ?? null,
    size: q.size ?? 0,
    sizeleft: q.sizeleft ?? 0,
    status: q.status ?? 'unknown',
    trackedDownloadState: q.trackedDownloadState ?? null,
    estimatedCompletionTime: q.estimatedCompletionTime ?? null,
  }
}

const ACTIVE_STATUSES = new Set([
  'downloading',
  'queued',
  'paused',
  'delay',
  'completed',
])

function buildEpisodeInfo(
  ep: EpisodeResource,
  fileMap: Map<number, EpisodeFileResource>,
  queueMap: Map<number, QueueResource>,
  searchResultsMap: Map<string, { lastSearchedAt: Date }>,
): EpisodeInfo {
  const file = ep.episodeFileId ? fileMap.get(ep.episodeFileId) : undefined
  const queueItem = ep.id ? queueMap.get(ep.id) : undefined

  const sn = ep.seasonNumber ?? 0
  const en = ep.episodeNumber ?? 0
  const key = `S${sn}E${en}`
  const searchResult = searchResultsMap.get(key)

  return {
    id: ep.id ?? 0,
    episodeFileId: ep.episodeFileId ?? null,
    seasonNumber: sn,
    episodeNumber: en,
    title: ep.title ?? null,
    airDate: ep.airDate ?? null,
    hasFile: ep.hasFile ?? false,
    monitored: ep.monitored ?? false,
    quality: file?.quality?.quality?.name ?? null,
    fileSize: file?.size ?? null,
    relativePath: file?.relativePath ?? null,
    download: queueItem ? queueItemToDownloadInfo(queueItem) : null,
    lastSearchedAt: searchResult?.lastSearchedAt.toISOString() ?? null,
  }
}

export function buildShowDetail(
  series: SeriesResource,
  episodes: EpisodeResource[],
  files: EpisodeFileResource[],
  queueItems: QueueResource[],
  isInLibrary: boolean,
  searchResultsMap: Map<string, { lastSearchedAt: Date }>,
): ShowDetail {
  const fileMap = new Map<number, EpisodeFileResource>()
  for (const f of files) {
    if (f.id) fileMap.set(f.id, f)
  }

  // Map from episodeId -> active queue item
  const queueMap = new Map<number, QueueResource>()
  for (const q of queueItems) {
    if (q.episodeId && ACTIVE_STATUSES.has(q.status ?? '')) {
      queueMap.set(q.episodeId, q)
    }
  }

  // Group episodes by season, skip season 0 (specials) unless it has episodes
  const seasonMap = new Map<number, EpisodeResource[]>()
  for (const ep of episodes) {
    const sn = ep.seasonNumber ?? 0
    const existing = seasonMap.get(sn)
    if (existing) {
      existing.push(ep)
    } else {
      seasonMap.set(sn, [ep])
    }
  }

  // Build season info from the series.seasons array (authoritative for season metadata)
  const seasons: SeasonInfo[] = []
  const seriesSeasons = (series.seasons ?? []).filter(
    s => (s.seasonNumber ?? 0) > 0,
  )

  for (const s of seriesSeasons) {
    const sn = s.seasonNumber ?? 0
    const seasonEpisodes = (seasonMap.get(sn) ?? []).sort(
      (a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0),
    )

    const episodeInfos = seasonEpisodes.map(ep =>
      buildEpisodeInfo(ep, fileMap, queueMap, searchResultsMap),
    )

    const downloadedCount = episodeInfos.filter(e => e.hasFile).length

    const seasonImages = s.images as Array<MediaCover> | null | undefined
    const seasonImageUrl =
      getImageUrl(seasonImages, 'poster') ??
      getImageUrl(seasonImages, 'banner') ??
      getImageUrl(seasonImages, 'screenshot')

    seasons.push({
      seasonNumber: sn,
      episodeCount: s.statistics?.totalEpisodeCount ?? seasonEpisodes.length,
      downloadedCount,
      monitored: s.monitored ?? false,
      sizeOnDisk: s.statistics?.sizeOnDisk ?? 0,
      episodes: episodeInfos,
      imageUrl: seasonImageUrl,
    })
  }

  seasons.sort((a, b) => a.seasonNumber - b.seasonNumber)

  // Collect episode screenshots from episode images
  const screenshotSet = new Set<string>()
  for (const ep of episodes) {
    const epImages = ep.images as Array<MediaCover> | null | undefined
    if (!epImages) continue
    for (const img of epImages) {
      if (img.coverType === 'screenshot') {
        const url = img.remoteUrl ?? img.url
        if (url) screenshotSet.add(url)
      }
    }
  }
  // Also include series-level screenshot/banner
  const seriesImages = series.images as Array<MediaCover> | null
  const seriesScreenshot = getImageUrl(seriesImages, 'screenshot')
  if (seriesScreenshot) screenshotSet.add(seriesScreenshot)

  return {
    id: series.id ?? 0,
    tvdbId: series.tvdbId ?? null,
    title: series.title ?? 'Unknown',
    year: series.year ?? 0,
    overview: series.overview ?? null,
    posterUrl: getImageUrl(seriesImages, 'poster'),
    fanartUrl: getImageUrl(seriesImages, 'fanart'),
    bannerUrl: getImageUrl(seriesImages, 'banner'),
    network: series.network ?? null,
    status: series.status ?? null,
    seriesType: series.seriesType ?? null,
    genres: series.genres ?? [],
    ratings: { value: series.ratings?.value ?? null },
    certification: series.certification ?? null,
    runtime: series.runtime ?? null,
    isInLibrary,
    sizeOnDisk: series.statistics?.sizeOnDisk ?? 0,
    seasons,
    firstAired: series.firstAired ?? null,
    lastAired: series.lastAired ?? null,
    imdbId: series.imdbId ?? null,
    tmdbId: series.tmdbId ?? null,
    tvMazeId: series.tvMazeId ?? null,
    originalLanguage: series.originalLanguage?.name ?? null,
    totalEpisodeCount: series.statistics?.totalEpisodeCount ?? 0,
    episodeFileCount: series.statistics?.episodeFileCount ?? 0,
    screenshots: Array.from(screenshotSet),
  }
}

function releaseToShowRelease(r: ReleaseResource): ShowRelease {
  return {
    guid: r.guid ?? '',
    title: r.title ?? null,
    size: r.size ?? 0,
    age: r.age ?? 0,
    indexer: r.indexer ?? null,
    seeders: r.seeders ?? null,
    leechers: r.leechers ?? null,
    quality: r.quality?.quality?.name ?? null,
    language:
      r.languages
        ?.map(l => l.name)
        .filter(Boolean)
        .join(', ') ?? null,
    protocol: r.protocol ?? 'unknown',
    approved: r.approved ?? false,
    indexerId: r.indexerId ?? 0,
    downloadUrl: r.downloadUrl ?? null,
  }
}

export async function searchShowReleases(
  episodeId: number,
): Promise<ShowRelease[]> {
  const client = getSonarrClient()
  const result = await getApiV3Release({
    client,
    query: { episodeId },
  })
  const releases = (result.data ?? []) as ReleaseResource[]
  return releases
    .filter(r => !r.rejected)
    .map(releaseToShowRelease)
    .filter(r => r.downloadUrl != null)
}
