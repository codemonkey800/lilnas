/**
 * @fileoverview Image URL Extraction Utilities
 *
 * This module provides utilities for extracting and processing cover art images
 * from Radarr API responses. It handles the conversion between relative proxy URLs
 * and absolute remote URLs for Discord embed display.
 *
 * @since 1.0.0
 * @author TDR Bot Development Team
 */

import { MediaImage, RadarrMovie } from 'src/media/clients/radarr.client'

/**
 * Options for image URL extraction
 */
export interface ImageExtractionOptions {
  /** Radarr base URL for converting relative URLs */
  radarrBaseUrl?: string
  /** Preferred cover type for image selection */
  preferredCoverType?: string
  /** Whether to log extraction process for debugging */
  debug?: boolean
}

/**
 * Result of image URL extraction
 */
export interface ImageExtractionResult {
  /** The extracted image URL (null if none found) */
  imageUrl: string | null
  /** The source of the URL (for debugging) */
  source:
    | 'remotePoster'
    | 'images_remoteUrl'
    | 'posterUrl_absolute'
    | 'posterUrl_relative'
    | 'none'
  /** Additional debug information */
  debug?: {
    remotePosterUrl?: string
    foundImages?: number
    selectedImage?: MediaImage
    originalPosterUrl?: string
  }
}

/**
 * Extract the best available poster URL from a Radarr movie object
 *
 * Priority order:
 * 1. remotePoster (direct TMDB URLs - preferred for Discord)
 * 2. images[] where coverType === 'poster' using remoteUrl
 * 3. Convert relative posterUrl to absolute with Radarr base URL
 * 4. Use posterUrl as fallback (may not work if relative)
 *
 * @param movie - Radarr movie object
 * @param options - Extraction options
 * @returns Image extraction result
 *
 * @example
 * ```typescript
 * const result = extractPosterUrl(movie, {
 *   radarrBaseUrl: 'http://radarr.localhost',
 *   preferredCoverType: 'poster',
 *   debug: true
 * })
 *
 * if (result.imageUrl) {
 *   embed.setImage(result.imageUrl)
 * }
 * ```
 */
export function extractPosterUrl(
  movie: RadarrMovie,
  options: ImageExtractionOptions = {},
): ImageExtractionResult {
  const {
    radarrBaseUrl,
    preferredCoverType = 'poster',
    debug = false,
  } = options

  const debugInfo = debug
    ? ({} as {
        remotePosterUrl?: string
        foundImages?: number
        selectedImage?: MediaImage
        originalPosterUrl?: string
      })
    : undefined

  // Priority 1: Use remotePoster (direct TMDB URLs)
  if (movie.remotePoster && isValidUrl(movie.remotePoster)) {
    if (debugInfo) {
      debugInfo.remotePosterUrl = movie.remotePoster
    }
    return {
      imageUrl: movie.remotePoster,
      source: 'remotePoster',
      debug: debugInfo,
    }
  }

  // Priority 2: Extract from images[] where coverType === preferredCoverType using remoteUrl
  if (movie.images && movie.images.length > 0) {
    const posterImage = movie.images.find(
      image => image.coverType === preferredCoverType && image.remoteUrl,
    )

    if (posterImage && isValidUrl(posterImage.remoteUrl)) {
      if (debugInfo) {
        debugInfo.foundImages = movie.images.length
        debugInfo.selectedImage = posterImage
      }
      return {
        imageUrl: posterImage.remoteUrl,
        source: 'images_remoteUrl',
        debug: debugInfo,
      }
    }

    // If no poster found, try any image with remoteUrl
    const anyRemoteImage = movie.images.find(
      image => image.remoteUrl && isValidUrl(image.remoteUrl),
    )
    if (anyRemoteImage) {
      if (debugInfo) {
        debugInfo.foundImages = movie.images.length
        debugInfo.selectedImage = anyRemoteImage
      }
      return {
        imageUrl: anyRemoteImage.remoteUrl,
        source: 'images_remoteUrl',
        debug: debugInfo,
      }
    }

    if (debugInfo) {
      debugInfo.foundImages = movie.images.length
    }
  }

  // Priority 3: Convert relative posterUrl to absolute with Radarr base URL
  if (movie.posterUrl && radarrBaseUrl) {
    if (debugInfo) {
      debugInfo.originalPosterUrl = movie.posterUrl
    }

    // Check if posterUrl is already absolute
    if (isValidUrl(movie.posterUrl)) {
      return {
        imageUrl: movie.posterUrl,
        source: 'posterUrl_absolute',
        debug: debugInfo,
      }
    }

    // Convert relative URL to absolute
    const absoluteUrl = convertToAbsoluteUrl(movie.posterUrl, radarrBaseUrl)
    if (absoluteUrl) {
      return {
        imageUrl: absoluteUrl,
        source: 'posterUrl_relative',
        debug: debugInfo,
      }
    }
  }

  // Priority 4: Fallback to existing posterUrl (may not work if relative)
  if (movie.posterUrl && isValidUrl(movie.posterUrl)) {
    if (debugInfo) {
      debugInfo.originalPosterUrl = movie.posterUrl
    }
    return {
      imageUrl: movie.posterUrl,
      source: 'posterUrl_absolute',
      debug: debugInfo,
    }
  }

  // No valid image URL found
  if (debugInfo) {
    debugInfo.originalPosterUrl = movie.posterUrl || 'none'
    debugInfo.foundImages = movie.images?.length || 0
  }

  return {
    imageUrl: null,
    source: 'none',
    debug: debugInfo,
  }
}

/**
 * Convert a relative URL to an absolute URL using a base URL
 *
 * @param relativeUrl - The relative URL (e.g., '/MediaCoverProxy/...')
 * @param baseUrl - The base URL (e.g., 'http://radarr.localhost')
 * @returns Absolute URL or null if conversion fails
 */
export function convertToAbsoluteUrl(
  relativeUrl: string,
  baseUrl: string,
): string | null {
  try {
    // Remove trailing slash from base URL
    const cleanBaseUrl = baseUrl.replace(/\/$/, '')

    // Ensure relative URL starts with /
    const cleanRelativeUrl = relativeUrl.startsWith('/')
      ? relativeUrl
      : `/${relativeUrl}`

    const absoluteUrl = `${cleanBaseUrl}${cleanRelativeUrl}`

    // Validate the result
    return isValidUrl(absoluteUrl) ? absoluteUrl : null
  } catch {
    return null
  }
}

/**
 * Check if a string is a valid URL
 *
 * @param url - URL string to validate
 * @returns True if valid URL, false otherwise
 */
export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Get Radarr base URL from environment or configuration
 * This is a helper function to get the base URL for relative URL conversion
 *
 * @returns Radarr base URL or null if not configured
 */
export function getRadarrBaseUrl(): string | null {
  // Try to get from environment variables
  const radarrUrl = process.env.RADARR_URL
  if (radarrUrl) {
    return radarrUrl.replace(/\/$/, '') // Remove trailing slash
  }

  // Could also get from configuration service if needed
  // const configService = // get from dependency injection
  // return configService.getServiceConfig('radarr').url

  return null
}

/**
 * Batch extract poster URLs from multiple movies
 *
 * @param movies - Array of Radarr movies
 * @param options - Extraction options
 * @returns Array of image extraction results
 */
export function extractPosterUrls(
  movies: RadarrMovie[],
  options: ImageExtractionOptions = {},
): ImageExtractionResult[] {
  return movies.map(movie => extractPosterUrl(movie, options))
}
