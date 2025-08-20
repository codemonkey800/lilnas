/**
 * Standardized Error Types for Media Module
 *
 * This module provides consistent error handling across all media services
 * with proper error context, correlation ID tracking, and NestJS compatibility.
 */

import { HttpException, HttpStatus } from '@nestjs/common'

/**
 * Base error class for all media-related errors
 * Provides consistent error context and correlation ID tracking
 */
export abstract class MediaError extends Error {
  public readonly timestamp: Date
  public readonly context: Record<string, unknown>

  constructor(
    message: string,
    public readonly correlationId?: string,
    context: Record<string, unknown> = {},
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = this.constructor.name
    this.timestamp = new Date()
    this.context = {
      ...context,
      correlationId,
      errorType: this.constructor.name,
    }

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }

    // Chain error causes
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`
    }
  }

  /**
   * Convert to user-friendly message suitable for Discord display
   */
  abstract toUserMessage(): string

  /**
   * Get structured error data for logging
   */
  toLogData(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      correlationId: this.correlationId,
      timestamp: this.timestamp,
      context: this.context,
      cause: this.cause?.message,
    }
  }
}

/**
 * Component State Management Errors
 */
export class ComponentStateError extends MediaError {
  constructor(
    message: string,
    correlationId?: string,
    public readonly stateId?: string,
    context: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(message, correlationId, { ...context, stateId }, cause)
  }

  toUserMessage(): string {
    if (
      this.message.includes('inactive') ||
      this.message.includes('non-existent')
    ) {
      return 'This interaction has expired. Please try the command again.'
    }
    if (this.message.includes('limit')) {
      return 'You have reached the maximum number of active interactions. Please wait for some to expire.'
    }
    return 'An error occurred while managing the interaction. Please try again.'
  }
}

export class ComponentStateNotFoundError extends ComponentStateError {
  constructor(stateId: string, correlationId?: string) {
    super(`Component state not found: ${stateId}`, correlationId, stateId, {
      operation: 'state_lookup',
    })
  }

  toUserMessage(): string {
    return 'This interaction has expired. Please try the command again.'
  }
}

export class ComponentStateInactiveError extends ComponentStateError {
  constructor(stateId: string, currentState: string, correlationId?: string) {
    super(
      `Component state is inactive: ${stateId} (current: ${currentState})`,
      correlationId,
      stateId,
      { operation: 'state_update', currentState },
    )
  }

  toUserMessage(): string {
    return 'This interaction is no longer active. Please start a new command.'
  }
}

export class ComponentLimitExceededError extends ComponentStateError {
  constructor(
    limitType: 'global' | 'user',
    currentCount: number,
    maxAllowed: number,
    correlationId?: string,
    userId?: string,
  ) {
    super(
      `${limitType === 'global' ? 'Global' : 'User'} component limit exceeded: ${currentCount}/${maxAllowed}`,
      correlationId,
      undefined,
      {
        operation: 'limit_check',
        limitType,
        currentCount,
        maxAllowed,
        userId,
      },
    )
  }

  toUserMessage(): string {
    const limitType =
      (this.context.limitType as string) === 'global' ? 'system' : 'your'
    return `Maximum ${limitType} interaction limit reached. Please try again later.`
  }
}

export class ComponentTransitionError extends ComponentStateError {
  constructor(
    stateId: string,
    fromState: string,
    toState: string,
    correlationId?: string,
  ) {
    super(
      `Invalid state transition for ${stateId}: ${fromState} -> ${toState}`,
      correlationId,
      stateId,
      { operation: 'state_transition', fromState, toState },
    )
  }

  toUserMessage(): string {
    return 'Unable to process this interaction in its current state. Please try again.'
  }
}

/**
 * Component Factory and Validation Errors
 */
export class ComponentValidationError extends MediaError {
  constructor(
    message: string,
    public readonly field: string,
    public readonly validationCode: string,
    correlationId?: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, correlationId, { ...context, field, validationCode })
  }

  toUserMessage(): string {
    switch (this.validationCode) {
      case 'MISSING_ID_OR_URL':
        return 'Button configuration is invalid. Please contact support.'
      case 'CUSTOM_ID_TOO_LONG':
        return 'Button identifier is too long. Please simplify your request.'
      case 'LABEL_TOO_LONG':
        return 'Button label is too long. Please use shorter text.'
      case 'TOO_MANY_OPTIONS':
        return 'Too many options provided. Please reduce the number of choices.'
      case 'EMBED_TOO_LONG':
        return 'Message content is too long. Please reduce the amount of text.'
      default:
        return 'Invalid component configuration. Please try again with different options.'
    }
  }
}

export class ComponentCreationError extends MediaError {
  constructor(
    componentType: string,
    reason: string,
    correlationId?: string,
    context: Record<string, unknown> = {},
  ) {
    super(`Failed to create ${componentType}: ${reason}`, correlationId, {
      ...context,
      componentType,
      reason,
    })
  }

  toUserMessage(): string {
    const componentType = this.context.componentType as string
    return `Unable to create ${componentType.toLowerCase()}. Please try again.`
  }
}

/**
 * Discord API and Interaction Errors
 */
export class DiscordInteractionError extends MediaError {
  constructor(
    message: string,
    public readonly discordErrorCode?: string | number,
    public readonly httpStatus?: number,
    correlationId?: string,
    context: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(
      message,
      correlationId,
      { ...context, discordErrorCode, httpStatus },
      cause,
    )
  }

  toUserMessage(): string {
    if (this.discordErrorCode === 'DISCORD_10062') {
      return 'This interaction has expired. Please try the command again.'
    }
    if (this.discordErrorCode === 'DISCORD_40060') {
      return 'Unable to process your request. Please try again.'
    }
    if (this.discordErrorCode === 'DISCORD_50013') {
      return "I don't have the required permissions to perform this action. Please contact a server administrator."
    }
    if (this.httpStatus === 429) {
      return 'Service is temporarily busy. Please try again in a moment.'
    }
    return 'An error occurred while processing your Discord interaction. Please try again.'
  }
}

export class DiscordRateLimitError extends DiscordInteractionError {
  constructor(
    retryAfter: number,
    correlationId?: string,
    context: Record<string, unknown> = {},
  ) {
    super(
      `Discord rate limit hit, retry after ${retryAfter}ms`,
      429,
      429,
      correlationId,
      { ...context, retryAfter },
    )
  }

  toUserMessage(): string {
    const retryAfter = this.context.retryAfter as number
    const seconds = Math.ceil(retryAfter / 1000)
    return `Service is temporarily busy. Please try again in ${seconds} second${seconds !== 1 ? 's' : ''}.`
  }
}

export class DiscordPermissionError extends DiscordInteractionError {
  constructor(
    requiredPermission: string,
    guildId?: string,
    channelId?: string,
    correlationId?: string,
  ) {
    super(
      `Missing Discord permission: ${requiredPermission}`,
      'DISCORD_50013',
      403,
      correlationId,
      { requiredPermission, guildId, channelId },
    )
  }

  toUserMessage(): string {
    const permission = this.context.requiredPermission as string
    return `I don't have the required permission (${permission}) to perform this action. Please contact a server administrator.`
  }
}

