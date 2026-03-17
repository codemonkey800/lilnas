import { AIMessage } from '@langchain/core/messages'

import {
  createMockMessage,
  createMockMetricsService,
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { DISCORD_MAX_MESSAGE_LENGTH } from 'src/constants/chat'
import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { ResponseService } from 'src/messages/response/response.service'
import { ResponseSanitizer } from 'src/messages/response/response-sanitizer'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import { RetryService } from 'src/utils/retry.service'

function makeSanitizer(): jest.Mocked<ResponseSanitizer> {
  return {
    sanitizeResponse: jest
      .fn()
      .mockImplementation((c: string) => Promise.resolve(c)),
  } as unknown as jest.Mocked<ResponseSanitizer>
}

function makeModelFactory(
  shortenedContent = 'shortened response',
): jest.Mocked<ModelFactoryService> {
  const mockModel = {
    invoke: jest.fn().mockResolvedValue(new AIMessage(shortenedContent)),
  }
  return {
    createChatModel: jest.fn().mockReturnValue(mockModel),
    createReasoningModel: jest.fn(),
  } as unknown as jest.Mocked<ModelFactoryService>
}

describe('ResponseService', () => {
  let service: ResponseService
  let retryService: jest.Mocked<RetryService>
  let modelFactory: jest.Mocked<ModelFactoryService>
  let sanitizer: jest.Mocked<ResponseSanitizer>

  beforeEach(async () => {
    retryService = createMockRetryService()
    modelFactory = makeModelFactory()
    sanitizer = makeSanitizer()

    const module = await createTestingModule([
      ResponseService,
      { provide: RetryService, useValue: retryService },
      { provide: ModelFactoryService, useValue: modelFactory },
      { provide: ResponseSanitizer, useValue: sanitizer },
      { provide: TdrBotMetricsService, useValue: createMockMetricsService() },
    ])

    service = module.get(ResponseService)
  })

  describe('sendReply', () => {
    it('sanitizes content before replying', async () => {
      sanitizer.sanitizeResponse.mockResolvedValue('sanitized content')
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, { content: 'raw content', images: [] })

      expect(sanitizer.sanitizeResponse).toHaveBeenCalledWith('raw content')
    })

    it('replies with sanitized content', async () => {
      sanitizer.sanitizeResponse.mockResolvedValue('clean content')
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, { content: 'raw', images: [] })

      expect(message.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'clean content' }),
      )
    })

    it('includes embeds when images are provided', async () => {
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})
      const images = [
        { title: 'Sunset', url: 'https://example.com/s.png', parentId: 'p1' },
      ]

      await service.sendReply(message, { content: 'here you go', images })

      const replyArg = (message.reply as jest.Mock).mock.calls[0][0]
      expect(replyArg.embeds).toBeDefined()
      expect(replyArg.embeds).toHaveLength(1)
    })

    it('sends no embeds when images array is empty', async () => {
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, { content: 'content', images: [] })

      const replyArg = (message.reply as jest.Mock).mock.calls[0][0]
      expect(replyArg.embeds).toBeUndefined()
    })

    it('shortens content when it exceeds DISCORD_MAX_MESSAGE_LENGTH', async () => {
      const longContent = 'a'.repeat(DISCORD_MAX_MESSAGE_LENGTH + 1)
      sanitizer.sanitizeResponse.mockResolvedValue(longContent)
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, { content: longContent, images: [] })

      expect(modelFactory.createChatModel).toHaveBeenCalled()
    })

    it('sends fallback message when reply throws after retries', async () => {
      retryService.executeWithRetry.mockRejectedValueOnce(
        new Error('Discord down'),
      )
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, { content: 'content', images: [] })

      expect(message.reply).toHaveBeenCalledWith(
        expect.stringContaining('sorry, my response was too long'),
      )
    })

    it('does not throw when fallback reply also fails', async () => {
      retryService.executeWithRetry.mockRejectedValueOnce(
        new Error('Discord down'),
      )
      const message = createMockMessage()
      message.reply = jest
        .fn()
        .mockRejectedValue(new Error('Fallback also failed'))

      await expect(
        service.sendReply(message, { content: 'content', images: [] }),
      ).resolves.toBeUndefined()
    })

    it('uses retryService with correct config for the reply call', async () => {
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, { content: 'content', images: [] })

      expect(retryService.executeWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxAttempts: 3 }),
        'Discord-sendResponse',
        expect.any(String),
      )
    })
  })

  describe('sendErrorReply', () => {
    it('replies with the provided error message', async () => {
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendErrorReply(message, 'sorry something went wrong')

      expect(message.reply).toHaveBeenCalledWith('sorry something went wrong')
    })

    it('does not throw when retry fails', async () => {
      retryService.executeWithRetry.mockRejectedValue(
        new Error('Discord unavailable'),
      )
      const message = createMockMessage()

      await expect(
        service.sendErrorReply(message, 'error msg'),
      ).resolves.toBeUndefined()
    })

    it('uses retryService with correct config for the error reply call', async () => {
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendErrorReply(message, 'error')

      expect(retryService.executeWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxAttempts: 3 }),
        'Discord-sendErrorMessage',
        expect.any(String),
      )
    })
  })

  describe('shortenResponse (via sendReply with long content)', () => {
    it('calls LLM to shorten content and uses its output', async () => {
      const shortenedContent = 'Short answer.'
      const mockModel = {
        invoke: jest.fn().mockResolvedValue(new AIMessage(shortenedContent)),
      }
      modelFactory.createChatModel.mockReturnValue(
        mockModel as unknown as ReturnType<
          ModelFactoryService['createChatModel']
        >,
      )

      const longContent = 'a'.repeat(DISCORD_MAX_MESSAGE_LENGTH + 100)
      sanitizer.sanitizeResponse.mockResolvedValue(longContent)
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, { content: longContent, images: [] })

      const replyContent = (message.reply as jest.Mock).mock.calls[0][0].content
      expect(replyContent).toBe(shortenedContent)
    })

    it('falls back to smart truncation when LLM shortening fails', async () => {
      const mockModel = {
        invoke: jest.fn().mockRejectedValue(new Error('LLM error')),
      }
      modelFactory.createChatModel.mockReturnValue(
        mockModel as unknown as ReturnType<
          ModelFactoryService['createChatModel']
        >,
      )
      // Make retryService actually throw the error for the shortening call
      retryService.executeWithRetry
        .mockImplementationOnce(async () => {
          throw new Error('LLM shorten failed')
        })
        .mockImplementation(async (fn: () => unknown) => fn())

      const longContent = 'a'.repeat(DISCORD_MAX_MESSAGE_LENGTH + 100)
      sanitizer.sanitizeResponse.mockResolvedValue(longContent)
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, { content: longContent, images: [] })

      const replyContent = (message.reply as jest.Mock).mock.calls[0][0].content
      expect(replyContent.length).toBeLessThanOrEqual(
        DISCORD_MAX_MESSAGE_LENGTH,
      )
      expect(replyContent.endsWith('...')).toBe(true)
    })
  })
})
