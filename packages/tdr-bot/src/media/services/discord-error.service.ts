import { Injectable, Logger } from '@nestjs/common'
import { DiscordAPIError, InteractionResponse, Message } from 'discord.js'

import {
  ComponentError,
  ComponentInteraction,
  CorrelationContext,
} from 'src/types/discord.types'
import {
  ErrorCategory,
  ErrorClassificationService,
  ErrorSeverity,
} from 'src/utils/error-classifier'
import { RetryConfig, RetryService } from 'src/utils/retry.service'

/**
 * Discord-specific error codes that require special handling
 */
export enum DiscordErrorCode {
  UNKNOWN_INTERACTION = 10062,
  INTERACTION_ALREADY_ACKNOWLEDGED = 40060,
  MISSING_PERMISSIONS = 50013,
}

/**
 * Configuration for Discord API rate limiting
 */
export interface DiscordRateLimitConfig {
  baseDelay: number
  maxDelay: number
  exponentialBase: number
  maxAttempts: number
  circuitBreakerThreshold: number
  circuitBreakerResetTime: number
}

/**
 * Fallback mechanism configuration
 */
export interface FallbackConfig {
  enableFollowUpMessage: boolean
  enableEditMessage: boolean
  enableEphemeralResponse: boolean
  fallbackMessage: string
  maxFallbackAttempts: number
}

/**
 * Discord interaction context for error handling
 */
export interface DiscordInteractionContext {
  interaction: ComponentInteraction
  correlationContext: CorrelationContext
  isDeferred: boolean
  isReplied: boolean
  isExpired: boolean
}

/**
 * Result of Discord error handling operation
 */
export interface DiscordErrorResult {
  success: boolean
  handled: boolean
  fallbackUsed: boolean
  response?: InteractionResponse | Message
  error?: ComponentError
  retryAfter?: number
}

/**
 * Discord Error Service
 *
 * Provides specialized error handling for Discord API interactions with:
 * - Rate limiting with exponential backoff
 * - Circuit breaker pattern for API failures
 * - Fallback mechanisms for expired interactions
 * - Correlation ID support for tracing
 * - Integration with existing error infrastructure
 */
@Injectable()
export class DiscordErrorService {
  private readonly logger = new Logger(DiscordErrorService.name)

  private readonly defaultRateLimitConfig: DiscordRateLimitConfig = {
    baseDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    exponentialBase: 2, // 2x multiplier
    maxAttempts: 5,
    circuitBreakerThreshold: 5,
    circuitBreakerResetTime: 30000, // 30 seconds
  }

  private readonly defaultFallbackConfig: FallbackConfig = {
    enableFollowUpMessage: true,
    enableEditMessage: true,
    enableEphemeralResponse: true,
    fallbackMessage:
      'An error occurred while processing your request. Please try again.',
    maxFallbackAttempts: 3,
  }

  constructor(
    private readonly errorClassifier: ErrorClassificationService,
    private readonly retryService: RetryService,
  ) {}

  /**
   * Handle Discord API errors with specialized logic for interaction errors
   */
  async handleDiscordError(
    error: Error,
    context: DiscordInteractionContext,
    rateLimitConfig: Partial<DiscordRateLimitConfig> = {},
    fallbackConfig: Partial<FallbackConfig> = {},
  ): Promise<DiscordErrorResult> {
    const finalRateLimitConfig = {
      ...this.defaultRateLimitConfig,
      ...rateLimitConfig,
    }
    const finalFallbackConfig = {
      ...this.defaultFallbackConfig,
      ...fallbackConfig,
    }

    const correlationId = context.correlationContext.correlationId

    this.logger.debug('Handling Discord error', {
      correlationId,
      userId: context.correlationContext.userId,
      errorName: error.name,
      errorMessage: error.message,
      isDeferred: context.isDeferred,
      isReplied: context.isReplied,
      isExpired: context.isExpired,
    })

    // Check if it's a Discord API error
    if (this.isDiscordAPIError(error)) {
      return this.handleDiscordAPIError(
        error as DiscordAPIError,
        context,
        finalRateLimitConfig,
        finalFallbackConfig,
      )
    }

    // Handle generic errors
    return this.handleGenericError(error, context, finalFallbackConfig)
  }

