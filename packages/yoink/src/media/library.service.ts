import {
  getApiV3Movie,
  getApiV3MovieLookup,
  type MovieResource,
} from '@lilnas/media/radarr-next'
import {
  getApiV3Series,
  getApiV3SeriesLookup,
  type SeriesResource,
} from '@lilnas/media/sonarr'
import { Injectable } from '@nestjs/common'

import { cached } from './cache'
import { getRadarrClient, getSonarrClient } from './clients'
import {
  interleave,
  type LibraryItem,
  movieToLibraryItem,
  type SearchFilter,
  seriesToLibraryItem,
} from './library'

const LIBRARY_CACHE_TTL_MS = 60_000

@Injectable()
export class LibraryService {
  private async getLibraryMovies(): Promise<LibraryItem[]> {
    const result = await getApiV3Movie({ client: getRadarrClient() })
    const movies = (result.data ?? []) as MovieResource[]
    return movies.filter(m => m.hasFile).map(movieToLibraryItem)
  }

  private async getLibrarySeries(): Promise<LibraryItem[]> {
    const result = await getApiV3Series({ client: getSonarrClient() })
    const series = (result.data ?? []) as SeriesResource[]
    return series
      .filter(s => (s.statistics?.episodeFileCount ?? 0) > 0)
      .map(seriesToLibraryItem)
  }

  async getLibrary(): Promise<LibraryItem[]> {
    const [movies, series] = await Promise.all([
      this.getLibraryMovies(),
      this.getLibrarySeries(),
    ])
    return [...movies, ...series]
  }

  private async lookupMovies(term: string): Promise<LibraryItem[]> {
    const client = getRadarrClient()
    const [lookupResult, allMovies] = await Promise.all([
      getApiV3MovieLookup({ client, query: { term } }),
      cached('radarr:movies', LIBRARY_CACHE_TTL_MS, () =>
        getApiV3Movie({ client }).then(r => (r.data ?? []) as MovieResource[]),
      ),
    ])

    const libraryByTmdbId = new Map<number, MovieResource>()
    for (const m of allMovies) {
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

  private async lookupSeries(term: string): Promise<LibraryItem[]> {
    const client = getSonarrClient()
    const [lookupResult, allSeries] = await Promise.all([
      getApiV3SeriesLookup({ client, query: { term } }),
      cached('sonarr:series', LIBRARY_CACHE_TTL_MS, () =>
        getApiV3Series({ client }).then(
          r => (r.data ?? []) as SeriesResource[],
        ),
      ),
    ])

    const libraryByTvdbId = new Map<number, SeriesResource>()
    for (const s of allSeries) {
      if (s.tvdbId) libraryByTvdbId.set(s.tvdbId, s)
    }

    const series = (lookupResult.data ?? []) as SeriesResource[]
    return series.map(s => {
      const libSeries = s.tvdbId ? libraryByTvdbId.get(s.tvdbId) : undefined
      if (libSeries) return seriesToLibraryItem(libSeries)
      return {
        ...seriesToLibraryItem(s),
        id: s.tvdbId ?? 0,
        href: `/show/${s.tvdbId}`,
      }
    })
  }

  async search(
    term: string,
    filter: SearchFilter = 'all',
  ): Promise<LibraryItem[]> {
    if (filter === 'movies') return this.lookupMovies(term)
    if (filter === 'shows') return this.lookupSeries(term)

    const [movies, series] = await Promise.all([
      this.lookupMovies(term),
      this.lookupSeries(term),
    ])
    return interleave(movies, series)
  }
}
