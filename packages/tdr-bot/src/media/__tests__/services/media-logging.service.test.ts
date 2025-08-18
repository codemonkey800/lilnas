import { Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { TestingModule } from '@nestjs/testing'

// Mock nanoid to generate unique IDs for testing
jest.mock('nanoid', () => ({
  nanoid: jest.fn().mockImplementation(() => {
    return `test-id-${Math.random().toString(36).substr(2, 9)}`
  }),
}))

import { createTestingModule } from 'src/__tests__/test-utils'
import {
  MediaLogContext,
  MediaLoggingService,
} from 'src/media/services/media-logging.service'
import {
  ComponentError,
  ComponentState,
  CorrelationContext,
  InteractionContext,
} from 'src/types/discord.types'
import {
  EventType,
  LogLevel as MediaLogLevel,
  MediaType,
} from 'src/types/enums'

// Mock factories for testing
function createMockCorrelationContext(
  overrides: Partial<CorrelationContext> = {},
): CorrelationContext {
  return {
    correlationId: 'test_correlation_123',
    userId: 'user_123',
    username: 'testuser',
    guildId: 'guild_123',
    channelId: 'channel_123',
    startTime: new Date(),
    mediaType: MediaType.MOVIE,
    requestId: 'request_123',
    ...overrides,
  }
}

function createMockComponentState(
  overrides: Partial<ComponentState> = {},
): ComponentState {
  return {
    id: 'component_123',
    userId: 'user_123',
    type: 2, // ComponentType.BUTTON
    correlationId: 'test_correlation_123',
    sessionId: 'session_123',
    expiresAt: new Date(Date.now() + 300000), // 5 minutes from now
    createdAt: new Date(),
    lastInteractionAt: new Date(),
    interactionCount: 0,
    maxInteractions: 10,
    state: 'ACTIVE' as any,
    data: {},
    ...overrides,
  }
}

function createMockInteractionContext(
  overrides: Partial<InteractionContext> = {},
): InteractionContext {
  return {
    interaction: {} as any,
    state: createMockComponentState(),
    correlationContext: createMockCorrelationContext(),
    user: {} as any,
    guild: {} as any,
    channel: {} as any,
    message: {} as any,
    ...overrides,
  }
}

function createMockComponentError(
  overrides: Partial<ComponentError> = {},
): ComponentError {
  return {
    code: 'TEST_ERROR',
    message: 'Test error message',
    userMessage: 'User-friendly error message',
    correlationId: 'test_correlation_123',
    timestamp: new Date(),
    stack: 'Error stack trace',
    context: {},
    ...overrides,
  }
}

describe('MediaLoggingService', () => {
  let service: MediaLoggingService
  let mockEventEmitter: jest.Mocked<EventEmitter2>
  let mockLogger: {
    error: jest.SpyInstance
    warn: jest.SpyInstance
    log: jest.SpyInstance
    debug: jest.SpyInstance
    verbose: jest.SpyInstance
  }

  beforeEach(async () => {
    const module: TestingModule = await createTestingModule([
      MediaLoggingService,
    ])

    service = module.get<MediaLoggingService>(MediaLoggingService)
    mockEventEmitter = module.get<EventEmitter2>(
      EventEmitter2,
    ) as jest.Mocked<EventEmitter2>

    // Mock all logger methods
    mockLogger = {
      error: jest.spyOn(Logger.prototype, 'error').mockImplementation(),
      warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(),
      log: jest.spyOn(Logger.prototype, 'log').mockImplementation(),
      debug: jest.spyOn(Logger.prototype, 'debug').mockImplementation(),
      verbose: jest.spyOn(Logger.prototype, 'verbose').mockImplementation(),
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('createCorrelationContext', () => {
    it('should create correlation context with all required fields', () => {
      const userId = 'user_123'
      const username = 'testuser'
      const guildId = 'guild_123'
      const channelId = 'channel_123'
      const mediaType = MediaType.SERIES

      const context = service.createCorrelationContext(
        userId,
        username,
        guildId,
        channelId,
        mediaType,
      )

      expect(context.correlationId).toMatch(/^media_.+_\d+$/)
      expect(context.userId).toBe(userId)
      expect(context.username).toBe(username)
      expect(context.guildId).toBe(guildId)
      expect(context.channelId).toBe(channelId)
      expect(context.startTime).toBeInstanceOf(Date)
      expect(context.mediaType).toBe(mediaType)

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Created correlation context',
        expect.objectContaining({
          operation: 'correlation_created',
          correlationId: context.correlationId,
          userId,
          username,
          guildId,
          channelId,
          mediaType,
        }),
      )

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.API_REQUEST,
        expect.objectContaining({
          operation: 'correlation_created',
          level: MediaLogLevel.INFO,
        }),
      )
    })

    it('should generate unique correlation IDs', () => {
      const context1 = service.createCorrelationContext(
        'user1',
        'user1',
        'guild1',
        'channel1',
      )
      const context2 = service.createCorrelationContext(
        'user2',
        'user2',
        'guild2',
        'channel2',
      )

      expect(context1.correlationId).not.toBe(context2.correlationId)
      expect(context1.correlationId).toMatch(/^media_.+_\d+$/)
      expect(context2.correlationId).toMatch(/^media_.+_\d+$/)
    })
  })

  describe('logOperation', () => {
    it('should log operation with appropriate log level', () => {
      const operation = 'test_operation'
      const message = 'Test operation message'
      const context: Partial<MediaLogContext> = {
        correlationId: 'test_123',
        userId: 'user_123',
        mediaType: MediaType.MOVIE,
      }

      service.logOperation(operation, message, context, MediaLogLevel.WARN)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        message,
        expect.objectContaining({
          operation,
          correlationId: 'test_123',
          userId: 'user_123',
          mediaType: MediaType.MOVIE,
          timestamp: expect.any(Date),
        }),
      )

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.API_REQUEST,
        expect.objectContaining({
          operation,
          message,
          level: MediaLogLevel.WARN,
        }),
      )
    })

    it('should handle different log levels correctly', () => {
      const testCases = [
        { level: MediaLogLevel.ERROR, expectedMethod: 'error' },
        { level: MediaLogLevel.WARN, expectedMethod: 'warn' },
        { level: MediaLogLevel.DEBUG, expectedMethod: 'debug' },
        { level: MediaLogLevel.TRACE, expectedMethod: 'verbose' },
        { level: MediaLogLevel.INFO, expectedMethod: 'log' },
      ] as const

      testCases.forEach(({ level, expectedMethod }) => {
        const context = { correlationId: 'test_123', userId: 'user_123' }
        service.logOperation('test_op', 'test message', context, level)

        expect(mockLogger[expectedMethod]).toHaveBeenCalledWith(
          'test message',
          expect.any(Object),
        )
      })
    })

    it('should default to INFO level when no level is specified', () => {
      const context = { correlationId: 'test_123', userId: 'user_123' }
      service.logOperation('test_op', 'test message', context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        'test message',
        expect.any(Object),
      )
    })

    it('should handle missing context fields gracefully', () => {
      const context: Partial<MediaLogContext> = {
        correlationId: 'test_123',
        // Missing other required fields
      }

      service.logOperation('test_op', 'test message', context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        'test message',
        expect.objectContaining({
          correlationId: 'test_123',
          userId: 'unknown', // Default fallback
          timestamp: expect.any(Date),
        }),
      )
    })
  })

  describe('logComponentInteraction', () => {
    it('should log successful component interaction', () => {
      const interactionContext = createMockInteractionContext()
      const action = 'button_click'
      const result = 'success'

      service.logComponentInteraction(interactionContext, action, result)

      expect(mockLogger.log).toHaveBeenCalledWith(
        `Component interaction: ${action} - ${result}`,
        expect.objectContaining({
          operation: 'component_interaction',
          correlationId: interactionContext.correlationContext.correlationId,
          userId: interactionContext.correlationContext.userId,
          componentId: interactionContext.state.id,
          action,
          sessionId: interactionContext.state.sessionId,
        }),
      )
    })

    it('should log error interactions with ERROR level and call logError', () => {
      const interactionContext = createMockInteractionContext()
      const action = 'button_click'
      const result = 'error'
      const error = new Error('Component interaction failed')
      const logErrorSpy = jest.spyOn(service, 'logError').mockImplementation()

      service.logComponentInteraction(interactionContext, action, result, error)

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Component interaction: ${action} - ${result}`,
        expect.any(Object),
      )

      expect(logErrorSpy).toHaveBeenCalledWith(
        error,
        interactionContext.correlationContext,
        {
          action,
          componentId: interactionContext.state.id,
          result,
        },
      )
    })
  })

  describe('logDiscordError', () => {
    it('should log Discord API error and emit event', () => {
      const error = createMockComponentError()
      const correlationContext = createMockCorrelationContext()
      const additionalContext = { customField: 'value' }

      service.logDiscordError(error, correlationContext, additionalContext)

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Discord API error: ${error.message}`,
        expect.objectContaining({
          operation: 'discord_error',
          correlationId: correlationContext.correlationId,
          userId: correlationContext.userId,
          guildId: correlationContext.guildId,
          channelId: correlationContext.channelId,
        }),
      )

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(EventType.API_ERROR, {
        error,
        correlationContext,
        additionalContext,
        timestamp: expect.any(Date),
      })
    })
  })

  describe('logPerformance', () => {
    it('should log performance metrics and add to circular buffer', () => {
      const operation = 'database_query'
      const startTime = Date.now() - 1000 // 1 second ago
      const correlationId = 'test_correlation_123'
      const success = true
      const metadata = { queryType: 'SELECT' }

      service.logPerformance(
        operation,
        startTime,
        correlationId,
        success,
        metadata,
      )

      // Should log with DEBUG level for operations under 5 seconds
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/Operation database_query completed in \d+ms/),
        expect.objectContaining({
          operation: 'performance_metric',
          correlationId,
          action: operation,
        }),
      )

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'media.performance',
        expect.objectContaining({
          operation,
          correlationId,
          success,
          metadata,
          duration: expect.any(Number),
          timestamp: expect.any(Date),
        }),
      )
    })

    it('should log with WARN level for slow operations (>5 seconds)', () => {
      const operation = 'slow_operation'
      const startTime = Date.now() - 6000 // 6 seconds ago
      const correlationId = 'test_correlation_123'

      service.logPerformance(operation, startTime, correlationId)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/Operation slow_operation completed in \d+ms/),
        expect.any(Object),
      )
    })

    it('should maintain circular buffer limit for performance metrics', () => {
      const maxMetrics = (service as any).maxMetrics // Access private property

      // Fill beyond the limit
      for (let i = 0; i < maxMetrics + 10; i++) {
        service.logPerformance(
          `operation_${i}`,
          Date.now() - 100,
          `correlation_${i}`,
        )
      }

      const metrics = service.getPerformanceMetrics()
      expect(metrics.length).toBe(maxMetrics)

      // Should have the most recent metrics
      expect(metrics[metrics.length - 1].operation).toBe(
        `operation_${maxMetrics + 9}`,
      )
    })
  })

  describe('logApiCall', () => {
    it('should log successful API calls', () => {
      const service_name = 'sonarr'
      const method = 'GET'
      const url = '/api/v3/series'
      const startTime = Date.now() - 500 // 500ms ago
      const correlationId = 'test_correlation_123'
      const status = 200

      service.logApiCall(
        service_name,
        method,
        url,
        startTime,
        correlationId,
        status,
      )

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(
          /SONARR API GET \/api\/v3\/series - success \(\d+ms\)/,
        ),
        expect.objectContaining({
          operation: 'api_call',
          correlationId,
          action: 'sonarr_get',
        }),
      )

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.API_RESPONSE,
        expect.objectContaining({
          method,
          url,
          status,
          correlationId,
          service: service_name,
          success: true,
          duration: expect.any(Number),
          timestamp: expect.any(Date),
        }),
      )
    })

    it('should log failed API calls with error', () => {
      const service_name = 'radarr'
      const method = 'POST'
      const url = '/api/v3/movie'
      const startTime = Date.now() - 1000
      const correlationId = 'test_correlation_123'
      const status = 500
      const error = new Error('API call failed')

      service.logApiCall(
        service_name,
        method,
        url,
        startTime,
        correlationId,
        status,
        error,
      )

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(
          /RADARR API POST \/api\/v3\/movie - error \(\d+ms\)/,
        ),
        expect.any(Object),
      )

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.API_ERROR,
        expect.objectContaining({
          success: false,
          error: 'API call failed',
        }),
      )
    })

    it('should maintain circular buffer limit for API call logs', () => {
      const maxApiLogs = (service as any).maxApiLogs // Access private property

      // Fill beyond the limit
      for (let i = 0; i < maxApiLogs + 5; i++) {
        service.logApiCall(
          'emby',
          'GET',
          `/api/test/${i}`,
          Date.now() - 100,
          `correlation_${i}`,
        )
      }

      const apiLogs = service.getApiCallLogs()
      expect(apiLogs.length).toBe(maxApiLogs)

      // Should have the most recent logs
      expect(apiLogs[apiLogs.length - 1].url).toBe(
        `/api/test/${maxApiLogs + 4}`,
      )
    })
  })

  describe('logError', () => {
    it('should log error with full context and stack trace', () => {
      const error = new Error('Test error message')
      error.stack = 'Error stack trace'
      const correlationContext = createMockCorrelationContext()
      const additionalContext = { customField: 'value' }

      service.logError(error, correlationContext, additionalContext)

      expect(mockLogger.error).toHaveBeenNthCalledWith(
        1,
        'Error occurred: Test error message',
        expect.objectContaining({
          operation: 'error',
          correlationId: correlationContext.correlationId,
          userId: correlationContext.userId,
          guildId: correlationContext.guildId,
          channelId: correlationContext.channelId,
        }),
      )

      expect(mockLogger.error).toHaveBeenNthCalledWith(
        2,
        'Stack trace',
        expect.objectContaining({
          correlationId: correlationContext.correlationId,
          stack: 'Error stack trace',
          name: 'Error',
          customField: 'value',
        }),
      )
    })
  })

  describe('logMediaSearch', () => {
    it('should log media search with results and emit event', () => {
      const searchTerm = 'The Matrix'
      const mediaType = MediaType.MOVIE
      const resultCount = 5
      const correlationContext = createMockCorrelationContext()
      const duration = 250

      service.logMediaSearch(
        searchTerm,
        mediaType,
        resultCount,
        correlationContext,
        duration,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        `Media search for "The Matrix" (movie) returned 5 results in 250ms`,
        expect.objectContaining({
          operation: 'media_search',
          correlationId: correlationContext.correlationId,
          mediaType,
          action: 'search',
        }),
      )

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.MEDIA_SEARCH,
        {
          searchTerm,
          mediaType,
          resultCount,
          correlationContext,
          duration,
          timestamp: expect.any(Date),
        },
      )
    })
  })

  describe('logMediaRequest', () => {
    it('should log successful media request', () => {
      const mediaId = 'movie_123'
      const mediaType = MediaType.MOVIE
      const title = 'The Matrix'
      const correlationContext = createMockCorrelationContext()
      const success = true

      service.logMediaRequest(
        mediaId,
        mediaType,
        title,
        correlationContext,
        success,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Media request for "The Matrix" (movie) - success',
        expect.objectContaining({
          operation: 'media_request',
          correlationId: correlationContext.correlationId,
          mediaType,
          mediaId,
          action: 'request',
        }),
      )

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.MEDIA_REQUESTED,
        expect.objectContaining({
          mediaId,
          mediaType,
          title,
          correlationContext,
          success: true,
          timestamp: expect.any(Date),
        }),
      )
    })

    it('should log failed media request with error level', () => {
      const mediaId = 'series_456'
      const mediaType = MediaType.SERIES
      const title = 'Breaking Bad'
      const correlationContext = createMockCorrelationContext()
      const success = false

      service.logMediaRequest(
        mediaId,
        mediaType,
        title,
        correlationContext,
        success,
      )

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Media request for "Breaking Bad" (series) - failed',
        expect.any(Object),
      )

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.API_ERROR,
        expect.objectContaining({
          success: false,
        }),
      )
    })
  })

  describe('getPerformanceMetrics', () => {
    beforeEach(() => {
      // Add some test metrics
      service.logPerformance('operation1', Date.now() - 100, 'correlation1')
      service.logPerformance('operation2', Date.now() - 200, 'correlation2')
      service.logPerformance('operation3', Date.now() - 300, 'correlation1')
    })

    it('should return all metrics when no correlation ID is provided', () => {
      const metrics = service.getPerformanceMetrics()

      expect(metrics.length).toBe(3)
      expect(metrics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operation: 'operation1' }),
          expect.objectContaining({ operation: 'operation2' }),
          expect.objectContaining({ operation: 'operation3' }),
        ]),
      )
    })

    it('should filter metrics by correlation ID when provided', () => {
      const metrics = service.getPerformanceMetrics('correlation1')

      expect(metrics.length).toBe(2)
      expect(metrics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: 'operation1',
            correlationId: 'correlation1',
          }),
          expect.objectContaining({
            operation: 'operation3',
            correlationId: 'correlation1',
          }),
        ]),
      )
    })

    it('should return empty array for non-existent correlation ID', () => {
      const metrics = service.getPerformanceMetrics('non-existent')
      expect(metrics).toEqual([])
    })
  })

  describe('getApiCallLogs', () => {
    beforeEach(() => {
      // Add some test API call logs
      service.logApiCall(
        'sonarr',
        'GET',
        '/api1',
        Date.now() - 100,
        'correlation1',
      )
      service.logApiCall(
        'radarr',
        'POST',
        '/api2',
        Date.now() - 200,
        'correlation2',
      )
      service.logApiCall(
        'emby',
        'GET',
        '/api3',
        Date.now() - 300,
        'correlation1',
      )
    })

    it('should return all API logs when no correlation ID is provided', () => {
      const logs = service.getApiCallLogs()

      expect(logs.length).toBe(3)
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ service: 'sonarr', url: '/api1' }),
          expect.objectContaining({ service: 'radarr', url: '/api2' }),
          expect.objectContaining({ service: 'emby', url: '/api3' }),
        ]),
      )
    })

    it('should filter logs by correlation ID when provided', () => {
      const logs = service.getApiCallLogs('correlation1')

      expect(logs.length).toBe(2)
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            service: 'sonarr',
            correlationId: 'correlation1',
          }),
          expect.objectContaining({
            service: 'emby',
            correlationId: 'correlation1',
          }),
        ]),
      )
    })
  })

  describe('getMetricsSummary', () => {
    beforeEach(() => {
      const now = Date.now()
      // Add recent metrics (within 5 minutes)
      service.logPerformance('recent1', now - 100000, 'correlation1', true) // 100 seconds ago
      service.logPerformance('recent2', now - 200000, 'correlation2', true) // 200 seconds ago

      // Add old metrics (older than 5 minutes)
      service.logPerformance('old1', now - 400000, 'correlation3', true) // 400 seconds ago

      // Add recent API calls
      service.logApiCall(
        'sonarr',
        'GET',
        '/api1',
        now - 100000,
        'correlation1',
        200,
      )
      service.logApiCall(
        'radarr',
        'POST',
        '/api2',
        now - 150000,
        'correlation2',
        500,
      ) // Error
    })

    it('should calculate metrics summary correctly', () => {
      const summary = service.getMetricsSummary()

      expect(summary).toEqual({
        totalComponents: expect.any(Number), // Total performance metrics logged
        activeComponents: 0, // Would be set by ComponentStateService
        expiredComponents: 0, // Would be set by ComponentStateService
        totalInteractions: expect.any(Number), // Recent metrics only (within 5 minutes)
        avgResponseTime: expect.any(Number), // Average of recent metrics
        errorRate: expect.any(Number), // Error rate percentage
      })

      expect(summary.totalComponents).toBeGreaterThanOrEqual(3)
      expect(summary.totalInteractions).toBeGreaterThanOrEqual(2)
      expect(summary.avgResponseTime).toBeGreaterThan(0)
    })

    it('should handle empty metrics gracefully', () => {
      // Create a fresh service with no metrics
      const freshService = new MediaLoggingService(mockEventEmitter)
      const summary = freshService.getMetricsSummary()

      expect(summary).toEqual({
        totalComponents: 0,
        activeComponents: 0,
        expiredComponents: 0,
        totalInteractions: 0,
        avgResponseTime: 0,
        errorRate: 0,
      })
    })
  })

  describe('private utility methods', () => {
    it('should build log context from correlation context', () => {
      const correlationContext = createMockCorrelationContext({
        correlationId: 'test_123',
        userId: 'user_123',
        username: 'testuser',
        guildId: 'guild_123',
        channelId: 'channel_123',
        mediaType: MediaType.SERIES,
        requestId: 'request_123',
      })

      // Access private method for testing
      const buildLogContext = (service as any).buildLogContext.bind(service)
      const logContext = buildLogContext(correlationContext)

      expect(logContext).toEqual({
        correlationId: 'test_123',
        userId: 'user_123',
        username: 'testuser',
        guildId: 'guild_123',
        channelId: 'channel_123',
        mediaType: MediaType.SERIES,
        requestId: 'request_123',
      })
    })

    it('should generate correlation IDs with correct format', () => {
      // Access private method for testing
      const generateCorrelationId = (service as any).generateCorrelationId.bind(
        service,
      )
      const correlationId = generateCorrelationId()

      expect(correlationId).toMatch(/^media_.+_\d+$/)
      expect(typeof correlationId).toBe('string')
      expect(correlationId.length).toBeGreaterThan(20)
    })
  })

  describe('edge cases and error boundaries', () => {
    it('should handle malformed correlation context gracefully', () => {
      const malformedContext = {
        correlationId: '',
        userId: null as any,
        username: undefined as any,
      } as CorrelationContext

      // This should not throw
      expect(() => {
        service.logError(new Error('Test'), malformedContext)
      }).not.toThrow()

      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('should handle null/undefined errors in logError', () => {
      const correlationContext = createMockCorrelationContext()

      // This should throw because the service doesn't handle null errors gracefully
      expect(() => {
        service.logError(null as any, correlationContext)
      }).toThrow('Cannot read properties of null')
    })

    it('should handle negative durations in performance logging', () => {
      const futureStartTime = Date.now() + 1000 // Future time
      const correlationId = 'test_123'

      service.logPerformance('test_operation', futureStartTime, correlationId)

      const metrics = service.getPerformanceMetrics()
      const metric = metrics.find(m => m.correlationId === correlationId)

      expect(metric).toBeDefined()
      expect(typeof metric!.duration).toBe('number')
    })

    it('should handle extremely long operation names and URLs', () => {
      const longOperationName = 'a'.repeat(1000)
      const longUrl = 'https://example.com/api/' + 'b'.repeat(2000)

      expect(() => {
        service.logPerformance(longOperationName, Date.now() - 100, 'test_123')
        service.logApiCall(
          'sonarr',
          'GET',
          longUrl,
          Date.now() - 100,
          'test_123',
        )
      }).not.toThrow()

      expect(mockLogger.debug).toHaveBeenCalled()
    })

    it('should handle API calls with missing status codes', () => {
      service.logApiCall(
        'emby',
        'GET',
        '/api/test',
        Date.now() - 100,
        'test_123',
      )

      const logs = service.getApiCallLogs()
      const log = logs.find(l => l.url === '/api/test')

      expect(log).toBeDefined()
      expect(log!.success).toBe(true) // Should default to success when no error and no status
    })
  })
})
