import { ChannelType, Client } from 'discord.js'

import {
  createMockErrorClassificationService,
  createMockMessage,
  createTestingModule,
  MessageBuilder,
} from 'src/__tests__/test-utils'
import { TDR_CHAT_CHANNEL } from 'src/constants/chat'
import { ChatHandler } from 'src/messages/handlers/chat.handler'
import { LLMOrchestrationService } from 'src/messages/llm/llm-orchestration.service'
import { ResponseService } from 'src/messages/response/response.service'
import { TypingIndicatorService } from 'src/messages/response/typing-indicator.service'
import { MessageContext } from 'src/messages/types'
import {
  ErrorCategory,
  ErrorClassificationService,
  ErrorSeverity,
  ErrorType,
} from 'src/utils/error-classifier'

const BOT_USER_ID = 'bot-user-id-123'

function makeClient(userId = BOT_USER_ID): jest.Mocked<Client> {
  return {
    user: { id: userId },
  } as unknown as jest.Mocked<Client>
}

function makeLLM(): jest.Mocked<LLMOrchestrationService> {
  return {
    sendMessage: jest.fn().mockResolvedValue({
      content: 'LLM response',
      images: [],
    }),
  } as unknown as jest.Mocked<LLMOrchestrationService>
}

function makeResponseService(): jest.Mocked<ResponseService> {
  return {
    sendReply: jest.fn().mockResolvedValue(undefined),
    sendErrorReply: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ResponseService>
}

function makeTypingIndicator(): jest.Mocked<TypingIndicatorService> {
  return {
    start: jest.fn(),
    stop: jest.fn(),
  } as unknown as jest.Mocked<TypingIndicatorService>
}

function makeContext(): MessageContext {
  return { requestId: 'req-1', userId: 'user-123' }
}

describe('ChatHandler', () => {
  let handler: ChatHandler
  let client: jest.Mocked<Client>
  let llm: jest.Mocked<LLMOrchestrationService>
  let responseService: jest.Mocked<ResponseService>
  let typingIndicator: jest.Mocked<TypingIndicatorService>
  let errorClassifier: jest.Mocked<ErrorClassificationService>

  beforeEach(async () => {
    client = makeClient()
    llm = makeLLM()
    responseService = makeResponseService()
    typingIndicator = makeTypingIndicator()
    errorClassifier =
      createMockErrorClassificationService() as jest.Mocked<ErrorClassificationService>

    const module = await createTestingModule([
      ChatHandler,
      { provide: Client, useValue: client },
      { provide: LLMOrchestrationService, useValue: llm },
      { provide: ResponseService, useValue: responseService },
      { provide: TypingIndicatorService, useValue: typingIndicator },
      { provide: ErrorClassificationService, useValue: errorClassifier },
    ])

    handler = module.get(ChatHandler)
  })

  describe('canHandle', () => {
    it('returns true when the bot is mentioned', () => {
      const message = new MessageBuilder()
        .inGuild()
        .withMention(BOT_USER_ID)
        .withContent(`<@${BOT_USER_ID}> hello`)
        .build()

      expect(handler.canHandle(message)).toBe(true)
    })

    it('returns true for a question in the TDR chat channel', () => {
      const message = createMockMessage({
        content: 'what time is it?',
        channelId: 'ch-1',
        channel: {
          id: 'ch-1',
          type: ChannelType.GuildText,
          name: TDR_CHAT_CHANNEL,
          send: jest.fn(),
          sendTyping: jest.fn(),
        },
      })

      expect(handler.canHandle(message)).toBe(true)
    })

    it('returns false for a non-question in the TDR chat channel without mention', () => {
      const message = createMockMessage({
        content: 'hello everyone',
        channelId: 'ch-1',
        channel: {
          id: 'ch-1',
          type: ChannelType.GuildText,
          name: TDR_CHAT_CHANNEL,
          send: jest.fn(),
          sendTyping: jest.fn(),
        },
      })

      expect(handler.canHandle(message)).toBe(false)
    })

    it('returns false for a question in a non-TDR channel without mention', () => {
      const message = createMockMessage({
        content: 'what time is it?',
        channelId: 'ch-2',
        channel: {
          id: 'ch-2',
          type: ChannelType.GuildText,
          name: 'general',
          send: jest.fn(),
          sendTyping: jest.fn(),
        },
      })

      expect(handler.canHandle(message)).toBe(false)
    })

    it('returns false for a plain message in a non-TDR channel without mention', () => {
      const message = new MessageBuilder()
        .inGuild()
        .withContent('hello')
        .build()

      expect(handler.canHandle(message)).toBe(false)
    })

    it('returns true for a DM with a bot mention', () => {
      const message = new MessageBuilder()
        .inDM()
        .withMention(BOT_USER_ID)
        .withContent(`<@${BOT_USER_ID}> hi`)
        .build()

      expect(handler.canHandle(message)).toBe(true)
    })

    it('returns false when client.user is null (bot not ready)', () => {
      ;(client as unknown as { user: null }).user = null
      const message = new MessageBuilder()
        .inGuild()
        .withContent('hello')
        .build()

      expect(handler.canHandle(message)).toBe(false)
    })
  })

  describe('handle', () => {
    it('calls LLM, starts typing, and sends reply on success', async () => {
      const message = new MessageBuilder()
        .inGuild()
        .withMention(BOT_USER_ID)
        .withContent(`<@${BOT_USER_ID}> hello`)
        .build()

      const result = await handler.handle(message, makeContext())

      expect(typingIndicator.start).toHaveBeenCalledWith(message.channel)
      expect(llm.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'hello', userId: 'user-123' }),
      )
      expect(responseService.sendReply).toHaveBeenCalled()
      expect(typingIndicator.stop).toHaveBeenCalledWith(message.channelId)
      expect(result.handled).toBe(true)
    })

    it('sends generic error reply when LLM throws a non-timeout error', async () => {
      llm.sendMessage.mockRejectedValue(new Error('LLM failure'))

      const message = new MessageBuilder()
        .inGuild()
        .withContent('hello')
        .build()
      const result = await handler.handle(message, makeContext())

      expect(responseService.sendErrorReply).toHaveBeenCalledWith(
        message,
        expect.stringContaining('sorry something went wrong'),
      )
      expect(typingIndicator.stop).toHaveBeenCalledWith(message.channelId)
      expect(result.handled).toBe(true)
    })

    it('sends timeout-specific error reply when error is classified as timeout', async () => {
      errorClassifier.classifyError.mockReturnValue({
        isRetryable: true,
        errorType: ErrorType.TIMEOUT,
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.MEDIUM,
      })

      llm.sendMessage.mockRejectedValue(new Error('Request timed out'))

      const message = new MessageBuilder()
        .inGuild()
        .withContent('hello')
        .build()
      const result = await handler.handle(message, makeContext())

      expect(responseService.sendErrorReply).toHaveBeenCalledWith(
        message,
        expect.stringContaining('taking too long'),
      )
      expect(typingIndicator.stop).toHaveBeenCalledWith(message.channelId)
      expect(result.handled).toBe(true)
    })
  })
})
