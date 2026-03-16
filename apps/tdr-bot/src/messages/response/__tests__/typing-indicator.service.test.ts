import { TextBasedChannel } from 'discord.js'

import {
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { MAX_SEND_TYPING_COUNT, TYPING_DELAY_MS } from 'src/constants/chat'
import { TypingIndicatorService } from 'src/messages/response/typing-indicator.service'
import { RetryService } from 'src/utils/retry.service'

function makeChannel(
  id = 'ch-1',
): TextBasedChannel & { sendTyping: jest.Mock; send: jest.Mock } {
  return {
    id,
    sendTyping: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue({}),
  } as unknown as TextBasedChannel & { sendTyping: jest.Mock; send: jest.Mock }
}

function makeChannelWithoutTyping(id = 'no-typing'): TextBasedChannel {
  return { id } as unknown as TextBasedChannel
}

describe('TypingIndicatorService', () => {
  let service: TypingIndicatorService
  let retryService: jest.Mocked<RetryService>

  beforeEach(async () => {
    jest.useFakeTimers()
    retryService = createMockRetryService()

    const module = await createTestingModule([
      TypingIndicatorService,
      { provide: RetryService, useValue: retryService },
    ])

    service = module.get(TypingIndicatorService)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('start', () => {
    it('sends typing immediately when start is called', async () => {
      const channel = makeChannel()

      service.start(channel)

      // Flush the immediate async call
      await Promise.resolve()
      await Promise.resolve()

      expect(retryService.executeWithRetry).toHaveBeenCalled()
    })

    it('sets an interval to keep sending typing', async () => {
      const channel = makeChannel()

      service.start(channel)
      await Promise.resolve()
      await Promise.resolve()

      const callsBefore = (retryService.executeWithRetry as jest.Mock).mock
        .calls.length

      jest.advanceTimersByTime(TYPING_DELAY_MS)
      await Promise.resolve()
      await Promise.resolve()

      const callsAfter = (retryService.executeWithRetry as jest.Mock).mock.calls
        .length
      expect(callsAfter).toBeGreaterThan(callsBefore)
    })

    it('clears existing interval before starting a new one for same channel', async () => {
      const channel = makeChannel('ch-dup')
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval')

      service.start(channel)
      await Promise.resolve()

      // Start again for same channel
      service.start(channel)
      await Promise.resolve()

      expect(clearIntervalSpy).toHaveBeenCalled()
      clearIntervalSpy.mockRestore()
    })

    it('ignores channels that do not support sendTyping', async () => {
      const channel = makeChannelWithoutTyping()

      service.start(channel)
      await Promise.resolve()

      expect(retryService.executeWithRetry).not.toHaveBeenCalled()
    })
  })

  describe('stop', () => {
    it('clears the interval and removes channel state', async () => {
      const channel = makeChannel('ch-stop')
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval')

      service.start(channel)
      await Promise.resolve()

      service.stop(channel.id)

      // After stop, advancing timers should not trigger more typing
      const callCount = (retryService.executeWithRetry as jest.Mock).mock.calls
        .length
      jest.advanceTimersByTime(TYPING_DELAY_MS * 3)
      await Promise.resolve()

      expect(
        (retryService.executeWithRetry as jest.Mock).mock.calls.length,
      ).toBe(callCount)
      expect(clearIntervalSpy).toHaveBeenCalled()
      clearIntervalSpy.mockRestore()
    })

    it('is a no-op for an unknown channel id', () => {
      expect(() => service.stop('nonexistent-channel')).not.toThrow()
    })
  })

  describe('max typing count', () => {
    it('sends a "taking too long" message and stops after exceeding max count', async () => {
      const channel = makeChannel('ch-max')

      service.start(channel)

      // Trigger enough intervals to exceed MAX_SEND_TYPING_COUNT
      for (let i = 0; i <= MAX_SEND_TYPING_COUNT; i++) {
        jest.advanceTimersByTime(TYPING_DELAY_MS)
        // Flush all pending promises
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      }

      // The "taking too long" message send should have been called
      const calls = (retryService.executeWithRetry as jest.Mock).mock.calls
      const sentLongTypingMessage = calls.some(call => {
        const label = call[2] as string
        return label === 'Discord-longTypingMessage'
      })
      expect(sentLongTypingMessage).toBe(true)
    })
  })

  describe('onModuleDestroy', () => {
    it('clears all active intervals on module destroy', async () => {
      const channel1 = makeChannel('ch-destroy-1')
      const channel2 = makeChannel('ch-destroy-2')
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval')

      service.start(channel1)
      service.start(channel2)
      await Promise.resolve()

      service.onModuleDestroy()

      expect(clearIntervalSpy).toHaveBeenCalledTimes(2)
      clearIntervalSpy.mockRestore()
    })

    it('does nothing when no channels are active', () => {
      expect(() => service.onModuleDestroy()).not.toThrow()
    })
  })
})
