import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { nanoid } from 'nanoid'

import { MediaErrorHandler } from 'src/media/errors/error-utils'
import { MediaLoggingError } from 'src/media/errors/media-errors'
import {
  ComponentError,
  ComponentMetrics,
  CorrelationContext,
  InteractionContext,
} from 'src/types/discord.types'
import {
  EventType,
  LogLevel as MediaLogLevel,
  MediaType,
} from 'src/types/enums'

export interface MediaLogContext {
  correlationId: string
  userId: string
  username?: string
  guildId?: string
  channelId?: string
  mediaType?: MediaType
  mediaId?: string
  componentId?: string
  action?: string
  timestamp: Date
  sessionId?: string
  requestId?: string
  service?: 'sonarr' | 'radarr' | 'emby'
}

export interface PerformanceMetric {
  operation: string
  duration: number
  correlationId: string
  success: boolean
  timestamp: Date
  metadata?: Record<string, unknown>
}

export interface ApiCallLog {
  method: string
  url: string
  status?: number
  duration: number
  correlationId: string
  service: 'sonarr' | 'radarr' | 'emby'
  success: boolean
  timestamp: Date
  error?: string
}

@Injectable()
export class MediaLoggingService {
  private readonly logger = new Logger(MediaLoggingService.name)
  private readonly errorHandler: MediaErrorHandler
  private performanceMetrics: PerformanceMetric[] = []
  private apiCallLogs: ApiCallLog[] = []

  // Circular buffer limits to prevent memory leaks
  private readonly maxMetrics = 1000
  private readonly maxApiLogs = 500

  constructor(private readonly eventEmitter: EventEmitter2) {
    this.errorHandler = new MediaErrorHandler(this.logger, this.eventEmitter)
  }

  /**
   * Create correlation context for new operations
   * @throws {MediaLoggingError} When correlation context creation fails
   */
  createCorrelationContext(
    userId: string,
    username: string,
    guildId: string,
    channelId: string,
    mediaType?: MediaType,
  ): CorrelationContext {
    try {
      const correlationId = this.generateCorrelationId()

      const context: CorrelationContext = {
        correlationId,
        userId,
        username,
        guildId,
        channelId,
        startTime: new Date(),
        mediaType,
      }

      this.logOperation('correlation_created', 'Created correlation context', {
        correlationId,
        userId,
        username,
        guildId,
        channelId,
        mediaType,
      })

      return context
    } catch (error) {
      const result = this.errorHandler.handleError(error, {
        userId,
        operation: 'create_correlation_context',
      })
      throw new MediaLoggingError(
        'create_correlation_context',
        result.error.message,
        undefined,
        { userId, username, guildId, channelId, mediaType },
        result.originalError,
      )
    }
  }

  /**
   * Log media operations with correlation context
   * @throws {MediaLoggingError} When logging operation fails
   */
  logOperation(
    operation: string,
    message: string,
    context: Partial<MediaLogContext>,
    level: MediaLogLevel = MediaLogLevel.INFO,
  ): void {
    try {
      const logContext: MediaLogContext = {
        correlationId: context.correlationId || 'unknown',
        userId: context.userId || 'unknown',
        username: context.username,
        guildId: context.guildId,
        channelId: context.channelId,
        mediaType: context.mediaType,
        mediaId: context.mediaId,
        componentId: context.componentId,
        action: context.action,
        timestamp: new Date(),
        sessionId: context.sessionId,
        requestId: context.requestId,
      }

      const logData = {
        operation,
        ...logContext,
      }

      switch (level) {
        case MediaLogLevel.ERROR:
          this.logger.error(message, logData)
          break
        case MediaLogLevel.WARN:
          this.logger.warn(message, logData)
          break
        case MediaLogLevel.DEBUG:
          this.logger.debug(message, logData)
          break
        case MediaLogLevel.TRACE:
          this.logger.verbose(message, logData)
          break
        default:
          this.logger.log(message, logData)
      }

      // Emit event for structured logging consumers
      this.eventEmitter.emit(EventType.API_REQUEST, {
        operation,
        message,
        level,
        context: logContext,
      })
    } catch (error) {
      // For logging operations, we want to handle errors gracefully
      // to prevent logging failures from breaking the main application flow
      const fallbackLogger = new Logger('MediaLoggingService.Fallback')
      fallbackLogger.error('Failed to log operation', {
        operation,
        message,
        error: error instanceof Error ? error.message : String(error),
        context: {
          correlationId: context.correlationId,
          userId: context.userId,
        },
      })

      // Only throw if this is a critical logging operation
      if (level === MediaLogLevel.ERROR) {
        throw new MediaLoggingError(
          operation,
          error instanceof Error ? error.message : String(error),
          context.correlationId,
          { operation, message, level },
          error instanceof Error ? error : undefined,
        )
      }
    }
  }

