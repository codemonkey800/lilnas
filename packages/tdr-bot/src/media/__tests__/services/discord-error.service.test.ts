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
  rawError: unknown
  requestBody: unknown

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
} from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Mock Discord.js interaction for testing
function createMockComponentInteraction(
  overrides: Record<string, unknown> = {},
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
  overrides: Record<string, unknown> = {},
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

      mockRetryService.executeWithRetry.mockResolvedValue('success')

      const result = await service.executeWithRetry(
        operation,
        context,
        operationName,
      )

      expect(result).toBe('success')
      expect(mockRetryService.executeWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
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

      mockRetryService.executeWithRetry.mockImplementation(async op => {
        return await op() // Execute the wrapper function
      })

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

      mockRetryService.executeWithRetry.mockRejectedValue(error)

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

  describe('Discord-Specific Error Classification', () => {
    it('should correctly identify non-retryable Discord interaction states', () => {
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

      // These Discord states cannot be retried
      expect(service.isRetryableError(unknownInteractionError)).toBe(false)
      expect(service.isRetryableError(alreadyAcknowledgedError)).toBe(false)
      expect(service.isRetryableError(missingPermissionsError)).toBe(false)
    })
  })

  describe('getRateLimitDelay', () => {
    it('should extract retry delay from rate limit error', () => {
      const error = createMockDiscordAPIError(429, 'Rate limited')
      error.retryAfter = 60

      const delay = service.getRateLimitDelay(error as any)

      expect(delay).toBe(60000) // Convert seconds to milliseconds
    })

    it('should return undefined for non-rate-limit errors', () => {
      const error = createMockDiscordAPIError(500, 'Server error')

      const delay = service.getRateLimitDelay(error as any)

      expect(delay).toBeUndefined()
    })

    it('should return undefined when retryAfter is not available', () => {
      const error = createMockDiscordAPIError(429, 'Rate limited', 429, {
        retryAfter: undefined,
      })

      const delay = service.getRateLimitDelay(error as any)

      expect(delay).toBeUndefined()
    })
  })

  describe('Discord User Message Mapping', () => {
    it('should provide clear user messages for Discord interaction errors', () => {
      const unknownInteractionError = createMockDiscordAPIError(
        DiscordErrorCode.UNKNOWN_INTERACTION,
        'Unknown interaction',
      )
      const rateLimitError = createMockDiscordAPIError(429, 'Rate limited')
      const timeoutError = new Error('Timeout')
      timeoutError.name = 'TimeoutError'

      const getUserFriendlyMessage = (
        service as unknown as {
          getUserFriendlyMessage: (error: Error) => string
        }
      ).getUserFriendlyMessage.bind(service)

      // Discord-specific user messages
      expect(getUserFriendlyMessage(unknownInteractionError)).toBe(
        'This interaction has expired. Please try the command again.',
      )
      expect(getUserFriendlyMessage(rateLimitError)).toBe(
        'Service is temporarily busy. Please try again in a moment.',
      )
      expect(getUserFriendlyMessage(timeoutError)).toBe(
        'The operation took too long to complete. Please try again.',
      )
    })

    it('should generate Discord-specific error codes', () => {
      const discordError = createMockDiscordAPIError(10062, 'Discord error')
      const getErrorCode = (
        service as unknown as { getErrorCode: (error: unknown) => string }
      ).getErrorCode.bind(service)

      expect(getErrorCode(discordError)).toBe('DISCORD_10062')
    })
  })

  describe('Discord Context Edge Cases', () => {
    it('should handle Discord interaction contexts with missing data', async () => {
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

    it('should handle malformed Discord API errors gracefully', async () => {
      const malformedError = new Error('Malformed Discord error')
      malformedError.name = 'DiscordAPIError'
      // Missing typical DiscordAPIError properties

      const context = createMockDiscordInteractionContext()
      const result = await service.handleDiscordError(malformedError, context)

      expect(result.handled).toBe(true)
      expect(result.error).toBeDefined()
    })
  })

  describe('Discord API Infrastructure Resilience', () => {
    it('should gracefully handle complete Discord API outages', async () => {
      const error = createMockDiscordAPIError(
        DiscordErrorCode.UNKNOWN_INTERACTION,
        'Unknown interaction',
      )
      const context = createMockDiscordInteractionContext({
        isExpired: true,
      })

      // Mock all Discord API methods to fail
      const mockFollowUp = jest
        .fn()
        .mockRejectedValue(new Error('Discord API unavailable'))
      context.interaction.followUp = mockFollowUp

      const fallbackConfig: FallbackConfig = {
        enableFollowUpMessage: true,
        enableEditMessage: true,
        enableEphemeralResponse: true,
        fallbackMessage: 'Service temporarily unavailable',
        maxFallbackAttempts: 3,
      }

      const result = await service.handleDiscordError(
        error,
        context,
        {},
        fallbackConfig,
      )

      expect(result.handled).toBe(true)
      expect(result.success).toBe(false)
      expect(result.error!.userMessage).toBe(
        'This interaction has expired. Please try the command again.',
      )
    })

    it('should handle future Discord API error codes gracefully', async () => {
      const newErrorCode = 99999 // Hypothetical future error code
      const futureError = createMockDiscordAPIError(
        newErrorCode,
        'New Discord API error type',
      )
      const context = createMockDiscordInteractionContext()

      const result = await service.handleDiscordError(futureError, context)

      expect(result.handled).toBe(true)
      expect(result.error!.code).toBe(`DISCORD_${newErrorCode}`)
      expect(result.error!.userMessage).toBe(
        'An unexpected error occurred. Please try again.',
      )
    })

    it('should handle malformed Discord rate limit responses', async () => {
      const rateLimitError = createMockDiscordAPIError(429, 'Rate limited')
      delete (rateLimitError as unknown as Record<string, unknown>).retryAfter

      const context = createMockDiscordInteractionContext()
      const result = await service.handleDiscordError(rateLimitError, context)

      expect(result.handled).toBe(true)
      expect(result.retryAfter).toBeUndefined()
      expect(result.error!.userMessage).toBe(
        'Service is temporarily busy. Please try again in a moment.',
      )
    })
  })
})