  /**
   * Execute Discord API operation with retry logic and circuit breaker
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: DiscordInteractionContext,
    operationName: string,
    config: Partial<DiscordRateLimitConfig> = {},
  ): Promise<T> {
    const finalConfig = { ...this.defaultRateLimitConfig, ...config }
    const correlationId = context.correlationContext.correlationId

    const retryConfig: RetryConfig = {
      maxAttempts: finalConfig.maxAttempts,
      baseDelay: finalConfig.baseDelay,
      maxDelay: finalConfig.maxDelay,
      backoffFactor: finalConfig.exponentialBase,
      jitter: true,
      timeout: 30000, // 30 second timeout
      logRetryAttempts: true,
      logSuccessfulRetries: true,
      logFailedRetries: true,
      logRetryDelays: true,
      logErrorDetails: true,
      logSeverityThreshold: ErrorSeverity.LOW,
    }

    const circuitBreakerKey = this.getCircuitBreakerKey(context)

    try {
      return await this.retryService.executeWithCircuitBreaker(
        async () => {
          // Check if interaction is still valid before attempting operation
          if (this.isInteractionExpired(context)) {
            throw new Error(
              `Interaction expired for correlation ${correlationId}`,
            )
          }

          return await operation()
        },
        circuitBreakerKey,
        retryConfig,
        operationName,
        ErrorCategory.DISCORD_API,
      )
    } catch (error) {
      this.logger.error(
        `Discord operation failed after retries: ${operationName}`,
        {
          correlationId,
          userId: context.correlationContext.userId,
          operationName,
          error: error instanceof Error ? error.message : String(error),
          circuitBreakerKey,
        },
      )

      throw error
    }
  }

  /**
   * Create a structured ComponentError for Discord errors
   */
  createComponentError(
    error: Error,
    correlationId: string,
    userMessage?: string,
    context?: Record<string, unknown>,
  ): ComponentError {
    const componentError: ComponentError = {
      code: this.getErrorCode(error),
      message: error.message,
      userMessage: userMessage || this.getUserFriendlyMessage(error),
      correlationId,
      timestamp: new Date(),
      stack: error.stack,
      context: {
        ...context,
        errorName: error.name,
        errorType: error.constructor.name,
      },
    }

    this.logger.error('Created component error', {
      correlationId,
      code: componentError.code,
      message: componentError.message,
      userMessage: componentError.userMessage,
    })

    return componentError
  }

  /**
   * Check if an error is retryable based on Discord-specific logic
   */
  isRetryableError(error: Error): boolean {
    if (this.isDiscordAPIError(error)) {
      const discordError = error as DiscordAPIError

      // Non-retryable Discord error codes
      const nonRetryableCodes = [
        DiscordErrorCode.UNKNOWN_INTERACTION,
        DiscordErrorCode.INTERACTION_ALREADY_ACKNOWLEDGED,
        DiscordErrorCode.MISSING_PERMISSIONS,
      ]

      if (nonRetryableCodes.includes(discordError.code as DiscordErrorCode)) {
        return false
      }
    }

    // Use existing error classification
    const classification = this.errorClassifier.classifyError(
      error,
      ErrorCategory.DISCORD_API,
    )
    return classification.isRetryable
  }

  /**
   * Get rate limit delay from Discord error
   */
  getRateLimitDelay(error: DiscordAPIError): number | undefined {
    // Discord rate limit errors include retry-after in seconds
    if (error.code === 429) {
      // Rate limited error code
      // Try to extract retry-after from rawError if available
      const retryAfter = (error as DiscordAPIError & { retryAfter?: number })
        .retryAfter
      return retryAfter ? retryAfter * 1000 : undefined
    }
    return undefined
  }

  /**
   * Handle Discord API specific errors
   */
  private async handleDiscordAPIError(
    error: DiscordAPIError,
    context: DiscordInteractionContext,
    rateLimitConfig: DiscordRateLimitConfig,
    fallbackConfig: FallbackConfig,
  ): Promise<DiscordErrorResult> {
    const correlationId = context.correlationContext.correlationId

    switch (error.code) {
      case DiscordErrorCode.UNKNOWN_INTERACTION:
        return this.handleUnknownInteraction(error, context, fallbackConfig)

      case DiscordErrorCode.INTERACTION_ALREADY_ACKNOWLEDGED:
        return this.handleAlreadyAcknowledged(error, context, fallbackConfig)

      case DiscordErrorCode.MISSING_PERMISSIONS:
        return this.handleMissingPermissions(error, context, fallbackConfig)

      case 429: // Rate limited
        return this.handleRateLimit(error, context, rateLimitConfig)

      default:
        this.logger.warn('Unhandled Discord API error', {
          correlationId,
          errorCode: error.code,
          errorMessage: error.message,
          httpStatus: error.status,
        })

        return this.handleGenericDiscordError(error, context, fallbackConfig)
    }
  }