/**
 * Media Service Errors
 */
export class MediaServiceError extends MediaError {
  constructor(
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    message: string,
    correlationId?: string,
    context: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(
      `${service.toUpperCase()} ${operation} failed: ${message}`,
      correlationId,
      { ...context, service, operation },
      cause,
    )
  }

  toUserMessage(): string {
    const service = (this.context.service as string).toLowerCase()
    const operation = this.context.operation as string

    if (operation.includes('search')) {
      return `Unable to search ${service} library. Please try again.`
    }
    if (operation.includes('request') || operation.includes('add')) {
      return `Unable to add media to ${service}. Please try again.`
    }
    return `${service} service is currently unavailable. Please try again later.`
  }
}

/**
 * Base class for all Media API-specific errors
 * Provides HTTP status code mapping and API-specific context
 */
export abstract class MediaApiError extends MediaError {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly service: 'sonarr' | 'radarr' | 'emby',
    public readonly operation: string,
    correlationId?: string,
    context: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(
      message,
      correlationId,
      { ...context, httpStatus, service, operation },
      cause,
    )
  }

  /**
   * Determine if this error should be retried based on its nature
   */
  abstract get isRetryable(): boolean

  /**
   * Get suggested retry delay in milliseconds
   */
  abstract get retryDelayMs(): number | undefined

  /**
   * Get user-friendly service name for display
   */
  protected getServiceDisplayName(): string {
    switch (this.service) {
      case 'sonarr':
        return 'TV Show service'
      case 'radarr':
        return 'Movie service'
      case 'emby':
        return 'Media library'
      default:
        return 'Media service'
    }
  }
}

/**
 * 401 Unauthorized - Invalid API credentials (non-retryable)
 */
