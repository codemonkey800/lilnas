/**
 * Common types for media API clients
 */

/**
 * Base media item interface
 */
export interface BaseMediaItem {
  id: number
  title: string
  overview?: string
  year?: number
  genres?: string[]
  rating?: number
}

/**
 * Image information
 */
export interface ImageInfo {
  path?: string
  url?: string
  width?: number
  height?: number
}
