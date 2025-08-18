/**
 * Error Utilities for Media Module
 * 
 * Provides utility functions for consistent error handling, logging,
 * and error transformation across all media services.
 */

import { Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { DiscordAPIError } from 'discord.js'

import { CorrelationContext } from 'src/types/discord.types'
import { EventType } from 'src/types/enums'
import {
  MediaError,
  DiscordInteractionError,
  ComponentStateError,
  MediaErrorFactory,
  TimeoutError,
  CleanupError,
} from './media-errors'

/**
 * Error context for enhanced error handling
 */
export interface ErrorContext {
  correlationId?: string
  userId?: string
  guildId?: string
  channelId?: string
  operation?: string
  component?: string
  stateId?: string
  [key: string]: unknown
}

/**
 * Error handling configuration
 */
export interface ErrorHandlingConfig {
  logLevel?: 'error' | 'warn' | 'debug'
  emitEvent?: boolean
  includeStack?: boolean
  maxContextSize?: number
}

/**
 * Error handling result
 */
export interface ErrorHandlingResult<T = unknown> {
  success: false
  error: MediaError
  originalError?: Error
  context: ErrorContext
  handledAt: Date
  userMessage: string
  logData: Record<string, unknown>
  shouldRetry: boolean
  retryAfter?: number
  fallbackValue?: T
}

/**
 * Utility class for consistent error handling across media services
 */
export class MediaErrorHandler {
  constructor(
    private readonly logger: Logger,
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * Handle any error and convert to standardized MediaError
   */
  handleError<T = unknown>(
    error: Error | MediaError | unknown,
    context: ErrorContext = {},
    config: ErrorHandlingConfig = {},
  ): ErrorHandlingResult<T> {
    const {
      logLevel = 'error',
      emitEvent = true,
      includeStack = true,
      maxContextSize = 1000,
    } = config

    let mediaError: MediaError
    let originalError: Error | undefined

    // Convert various error types to MediaError
    if (error instanceof MediaError) {
      mediaError = error
      originalError = error.cause
    } else if (error instanceof DiscordAPIError) {
      mediaError = this.convertDiscordError(error, context.correlationId)
      originalError = error
    } else if (error instanceof Error) {
      mediaError = this.convertGenericError(error, context)
      originalError = error
    } else {
      const errorMessage = String(error) || 'Unknown error occurred'
      mediaError = new ComponentStateError(
        errorMessage,
        context.correlationId,
        context.stateId,
        context,
      )
      originalError = new Error(errorMessage)
    }

    // Merge context with error context
    const finalContext: ErrorContext = {
      ...context,
      ...mediaError.context,
      errorName: mediaError.name,
      errorType: mediaError.constructor.name,
    }

    // Limit context size to prevent memory issues
    const sanitizedContext = this.sanitizeContext(finalContext, maxContextSize)

    // Create result
    const result: ErrorHandlingResult<T> = {
      success: false,
      error: mediaError,
      originalError,
      context: sanitizedContext,
      handledAt: new Date(),
      userMessage: mediaError.toUserMessage(),
      logData: mediaError.toLogData(),
      shouldRetry: this.shouldRetryError(mediaError),
      retryAfter: this.getRetryDelay(mediaError),
    }

    // Log the error
    this.logError(result, logLevel, includeStack)

    // Emit error event for monitoring
    if (emitEvent && this.eventEmitter) {
      this.emitErrorEvent(result)
    }

    return result
  }

  /**
   * Handle errors with fallback values for non-critical operations
   */
  handleErrorWithFallback<T>(
    error: Error | MediaError | unknown,
    fallbackValue: T,
    context: ErrorContext = {},
    config: ErrorHandlingConfig = {},
  ): ErrorHandlingResult<T> {
    const result = this.handleError<T>(error, context, {
      ...config,
      logLevel: config.logLevel || 'warn', // Default to warn for fallback errors
    })

    result.fallbackValue = fallbackValue
    return result
  }

  /**
   * Wrap an async operation with error handling
   */
  async wrapOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    context: ErrorContext = {},
    config: ErrorHandlingConfig = {},
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      const errorContext = {
        ...context,
        operation: operationName,
      }

      const result = this.handleError(error, errorContext, config)
      throw result.error
    }
  }

  /**
   * Wrap an async operation with error handling and fallback
   */
  async wrapOperationWithFallback<T>(
    operation: () => Promise<T>,
    fallbackValue: T,
    operationName: string,
    context: ErrorContext = {},
    config: ErrorHandlingConfig = {},
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      const errorContext = {
        ...context,
        operation: operationName,
      }

      const result = this.handleErrorWithFallback(
        error,
        fallbackValue,
        errorContext,
        {
          ...config,
          logLevel: config.logLevel || 'warn',
        },
      )

      return result.fallbackValue!
    }
  }

  /**
   * Convert DiscordAPIError to standardized MediaError
   */
  private convertDiscordError(
    error: DiscordAPIError,
    correlationId?: string,
  ): DiscordInteractionError {
    return new DiscordInteractionError(
      error.message,
      `DISCORD_${error.code}`,
      error.status,
      correlationId,
      {
        httpMethod: (error as any).method || 'unknown',
        url: (error as any).url || 'unknown',
      },
      error,
    )
  }

  /**
   * Convert generic Error to appropriate MediaError
   */
  private convertGenericError(
    error: Error,
    context: ErrorContext,
  ): MediaError {
    // Timeout errors
    if (
      error.name === 'TimeoutError' ||
      error.message.toLowerCase().includes('timeout')
    ) {
      return new TimeoutError(
        context.operation || 'unknown_operation',
        30000, // Default 30s timeout
        context.correlationId,
        context,
      )
    }

    // Permission errors
    if (
      error.message.toLowerCase().includes('permission') ||
      error.message.toLowerCase().includes('forbidden')
    ) {
      return MediaErrorFactory.discordInteraction(
        error.message,
        'PERMISSION_ERROR',
        403,
        context.correlationId,
        error,
      )
    }

    // Rate limit errors
    if (
      error.message.toLowerCase().includes('rate limit') ||
      error.message.toLowerCase().includes('too many requests')
    ) {
      return MediaErrorFactory.discordInteraction(
        error.message,
        'RATE_LIMITED',
        429,
        context.correlationId,
        error,
      )
    }

    // Component state errors
    if (
      context.stateId &&
      (error.message.toLowerCase().includes('state') ||
        error.message.toLowerCase().includes('component'))
    ) {
      return new ComponentStateError(
        error.message,
        context.correlationId,
        context.stateId,
        context,
        error,
      )
    }

    // Cleanup errors
    if (
      context.operation?.includes('cleanup') ||
      error.message.toLowerCase().includes('cleanup')
    ) {
      return new CleanupError(
        'component',
        context.stateId || 'unknown',
        error.message,
        context.correlationId,
        context,
        error,
      )
    }

    // Generic component state error as fallback
    return new ComponentStateError(
      error.message,
      context.correlationId,
      context.stateId,
      context,
      error,
    )
  }

  /**
   * Determine if an error should be retried
   */
  private shouldRetryError(error: MediaError): boolean {
    // Timeout errors are usually retryable
    if (error instanceof TimeoutError) {
      return true
    }

    // Rate limit errors are retryable after delay
    if (error instanceof DiscordInteractionError) {
      return (
        error.httpStatus === 429 ||
        error.discordErrorCode?.toString().includes('429')
      )
    }

    // Component state errors are generally not retryable
    if (error instanceof ComponentStateError) {
      return false
    }

    // Generic media errors might be retryable
    return error.message.toLowerCase().includes('temporary') ||
           error.message.toLowerCase().includes('retry') || false
  }

  /**
   * Get retry delay for retryable errors
   */
  private getRetryDelay(error: MediaError): number | undefined {
    if (!this.shouldRetryError(error)) {
      return undefined
    }

    // Extract retry-after from Discord rate limit errors
    if (error instanceof DiscordInteractionError && error.httpStatus === 429) {
      const retryAfter = error.context.retryAfter as number
      return retryAfter || 5000 // Default 5 second delay
    }

    // Default delays for different error types
    if (error instanceof TimeoutError) {
      return 2000 // 2 second delay for timeout retries
    }

    return 1000 // Default 1 second delay
  }

  /**
   * Sanitize context to prevent memory issues and sensitive data exposure
   */
  private sanitizeContext(
    context: ErrorContext,
    maxSize: number,
  ): ErrorContext {
    const serialized = JSON.stringify(context)
    
    if (serialized.length <= maxSize) {
      return context
    }

    // Truncate large values while preserving important fields
    const important = ['correlationId', 'userId', 'stateId', 'operation', 'errorName']
    const sanitized: ErrorContext = {}

    // Always include important fields
    for (const key of important) {
      if (context[key] !== undefined) {
        sanitized[key] = context[key]
      }
    }

    // Add other fields if space allows
    const remainingSize = maxSize - JSON.stringify(sanitized).length
    for (const [key, value] of Object.entries(context)) {
      if (!important.includes(key)) {
        const valueStr = JSON.stringify({ [key]: value })
        if (valueStr.length <= remainingSize) {
          sanitized[key] = value
        } else {
          // Truncate string values
          if (typeof value === 'string' && remainingSize > 50) {
            sanitized[key] = value.substring(0, remainingSize - 20) + '...'
          }
        }
      }
    }

    return sanitized
  }

  /**
   * Log error with appropriate level and context
   */
  private logError(
    result: ErrorHandlingResult,
    level: 'error' | 'warn' | 'debug',
    includeStack: boolean,
  ): void {
    const { error, context, originalError } = result

    const logData = {
      ...context,
      errorName: error.name,
      errorMessage: error.message,
      userMessage: error.toUserMessage(),
      handledAt: result.handledAt,
      shouldRetry: result.shouldRetry,
      retryAfter: result.retryAfter,
    }

    // Add stack trace if requested and available
    if (includeStack && (error.stack || originalError?.stack)) {
      (logData as any).stack = error.stack || originalError?.stack
    }

    switch (level) {
      case 'error':
        this.logger.error(error.message, logData)
        break
      case 'warn':
        this.logger.warn(error.message, logData)
        break
      case 'debug':
        this.logger.debug(error.message, logData)
        break
    }
  }

  /**
   * Emit error event for monitoring and metrics
   */
  private emitErrorEvent(result: ErrorHandlingResult): void {
    if (!this.eventEmitter) return

    this.eventEmitter.emit(EventType.API_ERROR, {
      error: result.error,
      context: result.context,
      originalError: result.originalError,
      handledAt: result.handledAt,
      shouldRetry: result.shouldRetry,
      retryAfter: result.retryAfter,
      userMessage: result.userMessage,
    })
  }

  /**
   * Create error context from correlation context
   */
  static createErrorContext(
    correlationContext: CorrelationContext,
    additional: Record<string, unknown> = {},
  ): ErrorContext {
    return {
      correlationId: correlationContext.correlationId,
      userId: correlationContext.userId,
      guildId: correlationContext.guildId,
      channelId: correlationContext.channelId,
      ...additional,
    }
  }

  /**
   * Extract correlation ID from various sources
   */
  static extractCorrelationId(
    source:
      | string
      | { correlationId?: string }
      | { context?: { correlationId?: string } }
      | CorrelationContext,
  ): string | undefined {
    if (typeof source === 'string') {
      return source
    }

    if ('correlationId' in source && source.correlationId) {
      return source.correlationId
    }

    if ('context' in source && source.context?.correlationId) {
      return source.context.correlationId
    }

    return undefined
  }
}

