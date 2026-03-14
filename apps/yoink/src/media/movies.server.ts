import {
  getApiV3Movie,
  getApiV3Moviefile,
  getApiV3MovieLookupTmdb,
  getApiV3QueueDetails,
  type MovieFileResource,
  type MovieResource,
  type QueueResource,
} from '@lilnas/media/radarr-next'

import { getRadarrClient } from 'src/media/clients'
import {
  clearMovieSearchResult,
  getMovieSearchResult,
} from 'src/media/search-results'

import { type MovieDetail, movieResourceToDetail } from './movies'

/**
 * Fetches full movie details by TMDB ID. Checks the Radarr library first;
 * if the movie exists, enriches it with file, queue, and search-result data.
 * Falls back to a TMDB metadata lookup for movies not yet in the library.
 */
export async function getMovie(tmdbId: number): Promise<MovieDetail> {
  const client = getRadarrClient()

  const libraryResult = await getApiV3Movie({ client, query: { tmdbId } })
  const libraryMovies = (libraryResult.data ?? []) as MovieResource[]
  const radarrMovie = libraryMovies[0]

  // Movie exists in the Radarr library — fetch files, queue state, and
  // any prior "not found" search result in parallel
  if (radarrMovie?.id) {
    const movieId = radarrMovie.id
    const [filesResult, queueResult, searchResult] = await Promise.all([
      getApiV3Moviefile({ client, query: { movieId: [movieId] } }),
      getApiV3QueueDetails({
        client,
        query: { movieId, includeMovie: false },
      }),
      getMovieSearchResult(tmdbId),
    ])
    const files = (filesResult.data ?? []) as MovieFileResource[]
    const queueItems = (queueResult.data ?? []) as QueueResource[]

    // If a file now exists but we still have a stale "not found" record,
    // clear it asynchronously and return without a search timestamp
    if (radarrMovie.hasFile && searchResult) {
      void clearMovieSearchResult(tmdbId)
      return movieResourceToDetail(radarrMovie, files, queueItems, true, null)
    }

    return movieResourceToDetail(
      radarrMovie,
      files,
      queueItems,
      true,
      searchResult?.lastSearchedAt ?? null,
    )
  }

  // Movie not in library — look up metadata from TMDB via Radarr
  const [result, searchResult] = await Promise.all([
    getApiV3MovieLookupTmdb({ client, query: { tmdbId } }),
    getMovieSearchResult(tmdbId),
  ])
  const movie = result.data as MovieResource
  return movieResourceToDetail(
    movie,
    [],
    [],
    false,
    searchResult?.lastSearchedAt ?? null,
  )
}