  /**
   * Handle Unknown Interaction errors (10062)
   */
  private async handleUnknownInteraction(
    error: DiscordAPIError,
    context: DiscordInteractionContext,
    fallbackConfig: FallbackConfig,
  ): Promise<DiscordErrorResult> {
    const correlationId = context.correlationContext.correlationId

    this.logger.warn(
      'Unknown interaction error - interaction may have expired',
      {
        correlationId,
        userId: context.correlationContext.userId,
        interactionId: context.interaction.id,
        isExpired: context.isExpired,
      },
    )

    // Try fallback mechanisms
    if (fallbackConfig.enableFollowUpMessage) {
      try {
        const followUp = await context.interaction.followUp({
          content: fallbackConfig.fallbackMessage,
          ephemeral: true,
        })

        return {
          success: true,
          handled: true,
          fallbackUsed: true,
          response: followUp,
        }
      } catch (fallbackError) {
        this.logger.error('Fallback follow-up failed', {
          correlationId,
          fallbackError:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
        })
      }
    }

    return {
      success: false,
      handled: true,
      fallbackUsed: false,
      error: this.createComponentError(
        error,
        correlationId,
        'This interaction has expired. Please try the command again.',
        { errorCode: error.code },
      ),
    }
  }

  /**
   * Handle Interaction Already Acknowledged errors (40060)
   */
  private async handleAlreadyAcknowledged(
    error: DiscordAPIError,
    context: DiscordInteractionContext,
    fallbackConfig: FallbackConfig,
  ): Promise<DiscordErrorResult> {
    const correlationId = context.correlationContext.correlationId

    this.logger.warn('Interaction already acknowledged', {
      correlationId,
      userId: context.correlationContext.userId,
      interactionId: context.interaction.id,
      isDeferred: context.isDeferred,
      isReplied: context.isReplied,
    })

    // If we can edit the reply, try that
    if (context.isReplied && fallbackConfig.enableEditMessage) {
      try {
        const editedReply = await context.interaction.editReply({
          content: 'Processing your request...',
        })

        return {
          success: true,
          handled: true,
          fallbackUsed: true,
          response: editedReply,
        }
      } catch (editError) {
        this.logger.error('Failed to edit reply as fallback', {
          correlationId,
          editError:
            editError instanceof Error ? editError.message : String(editError),
        })
      }
    }

    return {
      success: false,
      handled: true,
      fallbackUsed: false,
      error: this.createComponentError(
        error,
        correlationId,
        'Unable to process your request. Please try again.',
        { errorCode: error.code, isReplied: context.isReplied },
      ),
    }
  }

  /**
   * Handle Missing Permissions errors (50013)
   */
  private async handleMissingPermissions(
    error: DiscordAPIError,
    context: DiscordInteractionContext,
    fallbackConfig: FallbackConfig,
  ): Promise<DiscordErrorResult> {
    const correlationId = context.correlationContext.correlationId

    this.logger.error('Missing permissions for Discord operation', {
      correlationId,
      userId: context.correlationContext.userId,
      guildId: context.correlationContext.guildId,
      channelId: context.correlationContext.channelId,
      errorMessage: error.message,
    })

    const permissionError = this.createComponentError(
      error,
      correlationId,
      "I don't have the required permissions to perform this action. Please contact a server administrator.",
      {
        errorCode: error.code,
        guildId: context.correlationContext.guildId,
        channelId: context.correlationContext.channelId,
      },
    )

    // Try to respond with ephemeral message if possible
    if (fallbackConfig.enableEphemeralResponse) {
      try {
        let response: InteractionResponse | Message

        if (!context.isReplied && !context.isDeferred) {
          response = await context.interaction.reply({
            content: permissionError.userMessage!,
            ephemeral: true,
          })
        } else {
          response = await context.interaction.followUp({
            content: permissionError.userMessage!,
            ephemeral: true,
          })
        }

        return {
          success: true,
          handled: true,
          fallbackUsed: true,
          response,
          error: permissionError,
        }
      } catch (responseError) {
        this.logger.error('Failed to send permission error message', {
          correlationId,
          responseError:
            responseError instanceof Error
              ? responseError.message
              : String(responseError),
        })
      }
    }

    return {
      success: false,
      handled: true,
      fallbackUsed: false,
      error: permissionError,
    }
  }

