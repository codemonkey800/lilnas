import {
  getApiV3Movie,
  getApiV3Moviefile,
  getApiV3MovieLookupTmdb,
  getApiV3QueueDetails,
  getApiV3Release,
  type MediaCover,
  type MovieFileResource,
  type MovieResource,
  type QueueResource,
  type ReleaseResource,
} from '@lilnas/media/radarr-next'

import { getRadarrClient } from 'src/lib/media-clients'

interface MovieFileInfo {
  id: number
  relativePath: string | null
  size: number
  quality: string | null
  dateAdded: string | null
}

export interface MovieDownloadInfo {
  id: number
  title: string | null
  size: number
  sizeleft: number
  status: string
  trackedDownloadState: string | null
  estimatedCompletionTime: string | null
}

export interface MovieDetail {
  id: number
  tmdbId: number | null
  title: string
  year: number
  runtime: number | null
  certification: string | null
  overview: string | null
  posterUrl: string | null
  fanartUrl: string | null
  quality: string | null
  status: 'downloaded' | 'missing'
  genres: string[]
  ratings: { imdb: number | null; tmdb: number | null }
  isInLibrary: boolean
  sizeOnDisk: number | null
  files: MovieFileInfo[]
  download: MovieDownloadInfo | null
}

export interface MovieRelease {
  guid: string
  title: string | null
  size: number
  age: number
  indexer: string | null
  seeders: number | null
  leechers: number | null
  quality: string | null
  language: string | null
  protocol: 'usenet' | 'torrent' | 'unknown'
  approved: boolean
  indexerId: number
  downloadUrl: string | null
}

function getImageUrl(
  images: Array<MediaCover> | null | undefined,
  type: 'poster' | 'fanart',
): string | null {
  const img = images?.find(i => i.coverType === type)
  return img?.remoteUrl ?? img?.url ?? null
}

function movieFileToInfo(f: MovieFileResource): MovieFileInfo {
  return {
    id: f.id ?? 0,
    relativePath: f.relativePath ?? null,
    size: f.size ?? 0,
    quality: f.quality?.quality?.name ?? null,
    dateAdded: f.dateAdded ?? null,
  }
}

export function queueToDownloadInfo(q: QueueResource): MovieDownloadInfo {
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

function movieResourceToDetail(
  movie: MovieResource,
  files: MovieFileResource[],
  queueItems: QueueResource[],
  isInLibrary: boolean,
): MovieDetail {
  const activeDownload = queueItems.find(
    q =>
      q.status === 'downloading' ||
      q.status === 'queued' ||
      q.status === 'paused' ||
      q.status === 'delay' ||
      q.status === 'completed',
  )

  return {
    id: movie.id ?? 0,
    tmdbId: movie.tmdbId ?? null,
    title: movie.title ?? 'Unknown',
    year: movie.year ?? 0,
    runtime: movie.runtime ?? null,
    certification: movie.certification ?? null,
    overview: movie.overview ?? null,
    posterUrl: getImageUrl(movie.images, 'poster'),
    fanartUrl: getImageUrl(movie.images, 'fanart'),
    quality: movie.movieFile?.quality?.quality?.name ?? null,
    status: movie.hasFile ? 'downloaded' : 'missing',
    genres: movie.genres ?? [],
    ratings: {
      imdb: movie.ratings?.imdb?.value ?? null,
      tmdb: movie.ratings?.tmdb?.value ?? null,
    },
    isInLibrary,
    sizeOnDisk: movie.sizeOnDisk ?? null,
    files: files.map(movieFileToInfo),
    download: activeDownload ? queueToDownloadInfo(activeDownload) : null,
  }
}

export async function getMovie(tmdbIdStr: string): Promise<MovieDetail> {
  const client = getRadarrClient()
  const tmdbId = Number(tmdbIdStr)

  const libraryResult = await getApiV3Movie({ client, query: { tmdbId } })
  const libraryMovies = (libraryResult.data ?? []) as MovieResource[]
  const radarrMovie = libraryMovies[0]

  if (radarrMovie?.id) {
    const movieId = radarrMovie.id
    const [filesResult, queueResult] = await Promise.all([
      getApiV3Moviefile({ client, query: { movieId: [movieId] } }),
      getApiV3QueueDetails({
        client,
        query: { movieId, includeMovie: false },
      }),
    ])
    const files = (filesResult.data ?? []) as MovieFileResource[]
    const queueItems = (queueResult.data ?? []) as QueueResource[]
    return movieResourceToDetail(radarrMovie, files, queueItems, true)
  }

  const result = await getApiV3MovieLookupTmdb({ client, query: { tmdbId } })
  const movie = result.data as MovieResource
  return movieResourceToDetail(movie, [], [], false)
}

function releaseToMovieRelease(r: ReleaseResource): MovieRelease {
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
    downloadUrl: r.downloadUrl ?? r.magnetUrl ?? null,
  }
}

export async function searchMovieReleases(
  movieId: number,
): Promise<MovieRelease[]> {
  const client = getRadarrClient()
  const result = await getApiV3Release({
    client,
    query: { movieId },
  })
  const releases = (result.data ?? []) as ReleaseResource[]
  return releases
    .filter(r => !r.rejected)
    .map(releaseToMovieRelease)
    .filter(r => r.downloadUrl != null)
}