export class MediaAuthenticationError extends MediaApiError {
  constructor(
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    correlationId?: string,
    context: Record<string, unknown> = {},
  ) {
    super(
      `${service.toUpperCase()} authentication failed during ${operation}`,
      401,
      service,
      operation,
      correlationId,
      { ...context, errorCategory: 'authentication' },
    )
  }

  get isRetryable(): boolean {
    return false
  }

  get retryDelayMs(): number | undefined {
    return undefined
  }

  toUserMessage(): string {
    const serviceName = this.getServiceDisplayName()
    return `${serviceName} authentication failed. Please contact an administrator to check API configuration.`
  }
}

/**
 * 429 Rate Limited - Too many requests (retryable with delay)
 */
export class MediaRateLimitError extends MediaApiError {
  constructor(
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    retryAfterSeconds?: number,
    correlationId?: string,
    context: Record<string, unknown> = {},
  ) {
    const retryAfterMs = retryAfterSeconds
      ? retryAfterSeconds * 1000
      : undefined
    super(
      `${service.toUpperCase()} rate limit exceeded during ${operation}${
        retryAfterSeconds ? ` (retry after ${retryAfterSeconds}s)` : ''
      }`,
      429,
      service,
      operation,
      correlationId,
      { ...context, errorCategory: 'rate_limit', retryAfterMs },
    )
  }

  get isRetryable(): boolean {
    return true
  }

  get retryDelayMs(): number | undefined {
    return (this.context.retryAfterMs as number) || 30000 // Default 30s delay
  }

  toUserMessage(): string {
    const serviceName = this.getServiceDisplayName()
    const delaySeconds = Math.ceil((this.retryDelayMs || 30000) / 1000)
    return `${serviceName} is busy. Please try again in ${delaySeconds} second${delaySeconds !== 1 ? 's' : ''}.`
  }
}

/**
 * 503/5xx Server errors - Service temporarily unavailable (retryable)
 */
export class MediaServiceUnavailableError extends MediaApiError {
  constructor(
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    httpStatus: number = 503,
    correlationId?: string,
    context: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(
      `${service.toUpperCase()} service unavailable during ${operation} (HTTP ${httpStatus})`,
      httpStatus,
      service,
      operation,
      correlationId,
      { ...context, errorCategory: 'service_unavailable' },
      cause,
    )
  }

  get isRetryable(): boolean {
    return true
  }

  get retryDelayMs(): number | undefined {
    // Progressive delay based on HTTP status
    switch (this.httpStatus) {
      case 500: // Internal server error
        return 5000 // 5 seconds
      case 502: // Bad gateway
        return 10000 // 10 seconds
      case 503: // Service unavailable
        return 15000 // 15 seconds
      case 504: // Gateway timeout
        return 20000 // 20 seconds
      default:
        return 10000 // Default 10 seconds
    }
  }

  toUserMessage(): string {
    const serviceName = this.getServiceDisplayName()
    return `${serviceName} is temporarily unavailable. The request will be retried automatically.`
  }
}

/**
 * 404 Not Found - Resource not found (limited retry)
 */
export class MediaNotFoundApiError extends MediaApiError {
  constructor(
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    resourceType: string,
    resourceId: string,
    correlationId?: string,
    context: Record<string, unknown> = {},
  ) {
    super(
      `${service.toUpperCase()} ${resourceType} not found: ${resourceId} during ${operation}`,
      404,
      service,
      operation,
      correlationId,
      { ...context, errorCategory: 'not_found', resourceType, resourceId },
    )
  }

  get isRetryable(): boolean {
    // Only retry once for 404s in case it's a timing issue
    return true
  }

  get retryDelayMs(): number | undefined {
    return 2000 // Short delay for 404 retry
  }

  toUserMessage(): string {
    const resourceType = this.context.resourceType as string
    const serviceName = this.getServiceDisplayName()
    return `${resourceType} not found in ${serviceName}. Please verify your search criteria.`
  }
}

/**
 * 400/422 Bad Request - Invalid request data (non-retryable)
 */
export class MediaValidationApiError extends MediaApiError {
  constructor(
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    validationDetails: string,
    correlationId?: string,
    context: Record<string, unknown> = {},
  ) {
    super(
      `${service.toUpperCase()} validation failed during ${operation}: ${validationDetails}`,
      400,
      service,
      operation,
      correlationId,
      { ...context, errorCategory: 'validation', validationDetails },
    )
  }

  get isRetryable(): boolean {
    return false
  }

  get retryDelayMs(): number | undefined {
    return undefined
  }

  toUserMessage(): string {
    const serviceName = this.getServiceDisplayName()
    const details = this.context.validationDetails as string
    return `Invalid request to ${serviceName}: ${details}. Please check your input and try again.`
  }
}

