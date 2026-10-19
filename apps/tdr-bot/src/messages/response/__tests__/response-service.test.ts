import {
  createMockMessage,
  createMockMetricsService,
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { DISCORD_MAX_MESSAGE_LENGTH } from 'src/constants/chat'
import { resolveEmojis } from 'src/emojis/emoji-analysis'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import { LlmClient } from 'src/llm/client/llm-client'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
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

const EMOJI_KEYS = [
  '<:Sadge:781403152258826281>',
  '<a:peepoClap:1178865973156139009>',
]

function makeEmojis(): EmojiDictionaryService {
  return {
    resolve: jest
      .fn()
      .mockImplementation((text: string) => resolveEmojis(text, EMOJI_KEYS)),
  } as unknown as EmojiDictionaryService
}

function makeLlm(shortenedContent = 'shortened response'): FakeLlmClient {
  return new FakeLlmClient().script('response.shorten', shortenedContent)
}

describe('ResponseService', () => {
  let service: ResponseService
  let retryService: jest.Mocked<RetryService>
  let llm: FakeLlmClient
  let sanitizer: jest.Mocked<ResponseSanitizer>

  beforeEach(async () => {
    retryService = createMockRetryService()
    llm = makeLlm()
    sanitizer = makeSanitizer()

    const module = await createTestingModule([
      ResponseService,
      { provide: RetryService, useValue: retryService },
      { provide: LlmClient, useValue: llm },
      { provide: ResponseSanitizer, useValue: sanitizer },
      { provide: TdrBotMetricsService, useValue: createMockMetricsService() },
      { provide: EmojiDictionaryService, useValue: makeEmojis() },
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

      expect(llm.calls).toHaveLength(1)
      expect(llm.calls[0]).toMatchObject({
        operation: 'response.shorten',
        role: 'chat',
      })
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

  describe('emoji resolution', () => {
    function replyContent(message: ReturnType<typeof createMockMessage>) {
      return (message.reply as jest.Mock).mock.calls[0][0].content as string
    }

    it('sends a dictionary shortcode as its token', async () => {
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, { content: 'oh no :Sadge:', images: [] })

      expect(replyContent(message)).toBe('oh no <:Sadge:781403152258826281>')
    })

    it('strips an unknown shortcode', async () => {
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, {
        content: 'hello :NotAnEmoji: there',
        images: [],
      })

      expect(replyContent(message)).toBe('hello there')
    })

    it('fixes a token with the wrong id', async () => {
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, {
        content: 'rip <:Sadge:12345678901234567>',
        images: [],
      })

      expect(replyContent(message)).toBe('rip <:Sadge:781403152258826281>')
    })

    it('resolves before sanitizing', async () => {
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, { content: ':Sadge:', images: [] })

      expect(sanitizer.sanitizeResponse).toHaveBeenCalledWith(
        '<:Sadge:781403152258826281>',
      )
    })

    it('shortens the resolved text and resolves the shortened output again', async () => {
      llm.script('response.shorten', 'short <:Sadge:12345678901234567>')
      const longContent = ':Sadge: ' + 'a'.repeat(DISCORD_MAX_MESSAGE_LENGTH)
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, { content: longContent, images: [] })

      expect(llm.calls).toHaveLength(1)
      const shortenInput = llm.calls[0].messages.at(-1)?.content
      expect(shortenInput).toBe(
        '<:Sadge:781403152258826281> ' + 'a'.repeat(DISCORD_MAX_MESSAGE_LENGTH),
      )
      expect(replyContent(message)).toBe('short <:Sadge:781403152258826281>')
    })

    it('leaves text with no emojis unchanged', async () => {
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, {
        content: 'plain text, 10:30 am',
        images: [],
      })

      expect(replyContent(message)).toBe('plain text, 10:30 am')
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
      llm.script('response.shorten', shortenedContent)

      const longContent = 'a'.repeat(DISCORD_MAX_MESSAGE_LENGTH + 100)
      sanitizer.sanitizeResponse.mockResolvedValue(longContent)
      const message = createMockMessage()
      message.reply = jest.fn().mockResolvedValue({})

      await service.sendReply(message, { content: longContent, images: [] })

      const replyContent = (message.reply as jest.Mock).mock.calls[0][0].content
      expect(replyContent).toBe(shortenedContent)
    })

    it('falls back to smart truncation when LLM shortening fails', async () => {
      llm.script('response.shorten', new Error('LLM error'))

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