  /**
   * Log component interactions with full context
   */
  logComponentInteraction(
    interactionContext: InteractionContext,
    action: string,
    result: 'success' | 'error' | 'timeout',
    error?: Error,
  ): void {
    const logContext = this.buildLogContext(
      interactionContext.correlationContext,
    )

    this.logOperation(
      'component_interaction',
      `Component interaction: ${action} - ${result}`,
      {
        ...logContext,
        componentId: interactionContext.state.id,
        action,
        sessionId: interactionContext.state.sessionId,
      },
      result === 'error' ? MediaLogLevel.ERROR : MediaLogLevel.INFO,
    )

    if (error) {
      this.logError(error, interactionContext.correlationContext, {
        action,
        componentId: interactionContext.state.id,
        result,
      })
    }
  }

  /**
   * Log Discord API errors with context
   */
  logDiscordError(
    error: ComponentError,
    correlationContext: CorrelationContext,
    additionalContext?: Record<string, unknown>,
  ): void {
    const logContext = this.buildLogContext(correlationContext)

    this.logOperation(
      'discord_error',
      `Discord API error: ${error.message}`,
      {
        ...logContext,
        ...additionalContext,
      },
      MediaLogLevel.ERROR,
    )

    this.eventEmitter.emit(EventType.API_ERROR, {
      error,
      correlationContext,
      additionalContext,
      timestamp: new Date(),
    })
  }

  /**
   * Log performance metrics
   */
  logPerformance(
    operation: string,
    startTime: number,
    correlationId: string,
    success: boolean = true,
    metadata?: Record<string, unknown>,
  ): void {
    const duration = Date.now() - startTime

    const metric: PerformanceMetric = {
      operation,
      duration,
      correlationId,
      success,
      timestamp: new Date(),
      metadata,
    }

    // Add to circular buffer
    this.performanceMetrics.push(metric)
    if (this.performanceMetrics.length > this.maxMetrics) {
      this.performanceMetrics.shift()
    }

    this.logOperation(
      'performance_metric',
      `Operation ${operation} completed in ${duration}ms`,
      {
        correlationId,
        action: operation,
      },
      duration > 5000 ? MediaLogLevel.WARN : MediaLogLevel.DEBUG,
    )

    // Emit performance event
    this.eventEmitter.emit('media.performance', metric)
  }

  /**
   * Log API calls to external services
   */
  logApiCall(
    service: 'sonarr' | 'radarr' | 'emby',
    method: string,
    url: string,
    startTime: number,
    correlationId: string,
    status?: number,
    error?: Error,
  ): void {
    const duration = Date.now() - startTime
    const success =
      !error && (status === undefined || (status >= 200 && status < 300))

    const apiLog: ApiCallLog = {
      method,
      url,
      status,
      duration,
      correlationId,
      service,
      success,
      timestamp: new Date(),
      error: error?.message,
    }

    // Add to circular buffer
    this.apiCallLogs.push(apiLog)
    if (this.apiCallLogs.length > this.maxApiLogs) {
      this.apiCallLogs.shift()
    }

    this.logOperation(
      'api_call',
      `${service.toUpperCase()} API ${method} ${url} - ${success ? 'success' : 'error'} (${duration}ms)`,
      {
        correlationId,
        action: `${service}_${method.toLowerCase()}`,
      },
      success ? MediaLogLevel.DEBUG : MediaLogLevel.ERROR,
    )

    // Emit API call event
    this.eventEmitter.emit(
      success ? EventType.API_RESPONSE : EventType.API_ERROR,
      apiLog,
    )
  }

