import {
  createMockMessage,
  createTestingModule,
  MessageBuilder,
} from 'src/__tests__/test-utils'
import { ChatService } from 'src/message-handler/chat.service'
import { KeywordsService } from 'src/message-handler/keywords.service'
import { MessageHandlerService } from 'src/message-handler/message-handler.service'
import { MessageHandler } from 'src/message-handler/types'

describe('MessageHandlerService', () => {
  let service: MessageHandlerService
  let chatService: jest.Mocked<ChatService>
  let keywordsService: jest.Mocked<KeywordsService>

  const createMockHandler = (
    shouldHandle = false,
  ): jest.MockedFunction<MessageHandler> => {
    return jest.fn().mockResolvedValue(shouldHandle)
  }

  beforeEach(async () => {
    // Mock services
    chatService = {
      getHandlers: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<ChatService>

    keywordsService = {
      getHandlers: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<KeywordsService>

    const module = await createTestingModule([
      MessageHandlerService,
      {
        provide: ChatService,
        useValue: chatService,
      },
      {
        provide: KeywordsService,
        useValue: keywordsService,
      },
    ])

    service = module.get<MessageHandlerService>(MessageHandlerService)
  })

  describe('onMessage', () => {
    it('should execute handlers in order', async () => {
      const handler1 = createMockHandler(false)
      const handler2 = createMockHandler(false)
      const handler3 = createMockHandler(false)

      keywordsService.getHandlers.mockReturnValue([handler1, handler2])
      chatService.getHandlers.mockReturnValue([handler3])

      const message = createMockMessage()
      await service.onMessage([message])

      expect(handler1).toHaveBeenCalledWith(message)
      expect(handler2).toHaveBeenCalledWith(message)
      expect(handler3).toHaveBeenCalledWith(message)
      expect(handler1.mock.invocationCallOrder[0]).toBeLessThan(
        handler2.mock.invocationCallOrder[0],
      )
      expect(handler2.mock.invocationCallOrder[0]).toBeLessThan(
        handler3.mock.invocationCallOrder[0],
      )
    })

    it('should stop execution when a handler returns true', async () => {
      const handler1 = createMockHandler(false)
      const handler2 = createMockHandler(true) // This one handles the message
      const handler3 = createMockHandler(false)

      keywordsService.getHandlers.mockReturnValue([handler1, handler2])
      chatService.getHandlers.mockReturnValue([handler3])

      const message = createMockMessage()
      await service.onMessage([message])

      expect(handler1).toHaveBeenCalledWith(message)
      expect(handler2).toHaveBeenCalledWith(message)
      expect(handler3).not.toHaveBeenCalled()
    })

    it('should handle when no handlers are provided', async () => {
      keywordsService.getHandlers.mockReturnValue([])
      chatService.getHandlers.mockReturnValue([])

      const message = createMockMessage()

      // Should not throw
      await expect(service.onMessage([message])).resolves.toBeUndefined()
    })

    it('should handle handler errors gracefully', async () => {
      const errorHandler = jest
        .fn()
        .mockRejectedValue(new Error('Handler error'))
      const successHandler = createMockHandler(true)

      keywordsService.getHandlers.mockReturnValue([errorHandler])
      chatService.getHandlers.mockReturnValue([successHandler])

      const message = createMockMessage()

      // Should throw the error (not caught by the service)
      await expect(service.onMessage([message])).rejects.toThrow(
        'Handler error',
      )
      expect(successHandler).not.toHaveBeenCalled()
    })

    it('should execute all handlers when none return true', async () => {
      const handlers = Array(5)
        .fill(null)
        .map(() => createMockHandler(false))

      keywordsService.getHandlers.mockReturnValue(handlers.slice(0, 3))
      chatService.getHandlers.mockReturnValue(handlers.slice(3))

      const message = createMockMessage()
      await service.onMessage([message])

      handlers.forEach(handler => {
        expect(handler).toHaveBeenCalledWith(message)
      })
    })

    it('should work with different message types', async () => {
      const handler = createMockHandler(true)
      keywordsService.getHandlers.mockReturnValue([handler])

      // Test with DM message
      const dmMessage = new MessageBuilder().inDM().build()
      await service.onMessage([dmMessage])
      expect(handler).toHaveBeenCalledWith(dmMessage)

      // Test with guild message
      handler.mockClear()
      const guildMessage = new MessageBuilder().inGuild().build()
      await service.onMessage([guildMessage])
      expect(handler).toHaveBeenCalledWith(guildMessage)
    })

    it('should handle async handlers correctly', async () => {
      const asyncHandler1 = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return false
      })

      const asyncHandler2 = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        return true
      })

      const handler3 = createMockHandler(false)

      keywordsService.getHandlers.mockReturnValue([
        asyncHandler1,
        asyncHandler2,
      ])
      chatService.getHandlers.mockReturnValue([handler3])

      const message = createMockMessage()
      await service.onMessage([message])

      expect(asyncHandler1).toHaveBeenCalled()
      expect(asyncHandler2).toHaveBeenCalled()
      expect(handler3).not.toHaveBeenCalled()
    })
  })

  describe('handler priority', () => {
    it('should prioritize keyword handlers over chat handlers', async () => {
      const keywordHandler = createMockHandler(true)
      const chatHandler = createMockHandler(true)

      keywordsService.getHandlers.mockReturnValue([keywordHandler])
      chatService.getHandlers.mockReturnValue([chatHandler])

      const message = createMockMessage()
      await service.onMessage([message])

      expect(keywordHandler).toHaveBeenCalled()
      expect(chatHandler).not.toHaveBeenCalled()
    })
  })
})