/**
 * Network/Connection errors (retryable)
 */
export class MediaNetworkError extends MediaApiError {
  constructor(
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    networkErrorCode: string,
    correlationId?: string,
    context: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(
      `${service.toUpperCase()} network error during ${operation}: ${networkErrorCode}`,
      0, // No HTTP status for network errors
      service,
      operation,
      correlationId,
      { ...context, errorCategory: 'network', networkErrorCode },
      cause,
    )
  }

  get isRetryable(): boolean {
    return true
  }

  get retryDelayMs(): number | undefined {
    const errorCode = this.context.networkErrorCode as string
    switch (errorCode) {
      case 'ECONNREFUSED':
      case 'ENOTFOUND':
        return 30000 // 30 seconds for connection issues
      case 'ETIMEDOUT':
      case 'ECONNABORTED':
        return 10000 // 10 seconds for timeouts
      default:
        return 15000 // Default 15 seconds
    }
  }

  toUserMessage(): string {
    const serviceName = this.getServiceDisplayName()
    const errorCode = this.context.networkErrorCode as string

    if (errorCode === 'ECONNREFUSED') {
      return `Cannot connect to ${serviceName}. The service may be offline.`
    }
    if (errorCode === 'ETIMEDOUT') {
      return `${serviceName} request timed out. Please try again.`
    }
    return `Network error connecting to ${serviceName}. Please try again.`
  }
}

export class MediaNotFoundError extends MediaServiceError {
  constructor(
    mediaId: string,
    mediaType: 'movie' | 'tv',
    service: 'sonarr' | 'radarr' | 'emby',
    correlationId?: string,
  ) {
    super(
      service,
      'lookup',
      `${mediaType} not found: ${mediaId}`,
      correlationId,
      { mediaId, mediaType },
    )
  }

  toUserMessage(): string {
    const mediaType = this.context.mediaType as string
    return `${mediaType === 'tv' ? 'TV show' : 'Movie'} not found. Please try a different search term.`
  }
}

/**
 * Logging and Context Errors
 */
export class MediaLoggingError extends MediaError {
  constructor(
    operation: string,
    reason: string,
    correlationId?: string,
    context: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(
      `Logging operation failed: ${operation} - ${reason}`,
      correlationId,
      { ...context, operation, reason },
      cause,
    )
  }

  toUserMessage(): string {
    return 'An internal error occurred. The request has been logged for investigation.'
  }
}

/**
 * Timeout and Cleanup Errors
 */
export class TimeoutError extends MediaError {
  constructor(
    operation: string,
    timeoutMs: number,
    correlationId?: string,
    context: Record<string, unknown> = {},
  ) {
    super(
      `Operation timed out after ${timeoutMs}ms: ${operation}`,
      correlationId,
      { ...context, operation, timeoutMs },
    )
  }

  toUserMessage(): string {
    return 'The operation took too long to complete. Please try again.'
  }
}

export class CleanupError extends MediaError {
  constructor(
    resourceType: string,
    resourceId: string,
    reason: string,
    correlationId?: string,
    context: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(
      `Failed to cleanup ${resourceType} ${resourceId}: ${reason}`,
      correlationId,
      { ...context, resourceType, resourceId, reason },
      cause,
    )
  }

  toUserMessage(): string {
    return 'An error occurred during cleanup. The issue has been logged.'
  }
}

/**
 * HTTP Exception Compatibility for NestJS
 * Allows MediaErrors to be thrown from NestJS controllers
 */
export class MediaHttpException extends HttpException {
  constructor(
    public readonly mediaError: MediaError,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
  ) {
    super(
      {
        message: mediaError.message,
        userMessage: mediaError.toUserMessage(),
        correlationId: mediaError.correlationId,
        timestamp: mediaError.timestamp,
        error: mediaError.name,
        statusCode: status,
      },
      status,
    )
  }

  static fromMediaError(
    mediaError: MediaError,
    status?: HttpStatus,
  ): MediaHttpException {
    // Map specific error types to appropriate HTTP status codes
    let httpStatus = status

    if (!httpStatus) {
      if (mediaError instanceof ComponentStateNotFoundError) {
        httpStatus = HttpStatus.NOT_FOUND
      } else if (mediaError instanceof ComponentValidationError) {
        httpStatus = HttpStatus.BAD_REQUEST
      } else if (mediaError instanceof ComponentLimitExceededError) {
        httpStatus = HttpStatus.TOO_MANY_REQUESTS
      } else if (mediaError instanceof DiscordPermissionError) {
        httpStatus = HttpStatus.FORBIDDEN
      } else if (mediaError instanceof DiscordRateLimitError) {
        httpStatus = HttpStatus.TOO_MANY_REQUESTS
      } else if (mediaError instanceof TimeoutError) {
        httpStatus = HttpStatus.REQUEST_TIMEOUT
      } else {
        httpStatus = HttpStatus.INTERNAL_SERVER_ERROR
      }
    }

    return new MediaHttpException(mediaError, httpStatus)
  }
}

