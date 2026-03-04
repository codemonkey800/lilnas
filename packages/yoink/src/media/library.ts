import {
  getApiV3Movie,
  getApiV3MovieLookup,
  type MediaCover,
  type MovieResource,
} from '@lilnas/media/radarr-next'
import {
  getApiV3Series,
  getApiV3SeriesLookup,
  type SeriesResource,
} from '@lilnas/media/sonarr'

import { getRadarrClient, getSonarrClient } from 'src/media/clients'

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
    href: `/movie/${movie.tmdbId}`,
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

async function getLibraryMovies(): Promise<LibraryItem[]> {
  const result = await getApiV3Movie({ client: getRadarrClient() })
  const movies = (result.data ?? []) as MovieResource[]
  return movies.filter(m => m.hasFile).map(movieToLibraryItem)
}

async function getLibrarySeries(): Promise<LibraryItem[]> {
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

export type SearchFilter = 'all' | 'movies' | 'shows'

async function lookupMovies(term: string): Promise<LibraryItem[]> {
  const client = getRadarrClient()
  const [lookupResult, libraryResult] = await Promise.all([
    getApiV3MovieLookup({ client, query: { term } }),
    getApiV3Movie({ client }),
  ])

  const libraryMovies = (libraryResult.data ?? []) as MovieResource[]
  const libraryByTmdbId = new Map<number, MovieResource>()
  for (const m of libraryMovies) {
    if (m.tmdbId) libraryByTmdbId.set(m.tmdbId, m)
  }

  const movies = (lookupResult.data ?? []) as MovieResource[]
  return movies.map(movie => {
    const libMovie = movie.tmdbId
      ? libraryByTmdbId.get(movie.tmdbId)
      : undefined
    if (libMovie) return movieToLibraryItem(libMovie)
    return {
      ...movieToLibraryItem(movie),
      id: movie.tmdbId ?? 0,
      href: `/movie/${movie.tmdbId}`,
    }
  })
}

async function lookupSeries(term: string): Promise<LibraryItem[]> {
  const client = getSonarrClient()
  const [lookupResult, libraryResult] = await Promise.all([
    getApiV3SeriesLookup({ client, query: { term } }),
    getApiV3Series({ client }),
  ])

  const librarySeries = (libraryResult.data ?? []) as SeriesResource[]
  const libraryByTvdbId = new Map<number, SeriesResource>()
  for (const s of librarySeries) {
    if (s.tvdbId) libraryByTvdbId.set(s.tvdbId, s)
  }

  const series = (lookupResult.data ?? []) as SeriesResource[]
  return series.map(s => {
    const libSeries = s.tvdbId ? libraryByTvdbId.get(s.tvdbId) : undefined
    if (libSeries) return seriesToLibraryItem(libSeries)
    return {
      ...seriesToLibraryItem(s),
      id: s.tvdbId ?? 0,
      href: `/show/tvdb-${s.tvdbId}`,
    }
  })
}

function interleave(a: LibraryItem[], b: LibraryItem[]): LibraryItem[] {
  const result: LibraryItem[] = []
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (i < a.length) result.push(a[i]!)
    if (i < b.length) result.push(b[i]!)
  }
  return result
}

export async function searchMedia(
  term: string,
  filter: SearchFilter = 'all',
): Promise<LibraryItem[]> {
  if (filter === 'movies') return lookupMovies(term)
  if (filter === 'shows') return lookupSeries(term)

  const [movies, series] = await Promise.all([
    lookupMovies(term),
    lookupSeries(term),
  ])
  return interleave(movies, series)
}
