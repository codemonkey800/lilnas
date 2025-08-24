import { Logger } from '@nestjs/common'

import { MediaSearchResult } from 'src/commands/media-search.types'
import { RadarrMovie as RadarrMovieInterface } from 'src/media/clients/radarr.client'
import {
  extractPosterUrl,
  getRadarrBaseUrl,
} from 'src/media/utils/image-url-extractor'
import { MediaType } from 'src/types/enums'

// Extended RadarrMovie interface to include optional properties
type RadarrMovie = RadarrMovieInterface & {
  hasFile?: boolean
  runtime?: number
  genres?: string[]
}

/**
 * Convert a Radarr movie object to a standardized MediaSearchResult.
 * This function handles poster URL extraction, status determination, and proper ID mapping.
 * Includes validation for data consistency between inLibrary and radarrId properties.
 *
 * @param movie - The Radarr movie object to convert
 * @param logger - Optional logger instance for debug output
 * @returns MediaSearchResult object with standardized properties
 */
export function convertRadarrMovieToSearchResult(
  movie: RadarrMovie,
  logger?: Logger,
): MediaSearchResult {
  // Extract the best available poster URL using the image utility
  const imageResult = extractPosterUrl(movie, {
    radarrBaseUrl: getRadarrBaseUrl() || undefined,
    preferredCoverType: 'poster',
    debug: process.env.NODE_ENV === 'development',
  })

  // Log debug information if available and logger is provided
  if (imageResult.debug && process.env.NODE_ENV === 'development' && logger) {
    logger.debug('Poster URL extraction result', {
      title: movie.title,
      source: imageResult.source,
      imageUrl: imageResult.imageUrl,
      debug: imageResult.debug,
    })
  }

  // Determine if movie is in library based on Radarr internal ID
  // Note: radarrId can be 0 (valid but falsy), so check for undefined explicitly
  const inLibrary = movie.id !== undefined
  const radarrId = movie.id

  // Validate data consistency between inLibrary and radarrId
  if (inLibrary && radarrId === undefined) {
    // This should never happen in practice, but log it as a warning
    if (logger) {
      logger.warn(
        'Data consistency issue: movie appears to be in library but lacks Radarr ID',
        {
          title: movie.title,
          tmdbId: movie.tmdbId,
          radarrId: movie.id,
          inLibrary,
          warning: 'This may indicate a problem with the Radarr API response',
        },
      )
    }
  }

  // Handle edge case: movie.id = 0 (valid but falsy)
  if (radarrId === 0 && logger) {
    logger.debug(
      'Edge case detected: movie has radarrId = 0 (valid but falsy)',
      {
        title: movie.title,
        tmdbId: movie.tmdbId,
        radarrId,
        note: 'radarrId=0 is a valid Radarr ID but falsy in JavaScript',
      },
    )
  }

  // Validate essential movie data
  if (!movie.title || !movie.tmdbId) {
    if (logger) {
      logger.warn('Movie missing essential data', {
        title: movie.title,
        tmdbId: movie.tmdbId,
        radarrId: movie.id,
        warning:
          'Movie missing title or TMDB ID - this may cause display issues',
      })
    }
  }

  // Create the search result with standardized mapping
  const result: MediaSearchResult = {
    id: movie.tmdbId?.toString() || movie.id?.toString() || 'unknown', // Use TMDB ID for display, fallback to Radarr ID
    title: movie.title,
    year: movie.year,
    overview: movie.overview,
    posterUrl: imageResult.imageUrl || undefined,
    tmdbId: movie.tmdbId,
    imdbId: movie.imdbId,
    radarrId, // Store Radarr's internal ID for API operations
    mediaType: MediaType.MOVIE,
    inLibrary,
    monitored: movie.monitored,
    hasFile: Boolean(movie.downloaded || movie.hasFile), // Check both potential properties, ensure boolean
    status: movie.status,
    runtime: movie.runtime,
    genres: movie.genres,
  }

  // Final validation: ensure inLibrary and radarrId consistency
  const isConsistent = validateSearchResultConsistency(result, logger)
  if (!isConsistent && logger) {
    logger.error('Search result validation failed after conversion', {
      movieTitle: result.title,
      radarrId: result.radarrId,
      tmdbId: result.tmdbId,
      inLibrary: result.inLibrary,
      validationFailure: 'inLibrary and radarrId are inconsistent',
    })
  }

  // Debug logging for conversion tracking
  if (logger && process.env.NODE_ENV === 'development') {
    logger.debug('Converted Radarr movie to search result', {
      movieTitle: movie.title,
      radarrId: movie.id,
      tmdbId: movie.tmdbId,
      displayId: result.id,
      inLibrary: result.inLibrary,
      monitored: result.monitored,
      hasFile: result.hasFile,
      dataConsistent: isConsistent,
    })
  }

  return result
}

/**
 * Validate that inLibrary and radarrId properties are consistent.
 * Movies in library should always have a radarrId (including 0).
 * External movies should not have a radarrId.
 *
 * @param result - The MediaSearchResult to validate
 * @param logger - Optional logger for warnings
 * @returns true if data is consistent, false otherwise
 */
export function validateSearchResultConsistency(
  result: MediaSearchResult,
  logger?: Logger,
): boolean {
  // Case 1: Movie in library should have radarrId
  if (result.inLibrary && result.radarrId === undefined) {
    if (logger) {
      logger.warn(
        'Consistency validation failed: movie in library without radarrId',
        {
          title: result.title,
          mediaId: result.id,
          tmdbId: result.tmdbId,
          inLibrary: result.inLibrary,
          radarrId: result.radarrId,
          issue: 'inLibrary=true but radarrId=undefined',
        },
      )
    }
    return false
  }

  // Case 2: External movie should not have radarrId
  if (!result.inLibrary && result.radarrId !== undefined) {
    if (logger) {
      logger.warn(
        'Consistency validation failed: external movie with radarrId',
        {
          title: result.title,
          mediaId: result.id,
          tmdbId: result.tmdbId,
          inLibrary: result.inLibrary,
          radarrId: result.radarrId,
          issue: 'inLibrary=false but radarrId is set',
        },
      )
    }
    return false
  }

  // Case 3: radarrId should be a valid number when present
  if (
    result.radarrId !== undefined &&
    (typeof result.radarrId !== 'number' || result.radarrId < 0)
  ) {
    if (logger) {
      logger.warn('Consistency validation failed: invalid radarrId format', {
        title: result.title,
        mediaId: result.id,
        radarrId: result.radarrId,
        radarrIdType: typeof result.radarrId,
        issue: 'radarrId is not a non-negative number',
      })
    }
    return false
  }

  return true
}
