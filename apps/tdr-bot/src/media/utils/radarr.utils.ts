import type { MovieResource, QueueResource } from '@lilnas/media/radarr'

import {
  DownloadingMovieSchema,
  RadarrMovieResourceSchema,
  RadarrMovieSchema,
} from 'src/media/schemas/radarr.schemas'
import type {
  DownloadingMovie,
  MovieSearchResult,
  RadarrMovie,
  RadarrMovieResource,
} from 'src/media/types/radarr.types'
import { stripNulls } from 'src/media/utils/media.utils'

/**
 * Helper function to filter out empty URLs
 */
const getValidUrl = (url?: string): string | undefined => {
  return url && url.trim() !== '' ? url : undefined
}

/**
 * Helper function to get valid image URL by cover type
 */
const getImageUrl = (
  images: RadarrMovieResource['images'],
  coverType: string,
): string | undefined => {
  const image = images.find(img => img.coverType === coverType)
  return getValidUrl(image?.url)
}

/**
 * Helper function to get valid year
 */
const getValidYear = (year?: number): number | undefined => {
  return year && year >= 1900 && year <= 2100 ? year : undefined
}

/**
 * Validates an SDK MovieResource as a RadarrMovieResource (lookup/search result)
 * using the full Zod schema. Null values from the SDK are stripped to undefined
 * before parsing so all required fields are properly validated.
 *
 * Throws a ZodError if any required field is missing or invalid.
 */
export function toRadarrMovieResource(r: MovieResource): RadarrMovieResource {
  return RadarrMovieResourceSchema.parse(stripNulls(r)) as RadarrMovieResource
}

/**
 * Validates an array of SDK MovieResource objects as RadarrMovieResources.
 */
export function toRadarrMovieResourceArray(
  rs: MovieResource[],
): RadarrMovieResource[] {
  return rs.map(toRadarrMovieResource)
}

/**
 * Validates an SDK MovieResource as a full RadarrMovie (library movie) using
 * the full Zod schema. Null values from the SDK are stripped to undefined
 * before parsing so all required fields (id, path, monitored, etc.) are
 * properly validated.
 *
 * Throws a ZodError if any required field is missing or invalid.
 */
export function toRadarrMovie(r: MovieResource): RadarrMovie {
  return RadarrMovieSchema.parse(stripNulls(r)) as RadarrMovie
}

/**
 * Validates an array of SDK MovieResource objects as RadarrMovies.
 */
export function toRadarrMovieArray(rs: MovieResource[]): RadarrMovie[] {
  return rs.map(toRadarrMovie)
}

/**
 * Transform Radarr movie resource to simplified search result
 * Utility function for converting API responses to standardized format
 */
export function transformToSearchResult(
  movie: RadarrMovieResource,
): MovieSearchResult {
  return {
    tmdbId: movie.tmdbId,
    imdbId: movie.imdbId,
    title: movie.title,
    originalTitle: movie.originalTitle,
    year: getValidYear(movie.year),
    overview: movie.overview,
    runtime: movie.runtime,
    genres: movie.genres,
    rating: movie.ratings?.imdb?.value || movie.ratings?.tmdb?.value,
    posterPath: getImageUrl(movie.images, 'poster'),
    backdropPath: getImageUrl(movie.images, 'fanart'),
    inCinemas: movie.inCinemas,
    physicalRelease: movie.physicalRelease,
    digitalRelease: movie.digitalRelease,
    status: movie.status,
    certification: movie.certification,
    studio: movie.studio,
    website: getValidUrl(movie.website),
    youTubeTrailerId: movie.youTubeTrailerId,
    popularity: movie.popularity,
  }
}

/**
 * Transform multiple Radarr movie resources to search results
 * Convenience function for batch transformation
 */
export function transformToSearchResults(
  movies: RadarrMovieResource[],
): MovieSearchResult[] {
  return movies.map(transformToSearchResult)
}

/**
 * Maps a Radarr SDK QueueResource to a DownloadingMovie and validates via the
 * Zod schema. Replaces scattered inline `as` casts so type mismatches surface
 * at runtime through a ZodError rather than being silently ignored.
 */
export function toDownloadingMovie(item: QueueResource): DownloadingMovie {
  const size = item.size ?? 0
  const sizeleft = item.sizeleft ?? 0
  const downloadedBytes = Math.max(0, size - sizeleft)
  const progressPercent =
    size > 0
      ? Math.round(
          Math.min(100, Math.max(0, (downloadedBytes / size) * 100)) * 100,
        ) / 100
      : 0

  return DownloadingMovieSchema.parse({
    id: item.id ?? 0,
    movieId: item.movieId ?? undefined,
    movieTitle: item.movie?.title || item.title || undefined,
    movieYear: item.movie?.year,
    size,
    status: item.status,
    trackedDownloadStatus: item.trackedDownloadStatus,
    trackedDownloadState: item.trackedDownloadState,
    statusMessages: item.statusMessages ?? undefined,
    errorMessage: item.errorMessage ?? undefined,
    downloadId: item.downloadId ?? undefined,
    protocol: item.protocol,
    downloadClient: item.downloadClient ?? undefined,
    indexer: item.indexer ?? undefined,
    outputPath: item.outputPath ?? undefined,
    estimatedCompletionTime: item.estimatedCompletionTime ?? undefined,
    added: item.added ?? undefined,
    sizeleft,
    progressPercent,
    downloadedBytes,
  }) as DownloadingMovie
}
