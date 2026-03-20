import {
  type EpisodeFileResource,
  type EpisodeResource,
  type MediaCover,
  type SeriesResource,
} from '@lilnas/media/sonarr'

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
}

export interface SeasonInfo {
  seasonNumber: number
  episodeCount: number
  downloadedCount: number
  monitored: boolean
  sizeOnDisk: number
  episodes: EpisodeInfo[]
}

export interface ShowDetail {
  id: number
  tvdbId: number | null
  title: string
  year: number
  overview: string | null
  posterUrl: string | null
  fanartUrl: string | null
  network: string | null
  status: string | null
  genres: string[]
  ratings: { value: number | null }
  runtime: number | null
  sizeOnDisk: number
  seasons: SeasonInfo[]
  firstAired: string | null
  imdbId: string | null
  tmdbId: number | null
  totalEpisodeCount: number
  episodeFileCount: number
}

function getImageUrl(
  images: Array<MediaCover> | null | undefined,
  type: 'poster' | 'fanart',
): string | null {
  const img = images?.find(i => i.coverType === type)
  return img?.remoteUrl ?? img?.url ?? null
}

function buildEpisodeInfo(
  ep: EpisodeResource,
  fileMap: Map<number, EpisodeFileResource>,
): EpisodeInfo {
  const file = ep.episodeFileId ? fileMap.get(ep.episodeFileId) : undefined
  return {
    id: ep.id ?? 0,
    episodeFileId: ep.episodeFileId ?? null,
    seasonNumber: ep.seasonNumber ?? 0,
    episodeNumber: ep.episodeNumber ?? 0,
    title: ep.title ?? null,
    airDate: ep.airDate ?? null,
    hasFile: ep.hasFile ?? false,
    monitored: ep.monitored ?? false,
    quality: file?.quality?.quality?.name ?? null,
    fileSize: file?.size ?? null,
    relativePath: file?.relativePath ?? null,
  }
}

export function buildShowDetail(
  series: SeriesResource,
  episodes: EpisodeResource[],
  files: EpisodeFileResource[],
): ShowDetail {
  const fileMap = new Map<number, EpisodeFileResource>()
  for (const f of files) {
    if (f.id) fileMap.set(f.id, f)
  }

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

  const seasons: SeasonInfo[] = []
  const seriesSeasons = (series.seasons ?? []).filter(
    s => (s.seasonNumber ?? 0) > 0,
  )

  for (const s of seriesSeasons) {
    const sn = s.seasonNumber ?? 0
    const seasonEpisodes = (seasonMap.get(sn) ?? []).sort(
      (a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0),
    )
    const episodeInfos = seasonEpisodes.map(ep => buildEpisodeInfo(ep, fileMap))
    const downloadedCount = episodeInfos.filter(e => e.hasFile).length

    seasons.push({
      seasonNumber: sn,
      episodeCount: s.statistics?.totalEpisodeCount ?? seasonEpisodes.length,
      downloadedCount,
      monitored: s.monitored ?? false,
      sizeOnDisk: s.statistics?.sizeOnDisk ?? 0,
      episodes: episodeInfos,
    })
  }

  seasons.sort((a, b) => a.seasonNumber - b.seasonNumber)

  const seriesImages = series.images as Array<MediaCover> | null | undefined

  return {
    id: series.id ?? 0,
    tvdbId: series.tvdbId ?? null,
    title: series.title ?? 'Unknown',
    year: series.year ?? 0,
    overview: series.overview ?? null,
    posterUrl: getImageUrl(seriesImages, 'poster'),
    fanartUrl: getImageUrl(seriesImages, 'fanart'),
    network: series.network ?? null,
    status: series.status ?? null,
    genres: series.genres ?? [],
    ratings: { value: series.ratings?.value ?? null },
    runtime: series.runtime ?? null,
    sizeOnDisk: series.statistics?.sizeOnDisk ?? 0,
    seasons,
    firstAired: series.firstAired ?? null,
    imdbId: series.imdbId ?? null,
    tmdbId: series.tmdbId ?? null,
    totalEpisodeCount: series.statistics?.totalEpisodeCount ?? 0,
    episodeFileCount: series.statistics?.episodeFileCount ?? 0,
  }
}
