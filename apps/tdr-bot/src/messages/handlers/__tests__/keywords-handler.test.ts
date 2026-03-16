import {
  createMockMessage,
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { KeywordsHandler } from 'src/messages/handlers/keywords.handler'
import { MessageContext } from 'src/messages/types'
import { RetryService } from 'src/utils/retry.service'

function makeContext(): MessageContext {
  return { requestId: 'req-1', userId: 'user-123' }
}

describe('KeywordsHandler', () => {
  let handler: KeywordsHandler
  let retryService: jest.Mocked<RetryService>

  beforeEach(async () => {
    retryService = createMockRetryService()

    const module = await createTestingModule([
      KeywordsHandler,
      { provide: RetryService, useValue: retryService },
    ])

    handler = module.get(KeywordsHandler)
  })

  describe('canHandle', () => {
    it.each(['cabin', 'prog', 'cum', 'war'])(
      'returns true for messages containing the keyword "%s"',
      keyword => {
        const message = createMockMessage({
          content: `I love ${keyword} times`,
        })
        expect(handler.canHandle(message)).toBe(true)
      },
    )

    it('returns true for keyword-only message', () => {
      const message = createMockMessage({ content: 'war' })
      expect(handler.canHandle(message)).toBe(true)
    })

    it('returns false for messages ending with "?" even if they contain a keyword', () => {
      const message = createMockMessage({ content: 'wen cabin?' })
      expect(handler.canHandle(message)).toBe(false)
    })

    it('does not match partial word — "warzone" does not trigger "war"', () => {
      const message = createMockMessage({ content: 'I play warzone' })
      expect(handler.canHandle(message)).toBe(false)
    })

    it('does not match partial word — "cabining" does not trigger "cabin"', () => {
      const message = createMockMessage({ content: 'cabining is fun' })
      expect(handler.canHandle(message)).toBe(false)
    })

    it('returns false when message has no keywords', () => {
      const message = createMockMessage({ content: 'hello there' })
      expect(handler.canHandle(message)).toBe(false)
    })

    it('is case-insensitive', () => {
      const message = createMockMessage({ content: 'WAR is bad' })
      expect(handler.canHandle(message)).toBe(true)
    })

    it('matches keyword with mixed case', () => {
      const message = createMockMessage({ content: 'CABIN life' })
      expect(handler.canHandle(message)).toBe(true)
    })
  })

  describe('handle', () => {
    it('replies with the correct keyword response', async () => {
      const message = createMockMessage({ content: 'wen cabin bro' })
      message.reply = jest.fn().mockResolvedValue({})

      const result = await handler.handle(message, makeContext())

      expect(message.reply).toHaveBeenCalledWith('wen cabin')
      expect(result.handled).toBe(true)
    })

    it('returns handled: false if no keyword matched in handle()', async () => {
      const message = createMockMessage({ content: 'no keywords here' })

      const result = await handler.handle(message, makeContext())

      expect(result.handled).toBe(false)
    })

    it('returns handled: false when reply throws', async () => {
      retryService.executeWithRetry.mockRejectedValue(
        new Error('Discord API error'),
      )
      const message = createMockMessage({ content: 'cabin rules' })

      const result = await handler.handle(message, makeContext())

      expect(result.handled).toBe(false)
    })

    describe('war keyword random response', () => {
      afterEach(() => {
        jest.restoreAllMocks()
      })

      it('returns "war never changes" when random hits exactly 420', async () => {
        jest.spyOn(Math, 'random').mockReturnValue((420 - 1) / 420)

        const message = createMockMessage({ content: 'war is terrible' })
        message.reply = jest.fn().mockResolvedValue({})

        const result = await handler.handle(message, makeContext())

        expect(message.reply).toHaveBeenCalledWith('war never changes')
        expect(result.handled).toBe(true)
      })

      it('returns "war" when random does not hit 420', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0)

        const message = createMockMessage({ content: 'war is terrible' })
        message.reply = jest.fn().mockResolvedValue({})

        const result = await handler.handle(message, makeContext())

        expect(message.reply).toHaveBeenCalledWith('war')
        expect(result.handled).toBe(true)
      })
    })
  })
})
