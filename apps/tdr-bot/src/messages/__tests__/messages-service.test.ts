import {
  createMockMessage,
  createMockMetricsService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { IMessageHandler } from 'src/messages/handlers/handler.interface'
import { HandlerRegistry } from 'src/messages/handlers/handler.registry'
import { MessagesService } from 'src/messages/messages.service'
import { GuardMiddleware } from 'src/messages/middleware/guard.middleware'
import { MessageContext } from 'src/messages/types'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

function makeHandler(
  canHandle: boolean | jest.Mock = false,
  handled: boolean = false,
): jest.Mocked<IMessageHandler> {
  return {
    name: 'mock-handler',
    canHandle:
      typeof canHandle === 'function'
        ? canHandle
        : jest.fn().mockResolvedValue(canHandle),
    handle: jest.fn().mockResolvedValue({ handled }),
  } as unknown as jest.Mocked<IMessageHandler>
}

function makeGuard(allows = true): jest.Mocked<GuardMiddleware> {
  return {
    process: jest.fn().mockReturnValue(allows),
  } as unknown as jest.Mocked<GuardMiddleware>
}

function makeRegistry(
  handlers: IMessageHandler[],
): jest.Mocked<HandlerRegistry> {
  return {
    getHandlers: jest.fn().mockReturnValue(handlers),
  } as unknown as jest.Mocked<HandlerRegistry>
}

describe('MessagesService', () => {
  let service: MessagesService

  async function buildService(
    guard: jest.Mocked<GuardMiddleware>,
    registry: jest.Mocked<HandlerRegistry>,
  ): Promise<MessagesService> {
    const module = await createTestingModule([
      MessagesService,
      { provide: GuardMiddleware, useValue: guard },
      { provide: HandlerRegistry, useValue: registry },
      { provide: TdrBotMetricsService, useValue: createMockMetricsService() },
    ])
    return module.get(MessagesService)
  }

  describe('onMessage', () => {
    it('does not run handlers when guard rejects the message', async () => {
      const handler = makeHandler(true, true)
      const guard = makeGuard(false)
      const registry = makeRegistry([handler])
      service = await buildService(guard, registry)

      const message = createMockMessage()
      await service.onMessage([message] as Parameters<
        typeof service.onMessage
      >[0])

      expect(handler.canHandle).not.toHaveBeenCalled()
      expect(handler.handle).not.toHaveBeenCalled()
    })

    it('runs handlers when guard allows the message', async () => {
      const handler = makeHandler(true, true)
      const guard = makeGuard(true)
      const registry = makeRegistry([handler])
      service = await buildService(guard, registry)

      const message = createMockMessage()
      await service.onMessage([message] as Parameters<
        typeof service.onMessage
      >[0])

      expect(handler.canHandle).toHaveBeenCalledWith(message)
    })

    it('stops at the first handler that returns handled: true', async () => {
      const handler1 = makeHandler(true, false)
      const handler2 = makeHandler(true, true)
      const handler3 = makeHandler(true, false)
      const guard = makeGuard(true)
      const registry = makeRegistry([handler1, handler2, handler3])
      service = await buildService(guard, registry)

      const message = createMockMessage()
      await service.onMessage([message] as Parameters<
        typeof service.onMessage
      >[0])

      expect(handler1.handle).toHaveBeenCalled()
      expect(handler2.handle).toHaveBeenCalled()
      expect(handler3.canHandle).not.toHaveBeenCalled()
      expect(handler3.handle).not.toHaveBeenCalled()
    })

    it('calls all handlers when none return handled: true', async () => {
      const handlers = [
        makeHandler(true, false),
        makeHandler(true, false),
        makeHandler(true, false),
      ]
      const guard = makeGuard(true)
      const registry = makeRegistry(handlers)
      service = await buildService(guard, registry)

      const message = createMockMessage()
      await service.onMessage([message] as Parameters<
        typeof service.onMessage
      >[0])

      for (const h of handlers) {
        expect(h.handle).toHaveBeenCalledWith(
          message,
          expect.objectContaining({
            requestId: expect.any(String),
            userId: expect.any(String),
          }),
        )
      }
    })

    it('skips handle() when canHandle() returns false', async () => {
      const skippedHandler = makeHandler(false, false)
      const calledHandler = makeHandler(true, true)
      const guard = makeGuard(true)
      const registry = makeRegistry([skippedHandler, calledHandler])
      service = await buildService(guard, registry)

      const message = createMockMessage()
      await service.onMessage([message] as Parameters<
        typeof service.onMessage
      >[0])

      expect(skippedHandler.canHandle).toHaveBeenCalled()
      expect(skippedHandler.handle).not.toHaveBeenCalled()
      expect(calledHandler.handle).toHaveBeenCalled()
    })

    it('does not throw when no handlers are registered', async () => {
      const guard = makeGuard(true)
      const registry = makeRegistry([])
      service = await buildService(guard, registry)

      const message = createMockMessage()
      await expect(
        service.onMessage([message] as Parameters<typeof service.onMessage>[0]),
      ).resolves.toBeUndefined()
    })

    it('catches and swallows handler errors without crashing', async () => {
      const errorHandler = makeHandler(true, false)
      errorHandler.handle.mockRejectedValue(new Error('Handler crashed'))
      const guard = makeGuard(true)
      const registry = makeRegistry([errorHandler])
      service = await buildService(guard, registry)

      const message = createMockMessage()
      await expect(
        service.onMessage([message] as Parameters<typeof service.onMessage>[0]),
      ).resolves.toBeUndefined()
    })

    it('catches canHandle errors and does not crash', async () => {
      const failingHandler = makeHandler(true, false)
      failingHandler.canHandle = jest
        .fn()
        .mockRejectedValue(new Error('canHandle boom'))
      const guard = makeGuard(true)
      const registry = makeRegistry([failingHandler])
      service = await buildService(guard, registry)

      const message = createMockMessage()
      await expect(
        service.onMessage([message] as Parameters<typeof service.onMessage>[0]),
      ).resolves.toBeUndefined()
    })

    it('includes the author id as userId in the context', async () => {
      const handler = makeHandler(true, true)
      const guard = makeGuard(true)
      const registry = makeRegistry([handler])
      service = await buildService(guard, registry)

      const message = createMockMessage({
        author: { id: 'author-99', displayName: 'Test', bot: false },
      })
      await service.onMessage([message] as Parameters<
        typeof service.onMessage
      >[0])

      const context: MessageContext = handler.handle.mock.calls[0][1]
      expect(context.userId).toBe('author-99')
      expect(context.requestId).toBeTruthy()
    })

    it('generates a requestId (nanoid) for each message', async () => {
      // nanoid is globally mocked to return a fixed value in test setup;
      // we verify the context includes a non-empty requestId string.
      const handler = makeHandler(true, true)
      const guard = makeGuard(true)
      const registry = makeRegistry([handler])
      service = await buildService(guard, registry)

      const msg = createMockMessage()
      await service.onMessage([msg] as Parameters<typeof service.onMessage>[0])

      const context: MessageContext = handler.handle.mock.calls[0][1]
      expect(typeof context.requestId).toBe('string')
      expect(context.requestId.length).toBeGreaterThan(0)
    })

    it('bot messages are handled based on guard return value', async () => {
      const handler = makeHandler(true, true)
      const guard = makeGuard(false) // guard rejects bots
      const registry = makeRegistry([handler])
      service = await buildService(guard, registry)

      const botMessage = createMockMessage({
        author: { bot: true, id: 'bot-1', displayName: 'Bot' },
      })
      await service.onMessage([botMessage] as Parameters<
        typeof service.onMessage
      >[0])

      expect(handler.handle).not.toHaveBeenCalled()
    })
  })
})
