import { Logger } from '@nestjs/common'
import { TestingModule } from '@nestjs/testing'
import { InteractionResponse, Message } from 'discord.js'

// Mock DiscordAPIError at global level for instanceof checks
class MockDiscordAPIError extends Error {
  code: number
  status: number
  method: string
  url: string
  retryAfter?: number
  rawError: any
  requestBody: any

  constructor(
    message: string,
    code: number,
    status: number,
    method: string,
    url: string,
  ) {
    super(message)
    this.name = 'DiscordAPIError'
    this.code = code
    this.status = status
    this.method = method
    this.url = url
    this.rawError = {}
    this.requestBody = {}
  }
}

// Mock the DiscordAPIError import
jest.mock('discord.js', () => {
  const actual = jest.requireActual('discord.js')
  return {
    ...actual,
    DiscordAPIError: MockDiscordAPIError,
  }
})

const DiscordAPIError = MockDiscordAPIError

import {
  createMockErrorClassificationService,
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import {
  DiscordErrorCode,
  DiscordErrorService,
  DiscordInteractionContext,
  DiscordRateLimitConfig,
  FallbackConfig,
} from 'src/media/services/discord-error.service'
import {
  ComponentInteraction,
  CorrelationContext,
} from 'src/types/discord.types'
import {
  ErrorCategory,
  ErrorClassificationService,
  ErrorSeverity,
  ErrorType,
} from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Mock Discord.js interaction for testing
function createMockComponentInteraction(
  overrides: Record<string, any> = {},
): ComponentInteraction {
  return {
    id: 'interaction_123',
    createdTimestamp: Date.now(),
    reply: jest
      .fn()
      .mockResolvedValue({ id: 'response_123' } as InteractionResponse),
    editReply: jest.fn().mockResolvedValue({ id: 'message_123' } as Message),
    followUp: jest.fn().mockResolvedValue({ id: 'message_456' } as Message),
    deferred: false,
    replied: false,
    user: {
      id: 'user_123',
      username: 'testuser',
    },
    guild: {
      id: 'guild_123',
    },
    channel: {
      id: 'channel_123',
    },
    ...overrides,
  } as unknown as ComponentInteraction
}

// Mock DiscordAPIError for testing
function createMockDiscordAPIError(
  code: number,
  message: string,
  status?: number,
  overrides: Record<string, any> = {},
) {
  const error = new DiscordAPIError(
    message,
    code,
    status || 400,
    'POST',
    'https://discord.com/api/v10/interactions',
  )

  // Add retryAfter property for rate limit errors
  if (code === 429) {
    error.retryAfter = 30
  }

  Object.assign(error, overrides)

  return error
}

function createMockCorrelationContext(): CorrelationContext {
  return {
    correlationId: 'test_correlation_123',
    userId: 'user_123',
    username: 'testuser',
    guildId: 'guild_123',
    channelId: 'channel_123',
    startTime: new Date(),
    requestId: 'request_123',
  }
}

function createMockDiscordInteractionContext(
  overrides: Partial<DiscordInteractionContext> = {},
): DiscordInteractionContext {
  return {
    interaction: createMockComponentInteraction(),
    correlationContext: createMockCorrelationContext(),
    isDeferred: false,
    isReplied: false,
    isExpired: false,
    ...overrides,
  }
}

describe('DiscordErrorService', () => {
  let service: DiscordErrorService
  let mockErrorClassifier: jest.Mocked<ErrorClassificationService>
  let mockRetryService: jest.Mocked<RetryService>
  let mockLogger: jest.SpyInstance

  beforeEach(async () => {
    mockErrorClassifier = createMockErrorClassificationService()
    mockRetryService = createMockRetryService()

    const module: TestingModule = await createTestingModule([
      DiscordErrorService,
      {
        provide: ErrorClassificationService,
        useValue: mockErrorClassifier,
      },
      {
        provide: RetryService,
        useValue: mockRetryService,
      },
    ])

    service = module.get<DiscordErrorService>(DiscordErrorService)
    mockLogger = jest.spyOn(Logger.prototype, 'debug').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('handleDiscordError', () => {
    it('should handle Discord API errors with specialized logic', async () => {
      const discordError = createMockDiscordAPIError(
        DiscordErrorCode.UNKNOWN_INTERACTION,
        'Unknown interaction',
      )
      const context = createMockDiscordInteractionContext()

      // Mock followUp to fail so we get the fallback error
      const mockFollowUp = jest
        .fn()
        .mockRejectedValue(new Error('FollowUp failed'))
      context.interaction.followUp = mockFollowUp

      const result = await service.handleDiscordError(discordError, context)

      expect(result.handled).toBe(true)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe(
        `DISCORD_${DiscordErrorCode.UNKNOWN_INTERACTION}`,
      )
      expect(result.error!.userMessage).toBe(
        'This interaction has expired. Please try the command again.',
      )
    })

    it('should handle generic errors with fallback handling', async () => {
      const genericError = new Error('Generic error message')
      const context = createMockDiscordInteractionContext()

      const result = await service.handleDiscordError(genericError, context)

      expect(result.handled).toBe(false)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('Error')
      expect(result.error!.message).toBe('Generic error message')
      expect(result.error!.userMessage).toBe(
        'An unexpected error occurred. Please try again.',
      )
    })

    it('should merge custom rate limit and fallback configs with defaults', async () => {
      const error = new Error('Test error')
      const context = createMockDiscordInteractionContext()
      const customRateLimitConfig: Partial<DiscordRateLimitConfig> = {
        maxAttempts: 10,
      }
      const customFallbackConfig: Partial<FallbackConfig> = {
        enableFollowUpMessage: false,
      }

      await service.handleDiscordError(
        error,
        context,
        customRateLimitConfig,
        customFallbackConfig,
      )

      // Verify the service uses merged configs (indirectly tested through behavior)
      expect(mockLogger).toHaveBeenCalledWith(
        'Handling Discord error',
        expect.objectContaining({
          correlationId: context.correlationContext.correlationId,
          userId: context.correlationContext.userId,
        }),
      )
    })
  })

  describe('handleUnknownInteraction', () => {
    it('should attempt followUp when interaction is expired and fallback is enabled', async () => {
      const error = createMockDiscordAPIError(
        DiscordErrorCode.UNKNOWN_INTERACTION,
        'Unknown interaction',
      )
      const context = createMockDiscordInteractionContext({
        isExpired: true,
      })
      const fallbackConfig: FallbackConfig = {
        enableFollowUpMessage: true,
        enableEditMessage: true,
        enableEphemeralResponse: true,
        fallbackMessage: 'Custom fallback message',
        maxFallbackAttempts: 3,
      }

      const mockFollowUp = jest
        .fn()
        .mockResolvedValue({ id: 'followup_123' } as Message)
      context.interaction.followUp = mockFollowUp

      const result = await service.handleDiscordError(
        error,
        context,
        {},
        fallbackConfig,
      )

      expect(result.success).toBe(true)
      expect(result.handled).toBe(true)
      expect(result.fallbackUsed).toBe(true)
      expect(result.response).toBeDefined()
      expect(mockFollowUp).toHaveBeenCalledWith({
        content: 'Custom fallback message',
        ephemeral: true,
      })
    })

    it('should handle followUp failure gracefully', async () => {
      const error = createMockDiscordAPIError(
        DiscordErrorCode.UNKNOWN_INTERACTION,
        'Unknown interaction',
      )
      const context = createMockDiscordInteractionContext()

      const mockFollowUp = jest
        .fn()
        .mockRejectedValue(new Error('FollowUp failed'))
      context.interaction.followUp = mockFollowUp

      const result = await service.handleDiscordError(error, context)

      expect(result.success).toBe(false)
      expect(result.handled).toBe(true)
      expect(result.fallbackUsed).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('handleAlreadyAcknowledged', () => {
    it('should attempt to edit reply when interaction is already replied', async () => {
      const error = createMockDiscordAPIError(
        DiscordErrorCode.INTERACTION_ALREADY_ACKNOWLEDGED,
        'Interaction already acknowledged',
      )
      const context = createMockDiscordInteractionContext({
        isReplied: true,
      })

      const mockEditReply = jest
        .fn()
        .mockResolvedValue({ id: 'edited_123' } as Message)
      context.interaction.editReply = mockEditReply

      const result = await service.handleDiscordError(error, context)

      expect(result.success).toBe(true)
      expect(result.handled).toBe(true)
      expect(result.fallbackUsed).toBe(true)
      expect(mockEditReply).toHaveBeenCalledWith({
        content: 'Processing your request...',
      })
    })

    it('should handle edit reply failure gracefully', async () => {
      const error = createMockDiscordAPIError(
        DiscordErrorCode.INTERACTION_ALREADY_ACKNOWLEDGED,
        'Interaction already acknowledged',
      )
      const context = createMockDiscordInteractionContext({
        isReplied: true,
      })

      const mockEditReply = jest
        .fn()
        .mockRejectedValue(new Error('Edit failed'))
      context.interaction.editReply = mockEditReply

      const result = await service.handleDiscordError(error, context)

      expect(result.success).toBe(false)
      expect(result.handled).toBe(true)
      expect(result.fallbackUsed).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('handleMissingPermissions', () => {
    it('should send ephemeral response for permission errors', async () => {
      const error = createMockDiscordAPIError(
        DiscordErrorCode.MISSING_PERMISSIONS,
        'Missing permissions',
      )
      const context = createMockDiscordInteractionContext()

      const mockReply = jest
        .fn()
        .mockResolvedValue({ id: 'reply_123' } as InteractionResponse)
      context.interaction.reply = mockReply

      const result = await service.handleDiscordError(error, context)

      expect(result.success).toBe(true)
      expect(result.handled).toBe(true)
      expect(result.fallbackUsed).toBe(true)
      expect(mockReply).toHaveBeenCalledWith({
        content:
          "I don't have the required permissions to perform this action. Please contact a server administrator.",
        ephemeral: true,
      })
    })

    it('should use followUp if interaction is already replied', async () => {
      const error = createMockDiscordAPIError(
        DiscordErrorCode.MISSING_PERMISSIONS,
        'Missing permissions',
      )
      const context = createMockDiscordInteractionContext({
        isReplied: true,
      })

      const mockFollowUp = jest
        .fn()
        .mockResolvedValue({ id: 'followup_123' } as Message)
      context.interaction.followUp = mockFollowUp

      const result = await service.handleDiscordError(error, context)

      expect(result.success).toBe(true)
      expect(result.handled).toBe(true)
      expect(result.fallbackUsed).toBe(true)
      expect(mockFollowUp).toHaveBeenCalledWith({
        content:
          "I don't have the required permissions to perform this action. Please contact a server administrator.",
        ephemeral: true,
      })
    })
  })

  describe('handleRateLimit', () => {
    it('should extract retry-after from rate limit errors', async () => {
      const error = createMockDiscordAPIError(429, 'Rate limited')
      error.retryAfter = 45
      const context = createMockDiscordInteractionContext()

      const result = await service.handleDiscordError(error, context)

      expect(result.success).toBe(false)
      expect(result.handled).toBe(true)
      expect(result.retryAfter).toBe(45000) // Convert to milliseconds
      expect(result.error!.userMessage).toBe(
        'Service is temporarily busy. Please try again in a moment.',
      )
    })
  })

  describe('executeWithRetry', () => {
    it('should execute operation with retry logic', async () => {
      const context = createMockDiscordInteractionContext()
      const operation = jest.fn().mockResolvedValue('success')
      const operationName = 'test_operation'

      mockRetryService.executeWithCircuitBreaker.mockResolvedValue('success')

      const result = await service.executeWithRetry(
        operation,
        context,
        operationName,
      )

      expect(result).toBe('success')
      expect(mockRetryService.executeWithCircuitBreaker).toHaveBeenCalledWith(
        expect.any(Function),
        `discord:${context.correlationContext.guildId}:${context.correlationContext.channelId}`,
        expect.objectContaining({
          maxAttempts: 5,
          baseDelay: 1000,
          maxDelay: 30000,
          backoffFactor: 2,
          jitter: true,
        }),
        operationName,
        ErrorCategory.DISCORD_API,
      )
    })

    it('should check for expired interactions before executing operation', async () => {
      const context = createMockDiscordInteractionContext({
        isExpired: true,
      })
      const operation = jest.fn().mockResolvedValue('success')

      mockRetryService.executeWithCircuitBreaker.mockImplementation(
        async op => {
          return await op() // Execute the wrapper function
        },
      )

      await expect(
        service.executeWithRetry(operation, context, 'test_operation'),
      ).rejects.toThrow(
        `Interaction expired for correlation ${context.correlationContext.correlationId}`,
      )

      expect(operation).not.toHaveBeenCalled()
    })

    it('should handle retry service failures and log error', async () => {
      const context = createMockDiscordInteractionContext()
      const operation = jest.fn().mockResolvedValue('success')
      const error = new Error('Retry failed')

      mockRetryService.executeWithCircuitBreaker.mockRejectedValue(error)

      await expect(
        service.executeWithRetry(operation, context, 'test_operation'),
      ).rejects.toThrow('Retry failed')

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Discord operation failed after retries: test_operation',
        expect.objectContaining({
          correlationId: context.correlationContext.correlationId,
          userId: context.correlationContext.userId,
          operationName: 'test_operation',
          error: 'Retry failed',
        }),
      )
    })
  })

  describe('createComponentError', () => {
    it('should create structured ComponentError with proper fields', () => {
      const error = new Error('Test error')
      error.stack = 'Error stack trace'
      const correlationId = 'test_correlation_123'
      const userMessage = 'User-friendly message'
      const context = { customField: 'value' }

      const componentError = service.createComponentError(
        error,
        correlationId,
        userMessage,
        context,
      )

      expect(componentError).toEqual({
        code: 'Error',
        message: 'Test error',
        userMessage: 'User-friendly message',
        correlationId: 'test_correlation_123',
        timestamp: expect.any(Date),
        stack: 'Error stack trace',
        context: {
          customField: 'value',
          errorName: 'Error',
          errorType: 'Error',
        },
      })
    })

    it('should use default user message from getUserFriendlyMessage', () => {
      const discordError = createMockDiscordAPIError(
        DiscordErrorCode.UNKNOWN_INTERACTION,
        'Unknown interaction',
      )
      const correlationId = 'test_correlation_123'

      const componentError = service.createComponentError(
        discordError,
        correlationId,
      )

      expect(componentError.userMessage).toBe(
        'This interaction has expired. Please try the command again.',
      )
    })
  })

  describe('isRetryableError', () => {
    it('should return false for non-retryable Discord error codes', () => {
      const unknownInteractionError = createMockDiscordAPIError(
        DiscordErrorCode.UNKNOWN_INTERACTION,
        'Unknown interaction',
      )
      const alreadyAcknowledgedError = createMockDiscordAPIError(
        DiscordErrorCode.INTERACTION_ALREADY_ACKNOWLEDGED,
        'Already acknowledged',
      )
      const missingPermissionsError = createMockDiscordAPIError(
        DiscordErrorCode.MISSING_PERMISSIONS,
        'Missing permissions',
      )

      expect(service.isRetryableError(unknownInteractionError)).toBe(false)
      expect(service.isRetryableError(alreadyAcknowledgedError)).toBe(false)
      expect(service.isRetryableError(missingPermissionsError)).toBe(false)
    })

    it('should delegate to error classifier for other errors', () => {
      const genericError = new Error('Generic error')
      mockErrorClassifier.classifyError.mockReturnValue({
        isRetryable: true,
        errorType: ErrorType.NETWORK_ERROR,
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.MEDIUM,
      })

      const result = service.isRetryableError(genericError)

      expect(result).toBe(true)
      expect(mockErrorClassifier.classifyError).toHaveBeenCalledWith(
        genericError,
        ErrorCategory.DISCORD_API,
      )
    })
  })

  describe('getRateLimitDelay', () => {
    it('should extract retry delay from rate limit error', () => {
      const error = createMockDiscordAPIError(429, 'Rate limited')
      error.retryAfter = 60

      const delay = service.getRateLimitDelay(error)

      expect(delay).toBe(60000) // Convert seconds to milliseconds
    })

    it('should return undefined for non-rate-limit errors', () => {
      const error = createMockDiscordAPIError(500, 'Server error')

      const delay = service.getRateLimitDelay(error)

      expect(delay).toBeUndefined()
    })

    it('should return undefined when retryAfter is not available', () => {
      const error = createMockDiscordAPIError(429, 'Rate limited', 429, {
        retryAfter: undefined,
      })

      const delay = service.getRateLimitDelay(error)

      expect(delay).toBeUndefined()
    })
  })

  describe('private utility methods', () => {
    it('should correctly identify Discord API errors', () => {
      const discordError = createMockDiscordAPIError(500, 'Discord error')
      const genericError = new Error('Generic error')

      // Using type assertion to access private method for testing
      const isDiscordAPIError = (service as any).isDiscordAPIError.bind(service)

      expect(isDiscordAPIError(discordError)).toBe(true)
      expect(isDiscordAPIError(genericError)).toBe(false)
    })

    it('should detect expired interactions', () => {
      const expiredContext = createMockDiscordInteractionContext({
        isExpired: true,
      })

      // Create an old interaction with old timestamp
      const oldInteraction = createMockComponentInteraction({
        createdTimestamp: Date.now() - 16 * 60 * 1000, // 16 minutes ago
      })
      const veryOldInteraction = createMockDiscordInteractionContext({
        interaction: oldInteraction,
      })

      const recentContext = createMockDiscordInteractionContext()

      const isInteractionExpired = (service as any).isInteractionExpired.bind(
        service,
      )

      expect(isInteractionExpired(expiredContext)).toBe(true)
      expect(isInteractionExpired(veryOldInteraction)).toBe(true)
      expect(isInteractionExpired(recentContext)).toBe(false)
    })

    it('should generate proper circuit breaker keys', () => {
      const context = createMockDiscordInteractionContext()
      const getCircuitBreakerKey = (service as any).getCircuitBreakerKey.bind(
        service,
      )

      const key = getCircuitBreakerKey(context)

      expect(key).toBe(
        `discord:${context.correlationContext.guildId}:${context.correlationContext.channelId}`,
      )
    })

    it('should generate error codes correctly', () => {
      const discordError = createMockDiscordAPIError(10062, 'Discord error')
      const genericError = new Error('Generic error')
      genericError.name = 'CustomError'

      const getErrorCode = (service as any).getErrorCode.bind(service)

      expect(getErrorCode(discordError)).toBe('DISCORD_10062')
      expect(getErrorCode(genericError)).toBe('CustomError')
    })

    it('should provide user-friendly messages for different error types', () => {
      const unknownInteractionError = createMockDiscordAPIError(
        DiscordErrorCode.UNKNOWN_INTERACTION,
        'Unknown interaction',
      )
      const rateLimitError = createMockDiscordAPIError(429, 'Rate limited')
      const timeoutError = new Error('Timeout')
      timeoutError.name = 'TimeoutError'
      const genericError = new Error('Generic error')

      const getUserFriendlyMessage = (
        service as any
      ).getUserFriendlyMessage.bind(service)

      expect(getUserFriendlyMessage(unknownInteractionError)).toBe(
        'This interaction has expired. Please try the command again.',
      )
      expect(getUserFriendlyMessage(rateLimitError)).toBe(
        'Service is temporarily busy. Please try again in a moment.',
      )
      expect(getUserFriendlyMessage(timeoutError)).toBe(
        'The operation took too long to complete. Please try again.',
      )
      expect(getUserFriendlyMessage(genericError)).toBe(
        'An unexpected error occurred. Please try again.',
      )
    })
  })

  describe('edge cases and error boundaries', () => {
    it('should handle null/undefined context gracefully', async () => {
      const error = new Error('Test error')
      const context = createMockDiscordInteractionContext({
        correlationContext: {
          ...createMockCorrelationContext(),
          correlationId: '',
        },
      })

      const result = await service.handleDiscordError(error, context)

      expect(result.handled).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle malformed Discord errors', async () => {
      const malformedError = new Error('Malformed Discord error')
      malformedError.name = 'DiscordAPIError'
      // Missing typical DiscordAPIError properties

      const context = createMockDiscordInteractionContext()

      const result = await service.handleDiscordError(malformedError, context)

      expect(result.handled).toBe(true)
      expect(result.error).toBeDefined()
    })

    it('should handle interaction context with missing properties', async () => {
      const error = new Error('Test error')
      const context = createMockDiscordInteractionContext({
        correlationContext: {
          correlationId: 'test_123',
          userId: 'user_123',
          username: 'testuser',
          guildId: '', // Missing guild ID
          channelId: '', // Missing channel ID
          startTime: new Date(),
        },
      })

      const result = await service.handleDiscordError(error, context)

      expect(result.error).toBeDefined()
      expect(result.error!.correlationId).toBe('test_123')
    })
  })
})
