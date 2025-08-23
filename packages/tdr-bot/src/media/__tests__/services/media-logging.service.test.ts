import { EventEmitter2 } from '@nestjs/event-emitter'
import { TestingModule } from '@nestjs/testing'
import { Guild, TextChannel } from 'discord.js'

// Mock nanoid to generate unique IDs for testing
jest.mock('nanoid', () => ({
  nanoid: jest.fn().mockImplementation(() => {
    return `test-id-${Math.random().toString(36).substr(2, 9)}`
  }),
}))

import { createTestingModule } from 'src/__tests__/test-utils'
import { ComponentLifecycleState } from 'src/media/component-config'
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
    state: ComponentLifecycleState.ACTIVE,
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
    guild: {} as unknown as Guild | null,
    channel: {} as unknown as TextChannel | null,
    message: {} as any,
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

    // Create a mock logger with all the methods
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    }

    // Replace the service's private logger with our mock
    ;(service as unknown as { logger: unknown }).logger = mockLogger
  })

  describe('createCorrelationContext', () => {
    it('should create correlation context for media operations', () => {
      const context = service.createCorrelationContext(
        'user_123',
        'testuser',
        'guild_123',
        'channel_123',
        MediaType.MOVIE,
      )

      expect(context).toEqual({
        correlationId: expect.stringMatching(/^media_/),
        userId: 'user_123',
        username: 'testuser',
        guildId: 'guild_123',
        channelId: 'channel_123',
        startTime: expect.any(Date),
        mediaType: MediaType.MOVIE,
      })
    })
  })

  describe('Media Operation Logging', () => {
    it('should log media operations with proper context and emit events', () => {
      const context: Partial<MediaLogContext> = {
        correlationId: 'test_123',
        userId: 'user_123',
        mediaType: MediaType.MOVIE,
      }

      service.logOperation(
        'media_search',
        'Search operation',
        context,
        MediaLogLevel.INFO,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Search operation',
        expect.objectContaining({
          operation: 'media_search',
          correlationId: 'test_123',
          userId: 'user_123',
          mediaType: MediaType.MOVIE,
          timestamp: expect.any(Date),
        }),
      )

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.API_REQUEST,
        expect.objectContaining({
          operation: 'media_search',
          level: MediaLogLevel.INFO,
        }),
      )
    })

    it('should log successful component interactions', () => {
      const interactionContext = createMockInteractionContext()

      service.logComponentInteraction(
        interactionContext,
        'button_click',
        'success',
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(
          'Component interaction: button_click - success',
        ),
        expect.any(Object),
      )
    })

    it('should log failed component interactions', () => {
      const interactionContext = createMockInteractionContext()
      const error = new Error('Interaction failed')

      service.logComponentInteraction(
        interactionContext,
        'button_click',
        'error',
        error,
      )

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Component interaction: button_click - error'),
        expect.any(Object),
      )
    })
  })

  describe('Media-Specific Logging', () => {
    it('should log media searches with results and emit events', () => {
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
        expect.objectContaining({
          searchTerm,
          mediaType,
          resultCount,
          duration,
        }),
      )
    })

    it('should log media requests with success/failure states', () => {
      const correlationContext = createMockCorrelationContext()

      // Test successful request
      service.logMediaRequest(
        'movie_123',
        MediaType.MOVIE,
        'Test Movie',
        correlationContext,
        true,
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Media request'),
        expect.objectContaining({
          operation: 'media_request',
          correlationId: correlationContext.correlationId,
        }),
      )

      // Test failed request
      service.logMediaRequest(
        'movie_456',
        MediaType.MOVIE,
        'Failed Movie',
        correlationContext,
        false,
      )
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('API and Performance Tracking', () => {
    it('should track performance metrics and detect slow operations', () => {
      const operation = 'test_operation'
      const startTime = Date.now() - 500
      const correlationId = 'test_correlation_123'

      service.logPerformance(operation, startTime, correlationId)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/Operation test_operation completed in \d+ms/),
        expect.objectContaining({
          operation: 'performance_metric',
          correlationId,
          action: operation,
        }),
      )

      // Test slow operation warning threshold (>5 seconds)
      const slowStartTime = Date.now() - 6000
      service.logPerformance('slow_operation', slowStartTime, correlationId)
      expect(mockLogger.warn).toHaveBeenCalled()

      // Verify metrics are tracked
      const metrics = service.getPerformanceMetrics()
      expect(metrics.length).toBe(2)
    })

    it('should log API calls and handle success/error states', () => {
      // Test successful API call
      service.logApiCall(
        'sonarr',
        'GET',
        '/api/v3/series',
        Date.now() - 500,
        'test_correlation_123',
        200,
      )

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/SONARR API GET.*success/),
        expect.objectContaining({ operation: 'api_call' }),
      )
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.API_RESPONSE,
        expect.objectContaining({ success: true }),
      )

      // Test failed API call
      const error = new Error('API call failed')
      service.logApiCall(
        'radarr',
        'POST',
        '/api/v3/movie',
        Date.now() - 1000,
        'test_correlation_456',
        500,
        error,
      )

      expect(mockLogger.error).toHaveBeenCalled()
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.API_ERROR,
        expect.objectContaining({ success: false }),
      )
    })
  })

  describe('Error Handling and Discord Integration', () => {
    it('should log Discord errors and emit error events', () => {
      const error: ComponentError = {
        code: 'DISCORD_ERROR',
        message: 'Discord API error',
        userMessage: 'Something went wrong',
        correlationId: 'test_123',
        timestamp: new Date(),
        stack: 'Error stack',
        context: {},
      }
      const correlationContext = createMockCorrelationContext()

      service.logDiscordError(error, correlationContext)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Discord API error'),
        expect.objectContaining({
          operation: 'discord_error',
          correlationId: correlationContext.correlationId,
        }),
      )

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.API_ERROR,
        expect.objectContaining({
          error,
          correlationContext,
        }),
      )
    })

    it('should log errors with full context and stack traces', () => {
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

      // Second call should be for the stack trace
      expect(mockLogger.error).toHaveBeenNthCalledWith(
        2,
        'Stack trace',
        expect.objectContaining({
          correlationId: correlationContext.correlationId,
          customField: 'value',
          stack: 'Error stack trace',
          name: 'Error',
        }),
      )
    })

    it('should handle incomplete logging contexts gracefully', () => {
      const incompleteContext = {
        correlationId: null,
        userId: undefined,
      } as Record<string, unknown>

      expect(() => {
        service.logOperation(
          'media_operation',
          'Operation message',
          incompleteContext,
        )
      }).not.toThrow()

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Operation message',
        expect.objectContaining({
          correlationId: 'unknown',
          userId: 'unknown',
        }),
      )
    })
  })

  describe('Business Metrics and Reporting', () => {
    it('should track and filter performance metrics for business analysis', () => {
      service.logPerformance('media_search', Date.now() - 100, 'user_session_1')
      service.logPerformance(
        'content_request',
        Date.now() - 200,
        'user_session_2',
      )
      service.logPerformance(
        'library_check',
        Date.now() - 150,
        'user_session_1',
      )

      const allMetrics = service.getPerformanceMetrics()
      expect(allMetrics).toHaveLength(3)

      const sessionMetrics = service.getPerformanceMetrics('user_session_1')
      expect(sessionMetrics).toHaveLength(2)
      expect(
        sessionMetrics.every(m => m.correlationId === 'user_session_1'),
      ).toBe(true)
    })

    it('should track API call logs for service monitoring', () => {
      service.logApiCall(
        'sonarr',
        'GET',
        '/api/v3/series',
        Date.now() - 100,
        'corr_1',
        200,
      )
      service.logApiCall(
        'radarr',
        'POST',
        '/api/v3/movie',
        Date.now() - 200,
        'corr_2',
        201,
      )
      service.logApiCall(
        'emby',
        'GET',
        '/api/library',
        Date.now() - 150,
        'corr_1',
        404,
        new Error('Not found'),
      )

      const allLogs = service.getApiCallLogs()
      expect(allLogs).toHaveLength(3)

      const filteredLogs = service.getApiCallLogs('corr_1')
      expect(filteredLogs).toHaveLength(2)
      expect(filteredLogs.every(l => l.correlationId === 'corr_1')).toBe(true)
    })

    it('should provide business metrics summary for service health monitoring', () => {
      service.logPerformance('fast_operation', Date.now() - 50, 'session_1')
      service.logPerformance('slow_operation', Date.now() - 6000, 'session_2')
      service.logApiCall(
        'sonarr',
        'GET',
        '/api/series',
        Date.now() - 100,
        'session_1',
        200,
      )
      service.logApiCall(
        'radarr',
        'GET',
        '/api/movie',
        Date.now() - 300,
        'session_1',
        404,
        new Error('Not found'),
      )

      const summary = service.getMetricsSummary()
      expect(summary.totalComponents).toBeGreaterThanOrEqual(0)
      expect(summary.avgResponseTime).toBeGreaterThanOrEqual(0)
      expect(summary.errorRate).toBeGreaterThanOrEqual(0)
    })
  })
})