/**
 * Decorator for automatic error handling in service methods
 */
export function HandleMediaErrors(
  operationName?: string,
  config: ErrorHandlingConfig = {},
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      // Try to find error handler in the service instance
      const errorHandler = (this as any).errorHandler as MediaErrorHandler | undefined

      if (!errorHandler) {
        // No error handler, execute original method
        return originalMethod.apply(this, args)
      }

      const operation = operationName || `${target.constructor.name}.${propertyKey}`

      // Try to extract correlation context from arguments
      const correlationArg = args.find(
        (arg) => arg && typeof arg === 'object' && arg.correlationId,
      )
      
      const context = correlationArg
        ? MediaErrorHandler.createErrorContext(correlationArg)
        : {}

      try {
        return await originalMethod.apply(this, args)
      } catch (error) {
        const result = errorHandler.handleError(error, context, config)
        throw result.error
      }
    }

    return descriptor
  }
}

/**
 * Decorator for automatic error handling with fallback values
 */
export function HandleMediaErrorsWithFallback<T>(
  fallbackValue: T,
  operationName?: string,
  config: ErrorHandlingConfig = {},
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const errorHandler = (this as any).errorHandler as MediaErrorHandler | undefined

      if (!errorHandler) {
        return originalMethod.apply(this, args)
      }

      const operation = operationName || `${target.constructor.name}.${propertyKey}`

      const correlationArg = args.find(
        (arg) => arg && typeof arg === 'object' && arg.correlationId,
      )
      
      const context = correlationArg
        ? MediaErrorHandler.createErrorContext(correlationArg)
        : {}

      try {
        return await originalMethod.apply(this, args)
      } catch (error) {
        const result = errorHandler.handleErrorWithFallback(
          error,
          fallbackValue,
          context,
          config,
        )
        return result.fallbackValue
      }
    }

    return descriptor
  }
}

/**
 * Type guard to check if an error is a MediaError
 */
export function isMediaError(error: unknown): error is MediaError {
  return error instanceof MediaError
}

/**
 * Type guard to check if an error result indicates failure
 */
export function isErrorResult<T>(
  result: ErrorHandlingResult<T> | T,
): result is ErrorHandlingResult<T> {
  return (
    typeof result === 'object' &&
    result !== null &&
    'success' in result &&
    result.success === false
  )
}