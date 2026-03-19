import { AIMessage } from '@langchain/core/messages'
import { Client } from 'discord.js'

import {
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { Reminder } from 'src/db/schema'
import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import {
  DALLE_WRAPPER_TOKEN,
  TAVILY_SEARCH_TOKEN,
} from 'src/reminders/reminder.constants'
import { ReminderService } from 'src/reminders/reminder.service'
import { ReminderDeliveryService } from 'src/reminders/reminder-delivery.service'
import { EquationImageService } from 'src/services/equation-image.service'
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

const mockDalleInvoke = jest
  .fn()
  .mockResolvedValue('https://dalle.example.com/image.png')
jest.mock('@langchain/openai', () => ({
  DallEAPIWrapper: jest
    .fn()
    .mockImplementation(() => ({ invoke: mockDalleInvoke })),
}))

// ─── Mock prom-client to avoid duplicate metric registration ─────────────────

jest.mock('prom-client', () => ({
  Counter: jest.fn().mockImplementation(() => ({ inc: jest.fn() })),
  Gauge: jest
    .fn()
    .mockImplementation(() => ({ inc: jest.fn(), dec: jest.fn() })),
  register: {
    getSingleMetric: jest.fn().mockReturnValue(undefined),
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createTestReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'reminder-1',
    userId: 'user-42',
    guildId: 'guild-1',
    what: 'pay the rent',
    isRecurring: false,
    cronExpression: null,
    scheduledAt: new Date(Date.now() + 60_000),
    channelId: null,
    dayDescription: 'tomorrow',
    timeDescription: '9:00 AM',
    actionType: 'default',
    createdAt: new Date(),
    ...overrides,
  }
}

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

function makeModelFactory(responseContent = 'Hey! Reminder time!'): {
  factory: jest.Mocked<ModelFactoryService>
  mockChatModel: { invoke: jest.Mock }
  mockReasoningModel: { invoke: jest.Mock }
} {
  const mockChatModel = {
    invoke: jest.fn().mockResolvedValue(new AIMessage(responseContent)),
  }
  const mockReasoningModel = {
    invoke: jest.fn().mockResolvedValue(new AIMessage('$x^2 + y^2 = z^2$')),
  }
  const factory = {
    createChatModel: jest.fn().mockReturnValue(mockChatModel),
    createReasoningModel: jest.fn().mockReturnValue(mockReasoningModel),
  } as unknown as jest.Mocked<ModelFactoryService>
  return { factory, mockChatModel, mockReasoningModel }
}

function makeReminderServiceMock(): jest.Mocked<ReminderService> {
  return {
    setDeliveryFunction: jest.fn(),
    recordDeliveryFailure: jest.fn(),
    create: jest.fn(),
    listForUser: jest.fn(),
    cancel: jest.fn(),
    deleteAfterDelivery: jest.fn(),
    scheduleReminder: jest.fn(),
    onModuleInit: jest.fn(),
  } as unknown as jest.Mocked<ReminderService>
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
  let reminderService: jest.Mocked<ReminderService>
  let retryService: jest.Mocked<RetryService>

  async function buildService(
    client: Client,
    modelFactory: jest.Mocked<ModelFactoryService>,
    equationImageService: jest.Mocked<EquationImageService> = makeEquationImageServiceMock(),
  ) {
    reminderService = makeReminderServiceMock()
    retryService = createMockRetryService()

    const module = await createTestingModule([
      ReminderDeliveryService,
      { provide: Client, useValue: client },
      { provide: ModelFactoryService, useValue: modelFactory },
      { provide: RetryService, useValue: retryService },
      { provide: ReminderService, useValue: reminderService },
      { provide: EquationImageService, useValue: equationImageService },
      {
        provide: TAVILY_SEARCH_TOKEN,
        useValue: { invoke: mockTavilyInvoke },
      },
      {
        provide: DALLE_WRAPPER_TOKEN,
        useValue: { invoke: mockDalleInvoke },
      },
    ])

    return module.get(ReminderDeliveryService)
  }

  beforeEach(() => {
    mockTavilyInvoke.mockClear()
    mockDalleInvoke.mockClear()
  })

  // ── onModuleInit ────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('registers the deliver method as the delivery function', async () => {
      const { factory } = makeModelFactory()
      const client = makeDiscordClient([])
      service = await buildService(client, factory)

      service.onModuleInit()

      expect(reminderService.setDeliveryFunction).toHaveBeenCalledWith(
        expect.any(Function),
      )
    })

    it('registers a bound function that calls deliver on the service instance', async () => {
      const { factory } = makeModelFactory()
      const channel = makeMockTextChannel()
      const client = makeDiscordClient([channel])
      service = await buildService(client, factory)
      service.onModuleInit()

      const registeredFn = reminderService.setDeliveryFunction.mock
        .calls[0][0] as (r: Reminder) => Promise<void>
      await registeredFn(createTestReminder())

      expect(channel.send).toHaveBeenCalled()
    })
  })

  // ── deliver (default) ────────────────────────────────────────────────────

  describe('deliver (default action)', () => {
    it('sends a message to the tdr-bot-chat channel', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const channel = makeMockTextChannel('tdr-bot-chat', sendFn)
      const client = makeDiscordClient([channel])
      const { factory } = makeModelFactory('Hey, reminder!')
      service = await buildService(client, factory)

      await service.deliver(createTestReminder())

      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Hey, reminder!' }),
      )
    })

    it('skips non-text channels', async () => {
      const nonTextChannel = makeMockTextChannel()
      nonTextChannel.isTextBased.mockReturnValue(false)
      const client = makeDiscordClient([nonTextChannel])
      const { factory } = makeModelFactory()
      service = await buildService(client, factory)

      await expect(service.deliver(createTestReminder())).resolves.not.toThrow()
      expect(nonTextChannel.send).not.toHaveBeenCalled()
    })

    it('does nothing when no matching channels are found', async () => {
      const nonMatchingChannel = makeMockTextChannel('general')
      const client = makeDiscordClient([nonMatchingChannel])
      const { factory } = makeModelFactory()
      service = await buildService(client, factory)

      await expect(service.deliver(createTestReminder())).resolves.not.toThrow()
      expect(nonMatchingChannel.send).not.toHaveBeenCalled()
    })

    it('scopes delivery to the reminder guildId only', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const channel = makeMockTextChannel('tdr-bot-chat', sendFn)
      const client = makeDiscordClient([channel], 'guild-1')
      const { factory } = makeModelFactory('Reminder!')
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
      const { factory, mockChatModel } = makeModelFactory('Reminder text')
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
      const { factory, mockChatModel } = makeModelFactory('Reminder')
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
      const { factory } = makeModelFactory()
      const fallbackRetry = createMockRetryService()
      fallbackRetry.executeWithRetry
        .mockRejectedValueOnce(new Error('LLM unavailable'))
        .mockImplementation(operation => operation())
      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: ModelFactoryService, useValue: factory },
        { provide: RetryService, useValue: fallbackRetry },
        { provide: ReminderService, useValue: makeReminderServiceMock() },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
        {
          provide: DALLE_WRAPPER_TOKEN,
          useValue: { invoke: mockDalleInvoke },
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

  // ── deliver (search action) ───────────────────────────────────────────────

  describe('deliver (search action)', () => {
    it('calls TavilySearch with the reminder topic', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeModelFactory(
        'Here is the weather in Tokyo: sunny!',
      )
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
      const { factory } = makeModelFactory('Tokyo weather: sunny, 22°C!')
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
      const { factory } = makeModelFactory('Here is the result')
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
      const { factory } = makeModelFactory('Fallback')
      const failingRetry = createMockRetryService()
      failingRetry.executeWithRetry
        .mockRejectedValueOnce(new Error('Tavily error'))
        .mockImplementation(operation => operation())

      const trackedReminderService = makeReminderServiceMock()
      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: ModelFactoryService, useValue: factory },
        { provide: RetryService, useValue: failingRetry },
        { provide: ReminderService, useValue: trackedReminderService },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
        { provide: DALLE_WRAPPER_TOKEN, useValue: { invoke: mockDalleInvoke } },
      ]).then(m => m.get(ReminderDeliveryService))

      await service.deliver(
        createTestReminder({ actionType: 'search', what: 'weather' }),
      )

      expect(trackedReminderService.recordDeliveryFailure).toHaveBeenCalledWith(
        'search_delivery_error',
      )
    })

    it('falls back to default delivery when search fails', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeModelFactory('Fallback message')
      const failingRetry = createMockRetryService()
      failingRetry.executeWithRetry
        .mockRejectedValueOnce(new Error('Tavily error'))
        .mockImplementation(operation => operation())

      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: ModelFactoryService, useValue: factory },
        { provide: RetryService, useValue: failingRetry },
        { provide: ReminderService, useValue: makeReminderServiceMock() },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
        {
          provide: DALLE_WRAPPER_TOKEN,
          useValue: { invoke: mockDalleInvoke },
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

  // ── deliver (image action) ────────────────────────────────────────────────

  describe('deliver (image action)', () => {
    it('calls DallEAPIWrapper with the reminder topic', async () => {
      const client = makeDiscordClient([makeMockTextChannel()])
      const { factory } = makeModelFactory('Here is your image!')
      service = await buildService(client, factory)

      await service.deliver(
        createTestReminder({
          actionType: 'image',
          what: 'a random image of a honda or porsche',
        }),
      )

      expect(mockDalleInvoke).toHaveBeenCalledWith(
        'Generate an image of: a random image of a honda or porsche',
      )
    })

    it('sends message with an embed containing the generated image', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeModelFactory('Check out this car!')
      service = await buildService(client, factory)

      await service.deliver(
        createTestReminder({ actionType: 'image', what: 'a porsche' }),
      )

      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Check out this car!',
          embeds: expect.arrayContaining([expect.any(Object)]),
        }),
      )
    })

    it('strips HTML-like tags from the DALL-E prompt', async () => {
      const client = makeDiscordClient([makeMockTextChannel()])
      const { factory } = makeModelFactory('Image!')
      service = await buildService(client, factory)

      await service.deliver(
        createTestReminder({
          actionType: 'image',
          what: '<script>evil</script> a porsche',
        }),
      )

      const invokedWith = mockDalleInvoke.mock.calls[0][0] as string
      expect(invokedWith).not.toContain('<script>')
      expect(invokedWith).not.toContain('</script>')
    })

    it('records image_delivery_error failure reason on image delivery failure', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeModelFactory('Fallback')
      const failingRetry = createMockRetryService()
      failingRetry.executeWithRetry
        .mockRejectedValueOnce(new Error('DALL-E error'))
        .mockImplementation(operation => operation())

      const trackedReminderService = makeReminderServiceMock()
      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: ModelFactoryService, useValue: factory },
        { provide: RetryService, useValue: failingRetry },
        { provide: ReminderService, useValue: trackedReminderService },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
        { provide: DALLE_WRAPPER_TOKEN, useValue: { invoke: mockDalleInvoke } },
      ]).then(m => m.get(ReminderDeliveryService))

      await service.deliver(
        createTestReminder({ actionType: 'image', what: 'a car' }),
      )

      expect(trackedReminderService.recordDeliveryFailure).toHaveBeenCalledWith(
        'image_delivery_error',
      )
    })

    it('falls back to default delivery when image generation fails', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeModelFactory('Fallback message')
      const failingRetry = createMockRetryService()
      failingRetry.executeWithRetry
        .mockRejectedValueOnce(new Error('DALL-E error'))
        .mockImplementation(operation => operation())

      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: ModelFactoryService, useValue: factory },
        { provide: RetryService, useValue: failingRetry },
        { provide: ReminderService, useValue: makeReminderServiceMock() },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
        {
          provide: DALLE_WRAPPER_TOKEN,
          useValue: { invoke: mockDalleInvoke },
        },
      ]).then(m => m.get(ReminderDeliveryService))

      await service.deliver(
        createTestReminder({ actionType: 'image', what: 'a car' }),
      )

      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.any(String) }),
      )
    })
  })

  // ── deliver (math action) ─────────────────────────────────────────────────

  describe('deliver (math action)', () => {
    it('calls reasoning model to generate LaTeX', async () => {
      const client = makeDiscordClient([makeMockTextChannel()])
      const { factory, mockReasoningModel } = makeModelFactory(
        'Here is an equation!',
      )
      service = await buildService(client, factory)

      await service.deliver(
        createTestReminder({ actionType: 'math', what: 'a calculus equation' }),
      )

      expect(mockReasoningModel.invoke).toHaveBeenCalled()
    })

    it('calls EquationImageService with the generated LaTeX', async () => {
      const client = makeDiscordClient([makeMockTextChannel()])
      const { factory } = makeModelFactory('Here is your math!')
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
      const { factory } = makeModelFactory('Here is your daily equation!')
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
      const { factory } = makeModelFactory('Here is your math!')
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
      const { factory } = makeModelFactory('Fallback')
      const failingRetry = createMockRetryService()
      failingRetry.executeWithRetry
        .mockRejectedValueOnce(new Error('Reasoning model error'))
        .mockImplementation(operation => operation())

      const trackedReminderService = makeReminderServiceMock()
      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: ModelFactoryService, useValue: factory },
        { provide: RetryService, useValue: failingRetry },
        { provide: ReminderService, useValue: trackedReminderService },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
        { provide: DALLE_WRAPPER_TOKEN, useValue: { invoke: mockDalleInvoke } },
      ]).then(m => m.get(ReminderDeliveryService))

      await service.deliver(
        createTestReminder({ actionType: 'math', what: 'an equation' }),
      )

      expect(trackedReminderService.recordDeliveryFailure).toHaveBeenCalledWith(
        'math_delivery_error',
      )
    })

    it('falls back to default delivery when math delivery fails', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const client = makeDiscordClient([
        makeMockTextChannel('tdr-bot-chat', sendFn),
      ])
      const { factory } = makeModelFactory('Fallback message')
      const failingRetry = createMockRetryService()
      failingRetry.executeWithRetry
        .mockRejectedValueOnce(new Error('Reasoning model error'))
        .mockImplementation(operation => operation())

      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: ModelFactoryService, useValue: factory },
        { provide: RetryService, useValue: failingRetry },
        { provide: ReminderService, useValue: makeReminderServiceMock() },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
        {
          provide: DALLE_WRAPPER_TOKEN,
          useValue: { invoke: mockDalleInvoke },
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

  // ── sendToChannel edge cases ──────────────────────────────────────────────

  describe('sendToChannel edge cases', () => {
    it('truncates messages that exceed DISCORD_MAX_MESSAGE_LENGTH with "..."', async () => {
      const sendFn = jest.fn().mockResolvedValue({})
      const channel = makeMockTextChannel('tdr-bot-chat', sendFn)
      const client = makeDiscordClient([channel])
      // Generate a message longer than 2000 characters
      const longMessage = 'a'.repeat(2100)
      const { factory } = makeModelFactory(longMessage)
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
      const { factory } = makeModelFactory('Reminder!')
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
      const { factory } = makeModelFactory('Reminder!')
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
      const { factory } = makeModelFactory('Reminder message')

      reminderService = makeReminderServiceMock()
      retryService = createMockRetryService()
      retryService.executeWithRetry
        .mockResolvedValueOnce(new AIMessage('Reminder message')) // for generate
        .mockRejectedValueOnce(new Error('Discord error')) // for send

      service = await createTestingModule([
        ReminderDeliveryService,
        { provide: Client, useValue: client },
        { provide: ModelFactoryService, useValue: factory },
        { provide: RetryService, useValue: retryService },
        { provide: ReminderService, useValue: reminderService },
        {
          provide: EquationImageService,
          useValue: makeEquationImageServiceMock(),
        },
        {
          provide: TAVILY_SEARCH_TOKEN,
          useValue: { invoke: mockTavilyInvoke },
        },
        {
          provide: DALLE_WRAPPER_TOKEN,
          useValue: { invoke: mockDalleInvoke },
        },
      ]).then(m => m.get(ReminderDeliveryService))

      await service.deliver(createTestReminder())

      expect(reminderService.recordDeliveryFailure).toHaveBeenCalledWith(
        'send_error',
      )
    })

    it('does not throw when the guild is not found', async () => {
      const client = makeDiscordClient([], 'different-guild')
      const { factory } = makeModelFactory('Reminder message')
      service = await buildService(client, factory)

      // guildId 'guild-1' not in client — should resolve gracefully
      await expect(service.deliver(createTestReminder())).resolves.not.toThrow()
    })
  })
})
