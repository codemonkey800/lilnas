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

import { movieResourceToDetail, type MovieDetail } from './movies'

export async function getMovie(tmdbIdStr: string): Promise<MovieDetail> {
  const client = getRadarrClient()
  const tmdbId = Number(tmdbIdStr)

  const libraryResult = await getApiV3Movie({ client, query: { tmdbId } })
  const libraryMovies = (libraryResult.data ?? []) as MovieResource[]
  const radarrMovie = libraryMovies[0]

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
