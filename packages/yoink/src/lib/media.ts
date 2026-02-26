import {
  getApiV3Movie,
  type MediaCover,
  type MovieResource,
} from '@lilnas/media/radarr'
import { getApiV3Series, type SeriesResource } from '@lilnas/media/sonarr'

import { getRadarrClient, getSonarrClient } from 'src/lib/media-clients'

export interface LibraryItem {
  id: number
  title: string
  year: number
  posterUrl: string | null
  mediaType: 'movie' | 'show'
  quality: string | null
  status: 'downloaded' | 'missing'
  href: string
  addedAt: string
  releaseDate: string | null
}

function getPosterUrl(images?: Array<MediaCover> | null): string | null {
  const poster = images?.find(img => img.coverType === 'poster')
  return poster?.remoteUrl ?? poster?.url ?? null
}

function movieToLibraryItem(movie: MovieResource): LibraryItem {
  return {
    id: movie.id ?? 0,
    title: movie.title ?? 'Unknown',
    year: movie.year ?? 0,
    posterUrl: getPosterUrl(movie.images),
    mediaType: 'movie',
    quality: movie.movieFile?.quality?.quality?.name ?? null,
    status: movie.hasFile ? 'downloaded' : 'missing',
    href: `/movie/${movie.id}`,
    addedAt: movie.added ?? new Date(0).toISOString(),
    releaseDate:
      movie.releaseDate ?? movie.digitalRelease ?? movie.inCinemas ?? null,
  }
}

function seriesToLibraryItem(series: SeriesResource): LibraryItem {
  return {
    id: series.id ?? 0,
    title: series.title ?? 'Unknown',
    year: series.year ?? 0,
    posterUrl: getPosterUrl(
      series.images as Array<MediaCover> | null | undefined,
    ),
    mediaType: 'show',
    quality: null,
    status:
      (series.statistics?.episodeFileCount ?? 0) > 0 ? 'downloaded' : 'missing',
    href: `/show/${series.id}`,
    addedAt: series.added ?? new Date(0).toISOString(),
    releaseDate: series.firstAired ?? null,
  }
}

export async function getLibraryMovies(): Promise<LibraryItem[]> {
  const result = await getApiV3Movie({ client: getRadarrClient() })
  const movies = (result.data ?? []) as MovieResource[]
  return movies.filter(m => m.hasFile).map(movieToLibraryItem)
}

export async function getLibrarySeries(): Promise<LibraryItem[]> {
  const result = await getApiV3Series({ client: getSonarrClient() })
  const series = (result.data ?? []) as SeriesResource[]
  return series
    .filter(s => (s.statistics?.episodeFileCount ?? 0) > 0)
    .map(seriesToLibraryItem)
}

export async function getLibrary(): Promise<LibraryItem[]> {
  const [movies, series] = await Promise.all([
    getLibraryMovies(),
    getLibrarySeries(),
  ])
  return [...movies, ...series]
}
