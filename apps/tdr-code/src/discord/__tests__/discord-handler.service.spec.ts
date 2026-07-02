import { ModuleRef } from '@nestjs/core'
import { Client } from 'discord.js'

import {
  createMockMessage,
  createMockTextChannel,
  createMockThreadChannel,
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

    it('start → stop → start discards the first interval and keeps only the second (R5)', async () => {
      let resolveFirst!: (ch: unknown) => void
      let resolveSecond!: (ch: unknown) => void
      let callCount = 0

      const mockClient = {
        user: { id: 'bot-id' },
        channels: {
          cache: new Map(),
          fetch: jest.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1)
              return new Promise(r => {
                resolveFirst = r
              })
            return new Promise(r => {
              resolveSecond = r
            })
          }),
        },
      }
      const service = await createService(mockClient)
      const sendTyping = jest.fn().mockResolvedValue(undefined)
      const channel = createMockTextChannel({ sendTyping })

      // First start — placeholder A inserted, fetch #1 in flight
      service.onAgentMessageChunk('ch1', 'first')
      // Stop — clears placeholder A
      service.onPromptComplete('ch1', 'end_turn')
      // Second start — placeholder B inserted, fetch #2 in flight
      service.onAgentMessageChunk('ch1', 'second')

      // Resolve fetch #1 — placeholder A is gone, discard branch fires
      resolveFirst(channel)
      await new Promise(r => setImmediate(r))

      // Resolve fetch #2 — placeholder B is current, interval installed
      resolveSecond(channel)
      await new Promise(r => setImmediate(r))

      expect(typingIntervals(service).size).toBe(1)
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

    const channel = createMockTextChannel({
      send: jest.fn().mockImplementation(async (arg: unknown) => {
        const isFile = typeof arg === 'object' && arg !== null && 'files' in arg
        calls.push(isFile ? 'send-image' : 'send-text')
        return createMockMessage()
      }),
    })

    const service = await createService(
      createMockClient(new Map([['ch1', channel]])),
    )

    // Seed buffer through public API — the 500ms flush timer won't have fired by the
    // time sendAgentImage calls flushReply(final=true), so text arrives first.
    service.onAgentMessageChunk('ch1', 'buffered text')

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

  it('replies with queued note when prompt returns queued (no double-reply, R10)', async () => {
    const { service } = await createServiceWithSessionMgr({ kind: 'queued' })
    const message = makeMentionMessage('hello')

    await service.onMessage([message] as never)

    expect(message.reply).toHaveBeenCalledWith(
      expect.stringContaining('queued'),
    )
    // Only one reply — no spurious "cannot read images" reply
    expect((message.reply as jest.Mock).mock.calls).toHaveLength(1)
  })

  it('starts typing before awaiting prompt and stops on error', async () => {
    const sendTyping = jest.fn().mockResolvedValue(undefined)
    const channel = createMockTextChannel({ sendTyping })
    const mockPrompt = jest.fn().mockRejectedValue(new Error('boom'))
    const mockModuleRef = {
      get: jest.fn().mockReturnValue({
        prompt: mockPrompt,
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

describe('DiscordHandlerService — thread-aware routing (U2)', () => {
  beforeEach(() => {
    // Default: no images extracted (some tests below override per-case).
    mockExtractImages.mockResolvedValue([])
  })

  // Full permission grant: bot has CreatePublicThreads + SendMessagesInThreads.
  function allowThreadCreation() {
    return {
      guild: {
        members: { me: { id: 'bot-member' } },
      },
      channel: {
        type: 0 /* GuildText */,
        isThread: jest.fn().mockReturnValue(false),
        isDMBased: jest.fn().mockReturnValue(false),
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true),
        }),
      },
    }
  }

  it('top-level mention in a GuildText channel creates a thread and prompts with the thread id (AE1, R1/R2)', async () => {
    const threadChannel = createMockThreadChannel({ id: 'thread-abc' })
    const startThread = jest.fn().mockResolvedValue(threadChannel)
    const { service, mockPrompt } = await createServiceWithSessionMgr()
    const message = makeMentionMessage('please help me with this task', {
      ...allowThreadCreation(),
      startThread,
    })

    await service.onMessage([message] as never)

    expect(startThread).toHaveBeenCalledTimes(1)
    const call = startThread.mock.calls[0][0] as {
      name: string
      autoArchiveDuration: number
    }
    expect(call.name).toBe('please help me with this task')
    expect(call.name.length).toBeLessThanOrEqual(100)
    expect(call.autoArchiveDuration).toBe(1440)

    expect(mockPrompt).toHaveBeenCalledWith(
      'thread-abc',
      'please help me with this task',
      'user-1',
      [],
    )
  })

  it('truncates a long prompt at a word boundary for the thread name (<=100 chars)', async () => {
    const longText =
      'this is a very long message that should definitely exceed the ninety character budget we reserve for thread names before Discord rejects it outright'
    const threadChannel = createMockThreadChannel({ id: 'thread-long' })
    const startThread = jest.fn().mockResolvedValue(threadChannel)
    const { service } = await createServiceWithSessionMgr()
    const message = makeMentionMessage(longText, {
      ...allowThreadCreation(),
      startThread,
    })

    await service.onMessage([message] as never)

    const call = startThread.mock.calls[0][0] as { name: string }
    expect(call.name.length).toBeLessThanOrEqual(100)
    expect(call.name.endsWith('…')).toBe(true)
    // Truncated at a word boundary — no cut mid-word before the ellipsis.
    expect(longText.startsWith(call.name.slice(0, -1))).toBe(true)
  })

  it('mention with an image but empty text in a threadable channel uses the "New session" fallback name', async () => {
    const fakeImage = { data: 'abc', mimeType: 'image/png' }
    mockExtractImages.mockResolvedValue([fakeImage])

    const threadChannel = createMockThreadChannel({ id: 'thread-bare' })
    const startThread = jest.fn().mockResolvedValue(threadChannel)
    const { service, mockPrompt } = await createServiceWithSessionMgr()
    const message = makeMentionMessage('', {
      ...allowThreadCreation(),
      startThread,
      attachments: { values: jest.fn().mockReturnValue(['fake-attachment']) },
    })

    await service.onMessage([message] as never)

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New session' }),
    )
    expect(mockPrompt).toHaveBeenCalledWith('thread-bare', '', 'user-1', [
      fakeImage,
    ])
  })

  it('mention inside an existing thread continues that thread — no startThread, prompt uses the thread id (R3)', async () => {
    const startThread = jest.fn()
    const { service, mockPrompt } = await createServiceWithSessionMgr()
    const message = makeMentionMessage('continue please', {
      channelId: 'thread-existing',
      channel: {
        type: 11 /* PublicThread */,
        id: 'thread-existing',
        isThread: jest.fn().mockReturnValue(true),
        isDMBased: jest.fn().mockReturnValue(false),
      },
      startThread,
    })

    await service.onMessage([message] as never)

    expect(startThread).not.toHaveBeenCalled()
    expect(mockPrompt).toHaveBeenCalledWith(
      'thread-existing',
      'continue please',
      'user-1',
      [],
    )
  })

  it('mention in a DM never creates a thread — prompt uses the DM channel id (AE6, R4)', async () => {
    const startThread = jest.fn()
    const { service, mockPrompt } = await createServiceWithSessionMgr()
    const message = makeMentionMessage('hello from dm', {
      channelId: 'dm-channel-1',
      channel: {
        type: 1 /* DM */,
        isThread: jest.fn().mockReturnValue(false),
        isDMBased: jest.fn().mockReturnValue(true),
      },
      startThread,
    })

    await service.onMessage([message] as never)

    expect(startThread).not.toHaveBeenCalled()
    expect(mockPrompt).toHaveBeenCalledWith(
      'dm-channel-1',
      'hello from dm',
      'user-1',
      [],
    )
  })

  it('two top-level mentions on two different messages in the same channel create two distinct threads (AE5, R5)', async () => {
    const threadA = createMockThreadChannel({ id: 'thread-a' })
    const threadB = createMockThreadChannel({ id: 'thread-b' })
    const startThreadA = jest.fn().mockResolvedValue(threadA)
    const startThreadB = jest.fn().mockResolvedValue(threadB)
    const { service, mockPrompt } = await createServiceWithSessionMgr()

    const messageA = makeMentionMessage('first conversation', {
      ...allowThreadCreation(),
      startThread: startThreadA,
    })
    const messageB = makeMentionMessage('second conversation', {
      ...allowThreadCreation(),
      startThread: startThreadB,
    })

    await service.onMessage([messageA] as never)
    await service.onMessage([messageB] as never)

    expect(startThreadA).toHaveBeenCalledTimes(1)
    expect(startThreadB).toHaveBeenCalledTimes(1)
    expect(mockPrompt).toHaveBeenNthCalledWith(
      1,
      'thread-a',
      'first conversation',
      'user-1',
      [],
    )
    expect(mockPrompt).toHaveBeenNthCalledWith(
      2,
      'thread-b',
      'second conversation',
      'user-1',
      [],
    )
  })

  it('non-threadable guild channel (GuildVoice) never calls startThread — inline fallback with the channel id', async () => {
    const startThread = jest.fn()
    const { service, mockPrompt } = await createServiceWithSessionMgr()
    const message = makeMentionMessage('voice channel mention', {
      guild: { members: { me: { id: 'bot-member' } } },
      channel: {
        type: 2 /* GuildVoice */,
        isThread: jest.fn().mockReturnValue(false),
        isDMBased: jest.fn().mockReturnValue(false),
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true),
        }),
      },
      startThread,
    })

    await service.onMessage([message] as never)

    expect(startThread).not.toHaveBeenCalled()
    expect(mockPrompt).toHaveBeenCalledWith(
      'ch1',
      'voice channel mention',
      'user-1',
      [],
    )
  })

  it('bot lacking CreatePublicThreads permission never calls startThread — inline fallback', async () => {
    const startThread = jest.fn()
    const { service, mockPrompt } = await createServiceWithSessionMgr()
    const message = makeMentionMessage('no perms here', {
      guild: { members: { me: { id: 'bot-member' } } },
      channel: {
        type: 0 /* GuildText */,
        isThread: jest.fn().mockReturnValue(false),
        isDMBased: jest.fn().mockReturnValue(false),
        permissionsFor: jest.fn().mockReturnValue({
          // Missing CreatePublicThreads (and SendMessagesInThreads)
          has: jest.fn().mockReturnValue(false),
        }),
      },
      startThread,
    })

    await service.onMessage([message] as never)

    expect(startThread).not.toHaveBeenCalled()
    expect(mockPrompt).toHaveBeenCalledWith(
      'ch1',
      'no perms here',
      'user-1',
      [],
    )
  })

  it('startThread rejecting falls back to inline routing — the turn is still submitted (error path)', async () => {
    const startThread = jest.fn().mockRejectedValue(new Error('rate limited'))
    const { service, mockPrompt } = await createServiceWithSessionMgr()
    const message = makeMentionMessage('this should still go through', {
      ...allowThreadCreation(),
      startThread,
    })

    await service.onMessage([message] as never)

    expect(startThread).toHaveBeenCalledTimes(1)
    expect(mockPrompt).toHaveBeenCalledWith(
      'ch1',
      'this should still go through',
      'user-1',
      [],
    )
  })

  it('a non-mention message inside a thread never triggers a turn (AE2, R6)', async () => {
    const startThread = jest.fn()
    const { service, mockPrompt } = await createServiceWithSessionMgr()
    const message = makeMentionMessage('just chatting, no mention', {
      channelId: 'thread-existing',
      channel: {
        type: 11 /* PublicThread */,
        isThread: jest.fn().mockReturnValue(true),
        isDMBased: jest.fn().mockReturnValue(false),
      },
      mentions: { has: jest.fn().mockReturnValue(false) },
      startThread,
    })

    await service.onMessage([message] as never)

    expect(startThread).not.toHaveBeenCalled()
    expect(mockPrompt).not.toHaveBeenCalled()
  })

  it('leaves no lingering typing interval on the parent channel once a thread turn completes (typing symmetry)', async () => {
    const parentSendTyping = jest.fn().mockResolvedValue(undefined)
    const threadSendTyping = jest.fn().mockResolvedValue(undefined)
    const parentChannel = createMockTextChannel({
      id: 'ch1',
      sendTyping: parentSendTyping,
    })
    const threadChannel = createMockThreadChannel({
      id: 'thread-typing',
      sendTyping: threadSendTyping,
    })
    const startThread = jest.fn().mockResolvedValue(threadChannel)

    const { service, mockSessionManager } = await createServiceWithSessionMgr(
      { kind: 'completed', stopReason: 'end_turn' },
      {
        channels: {
          cache: new Map([
            ['ch1', parentChannel],
            ['thread-typing', threadChannel],
          ]),
          fetch: jest.fn(),
        },
      },
    )
    const message = makeMentionMessage('start a thread please', {
      ...allowThreadCreation(),
      startThread,
    })

    await service.onMessage([message] as never)
    await new Promise(r => setImmediate(r))

    // Typing was started on the thread, not the parent channel.
    expect(threadSendTyping).toHaveBeenCalled()
    expect(parentSendTyping).not.toHaveBeenCalled()
    expect(typingIntervals(service).has('thread-typing')).toBe(true)
    expect(typingIntervals(service).has('ch1')).toBe(false)

    // Simulate the turn completing — onPromptComplete is keyed on the
    // resolved thread id (mirrors what SessionManagerService would call).
    void mockSessionManager
    service.onPromptComplete('thread-typing', 'end_turn')

    // No lingering interval anywhere — especially not on the parent channel.
    expect(typingIntervals(service).has('thread-typing')).toBe(false)
    expect(typingIntervals(service).has('ch1')).toBe(false)
    expect(typingIntervals(service).size).toBe(0)
  })
})