  /**
   * Handle rate limit errors
   */
  private async handleRateLimit(
    error: DiscordAPIError,
    context: DiscordInteractionContext,
    rateLimitConfig: DiscordRateLimitConfig,
  ): Promise<DiscordErrorResult> {
    const correlationId = context.correlationContext.correlationId
    const retryAfter = this.getRateLimitDelay(error)

    this.logger.warn('Discord rate limit hit', {
      correlationId,
      userId: context.correlationContext.userId,
      retryAfter,
    })

    return {
      success: false,
      handled: true,
      fallbackUsed: false,
      retryAfter,
      error: this.createComponentError(
        error,
        correlationId,
        'Service is temporarily busy. Please try again in a moment.',
        {
          errorCode: error.code,
          retryAfter,
        },
      ),
    }
  }

  /**
   * Handle generic Discord errors
   */
  private async handleGenericDiscordError(
    error: DiscordAPIError,
    context: DiscordInteractionContext,
    fallbackConfig: FallbackConfig,
  ): Promise<DiscordErrorResult> {
    const correlationId = context.correlationContext.correlationId

    const componentError = this.createComponentError(
      error,
      correlationId,
      'An unexpected error occurred. Please try again.',
      {
        errorCode: error.code,
        httpStatus: error.status,
      },
    )

    return {
      success: false,
      handled: true,
      fallbackUsed: false,
      error: componentError,
    }
  }

  /**
   * Handle generic (non-Discord API) errors
   */
  private async handleGenericError(
    error: Error,
    context: DiscordInteractionContext,
    fallbackConfig: FallbackConfig,
  ): Promise<DiscordErrorResult> {
    const correlationId = context.correlationContext.correlationId

    this.logger.error('Generic error in Discord operation', {
      correlationId,
      userId: context.correlationContext.userId,
      errorName: error.name,
      errorMessage: error.message,
    })

    const componentError = this.createComponentError(
      error,
      correlationId,
      'An unexpected error occurred. Please try again.',
    )

    return {
      success: false,
      handled: false,
      fallbackUsed: false,
      error: componentError,
    }
  }

  /**
   * Check if error is a Discord API error
   */
  private isDiscordAPIError(error: Error): boolean {
    return error.name === 'DiscordAPIError' || error instanceof DiscordAPIError
  }

  /**
   * Check if interaction has expired
   */
  private isInteractionExpired(context: DiscordInteractionContext): boolean {
    // Discord interactions expire after 15 minutes
    const INTERACTION_LIFETIME = 15 * 60 * 1000 // 15 minutes
    const interactionAge = Date.now() - context.interaction.createdTimestamp

    return context.isExpired || interactionAge > INTERACTION_LIFETIME
  }

  /**
   * Generate circuit breaker key for context
   */
  private getCircuitBreakerKey(context: DiscordInteractionContext): string {
    return `discord:${context.correlationContext.guildId}:${context.correlationContext.channelId}`
  }

  /**
   * Get error code from error
   */
  private getErrorCode(error: Error): string {
    if (this.isDiscordAPIError(error)) {
      const discordError = error as DiscordAPIError
      return `DISCORD_${discordError.code}`
    }

    return error.name || 'UNKNOWN_ERROR'
  }

  /**
   * Get user-friendly error message
   */
  private getUserFriendlyMessage(error: Error): string {
    if (this.isDiscordAPIError(error)) {
      const discordError = error as DiscordAPIError

      switch (discordError.code) {
        case DiscordErrorCode.UNKNOWN_INTERACTION:
          return 'This interaction has expired. Please try the command again.'
        case DiscordErrorCode.INTERACTION_ALREADY_ACKNOWLEDGED:
          return 'Unable to process your request. Please try again.'
        case DiscordErrorCode.MISSING_PERMISSIONS:
          return "I don't have the required permissions to perform this action."
        case 429: // Rate limited
          return 'Service is temporarily busy. Please try again in a moment.'
        default:
          return 'An error occurred while processing your request.'
      }
    }

    // Generic error messages
    if (error.name === 'TimeoutError') {
      return 'The operation took too long to complete. Please try again.'
    }

    return 'An unexpected error occurred. Please try again.'
  }
}
