import { ModuleRef } from '@nestjs/core'
import { Client } from 'discord.js'

import {
  createMockMessage,
  createMockTextChannel,
  createTestingModule,
} from 'src/__tests__/test-utils'
import type { PromptOutcome } from 'src/agent/agent.types'
import { DiscordHandlerService } from 'src/discord/discord-handler.service'
import { extractImages } from 'src/discord/image-attachments'

// Mock extractImages so onMessage tests don't do real network calls
jest.mock('src/discord/image-attachments', () => ({
  extractImages: jest.fn().mockResolvedValue([]),
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  MAX_IMAGES_PER_MESSAGE: 4,
}))

const mockExtractImages = extractImages as jest.Mock

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

    it('clears interval on onPromptComplete("aborted") (U1, R4)', async () => {
      const sendTyping = jest.fn().mockResolvedValue(undefined)
      const channel = createMockTextChannel({ sendTyping })
      const service = await createService(
        createMockClient(new Map([['ch1', channel]])),
      )

      service.onAgentMessageChunk('ch1', 'text')
      await new Promise(r => setImmediate(r))

      expect(typingIntervals(service).size).toBe(1)
      service.onPromptComplete('ch1', 'aborted')

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
      const channelPromise = new Promise(r => {
        resolveChannel = r
      })

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

  describe('interval re-fire (U1)', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('re-sends typing every 8s and stops after onPromptComplete', async () => {
      const sendTyping = jest.fn().mockResolvedValue(undefined)
      const channel = createMockTextChannel({ sendTyping })
      const service = await createService(
        createMockClient(new Map([['ch1', channel]])),
      )

      service.onAgentMessageChunk('ch1', 'text')
      // Drain microtasks — fetchChannel resolves from cache, sendTyping fires once,
      // setInterval is installed.
      await Promise.resolve()

      expect(sendTyping).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(8000)
      expect(sendTyping).toHaveBeenCalledTimes(2)

      service.onPromptComplete('ch1', 'end_turn')

      jest.advanceTimersByTime(8000)
      // Interval was cleared — no more fires
      expect(sendTyping).toHaveBeenCalledTimes(2)
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

// Helper: create a service wired to a mock SessionManagerService
import { SessionManagerService } from 'src/agent/session-manager.service'

async function createServiceWithSessionMgr(
  promptResult: PromptOutcome | Promise<PromptOutcome> = {
    kind: 'completed',
    stopReason: 'end_turn',
  },
  clientOverrides = {},
) {
  const mockPrompt = jest.fn().mockResolvedValue(promptResult)
  const mockIsPrompting = jest.fn().mockReturnValue(false)
  const mockSessionManager = {
    prompt: mockPrompt,
    isPrompting: mockIsPrompting,
  }

  const mockClient = { ...createMockClient(), ...clientOverrides }
  const mockModuleRef = {
    get: jest.fn().mockReturnValue(mockSessionManager),
  }

  const module = await createTestingModule([
    DiscordHandlerService,
    { provide: Client, useValue: mockClient },
    { provide: ModuleRef, useValue: mockModuleRef },
    { provide: SessionManagerService, useValue: mockSessionManager },
  ])

  return {
    service: module.get(DiscordHandlerService),
    mockPrompt,
    mockIsPrompting,
    mockSessionManager,
  }
}

function makeMentionMessage(
  content = '',
  overrides: Record<string, unknown> = {},
) {
  return createMockMessage({
    content,
    mentions: { has: jest.fn().mockReturnValue(true) },
    attachments: { values: jest.fn().mockReturnValue([]) },
    channelId: 'ch1',
    author: { id: 'user-1', bot: false },
    ...overrides,
  })
}

describe('DiscordHandlerService — onAgentMessageImage / outbound images (U5)', () => {
  it('flushes buffered text before sending the image (R14, AE6)', async () => {
    const calls: string[] = []
    const sentMessages: unknown[] = []
    const existingPlaceholder = createMockMessage({ id: 'placeholder' })
    ;(existingPlaceholder.delete as jest.Mock).mockImplementation(async () => {
      calls.push('delete-placeholder')
    })

    const channel = createMockTextChannel({
      send: jest.fn().mockImplementation(async (arg: unknown) => {
        const isFile = typeof arg === 'object' && arg !== null && 'files' in arg
        calls.push(isFile ? 'send-image' : 'send-text')
        sentMessages.push(arg)
        return createMockMessage()
      }),
    })

    const service = await createService(
      createMockClient(new Map([['ch1', channel]])),
    )

    // Pre-populate channel state with buffered text and a reply placeholder
    const states = (
      service as unknown as { channelStates: Map<string, unknown> }
    ).channelStates
    states.set('ch1', {
      toolStates: new Map(),
      toolSummaryMessage: null,
      toolSummaryCreating: false,
      pendingDiffs: new Map(),
      replyBuffer: 'buffered text',
      replyMessage: existingPlaceholder,
      flushTimer: null,
      workingMessage: null,
      workingMessageCreating: false,
      currentTurnId: 1,
    })

    service.onAgentMessageImage(
      'ch1',
      Buffer.from('png').toString('base64'),
      'image/png',
    )
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))

    // Text must be sent before image
    expect(calls).toContain('send-text')
    expect(calls).toContain('send-image')
    const textIdx = calls.indexOf('send-text')
    const imageIdx = calls.indexOf('send-image')
    expect(textIdx).toBeLessThan(imageIdx)
  })

  it('derives file extension from mimeType (image/jpeg → image.jpeg)', async () => {
    const { AttachmentBuilder } = jest.requireMock('discord.js') as {
      AttachmentBuilder: jest.Mock
    }
    const channel = createMockTextChannel()
    const service = await createService(
      createMockClient(new Map([['ch1', channel]])),
    )

    service.onAgentMessageImage(
      'ch1',
      Buffer.from('jpg').toString('base64'),
      'image/jpeg',
    )
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))

    expect(AttachmentBuilder).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ name: 'image.jpeg' }),
    )
  })

  it('falls back to image.png for unknown mimeType', async () => {
    const { AttachmentBuilder } = jest.requireMock('discord.js') as {
      AttachmentBuilder: jest.Mock
    }
    const channel = createMockTextChannel()
    const service = await createService(
      createMockClient(new Map([['ch1', channel]])),
    )

    service.onAgentMessageImage(
      'ch1',
      Buffer.from('x').toString('base64'),
      'application/octet-stream',
    )
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))

    expect(AttachmentBuilder).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ name: 'image.octet-stream' }),
    )
  })

  it('does not throw when channel.send rejects (graceful failure)', async () => {
    const channel = createMockTextChannel({
      send: jest.fn().mockRejectedValue(new Error('too large')),
    })
    const service = await createService(
      createMockClient(new Map([['ch1', channel]])),
    )

    // Should not throw
    expect(() => {
      service.onAgentMessageImage(
        'ch1',
        Buffer.from('x').toString('base64'),
        'image/png',
      )
    }).not.toThrow()
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))
  })

  it('does not send image to a cleared channel (cleared-channel guard, Decision #5)', async () => {
    const channel = createMockTextChannel()
    const service = await createService(
      createMockClient(new Map([['ch1', channel]])),
    )

    // Arm the cleared-channel guard before the image event arrives
    service.resetChannel('ch1')
    service.onAgentMessageImage(
      'ch1',
      Buffer.from('x').toString('base64'),
      'image/png',
    )
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))

    expect(channel.send).not.toHaveBeenCalled()
  })
})

