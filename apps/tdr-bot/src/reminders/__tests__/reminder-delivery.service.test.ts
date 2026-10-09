import { AIMessage } from '@langchain/core/messages'
import { Client } from 'discord.js'

import {
  createMockMetricsService,
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { LlmClient } from 'src/llm/client/llm-client'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { createTestReminder } from 'src/reminders/__tests__/factories/reminder'
import { TAVILY_SEARCH_TOKEN } from 'src/reminders/reminder.constants'
import { ReminderDeliveryService } from 'src/reminders/reminder-delivery.service'
import { EquationImageService } from 'src/services/equation-image.service'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import { RetryService } from 'src/utils/retry.service'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockTavilyInvoke = jest
  .fn()
  .mockResolvedValue([{ title: 'Weather in Tokyo', content: 'Sunny, 22°C' }])
jest.mock('@langchain/tavily', () => ({
  TavilySearch: jest
    .fn()
    .mockImplementation(() => ({ invoke: mockTavilyInvoke })),
}))

// ─── Mock prom-client to avoid duplicate metric registration ─────────────────

jest.mock('prom-client', () => ({
  Counter: jest.fn().mockImplementation(() => ({ inc: jest.fn() })),
  Gauge: jest
    .fn()
    .mockImplementation(() => ({ inc: jest.fn(), dec: jest.fn() })),
  Histogram: jest.fn().mockImplementation(() => ({ observe: jest.fn() })),
  register: {
    getSingleMetric: jest.fn().mockReturnValue(undefined),
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface MockChannel {
  id: string
  name: string
  guild: { id: string }
  isTextBased: jest.Mock
  send: jest.Mock
}

function makeMockTextChannel(
  name = 'tdr-bot-chat',
  sendFn = jest.fn().mockResolvedValue({}),
): MockChannel {
  return {
    id: 'channel-1',
    name,
    guild: { id: 'guild-1' },
    isTextBased: jest.fn().mockReturnValue(true),
    send: sendFn,
  }
}

/**
 * Creates a Discord Client mock where `guilds.cache.get(guildId)` returns
 * a guild object whose `channels.cache.find` searches the provided channels.
 */
function makeDiscordClient(
  channels: MockChannel[],
  guildId = 'guild-1',
): Client {
  const guild = {
    id: guildId,
    channels: {
      cache: {
        find: (fn: (ch: MockChannel) => boolean) => channels.find(fn),
      },
    },
  }

  const guildsCache = {
    get: (id: string) => (id === guildId ? guild : undefined),
  }

  return { guilds: { cache: guildsCache } } as unknown as Client
}

/**
 * Scripts a FakeLlmClient by operation. The chat / reasoning mocks record the
 * messages each role receives.
 */
function makeLlm(responseContent = 'Hey! Reminder time!'): {
  factory: FakeLlmClient
  mockChatModel: { invoke: jest.Mock }
  mockReasoningModel: { invoke: jest.Mock }
} {
  const mockChatModel = {
    invoke: jest.fn().mockReturnValue(new AIMessage(responseContent)),
  }
  const mockReasoningModel = {
    invoke: jest.fn().mockReturnValue(new AIMessage('$x^2 + y^2 = z^2$')),
  }
  const factory = new FakeLlmClient()
  for (const op of [
    'reminder.deliver',
    'reminder.deliverSearch',
    'reminder.deliverMath',
  ]) {
    factory.script(op, call =>
      call.role === 'reasoning'
        ? mockReasoningModel.invoke(call.messages)
        : mockChatModel.invoke(call.messages),
    )
  }
  return { factory, mockChatModel, mockReasoningModel }
}

function makeEquationImageServiceMock(
  url = 'https://equations.example.com/eq.png',
): jest.Mocked<EquationImageService> {
  return {
    getImage: jest
      .fn()
      .mockResolvedValue({ url, bucket: 'test', file: 'eq.png' }),
  } as unknown as jest.Mocked<EquationImageService>
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ReminderDeliveryService', () => {
  let service: ReminderDeliveryService
  let metrics: jest.Mocked<TdrBotMetricsService>
  let retryService: jest.Mocked<RetryService>

  async function buildService(
    client: Client,
    llm: FakeLlmClient,
    equationImageService: jest.Mocked<EquationImageService> = makeEquationImageServiceMock(),
  ) {
    metrics = createMockMetricsService()
    retryService = createMockRetryService()

    const module = await createTestingModule([
      ReminderDeliveryService,
      { provide: Client, useValue: client },
      { provide: LlmClient, useValue: llm },
      { provide: RetryService, useValue: retryService },
      { provide: TdrBotMetricsService, useValue: metrics },
      { provide: EquationImageService, useValue: equationImageService },
      {
        provide: TAVILY_SEARCH_TOKEN,
        useValue: { invoke: mockTavilyInvoke },
      },
    ])

    return module.get(ReminderDeliveryService)
  }

  beforeEach(() => {
    mockTavilyInvoke.mockClear()
  })

  // ── deliver (default) ────────────────────────────────────────────────────

  describe('deliver (default action)', () => {
    it('sends a message to the tdr-bot-chat channel', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const channel = makeMockTextChannel('tdr-bot-chat', sendFn)
      const client = makeDiscordClient([channel])
      const { factory } = makeLlm('Hey, reminder!')
      service = await buildService(client, factory)

      const result = await service.deliver(createTestReminder())

      expect(result).toEqual({ ok: true })
      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Hey, reminder!' }),
      )
    })

    it('skips non-text channels', async () => {
      const nonTextChannel = makeMockTextChannel()
      nonTextChannel.isTextBased.mockReturnValue(false)
      const client = makeDiscordClient([nonTextChannel])
      const { factory } = makeLlm()
      service = await buildService(client, factory)

      await expect(service.deliver(createTestReminder())).resolves.toEqual({
        ok: false,
        reason: 'channel_not_found',
      })
      expect(nonTextChannel.send).not.toHaveBeenCalled()
    })

    it('does nothing when no matching channels are found', async () => {
      const nonMatchingChannel = makeMockTextChannel('general')
      const client = makeDiscordClient([nonMatchingChannel])
      const { factory } = makeLlm()
      service = await buildService(client, factory)

      await expect(service.deliver(createTestReminder())).resolves.toEqual({
        ok: false,
        reason: 'channel_not_found',
      })
      expect(nonMatchingChannel.send).not.toHaveBeenCalled()
    })

    it('scopes delivery to the reminder guildId only', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const channel = makeMockTextChannel('tdr-bot-chat', sendFn)
      const client = makeDiscordClient([channel], 'guild-1')
      const { factory } = makeLlm('Reminder!')
      service = await buildService(client, factory)

      // Reminder with a different guildId should not send to guild-1
      await service.deliver(createTestReminder({ guildId: 'guild-999' }))

      expect(sendFn).not.toHaveBeenCalled()
    })

    it('uses the LLM to generate a reminder message', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory, mockChatModel } = makeLlm('Reminder text')
      service = await buildService(client, factory)

      await service.deliver(createTestReminder())

      expect(mockChatModel.invoke).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content: expect.any(String) }),
        ]),
      )
    })

    it('includes the userId mention in the LLM prompt', async () => {
      const client = makeDiscordClient([makeMockTextChannel()])
      const { factory, mockChatModel } = makeLlm('Reminder')
      service = await buildService(client, factory)
      const reminder = createTestReminder({ userId: 'user-99' })

      await service.deliver(reminder)

      const calls = mockChatModel.invoke.mock.calls[0][0] as Array<{
        content: string
      }>
      const userPrompt = calls.find(m => m.content.includes('<@user-99>'))
      expect(userPrompt).toBeDefined()
    })

    it('falls back to a plain string message when LLM fails', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeLlm()
      factory.script('reminder.deliver', new Error('LLM unavailable'))
      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: LlmClient, useValue: factory },
        { provide: RetryService, useValue: createMockRetryService() },
        { provide: TdrBotMetricsService, useValue: createMockMetricsService() },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
      ]).then(m => m.get(ReminderDeliveryService))

      await service.deliver(createTestReminder({ userId: 'user-42' }))

      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('<@user-42>'),
        }),
      )
    })
  })

  // ── deliver to target user ───────────────────────────────────────────────

  describe('deliver to target user', () => {
    it('mentions every target in the LLM prompt', async () => {
      const client = makeDiscordClient([makeMockTextChannel()])
      const { factory, mockChatModel } = makeLlm('Reminder for target!')
      service = await buildService(client, factory)

      await service.deliver(
        createTestReminder({
          userId: 'creator-user',
          targetUserIds: ['target-99', 'target-100'],
        }),
      )

      const calls = mockChatModel.invoke.mock.calls[0][0] as Array<{
        content: string
      }>
      const targetMentionPrompt = calls.find(m =>
        m.content.includes('<@target-99> <@target-100>'),
      )
      expect(targetMentionPrompt).toBeDefined()
    })

    it('falls back to userId mention when there are no targets', async () => {
      const client = makeDiscordClient([makeMockTextChannel()])
      const { factory, mockChatModel } = makeLlm('Reminder!')
      service = await buildService(client, factory)

      await service.deliver(
        createTestReminder({ userId: 'user-42', targetUserIds: [] }),
      )

      const calls = mockChatModel.invoke.mock.calls[0][0] as Array<{
        content: string
      }>
      const userMentionPrompt = calls.find(m =>
        m.content.includes('<@user-42>'),
      )
      expect(userMentionPrompt).toBeDefined()
    })

    it('mentions every target in the fallback message when LLM fails', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeLlm()
      factory.script('reminder.deliver', new Error('LLM unavailable'))
      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: LlmClient, useValue: factory },
        { provide: RetryService, useValue: createMockRetryService() },
        { provide: TdrBotMetricsService, useValue: createMockMetricsService() },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
      ]).then(m => m.get(ReminderDeliveryService))

      await service.deliver(
        createTestReminder({
          userId: 'creator-user',
          targetUserIds: ['target-99', 'target-100'],
        }),
      )

      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('<@target-99> <@target-100>'),
        }),
      )
    })
  })

  // ── deliver (search action) ───────────────────────────────────────────────

  describe('deliver (search action)', () => {
    it('calls TavilySearch with the reminder topic', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeLlm('Here is the weather in Tokyo: sunny!')
      service = await buildService(client, factory)

      await service.deliver(
        createTestReminder({
          actionType: 'search',
          what: 'the weather in tokyo',
        }),
      )

      expect(mockTavilyInvoke).toHaveBeenCalledWith('the weather in tokyo')
    })

    it('sends the LLM-formatted search results to the channel', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeLlm('Tokyo weather: sunny, 22°C!')
      service = await buildService(client, factory)

      await service.deliver(
        createTestReminder({ actionType: 'search', what: 'weather in tokyo' }),
      )

      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Tokyo weather: sunny, 22°C!' }),
      )
    })

    it('truncates the search query to 200 characters', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeLlm('Here is the result')
      service = await buildService(client, factory)

      const longWhat = 'x'.repeat(300)
      await service.deliver(
        createTestReminder({ actionType: 'search', what: longWhat }),
      )

      const invokedWith = mockTavilyInvoke.mock.calls[0][0] as string
      expect(invokedWith.length).toBeLessThanOrEqual(200)
    })

    it('records search_delivery_error failure reason on search delivery failure', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeLlm('Fallback')
      const failingRetry = createMockRetryService()
      failingRetry.executeWithRetry
        .mockRejectedValueOnce(new Error('Tavily error'))
        .mockImplementation(operation => operation())

      const trackedMetrics = createMockMetricsService()
      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: LlmClient, useValue: factory },
        { provide: RetryService, useValue: failingRetry },
        { provide: TdrBotMetricsService, useValue: trackedMetrics },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
      ]).then(m => m.get(ReminderDeliveryService))

      await service.deliver(
        createTestReminder({ actionType: 'search', what: 'weather' }),
      )

      expect(trackedMetrics.reminderFailed).toHaveBeenCalledWith(
        'search_delivery_error',
      )
    })

    it('falls back to default delivery when search fails', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeLlm('Fallback message')
      const failingRetry = createMockRetryService()
      failingRetry.executeWithRetry
        .mockRejectedValueOnce(new Error('Tavily error'))
        .mockImplementation(operation => operation())

      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: LlmClient, useValue: factory },
        { provide: RetryService, useValue: failingRetry },
        { provide: TdrBotMetricsService, useValue: createMockMetricsService() },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
      ]).then(m => m.get(ReminderDeliveryService))

      await service.deliver(
        createTestReminder({ actionType: 'search', what: 'weather' }),
      )

      // Falls back to default, which sends the LLM-generated text
      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.any(String) }),
      )
    })
  })

  // ── deliver (legacy image action) ─────────────────────────────────────────

  describe('deliver (legacy image action)', () => {
    it('delivers a stored image reminder as a plain text reminder', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeLlm('Reminder!')
      service = await buildService(client, factory)

      await service.deliver(
        createTestReminder({ actionType: 'image', what: 'a car' }),
      )

      expect(factory.imageCalls).toHaveLength(0)
      expect(factory.calls.map(c => c.operation)).toEqual(['reminder.deliver'])
      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.any(String) }),
      )
    })
  })

  // ── deliver (math action) ─────────────────────────────────────────────────

  describe('deliver (math action)', () => {
    it('calls reasoning model to generate LaTeX', async () => {
      const client = makeDiscordClient([makeMockTextChannel()])
      const { factory, mockReasoningModel } = makeLlm('Here is an equation!')
      service = await buildService(client, factory)

      await service.deliver(
        createTestReminder({ actionType: 'math', what: 'a calculus equation' }),
      )

      expect(mockReasoningModel.invoke).toHaveBeenCalled()
    })

    it('calls EquationImageService with the generated LaTeX', async () => {
      const client = makeDiscordClient([makeMockTextChannel()])
      const { factory } = makeLlm('Here is your math!')
      const equationService = makeEquationImageServiceMock()
      service = await buildService(client, factory, equationService)

      await service.deliver(
        createTestReminder({ actionType: 'math', what: 'a random integral' }),
      )

      expect(equationService.getImage).toHaveBeenCalled()
    })

    it('sends message with an embed containing the equation image', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeLlm('Here is your daily equation!')
      service = await buildService(client, factory)

      await service.deliver(
        createTestReminder({ actionType: 'math', what: 'a calculus problem' }),
      )

      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Here is your daily equation!',
          embeds: expect.arrayContaining([expect.any(Object)]),
        }),
      )
    })

    it('sends text-only when EquationImageService returns undefined', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeLlm('Here is your math!')
      const equationService = makeEquationImageServiceMock()
      equationService.getImage.mockResolvedValue(undefined)
      service = await buildService(client, factory, equationService)

      await service.deliver(
        createTestReminder({ actionType: 'math', what: 'an equation' }),
      )

      // No embed, just content
      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Here is your math!' }),
      )
      const callArg = sendFn.mock.calls[0][0] as Record<string, unknown>
      expect(callArg.embeds).toBeUndefined()
    })

    it('records math_delivery_error failure reason on math delivery failure', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory, mockReasoningModel } = makeLlm('Fallback')
      mockReasoningModel.invoke.mockReturnValueOnce(
        new Error('Reasoning model error'),
      )

      const trackedMetrics = createMockMetricsService()
      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: LlmClient, useValue: factory },
        { provide: RetryService, useValue: createMockRetryService() },
        { provide: TdrBotMetricsService, useValue: trackedMetrics },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
      ]).then(m => m.get(ReminderDeliveryService))

      await service.deliver(
        createTestReminder({ actionType: 'math', what: 'an equation' }),
      )

      expect(trackedMetrics.reminderFailed).toHaveBeenCalledWith(
        'math_delivery_error',
      )
    })

    it('falls back to default delivery when math delivery fails', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory, mockReasoningModel } = makeLlm('Fallback message')
      mockReasoningModel.invoke.mockReturnValueOnce(
        new Error('Reasoning model error'),
      )

      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: LlmClient, useValue: factory },
        { provide: RetryService, useValue: createMockRetryService() },
        { provide: TdrBotMetricsService, useValue: createMockMetricsService() },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
      ]).then(m => m.get(ReminderDeliveryService))

      await service.deliver(
        createTestReminder({ actionType: 'math', what: 'an equation' }),
      )

      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.any(String) }),
      )
    })
  })

  // ── fire time ─────────────────────────────────────────────────────────────

  describe('fire time', () => {
    it('tells the LLM when the reminder is firing', async () => {
      const client = makeDiscordClient([makeMockTextChannel()])
      const { factory, mockChatModel } = makeLlm()
      service = await buildService(client, factory)

      // 16:00 UTC is 9:00 AM in America/Los_Angeles during PDT
      await service.deliver(
        createTestReminder(),
        new Date('2026-10-09T16:00:00Z'),
      )

      const [, prompt] = mockChatModel.invoke.mock.calls[0][0]
      expect(prompt.content).toContain(
        'It is currently Friday, October 9, 2026 at 9:00 AM.',
      )
    })
  })

  // ── sendTest ──────────────────────────────────────────────────────────────

  describe('sendTest', () => {
    function makeDmClient(dmSend: jest.Mock, channel = makeMockTextChannel()) {
      const client = makeDiscordClient([channel]) as unknown as {
        users: { fetch: jest.Mock }
      }
      client.users = {
        fetch: jest
          .fn()
          .mockResolvedValue({ username: 'creator', send: dmSend }),
      }
      return { client: client as unknown as Client, channel }
    }

    it('DMs the composed message to the creator, not the channel', async () => {
      const dmSend = jest.fn().mockResolvedValue({})
      const { client, channel } = makeDmClient(dmSend)
      const { factory } = makeLlm('Test reminder!')
      service = await buildService(client, factory)

      const result = await service.sendTest(
        createTestReminder({ userId: 'creator-1', targetUserIds: ['t1'] }),
        new Date('2026-10-09T16:00:00Z'),
      )

      expect(result).toEqual({ ok: true })
      expect(client.users.fetch).toHaveBeenCalledWith('creator-1')
      expect(dmSend).toHaveBeenCalledWith({ content: 'Test reminder!' })
      expect(channel.send).not.toHaveBeenCalled()
    })

    it('reports a closed-DM failure with a readable message', async () => {
      const dmSend = jest.fn().mockRejectedValue(new Error('50007'))
      const { client } = makeDmClient(dmSend)
      const { factory } = makeLlm()
      service = await buildService(client, factory)

      const result = await service.sendTest(createTestReminder(), new Date())

      expect(result).toMatchObject({
        ok: false,
        reason: 'dm_failed',
        message: expect.stringContaining('Could not DM creator'),
      })
    })

    it('does not record strategy fallbacks as reminder failures', async () => {
      const dmSend = jest.fn().mockResolvedValue({})
      const { client } = makeDmClient(dmSend)
      const { factory } = makeLlm('Fallback')
      service = await buildService(client, factory)
      retryService.executeWithRetry
        .mockRejectedValueOnce(new Error('Tavily error'))
        .mockImplementation(operation => operation())

      const result = await service.sendTest(
        createTestReminder({ actionType: 'search' }),
        new Date(),
      )

      expect(result).toEqual({ ok: true })
      expect(metrics.reminderFailed).not.toHaveBeenCalled()
      expect(dmSend).toHaveBeenCalledWith({ content: 'Fallback' })
    })
  })

  // ── sendToChannel edge cases ──────────────────────────────────────────────

  describe('sendToChannel edge cases', () => {
    it('truncates messages that exceed DISCORD_MAX_MESSAGE_LENGTH with "..."', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const channel = makeMockTextChannel('tdr-bot-chat', sendFn)
      const client = makeDiscordClient([channel])
      // Generate a message longer than 2000 characters
      const longMessage = 'a'.repeat(2100)
      const { factory } = makeLlm(longMessage)
      service = await buildService(client, factory)

      await service.deliver(createTestReminder())

      const callArg = sendFn.mock.calls[0][0] as { content: string }
      expect(callArg.content.length).toBeLessThanOrEqual(2000)
      expect(callArg.content.endsWith('...')).toBe(true)
    })

    it('does nothing when the reminder has an empty guildId', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const channel = makeMockTextChannel('tdr-bot-chat', sendFn)
      const client = makeDiscordClient([channel])
      const { factory } = makeLlm('Reminder!')
      service = await buildService(client, factory)

      await service.deliver(createTestReminder({ guildId: '' }))

      expect(sendFn).not.toHaveBeenCalled()
    })

    it('uses the cached channel ID on subsequent deliveries to the same guild', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const channel = makeMockTextChannel('tdr-bot-chat', sendFn)
      const guild = {
        id: 'guild-1',
        channels: {
          cache: {
            get: jest
              .fn()
              .mockReturnValue({ ...channel, isTextBased: () => true }),
            find: jest.fn().mockReturnValue(channel),
          },
        },
      }
      const client = {
        guilds: { cache: { get: jest.fn().mockReturnValue(guild) } },
      } as unknown as import('discord.js').Client
      const { factory } = makeLlm('Reminder!')
      service = await buildService(client, factory)

      await service.deliver(createTestReminder())
      await service.deliver(createTestReminder())

      // After the first call, find() populates the cache. The second call
      // should hit cache.get() instead of cache.find().
      expect(guild.channels.cache.find).toHaveBeenCalledTimes(1)
      expect(guild.channels.cache.get).toHaveBeenCalled()
    })
  })

  // ── sendToChannel error handling ──────────────────────────────────────────

  describe('sendToChannel error handling', () => {
    it('records a delivery failure when sending to a channel fails', async () => {
      const channel = makeMockTextChannel('tdr-bot-chat')
      const client = makeDiscordClient([channel])
      const { factory } = makeLlm('Reminder message')

      metrics = createMockMetricsService()
      retryService = createMockRetryService()
      retryService.executeWithRetry.mockRejectedValueOnce(
        new Error('Discord error'),
      ) // for send

      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: LlmClient, useValue: factory },
        { provide: RetryService, useValue: retryService },
        { provide: TdrBotMetricsService, useValue: metrics },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
      ]).then(m => m.get(ReminderDeliveryService))

      const result = await service.deliver(createTestReminder())

      expect(result).toEqual({ ok: false, reason: 'send_error' })
    })

    it('does not throw when the guild is not found', async () => {
      const client = makeDiscordClient([], 'different-guild')
      const { factory } = makeLlm('Reminder message')
      service = await buildService(client, factory)

      // guildId 'guild-1' not in client — should resolve gracefully
      await expect(service.deliver(createTestReminder())).resolves.toEqual({
        ok: false,
        reason: 'guild_not_found',
      })
    })
  })
})