/**
 * Error Factory Functions for Common Scenarios
 */
export const MediaErrorFactory = {
  /**
   * Create component state not found error
   */
  componentStateNotFound: (
    stateId: string,
    correlationId?: string,
  ): ComponentStateNotFoundError => {
    return new ComponentStateNotFoundError(stateId, correlationId)
  },

  /**
   * Create component state inactive error
   */
  componentStateInactive: (
    stateId: string,
    currentState: string,
    correlationId?: string,
  ): ComponentStateInactiveError => {
    return new ComponentStateInactiveError(stateId, currentState, correlationId)
  },

  /**
   * Create component limit exceeded error
   */
  componentLimitExceeded: (
    limitType: 'global' | 'user',
    currentCount: number,
    maxAllowed: number,
    correlationId?: string,
    userId?: string,
  ): ComponentLimitExceededError => {
    return new ComponentLimitExceededError(
      limitType,
      currentCount,
      maxAllowed,
      correlationId,
      userId,
    )
  },

  /**
   * Create validation error
   */
  validation: (
    field: string,
    message: string,
    code: string,
    correlationId?: string,
  ): ComponentValidationError => {
    return new ComponentValidationError(message, field, code, correlationId)
  },

  /**
   * Create Discord interaction error
   */
  discordInteraction: (
    message: string,
    errorCode?: string | number,
    httpStatus?: number,
    correlationId?: string,
    cause?: Error,
  ): DiscordInteractionError => {
    return new DiscordInteractionError(
      message,
      errorCode,
      httpStatus,
      correlationId,
      {},
      cause,
    )
  },

  /**
   * Create timeout error
   */
  timeout: (
    operation: string,
    timeoutMs: number,
    correlationId?: string,
  ): TimeoutError => {
    return new TimeoutError(operation, timeoutMs, correlationId)
  },

  /**
   * Create media service error
   */
  mediaService: (
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    message: string,
    correlationId?: string,
    cause?: Error,
  ): MediaServiceError => {
    return new MediaServiceError(
      service,
      operation,
      message,
      correlationId,
      {},
      cause,
    )
  },

  /**
   * Create media API authentication error
   */
  mediaAuthentication: (
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    correlationId?: string,
  ): MediaAuthenticationError => {
    return new MediaAuthenticationError(service, operation, correlationId)
  },

  /**
   * Create media API rate limit error
   */
  mediaRateLimit: (
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    retryAfterSeconds?: number,
    correlationId?: string,
  ): MediaRateLimitError => {
    return new MediaRateLimitError(
      service,
      operation,
      retryAfterSeconds,
      correlationId,
    )
  },

  /**
   * Create media API service unavailable error
   */
  mediaServiceUnavailable: (
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    httpStatus: number = 503,
    correlationId?: string,
    cause?: Error,
  ): MediaServiceUnavailableError => {
    return new MediaServiceUnavailableError(
      service,
      operation,
      httpStatus,
      correlationId,
      {},
      cause,
    )
  },

  /**
   * Create media API not found error
   */
  mediaNotFoundApi: (
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    resourceType: string,
    resourceId: string,
    correlationId?: string,
  ): MediaNotFoundApiError => {
    return new MediaNotFoundApiError(
      service,
      operation,
      resourceType,
      resourceId,
      correlationId,
    )
  },

  /**
   * Create media API validation error
   */
  mediaValidationApi: (
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    validationDetails: string,
    correlationId?: string,
  ): MediaValidationApiError => {
    return new MediaValidationApiError(
      service,
      operation,
      validationDetails,
      correlationId,
    )
  },

  /**
   * Create media API network error
   */
  mediaNetwork: (
    service: 'sonarr' | 'radarr' | 'emby',
    operation: string,
    networkErrorCode: string,
    correlationId?: string,
    cause?: Error,
  ): MediaNetworkError => {
    return new MediaNetworkError(
      service,
      operation,
      networkErrorCode,
      correlationId,
      {},
      cause,
    )
  },
} as const