  /**
   * Log errors with full context
   */
  logError(
    error: Error,
    correlationContext: CorrelationContext,
    additionalContext?: Record<string, unknown>,
  ): void {
    const logContext = this.buildLogContext(correlationContext)

    this.logOperation(
      'error',
      `Error occurred: ${error.message}`,
      {
        ...logContext,
        ...additionalContext,
      },
      MediaLogLevel.ERROR,
    )

    this.logger.error('Stack trace', {
      correlationId: correlationContext.correlationId,
      stack: error.stack,
      name: error.name,
      ...additionalContext,
    })
  }

  /**
   * Log media search operations
   */
  logMediaSearch(
    searchTerm: string,
    mediaType: MediaType,
    resultCount: number,
    correlationContext: CorrelationContext,
    duration: number,
  ): void {
    const logContext = this.buildLogContext(correlationContext)

    this.logOperation(
      'media_search',
      `Media search for "${searchTerm}" (${mediaType}) returned ${resultCount} results in ${duration}ms`,
      {
        ...logContext,
        mediaType,
        action: 'search',
      },
      MediaLogLevel.INFO,
    )

    this.eventEmitter.emit(EventType.MEDIA_SEARCH, {
      searchTerm,
      mediaType,
      resultCount,
      correlationContext,
      duration,
      timestamp: new Date(),
    })
  }

  /**
   * Log media requests (add to library)
   */
  logMediaRequest(
    mediaId: string,
    mediaType: MediaType,
    title: string,
    correlationContext: CorrelationContext,
    success: boolean,
  ): void {
    const logContext = this.buildLogContext(correlationContext)

    this.logOperation(
      'media_request',
      `Media request for "${title}" (${mediaType}) - ${success ? 'success' : 'failed'}`,
      {
        ...logContext,
        mediaType,
        mediaId,
        action: 'request',
      },
      success ? MediaLogLevel.INFO : MediaLogLevel.ERROR,
    )

    this.eventEmitter.emit(
      success ? EventType.MEDIA_REQUESTED : EventType.API_ERROR,
      {
        mediaId,
        mediaType,
        title,
        correlationContext,
        success,
        timestamp: new Date(),
      },
    )
  }

  /**
   * Get performance metrics for analysis
   */
  getPerformanceMetrics(correlationId?: string): PerformanceMetric[] {
    if (correlationId) {
      return this.performanceMetrics.filter(
        m => m.correlationId === correlationId,
      )
    }
    return [...this.performanceMetrics]
  }

  /**
   * Get API call logs for analysis
   */
  getApiCallLogs(correlationId?: string): ApiCallLog[] {
    if (correlationId) {
      return this.apiCallLogs.filter(l => l.correlationId === correlationId)
    }
    return [...this.apiCallLogs]
  }

  /**
   * Get metrics summary
   */
  getMetricsSummary(): ComponentMetrics {
    const recentMetrics = this.performanceMetrics.filter(
      m => Date.now() - m.timestamp.getTime() < 300000, // Last 5 minutes
    )

    const recentApiCalls = this.apiCallLogs.filter(
      l => Date.now() - l.timestamp.getTime() < 300000, // Last 5 minutes
    )

    const avgResponseTime =
      recentMetrics.length > 0
        ? recentMetrics.reduce((sum, m) => sum + m.duration, 0) /
          recentMetrics.length
        : 0

    const errorRate =
      recentApiCalls.length > 0
        ? (recentApiCalls.filter(l => !l.success).length /
            recentApiCalls.length) *
          100
        : 0

    return {
      totalComponents: this.performanceMetrics.length,
      activeComponents: 0, // Would be set by ComponentStateService
      expiredComponents: 0, // Would be set by ComponentStateService
      totalInteractions: recentMetrics.length,
      avgResponseTime,
      errorRate,
    }
  }

  /**
   * Build log context from correlation context
   */
  private buildLogContext(
    correlationContext: CorrelationContext,
  ): Partial<MediaLogContext> {
    return {
      correlationId: correlationContext.correlationId,
      userId: correlationContext.userId,
      username: correlationContext.username,
      guildId: correlationContext.guildId,
      channelId: correlationContext.channelId,
      mediaType: correlationContext.mediaType,
      requestId: correlationContext.requestId,
    }
  }

  /**
   * Generate unique correlation ID
   */
  private generateCorrelationId(): string {
    return `media_${nanoid(12)}_${Date.now()}`
  }
}
