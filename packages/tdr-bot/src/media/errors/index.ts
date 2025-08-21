/**
 * Media Error Handling - Index
 *
 * Centralized exports for all media error types and utilities.
 * This provides a single import point for consistent error handling
 * across the media module.
 */

// Core error types
export {
  CleanupError,
  ComponentCreationError,
  ComponentLimitExceededError,
  ComponentStateError,
  ComponentStateInactiveError,
  ComponentStateNotFoundError,
  ComponentTransitionError,
  ComponentValidationError,
  DiscordInteractionError,
  DiscordPermissionError,
  DiscordRateLimitError,
  MediaApiError,
  MediaAuthenticationError,
  MediaError,
  MediaErrorFactory,
  MediaHttpException,
  MediaLoggingError,
  MediaNetworkError,
  MediaNotFoundApiError,
  MediaNotFoundError,
  MediaRateLimitError,
  MediaServiceError,
  MediaServiceUnavailableError,
  MediaValidationApiError,
  TimeoutError,
} from './media-errors'

// Error handling utilities
export { isErrorResult, isMediaError, MediaErrorHandler } from './error-utils'

// Error handling types
export type {
  ErrorContext,
  ErrorHandlingConfig,
  ErrorHandlingResult,
} from './error-utils'

// Type guards and utility functions
import {
  ComponentStateError,
  ComponentValidationError,
  DiscordInteractionError,
  DiscordRateLimitError,
  MediaError,
  TimeoutError,
} from './media-errors'

export const MediaErrors = {
  /**
   * Check if an error is any type of ComponentStateError
   */
  isComponentStateError: (error: unknown): error is ComponentStateError => {
    return error instanceof ComponentStateError
  },

  /**
   * Check if an error is a validation error
   */
  isValidationError: (error: unknown): error is ComponentValidationError => {
    return error instanceof ComponentValidationError
  },

  /**
   * Check if an error is a Discord interaction error
   */
  isDiscordError: (error: unknown): error is DiscordInteractionError => {
    return error instanceof DiscordInteractionError
  },

  /**
   * Check if an error is retryable
   */
  isRetryableError: (error: unknown): boolean => {
    if (error instanceof DiscordRateLimitError) {
      return true
    }
    if (error instanceof TimeoutError) {
      return true
    }
    if (error instanceof MediaError) {
      return (
        error.message.toLowerCase().includes('temporary') ||
        error.message.toLowerCase().includes('retry')
      )
    }
    return false
  },

  /**
   * Get retry delay from error (in milliseconds)
   */
  getRetryDelay: (error: unknown): number | undefined => {
    if (error instanceof DiscordRateLimitError) {
      return (error.context.retryAfter as number) || 5000
    }
    if (error instanceof TimeoutError) {
      return 2000
    }
    if (MediaErrors.isRetryableError(error)) {
      return 1000
    }
    return undefined
  },

  /**
   * Extract correlation ID from various error sources
   */
  extractCorrelationId: (error: unknown): string | undefined => {
    if (error instanceof MediaError) {
      return error.correlationId
    }
    if (error && typeof error === 'object' && 'correlationId' in error) {
      const errorWithCorrelation = error as { correlationId: string }
      return errorWithCorrelation.correlationId
    }
    return undefined
  },

  /**
   * Convert any error to a user-friendly message
   */
  toUserMessage: (error: unknown): string => {
    if (error instanceof MediaError) {
      return error.toUserMessage()
    }
    if (error instanceof Error) {
      // Generic error handling
      if (error.message.toLowerCase().includes('timeout')) {
        return 'The operation took too long to complete. Please try again.'
      }
      if (error.message.toLowerCase().includes('permission')) {
        return "I don't have the required permissions to perform this action."
      }
      if (error.message.toLowerCase().includes('rate limit')) {
        return 'Service is temporarily busy. Please try again in a moment.'
      }
      return 'An unexpected error occurred. Please try again.'
    }
    return 'An unknown error occurred. Please try again.'
  },
} as const
