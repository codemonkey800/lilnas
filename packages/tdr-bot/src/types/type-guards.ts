/**
 * @fileoverview Type guards for runtime type checking and union type discrimination
 *
 * This module provides type guards for safely narrowing types at runtime,
 * particularly useful for union types, API responses, and error handling.
 */

import { AxiosError, AxiosResponse } from 'axios'

import {
  EmbyItem,
  MediaItem,
  MediaStatus,
  MovieItem,
  MovieSearchResult,
  QueueItem,
  SearchResult,
  SeriesItem,
  SeriesSearchResult,
} from 'src/media/interfaces/media.types'
import {
  ErrorCategory,
  ErrorClassification,
  ErrorSeverity,
  ErrorType,
} from 'src/utils/error-classifier'

import {
  isChannelId,
  isComponentCustomId,
  isCorrelationId,
  isGuildId,
  isMediaItemId,
  isOperationName,
  isServiceId,
  isStateId,
  isUserId,
} from './branded'
import {
  MediaStatusType,
  MediaType,
  QueueStatusType,
  TrackedDownloadStateType,
  TrackedDownloadStatusType,
} from './enums'

// ============================================================================
// Error Classification Type Guards
// ============================================================================

/**
 * Type guard to check if a value is an ErrorType
 */
export function isErrorType(value: unknown): value is ErrorType {
  return (
    typeof value === 'string' &&
    Object.values(ErrorType).includes(value as ErrorType)
  )
}

/**
 * Type guard to check if a value is an ErrorCategory
 */
export function isErrorCategory(value: unknown): value is ErrorCategory {
  return (
    typeof value === 'string' &&
    Object.values(ErrorCategory).includes(value as ErrorCategory)
  )
}

/**
 * Type guard to check if a value is an ErrorSeverity
 */
export function isErrorSeverity(value: unknown): value is ErrorSeverity {
  return (
    typeof value === 'string' &&
    Object.values(ErrorSeverity).includes(value as ErrorSeverity)
  )
}

/**
 * Type guard to check if a value is a complete ErrorClassification
 */
export function isErrorClassification(
  value: unknown,
): value is ErrorClassification {
  if (typeof value !== 'object' || value === null) return false

  const obj = value as Record<string, unknown>
  return (
    typeof obj.isRetryable === 'boolean' &&
    isErrorType(obj.errorType) &&
    isErrorCategory(obj.category) &&
    isErrorSeverity(obj.severity) &&
    (obj.retryAfterMs === undefined || typeof obj.retryAfterMs === 'number')
  )
}

/**
 * Type guard to check if an error is an Axios error
 */
export function isAxiosError(error: unknown): error is AxiosError {
  return (
    error instanceof Error &&
    'isAxiosError' in error &&
    (error as Record<string, unknown>).isAxiosError === true
  )
}

/**
 * Type guard to check if an Axios error has a response
 */
export function isAxiosErrorWithResponse(
  error: unknown,
): error is AxiosError & { response: AxiosResponse } {
  return (
    isAxiosError(error) &&
    error.response !== undefined &&
    typeof error.response === 'object' &&
    error.response !== null
  )
}

/**
 * Type guard to check if an error is a network error (no response)
 */
