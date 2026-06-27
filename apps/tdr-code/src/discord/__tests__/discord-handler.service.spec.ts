import { Client } from 'discord.js'
import { ModuleRef } from '@nestjs/core'

import {
  createTestingModule,
  createMockMessage,
  createMockTextChannel,
} from 'src/__tests__/test-utils'

import { DiscordHandlerService } from '../discord-handler.service'

// Expose private typing internals for inspection
function typingIntervals(
  service: DiscordHandlerService,
): Map<string, NodeJS.Timeout> {
  return (
    service as unknown as { typingIntervals: Map<string, NodeJS.Timeout> }
  ).typingIntervals
}

function createMockClient(channelMap: Map<string, unknown> = new Map()) {
  return {
    user: { id: 'bot-id' },
    channels: {
      cache: channelMap,
      fetch: jest.fn(),
    },
  }
}

async function createService(clientOverrides = {}) {
  const mockClient = { ...createMockClient(), ...clientOverrides }
  const mockModuleRef = { get: jest.fn() }

  const module = await createTestingModule([
    DiscordHandlerService,
    { provide: Client, useValue: mockClient },
    { provide: ModuleRef, useValue: mockModuleRef },
  ])

  return module.get(DiscordHandlerService)
}

describe('DiscordHandlerService — typing indicator (U1)', () => {
  describe('startTyping / stopTyping lifecycle', () => {
    it('fires sendTyping after fetchChannel resolves (AE1)', async () => {
      const sendTyping = jest.fn().mockResolvedValue(undefined)
      const channel = createMockTextChannel({ sendTyping })
      const service = await createService(
        createMockClient(new Map([['ch1', channel]])),
      )

      // Call startTyping via the first ACP event
      service.onAgentMessageChunk('ch1', 'text')
      await new Promise(r => setImmediate(r))

      expect(sendTyping).toHaveBeenCalledTimes(1)
    })

    it('does not accumulate intervals across a multi-chunk turn (leak regression)', async () => {
      const sendTyping = jest.fn().mockResolvedValue(undefined)
      const channel = createMockTextChannel({ sendTyping })
      const service = await createService(
        createMockClient(new Map([['ch1', channel]])),
      )

      service.onAgentMessageChunk('ch1', 'a')
      service.onAgentMessageChunk('ch1', 'b')
      service.onAgentMessageChunk('ch1', 'c')
      await new Promise(r => setImmediate(r))

      // Three chunk events — only one interval exists
      expect(typingIntervals(service).size).toBe(1)
    })

    it('clears interval on onPromptComplete (AE2)', async () => {
      const sendTyping = jest.fn().mockResolvedValue(undefined)
      const channel = createMockTextChannel({ sendTyping })
      const service = await createService(
        createMockClient(new Map([['ch1', channel]])),
      )

      service.onAgentMessageChunk('ch1', 'text')
      await new Promise(r => setImmediate(r))

      expect(typingIntervals(service).size).toBe(1)

      service.onPromptComplete('ch1', 'end_turn')

      expect(typingIntervals(service).size).toBe(0)
    })

    it('clears interval on onPromptComplete("error") (R4)', async () => {
      const sendTyping = jest.fn().mockResolvedValue(undefined)
      const channel = createMockTextChannel({ sendTyping })
      const service = await createService(
        createMockClient(new Map([['ch1', channel]])),
      )

      service.onAgentMessageChunk('ch1', 'text')
      await new Promise(r => setImmediate(r))

      service.onPromptComplete('ch1', 'error')

      expect(typingIntervals(service).size).toBe(0)
    })

    it('clears interval on onPromptComplete("cancelled") (R4)', async () => {
      const sendTyping = jest.fn().mockResolvedValue(undefined)
      const channel = createMockTextChannel({ sendTyping })
      const service = await createService(
        createMockClient(new Map([['ch1', channel]])),
      )

      service.onAgentMessageChunk('ch1', 'text')
      await new Promise(r => setImmediate(r))

      service.onPromptComplete('ch1', 'cancelled')

      expect(typingIntervals(service).size).toBe(0)
    })

    it('re-arms on onToolCall without creating a second interval (R3)', async () => {
      const sendTyping = jest.fn().mockResolvedValue(undefined)
      const channel = createMockTextChannel({ sendTyping })
      const service = await createService(
        createMockClient(new Map([['ch1', channel]])),
      )

      service.onAgentMessageChunk('ch1', 'text')
      await new Promise(r => setImmediate(r))

      const countAfterChunk = typingIntervals(service).size
      service.onToolCall('ch1', 'tool1', 'Title', 'other', 'pending', [])
      await new Promise(r => setImmediate(r))

      expect(typingIntervals(service).size).toBe(countAfterChunk)
    })
  })

  describe('dedupe — concurrent startTyping calls (R5)', () => {
    it('two near-simultaneous starts produce exactly one interval', async () => {
      const sendTyping = jest.fn().mockResolvedValue(undefined)
      const channel = createMockTextChannel({ sendTyping })
      const service = await createService(
        createMockClient(new Map([['ch1', channel]])),
      )

      // Two events fired synchronously before any await
      service.onAgentMessageChunk('ch1', 'a')
      service.onAgentMessageChunk('ch1', 'b')
      await new Promise(r => setImmediate(r))

      expect(typingIntervals(service).size).toBe(1)
    })

    it('start → stop before fetchChannel resolves leaves zero intervals (async-gap race, R5)', async () => {
      let resolveChannel!: (ch: unknown) => void
      const channelPromise = new Promise(r => { resolveChannel = r })

      const mockClient = {
        user: { id: 'bot-id' },
        channels: {
          cache: new Map(),
          fetch: jest.fn().mockReturnValue(channelPromise),
        },
      }
      const service = await createService(mockClient)

      // startTyping queues the fetch
      service.onAgentMessageChunk('ch1', 'text')
      // stopTyping fires before the fetch resolves
      service.onPromptComplete('ch1', 'end_turn')

      // Now let the fetch resolve with a channel
      const sendTyping = jest.fn()
      resolveChannel(createMockTextChannel({ sendTyping }))
      await new Promise(r => setImmediate(r))

      // No interval should have been installed (placeholder was cleared)
      expect(typingIntervals(service).size).toBe(0)
    })
  })

  describe('teardown abort — orphaned prompt (R4)', () => {
    it('onApplicationShutdown clears all active typing intervals', async () => {
      const sendTyping = jest.fn().mockResolvedValue(undefined)
      const ch1 = createMockTextChannel({ sendTyping })
      const ch2 = createMockTextChannel({ sendTyping })
      const service = await createService(
        createMockClient(
          new Map([
            ['ch1', ch1],
            ['ch2', ch2],
          ]),
        ),
      )

      service.onAgentMessageChunk('ch1', 'a')
      service.onAgentMessageChunk('ch2', 'b')
      await new Promise(r => setImmediate(r))

      expect(typingIntervals(service).size).toBe(2)

      service.onApplicationShutdown()

      expect(typingIntervals(service).size).toBe(0)
    })
  })
})