describe('DiscordHandlerService — onMessage / inbound images (U4)', () => {
  beforeEach(() => {
    // Default: no images extracted
    mockExtractImages.mockResolvedValue([])
  })

  it('accepts @mention with text and no image, calls prompt with text + [] (regression)', async () => {
    const { service, mockPrompt } = await createServiceWithSessionMgr()
    const message = makeMentionMessage('hello world')

    await service.onMessage([message] as never)

    expect(mockPrompt).toHaveBeenCalledWith('ch1', 'hello world', 'user-1', [])
  })

  it('accepts @mention with image and no text (R7, AE3)', async () => {
    const fakeImage = { data: 'abc', mimeType: 'image/png' }
    mockExtractImages.mockResolvedValue([fakeImage])

    const { service, mockPrompt } = await createServiceWithSessionMgr()
    const message = makeMentionMessage('')

    await service.onMessage([message] as never)

    expect(mockPrompt).toHaveBeenCalledWith('ch1', '', 'user-1', [fakeImage])
  })

  it('accepts @mention with text + image (R6)', async () => {
    const fakeImage = { data: 'xyz', mimeType: 'image/jpeg' }
    mockExtractImages.mockResolvedValue([fakeImage])

    const { service, mockPrompt } = await createServiceWithSessionMgr()
    const message = makeMentionMessage('fix this')

    await service.onMessage([message] as never)

    expect(mockPrompt).toHaveBeenCalledWith('ch1', 'fix this', 'user-1', [
      fakeImage,
    ])
  })

  it('rejects @mention with neither text nor usable images (R7, R10)', async () => {
    mockExtractImages.mockResolvedValue([]) // junk-only attachment → no images

    const { service, mockPrompt } = await createServiceWithSessionMgr()
    const message = makeMentionMessage('')

    await service.onMessage([message] as never)

    expect(mockPrompt).not.toHaveBeenCalled()
    expect(message.reply).toHaveBeenCalledWith(
      expect.stringContaining('Please provide'),
    )
  })

  it('replies with images-unsupported note when prompt returns no_image_support (R10)', async () => {
    const fakeImage = { data: 'abc', mimeType: 'image/png' }
    mockExtractImages.mockResolvedValue([fakeImage])

    const { service } = await createServiceWithSessionMgr({
      kind: 'no_image_support',
    })
    const message = makeMentionMessage('')

    await service.onMessage([message] as never)

    expect(message.reply).toHaveBeenCalledWith(
      expect.stringContaining('cannot read images'),
    )
  })

  it('starts typing before awaiting prompt and stops on error', async () => {
    const sendTyping = jest.fn().mockResolvedValue(undefined)
    const channel = createMockTextChannel({ sendTyping })
    const mockPrompt = jest.fn().mockRejectedValue(new Error('boom'))
    const mockModuleRef = {
      get: jest.fn().mockReturnValue({
        prompt: mockPrompt,
        isPrompting: jest.fn().mockReturnValue(false),
      }),
    }
    const mockClient = createMockClient(new Map([['ch1', channel]]))

    const module = await createTestingModule([
      DiscordHandlerService,
      { provide: Client, useValue: mockClient },
      { provide: ModuleRef, useValue: mockModuleRef },
    ])
    const service = module.get(DiscordHandlerService)

    const message = makeMentionMessage('hello')
    await service.onMessage([message] as never)
    await new Promise(r => setImmediate(r))

    // sendTyping was fired (typing started)
    expect(sendTyping).toHaveBeenCalledTimes(1)
    // After catch, typing interval was cleaned up
    expect(typingIntervals(service).size).toBe(0)
  })
})