export function isNetworkError(error: unknown): error is AxiosError {
  return (
    isAxiosError(error) &&
    error.response === undefined &&
    (error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT')
  )
}

/**
 * Type guard to check if an error is a timeout error
 */
export function isTimeoutError(error: unknown): error is Error | AxiosError {
  return (
    (error instanceof Error &&
      (error.name === 'TimeoutError' || error.message.includes('timeout'))) ||
    (isAxiosError(error) &&
      (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'))
  )
}

// ============================================================================
// Media Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a MediaType
 */
export function isMediaType(value: unknown): value is MediaType {
  return (
    typeof value === 'string' &&
    Object.values(MediaType).includes(value as MediaType)
  )
}

/**
 * Type guard to check if a value is a MediaStatusType
 */
export function isMediaStatusType(value: unknown): value is MediaStatusType {
  return (
    typeof value === 'string' &&
    Object.values(MediaStatusType).includes(value as MediaStatusType)
  )
}

/**
 * Type guard to check if a value is a QueueStatusType
 */
export function isQueueStatusType(value: unknown): value is QueueStatusType {
  return (
    typeof value === 'string' &&
    Object.values(QueueStatusType).includes(value as QueueStatusType)
  )
}

/**
 * Type guard to check if a value is a TrackedDownloadStatusType
 */
export function isTrackedDownloadStatusType(
  value: unknown,
): value is TrackedDownloadStatusType {
  return (
    typeof value === 'string' &&
    Object.values(TrackedDownloadStatusType).includes(
      value as TrackedDownloadStatusType,
    )
  )
}

/**
 * Type guard to check if a value is a TrackedDownloadStateType
 */
export function isTrackedDownloadStateType(
  value: unknown,
): value is TrackedDownloadStateType {
  return (
    typeof value === 'string' &&
    Object.values(TrackedDownloadStateType).includes(
      value as TrackedDownloadStateType,
    )
  )
}

// ============================================================================
// Media Item Type Guards
// ============================================================================

/**
 * Base type guard for MediaItem
 */
function isBaseMediaItem(value: unknown): value is MediaItem {
  if (typeof value !== 'object' || value === null) return false

  const obj = value as Record<string, unknown>
  return (
    (typeof obj.id === 'string' || typeof obj.id === 'number') &&
    typeof obj.title === 'string' &&
    isMediaStatusType(obj.status) &&
    typeof obj.monitored === 'boolean' &&
    obj.added instanceof Date &&
    typeof obj.sortTitle === 'string' &&
    typeof obj.qualityProfileId === 'number' &&
    Array.isArray(obj.tags) &&
    obj.tags.every((tag: unknown) => typeof tag === 'number')
  )
}

/**
 * Type guard to check if a media item is a MovieItem
 */
export function isMovieItem(value: unknown): value is MovieItem {
  if (!isBaseMediaItem(value)) return false

  const obj = value as unknown as Record<string, unknown>
  return (
    obj.type === MediaType.MOVIE &&
    typeof obj.hasFile === 'boolean' &&
    Array.isArray(obj.genres) &&
    obj.genres.every((genre: unknown) => typeof genre === 'string') &&
    typeof obj.minimumAvailability === 'string' &&
    ['announced', 'inCinemas', 'released', 'preDB'].includes(
      obj.minimumAvailability as string,
    )
  )
}

/**
 * Type guard to check if a media item is a SeriesItem
 */
export function isSeriesItem(value: unknown): value is SeriesItem {
  if (!isBaseMediaItem(value)) return false

  const obj = value as unknown as Record<string, unknown>
  return (
    obj.type === MediaType.SERIES &&
    typeof obj.seriesType === 'string' &&
    ['standard', 'daily', 'anime'].includes(obj.seriesType as string) &&
    typeof obj.seasonCount === 'number' &&
    typeof obj.totalEpisodeCount === 'number' &&
    typeof obj.episodeCount === 'number' &&
    typeof obj.episodeFileCount === 'number' &&
    typeof obj.ended === 'boolean' &&
    Array.isArray(obj.seasons) &&
    typeof obj.languageProfileId === 'number' &&
    typeof obj.useSeasonFolders === 'boolean'
  )
}

/**
 * Discriminated union type guard for MediaItem
 */
export function discriminateMediaItem(
  value: unknown,
): value is MovieItem | SeriesItem {
  return isMovieItem(value) || isSeriesItem(value)
}

// ============================================================================
// Search Result Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a MovieSearchResult
 */
export function isMovieSearchResult(
  value: unknown,
): value is MovieSearchResult {
  if (typeof value !== 'object' || value === null) return false

  const obj = value as Record<string, unknown>
  return (
    typeof obj.title === 'string' &&
    typeof obj.originalTitle === 'string' &&
    typeof obj.overview === 'string' &&
    typeof obj.status === 'string' &&
    ['released', 'inProduction', 'postProduction', 'announced'].includes(
      obj.status as string,
    ) &&
    typeof obj.runtime === 'number' &&
    typeof obj.qualityProfileId === 'number' &&
    typeof obj.tmdbId === 'number' &&
    typeof obj.year === 'number' &&
    Array.isArray(obj.genres) &&
    obj.genres.every((genre: unknown) => typeof genre === 'string') &&
    Array.isArray(obj.tags) &&
    obj.tags.every((tag: unknown) => typeof tag === 'number') &&
    Array.isArray(obj.images)
  )
}

/**
 * Type guard to check if a value is a SeriesSearchResult
 */
export function isSeriesSearchResult(
  value: unknown,
): value is SeriesSearchResult {
  if (typeof value !== 'object' || value === null) return false

  const obj = value as Record<string, unknown>
  return (
    typeof obj.title === 'string' &&
    typeof obj.sortTitle === 'string' &&
    typeof obj.status === 'string' &&
    ['continuing', 'ended', 'upcoming', 'deleted'].includes(
      obj.status as string,
    ) &&
    typeof obj.ended === 'boolean' &&
    typeof obj.overview === 'string' &&
    Array.isArray(obj.seasons) &&
    typeof obj.year === 'number' &&
    typeof obj.qualityProfileId === 'number' &&
    typeof obj.languageProfileId === 'number' &&
    typeof obj.seasonFolder === 'boolean' &&
    typeof obj.monitored === 'boolean' &&
    typeof obj.useSeasonFolders === 'boolean' &&
    typeof obj.runtime === 'number' &&
    typeof obj.seriesType === 'string' &&
    ['standard', 'daily', 'anime'].includes(obj.seriesType as string) &&
    typeof obj.cleanTitle === 'string' &&
    typeof obj.titleSlug === 'string' &&
    Array.isArray(obj.genres) &&
    obj.genres.every((genre: unknown) => typeof genre === 'string') &&
    Array.isArray(obj.tags) &&
    obj.tags.every((tag: unknown) => typeof tag === 'number') &&
    obj.added instanceof Date &&
    Array.isArray(obj.images)
  )
}

/**
 * Type guard to check if a SearchResult contains MovieSearchResult data
 */
export function isMovieSearchResultContainer(
  value: unknown,
): value is SearchResult<MovieSearchResult> {
  if (typeof value !== 'object' || value === null) return false

  const obj = value as Record<string, unknown>
  return (
    typeof obj.title === 'string' &&
    obj.data !== undefined &&
    isMovieSearchResult(obj.data)
  )
}

/**
 * Type guard to check if a SearchResult contains SeriesSearchResult data
 */
export function isSeriesSearchResultContainer(
  value: unknown,
): value is SearchResult<SeriesSearchResult> {
  if (typeof value !== 'object' || value === null) return false

  const obj = value as Record<string, unknown>
  return (
    typeof obj.title === 'string' &&
    obj.data !== undefined &&
    isSeriesSearchResult(obj.data)
  )
}

// ============================================================================
// Queue and Status Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a QueueItem
 */
export function isQueueItem(value: unknown): value is QueueItem {
  if (typeof value !== 'object' || value === null) return false

  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'number' &&
    typeof obj.title === 'string' &&
    typeof obj.size === 'number' &&
    typeof obj.sizeleft === 'number' &&
    typeof obj.timeleft === 'string' &&
    typeof obj.status === 'string' &&
    [
      'queued',
      'paused',
      'downloading',
      'downloadClientUnavailable',
      'completed',
      'failed',
    ].includes(obj.status as string) &&
    typeof obj.trackedDownloadStatus === 'string' &&
    ['ok', 'warning', 'error'].includes(obj.trackedDownloadStatus as string) &&
    typeof obj.trackedDownloadState === 'string' &&
    Array.isArray(obj.statusMessages)
  )
}

/**
 * Type guard to check if a value is a MediaStatus
 */
export function isMediaStatus(value: unknown): value is MediaStatus {
  if (typeof value !== 'object' || value === null) return false

  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'number' &&
    typeof obj.title === 'string' &&
    isQueueStatusType(obj.status) &&
    isTrackedDownloadStatusType(obj.trackedDownloadStatus) &&
    isTrackedDownloadStateType(obj.trackedDownloadState) &&
    typeof obj.size === 'number' &&
    typeof obj.sizeleft === 'number' &&
    typeof obj.percentage === 'number' &&
    typeof obj.timeleft === 'string' &&
    Array.isArray(obj.statusMessages)
  )
}

// ============================================================================
// Emby Type Guards
// ============================================================================

/**
 * Type guard to check if a value is an EmbyItem
 */
export function isEmbyItem(value: unknown): value is EmbyItem {
  if (typeof value !== 'object' || value === null) return false

  const obj = value as Record<string, unknown>
  return (
    typeof obj.Id === 'string' &&
    typeof obj.Name === 'string' &&
    typeof obj.ServerId === 'string' &&
    typeof obj.Etag === 'string' &&
    obj.DateCreated instanceof Date &&
    typeof obj.CanDelete === 'boolean' &&
    typeof obj.CanDownload === 'boolean' &&
    typeof obj.IsFolder === 'boolean' &&
    typeof obj.Type === 'string' &&
    typeof obj.LocationType === 'string' &&
    typeof obj.PlayAccess === 'string'
  )
}

// ============================================================================
// Response Type Guards
// ============================================================================

/**
 * Type guard to check if an API response contains an array of the expected type
 */
export function isArrayResponse<T>(
  value: unknown,
  itemGuard: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.every(itemGuard)
}

/**
 * Type guard to check if an API response is paginated
 */
export function isPaginatedResponse<T>(
  value: unknown,
  itemGuard: (item: unknown) => item is T,
): value is { data: T[]; total: number; page?: number; limit?: number } {
  if (typeof value !== 'object' || value === null) return false

  const obj = value as Record<string, unknown>
  return (
    Array.isArray(obj.data) &&
    obj.data.every(itemGuard) &&
    typeof obj.total === 'number'
  )
}

// ============================================================================
// Utility Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a non-null object
 */
export function isNonNullObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Type guard to check if a value is a string with content (not empty)
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Type guard to check if a value is a positive integer
 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/**
 * Type guard to check if a value is a non-negative integer
 */
export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Generic type guard factory for creating discriminated union type guards
 */
export function createDiscriminatedUnionGuard<
  T extends Record<string, unknown>,
>(
  discriminantKey: keyof T,
  discriminantValue: T[typeof discriminantKey],
  additionalChecks?: (value: unknown) => boolean,
): (value: unknown) => value is T {
  return (value: unknown): value is T => {
    if (!isNonNullObject(value)) return false

    const hasDiscriminant =
      value[discriminantKey as string] === discriminantValue
    const passesAdditionalChecks = !additionalChecks || additionalChecks(value)

    return hasDiscriminant && passesAdditionalChecks
  }
}

// ============================================================================
// Assertion Functions
// ============================================================================

/**
 * Assertion function to ensure a value is a MediaItem
 */
export function assertMediaItem(
  value: unknown,
  context?: string,
): asserts value is MediaItem {
  if (!discriminateMediaItem(value)) {
    const contextMsg = context ? ` in ${context}` : ''
    throw new Error(`Expected MediaItem${contextMsg}, got: ${typeof value}`)
  }
}

/**
 * Assertion function to ensure a value is a specific media type
 */
export function assertMovieItem(
  value: unknown,
  context?: string,
): asserts value is MovieItem {
  if (!isMovieItem(value)) {
    const contextMsg = context ? ` in ${context}` : ''
    throw new Error(`Expected MovieItem${contextMsg}, got: ${typeof value}`)
  }
}

/**
 * Assertion function to ensure a value is a SeriesItem
 */
export function assertSeriesItem(
  value: unknown,
  context?: string,
): asserts value is SeriesItem {
  if (!isSeriesItem(value)) {
    const contextMsg = context ? ` in ${context}` : ''
    throw new Error(`Expected SeriesItem${contextMsg}, got: ${typeof value}`)
  }
}

/**
 * Assertion function to ensure a value is an ErrorClassification
 */
export function assertErrorClassification(
  value: unknown,
  context?: string,
): asserts value is ErrorClassification {
  if (!isErrorClassification(value)) {
    const contextMsg = context ? ` in ${context}` : ''
    throw new Error(
      `Expected ErrorClassification${contextMsg}, got: ${typeof value}`,
    )
  }
}

// ============================================================================
// Re-exported Branded Type Guards
// ============================================================================

export {
  isChannelId,
  isComponentCustomId,
  isCorrelationId,
  isGuildId,
  isMediaItemId,
  isOperationName,
  isServiceId,
  isStateId,
  isUserId,
}
