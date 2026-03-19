import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages'

import {
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { Reminder } from 'src/db/schema'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { ReminderResponseNode } from 'src/messages/llm/nodes/reminder-response.node'
import { PromptService } from 'src/messages/prompts/prompt.service'
import { ReminderService } from 'src/reminders/reminder.service'
import { ResponseType } from 'src/schemas/graph'
import { RetryService } from 'src/utils/retry.service'

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

function makeExtractionJson(overrides: Record<string, unknown> = {}): string {
  const base = {
    action: 'create',
    what: 'pay rent',
    isRecurring: false,
    day: 'tomorrow',
    time: '9:00 AM',
    recurringPattern: null,
    scheduledAt: '2026-03-18T09:00:00',
    cronExpression: null,
    reminderIdToCancel: null,
    channelId: null,
    actionType: 'default',
  }
  return JSON.stringify({ ...base, ...overrides })
}

function makeListExtractionJson(): string {
  return JSON.stringify({
    action: 'list',
    what: null,
    isRecurring: null,
    day: null,
    time: null,
    recurringPattern: null,
    scheduledAt: null,
    cronExpression: null,
    reminderIdToCancel: null,
    channelId: null,
    actionType: 'default',
  })
}

function makeCancelExtractionJson(what: string): string {
  return JSON.stringify({
    action: 'cancel',
    what,
    isRecurring: null,
    day: null,
    time: null,
    recurringPattern: null,
    scheduledAt: null,
    cronExpression: null,
    reminderIdToCancel: null,
    channelId: null,
    actionType: 'default',
  })
}

function createTestReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'reminder-1',
    userId: 'user-1',
    guildId: 'guild-1',
    what: 'pay rent',
    isRecurring: false,
    cronExpression: null,
    scheduledAt: new Date('2026-03-18T09:00:00'),
    dayDescription: 'tomorrow',
    timeDescription: '9:00 AM',
    channelId: null,
    actionType: 'default',
    createdAt: new Date(),
    ...overrides,
  }
}

function buildState(
  userInput = 'remind me about something',
  userId = 'user-1',
  guildId = 'guild-1',
) {
  return {
    userInput,
    userId,
    guildId,
    messages: [],
    images: [],
    message: new HumanMessage({ content: userInput }),
    responseType: ResponseType.Default,
  }
}

function makeModelFactory(chatResponse = 'Done!', reasoningResponse?: string) {
  const reasoningContent = reasoningResponse ?? makeExtractionJson()
  const chatModel = {
    invoke: jest.fn().mockResolvedValue(new AIMessage(chatResponse)),
  }
  const reasoningModel = {
    invoke: jest.fn().mockResolvedValue(new AIMessage(reasoningContent)),
  }
  return {
    factory: {
      createChatModel: jest.fn().mockReturnValue(chatModel),
      createReasoningModel: jest.fn().mockReturnValue(reasoningModel),
    } as unknown as jest.Mocked<ModelFactoryService>,
    chatModel,
    reasoningModel,
  }
}

function makeContextService(
  existingContextType: string | null = null,
  existingContext: unknown = null,
): jest.Mocked<ContextManagementService> {
  return {
    getContext: jest.fn().mockResolvedValue(existingContext),
    getContextType: jest.fn().mockResolvedValue(existingContextType),
    setContext: jest.fn().mockResolvedValue(undefined),
    clearContext: jest.fn().mockResolvedValue(true),
    hasContext: jest.fn().mockResolvedValue(existingContextType !== null),
  } as unknown as jest.Mocked<ContextManagementService>
}

function makeReminderService(
  reminders: Reminder[] = [],
  createdReminder?: Reminder,
): jest.Mocked<ReminderService> {
  const created = createdReminder ?? reminders[0] ?? createTestReminder()
  return {
    create: jest.fn().mockResolvedValue(created),
    listForUser: jest.fn().mockResolvedValue(reminders),
    cancel: jest.fn().mockResolvedValue(true),
    setDeliveryFunction: jest.fn(),
    recordDeliveryFailure: jest.fn(),
    onModuleInit: jest.fn(),
  } as unknown as jest.Mocked<ReminderService>
}

function makePromptService(): jest.Mocked<PromptService> {
  return {
    getSystemPrompt: jest
      .fn()
      .mockReturnValue(
        new SystemMessage({ id: 'tdr-system-prompt', content: 'Test prompt' }),
      ),
  } as unknown as jest.Mocked<PromptService>
}

async function buildNode(
  factory: jest.Mocked<ModelFactoryService>,
  contextService: jest.Mocked<ContextManagementService>,
  reminderService: jest.Mocked<ReminderService>,
  promptService?: jest.Mocked<PromptService>,
) {
  const retryService = createMockRetryService()
  const module = await createTestingModule([
    ReminderResponseNode,
    { provide: ModelFactoryService, useValue: factory },
    { provide: RetryService, useValue: retryService },
    { provide: ContextManagementService, useValue: contextService },
    { provide: ReminderService, useValue: reminderService },
    { provide: PromptService, useValue: promptService ?? makePromptService() },
  ])
  return module.get(ReminderResponseNode)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ReminderResponseNode', () => {
  // ── list action ──────────────────────────────────────────────────────────

  describe('when action is "list"', () => {
    it('calls listForUser with the current userId', async () => {
      const { factory, reasoningModel } = makeModelFactory(
        'Here are your reminders',
      )
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeListExtractionJson()),
      )
      const reminderService = makeReminderService([createTestReminder()])
      const contextService = makeContextService()
      const node = await buildNode(factory, contextService, reminderService)

      await node.invoke(buildState('show me my reminders', 'user-42'))

      expect(reminderService.listForUser).toHaveBeenCalledWith('user-42')
    })

    it('returns messages with the AI response', async () => {
      const { factory, reasoningModel } = makeModelFactory(
        'You have 1 reminder',
      )
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeListExtractionJson()),
      )
      const node = await buildNode(
        factory,
        makeContextService(),
        makeReminderService(),
      )

      const result = await node.invoke(buildState('list reminders'))

      expect(result.messages).toHaveLength(2)
      expect((result.messages![1] as AIMessage).content).toBe(
        'You have 1 reminder',
      )
    })

    it('returns an empty-list message when user has no reminders', async () => {
      const { factory, reasoningModel } = makeModelFactory(
        'No reminders found!',
      )
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeListExtractionJson()),
      )
      const node = await buildNode(
        factory,
        makeContextService(),
        makeReminderService([]),
      )

      const result = await node.invoke(buildState('show reminders'))

      const lastMessage = result.messages![1] as AIMessage
      expect(lastMessage.content).toBe('No reminders found!')
    })
  })

  // ── cancel action ────────────────────────────────────────────────────────

  describe('when action is "cancel"', () => {
    it('cancels the matching reminder', async () => {
      const reminder = createTestReminder({ what: 'dentist appointment' })
      const { factory, reasoningModel } = makeModelFactory('Cancelled!')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeCancelExtractionJson('dentist')),
      )
      const reminderService = makeReminderService([reminder])
      const contextService = makeContextService()
      const node = await buildNode(factory, contextService, reminderService)

      await node.invoke(buildState('cancel dentist reminder'))

      expect(reminderService.cancel).toHaveBeenCalledWith(reminder.id, 'user-1')
    })

    it('does not cancel when no matching reminder is found', async () => {
      const { factory, reasoningModel } = makeModelFactory('No match found.')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeCancelExtractionJson('gym')),
      )
      const reminderService = makeReminderService([
        createTestReminder({ what: 'dentist appointment' }),
      ])
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(buildState('cancel gym reminder'))

      expect(reminderService.cancel).not.toHaveBeenCalled()
    })

    it('returns an AI response for the cancel result', async () => {
      const { factory, reasoningModel } = makeModelFactory(
        'Reminder cancelled!',
      )
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeCancelExtractionJson('dentist')),
      )
      const reminder = createTestReminder({ what: 'dentist' })
      const node = await buildNode(
        factory,
        makeContextService(),
        makeReminderService([reminder]),
      )

      const result = await node.invoke(buildState('cancel dentist'))

      expect((result.messages![1] as AIMessage).content).toBe(
        'Reminder cancelled!',
      )
    })

    it('does case-insensitive matching for reminder search', async () => {
      const reminder = createTestReminder({ what: 'Dentist Appointment' })
      const { factory, reasoningModel } = makeModelFactory('Cancelled!')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeCancelExtractionJson('dentist')),
      )
      const reminderService = makeReminderService([reminder])
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(buildState('cancel dentist'))

      expect(reminderService.cancel).toHaveBeenCalledWith(reminder.id, 'user-1')
    })

    it('prompts user to specify which reminder when cancel extraction.what is null', async () => {
      const { factory, reasoningModel, chatModel } = makeModelFactory(
        'Please specify which reminder to cancel.',
      )
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeCancelExtractionJson('')),
      )
      const existingReminders = [
        createTestReminder({ id: 'r1', what: 'dentist appointment' }),
        createTestReminder({ id: 'r2', what: 'pay rent' }),
      ]
      const reminderService = makeReminderService(existingReminders)
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(buildState('cancel a reminder'))

      // The cancel prompt data message should mention the available reminders
      const calls = chatModel.invoke.mock.calls[0][0] as Array<{
        content: string
      }>
      const dataMessage = calls.find(
        m =>
          m.content.includes('dentist appointment') ||
          m.content.includes('pay rent'),
      )
      expect(dataMessage).toBeDefined()
      expect(reminderService.cancel).not.toHaveBeenCalled()
    })

    it('does not cancel when multiple reminders match the search term', async () => {
      const reminder1 = createTestReminder({
        id: 'r1',
        what: 'dentist appointment',
      })
      const reminder2 = createTestReminder({
        id: 'r2',
        what: 'dentist cleaning',
      })
      const { factory, reasoningModel } = makeModelFactory('Multiple matches!')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeCancelExtractionJson('dentist')),
      )
      const reminderService = makeReminderService([reminder1, reminder2])
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(buildState('cancel dentist reminder'))

      expect(reminderService.cancel).not.toHaveBeenCalled()
    })
  })

  // ── create action — complete information ──────────────────────────────────

  describe('when action is "create" with complete information', () => {
    it('passes the correct fields to ReminderService.create', async () => {
      const { factory, reasoningModel } = makeModelFactory('Done!')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            what: 'buy groceries',
            isRecurring: false,
            day: 'tomorrow',
            time: '10:00 AM',
            scheduledAt: '2026-03-18T10:00:00',
          }),
        ),
      )
      const reminderService = makeReminderService()
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(
        buildState('remind me to buy groceries tomorrow at 10am', 'user-7'),
      )

      expect(reminderService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-7',
          what: 'buy groceries',
          isRecurring: false,
          dayDescription: 'tomorrow',
          timeDescription: '10:00 AM',
          actionType: 'default',
        }),
      )
    })

    it('passes actionType "search" when LLM extracts a search reminder', async () => {
      const { factory, reasoningModel } = makeModelFactory('Got it!')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            what: 'the weather in tokyo',
            isRecurring: true,
            day: 'today',
            cronExpression: '*/5 * * * *',
            scheduledAt: null,
            actionType: 'search',
          }),
        ),
      )
      const reminderService = makeReminderService(
        [],
        createTestReminder({ actionType: 'search' }),
      )
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(
        buildState('every 5 minutes tell me the weather in tokyo'),
      )

      expect(reminderService.create).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'search' }),
      )
    })

    it('passes actionType "image" when LLM extracts an image reminder', async () => {
      const { factory, reasoningModel } = makeModelFactory('Got it!')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            what: 'a random image of a honda or porsche',
            isRecurring: true,
            day: 'today',
            cronExpression: '*/10 * * * *',
            scheduledAt: null,
            actionType: 'image',
          }),
        ),
      )
      const reminderService = makeReminderService(
        [],
        createTestReminder({ actionType: 'image' }),
      )
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(
        buildState(
          'every 10 minutes generate a random image of a honda or porsche',
        ),
      )

      expect(reminderService.create).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'image' }),
      )
    })

    it('passes actionType "math" when LLM extracts a math reminder', async () => {
      const { factory, reasoningModel } = makeModelFactory('Got it!')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            what: 'a random calculus equation',
            isRecurring: true,
            day: 'every day',
            cronExpression: '0 9 * * *',
            scheduledAt: null,
            actionType: 'math',
          }),
        ),
      )
      const reminderService = makeReminderService(
        [],
        createTestReminder({ actionType: 'math' }),
      )
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(
        buildState('every day show me a random calculus equation'),
      )

      expect(reminderService.create).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'math' }),
      )
    })

    it('sets cronExpression for recurring reminders', async () => {
      const { factory, reasoningModel } = makeModelFactory('Done!')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            what: 'I am cool',
            isRecurring: true,
            day: 'every Tuesday',
            cronExpression: '0 9 * * 2',
            scheduledAt: null,
          }),
        ),
      )
      const reminderService = makeReminderService()
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(buildState('remind me every Tuesday that I am cool'))

      expect(reminderService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isRecurring: true,
          cronExpression: '0 9 * * 2',
          scheduledAt: null,
        }),
      )
    })

    it('clears any existing reminder context after successful creation', async () => {
      const { factory } = makeModelFactory('Done!')
      const contextService = makeContextService('reminder', {
        partialExtraction: { what: 'pay rent' },
      })
      const node = await buildNode(
        factory,
        contextService,
        makeReminderService(),
      )

      await node.invoke(buildState('tomorrow at 9am'))

      expect(contextService.clearContext).toHaveBeenCalledWith('user-1')
    })

    it('returns messages with a confirmation AI response', async () => {
      const { factory } = makeModelFactory('Got it! Reminder set for tomorrow.')
      const node = await buildNode(
        factory,
        makeContextService(),
        makeReminderService(),
      )

      const result = await node.invoke(
        buildState('remind me to call mom tomorrow'),
      )

      expect((result.messages![1] as AIMessage).content).toBe(
        'Got it! Reminder set for tomorrow.',
      )
    })
  })

  // ── create action — missing fields ────────────────────────────────────────

  describe('when action is "create" with missing fields', () => {
    it('stores partial context when "what" is missing', async () => {
      const { factory, reasoningModel } = makeModelFactory(
        'What do you want to be reminded about?',
      )
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            what: null,
            day: 'tomorrow',
            scheduledAt: null,
          }),
        ),
      )
      const contextService = makeContextService()
      const node = await buildNode(
        factory,
        contextService,
        makeReminderService(),
      )

      await node.invoke(buildState('remind me tomorrow'))

      expect(contextService.setContext).toHaveBeenCalledWith(
        'user-1',
        'reminder',
        expect.objectContaining({
          partialExtraction: expect.objectContaining({ day: 'tomorrow' }),
        }),
      )
    })

    it('stores partial context when "day" is missing', async () => {
      const { factory, reasoningModel } = makeModelFactory(
        'When should I remind you?',
      )
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            what: 'call mom',
            day: null,
            scheduledAt: null,
          }),
        ),
      )
      const contextService = makeContextService()
      const node = await buildNode(
        factory,
        contextService,
        makeReminderService(),
      )

      await node.invoke(buildState('remind me to call mom'))

      expect(contextService.setContext).toHaveBeenCalledWith(
        'user-1',
        'reminder',
        expect.objectContaining({
          partialExtraction: expect.objectContaining({ what: 'call mom' }),
        }),
      )
    })

    it('does not create the reminder when fields are missing', async () => {
      const { factory, reasoningModel } = makeModelFactory(
        'When should I remind you?',
      )
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            what: 'call mom',
            day: null,
            scheduledAt: null,
          }),
        ),
      )
      const reminderService = makeReminderService()
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(buildState('remind me to call mom'))

      expect(reminderService.create).not.toHaveBeenCalled()
    })

    it('returns a question asking for the missing field', async () => {
      const { factory, reasoningModel } = makeModelFactory(
        'When should I remind you?',
      )
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            what: 'call mom',
            day: null,
            scheduledAt: null,
          }),
        ),
      )
      const node = await buildNode(
        factory,
        makeContextService(),
        makeReminderService(),
      )

      const result = await node.invoke(buildState('remind me to call mom'))

      expect((result.messages![1] as AIMessage).content).toBe(
        'When should I remind you?',
      )
    })
  })

  // ── context merging ───────────────────────────────────────────────────────

  describe('context merging', () => {
    it('merges new extraction with existing partial context', async () => {
      const { factory, reasoningModel } = makeModelFactory('Done!')
      // Current message provides the day (previously missing)
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            what: null,
            day: 'tomorrow',
            scheduledAt: '2026-03-18T09:00:00',
          }),
        ),
      )
      // Existing context has the "what" from a prior message
      const contextService = makeContextService('reminder', {
        timestamp: Date.now(),
        isActive: true,
        partialExtraction: { what: 'pay rent' },
      })
      const reminderService = makeReminderService()
      const node = await buildNode(factory, contextService, reminderService)

      await node.invoke(buildState('tomorrow'))

      // Merged: what from context + day from current extraction → complete → creates
      expect(reminderService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          what: 'pay rent',
          dayDescription: 'tomorrow',
        }),
      )
    })

    it('does not overwrite existing context values with null', async () => {
      const { factory, reasoningModel } = makeModelFactory('Done!')
      // New extraction has null for "day", but existing context has it
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            what: 'pay rent',
            day: null,
            time: null,
            scheduledAt: null,
          }),
        ),
      )
      const contextService = makeContextService('reminder', {
        timestamp: Date.now(),
        isActive: true,
        partialExtraction: { what: 'pay rent', day: 'tomorrow' },
      })
      const reminderService = makeReminderService()
      const node = await buildNode(factory, contextService, reminderService)

      await node.invoke(buildState('pay rent'))

      // "day" from existing context should be preserved
      expect(reminderService.create).toHaveBeenCalledWith(
        expect.objectContaining({ dayDescription: 'tomorrow' }),
      )
    })
  })

  // ── extractReminderInfo ───────────────────────────────────────────────────

  describe('extractReminderInfo', () => {
    it('calls the reasoning model to extract reminder info', async () => {
      const { factory, reasoningModel } = makeModelFactory()
      const node = await buildNode(
        factory,
        makeContextService(),
        makeReminderService(),
      )

      await node.invoke(buildState('remind me to do something tomorrow'))

      expect(reasoningModel.invoke).toHaveBeenCalled()
    })

    it('parses JSON embedded in the model response', async () => {
      const { factory, reasoningModel } = makeModelFactory()
      // Model wraps JSON in extra text (common with reasoning models)
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          `Here is the extraction:\n${makeExtractionJson()}\nThat's it.`,
        ),
      )
      const reminderService = makeReminderService()
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(buildState('remind me about something tomorrow'))

      expect(reminderService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          what: 'pay rent',
          dayDescription: 'tomorrow',
        }),
      )
    })
  })

  // ── getMissingFields ──────────────────────────────────────────────────────

  describe('getMissingFields', () => {
    it('reports both "what" and "day" as missing when both are absent', async () => {
      const { factory, reasoningModel } = makeModelFactory('What do you need?')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({ what: null, day: null, scheduledAt: null }),
        ),
      )
      const contextService = makeContextService()
      const reminderService = makeReminderService()
      const node = await buildNode(factory, contextService, reminderService)

      await node.invoke(buildState('set a reminder'))

      // Both fields are missing; context is saved to ask for them, and create is NOT called
      expect(contextService.setContext).toHaveBeenCalledWith(
        'user-1',
        'reminder',
        expect.objectContaining({
          isActive: true,
          partialExtraction: expect.not.objectContaining({
            what: expect.any(String),
            day: expect.any(String),
          }),
        }),
      )
      expect(reminderService.create).not.toHaveBeenCalled()
    })
  })

  // ── list cap ─────────────────────────────────────────────────────────────

  describe('list cap at 25', () => {
    it('passes at most 25 reminders to the LLM for display', async () => {
      const { factory, reasoningModel, chatModel } = makeModelFactory(
        'Here are your reminders',
      )
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeListExtractionJson()),
      )

      const manyReminders = Array.from({ length: 30 }, (_, i) =>
        createTestReminder({ id: `r${i}`, what: `reminder ${i}` }),
      )
      const reminderService = makeReminderService(manyReminders)
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(buildState('show all my reminders', 'user-1'))

      // The data passed to the chat model should only contain 25 entries
      const dataArg = chatModel.invoke.mock.calls[0][0] as Array<{
        content: string
      }>
      const dataMessage = dataArg.find(m => {
        try {
          const parsed = JSON.parse(m.content) as unknown[]
          return Array.isArray(parsed)
        } catch {
          return false
        }
      })
      expect(dataMessage).toBeDefined()
      const parsed = JSON.parse(dataMessage!.content) as unknown[]
      expect(parsed).toHaveLength(25)
    })
  })

  // ── recurring reminder defaults ────────────────────────────────────────────

  describe('recurring reminder defaults', () => {
    it('defaults timeDescription to "9:00 AM" for recurring reminders without a time', async () => {
      const { factory, reasoningModel } = makeModelFactory('Done!')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            what: 'exercise',
            isRecurring: true,
            day: 'every day',
            time: null,
            cronExpression: '0 9 * * *',
            scheduledAt: null,
          }),
        ),
      )
      const reminderService = makeReminderService()
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(buildState('remind me to exercise every day'))

      expect(reminderService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isRecurring: true,
          timeDescription: '9:00 AM',
        }),
      )
    })
  })

  // ── confirm message action labels ──────────────────────────────────────────

  describe('generateConfirmMessage action labels', () => {
    it.each([
      ['search', 'search for'],
      ['image', 'generate an image of'],
      ['math', 'show a math equation about'],
    ])(
      'includes "%s" action label in the confirm prompt for actionType "%s"',
      async (actionType, expectedLabel) => {
        const { factory, reasoningModel, chatModel } = makeModelFactory('Done!')
        reasoningModel.invoke.mockResolvedValue(
          new AIMessage(
            makeExtractionJson({
              what: 'the weather in tokyo',
              actionType,
              isRecurring: false,
              day: 'tomorrow',
              scheduledAt: '2026-03-18T09:00:00',
            }),
          ),
        )
        const reminderService = makeReminderService(
          [],
          createTestReminder({ actionType }),
        )
        const node = await buildNode(
          factory,
          makeContextService(),
          reminderService,
        )

        await node.invoke(buildState('remind me about something'))

        // The confirm prompt passed to the chat model should include the label
        const calls = chatModel.invoke.mock.calls[0][0] as Array<{
          content: string
        }>
        const hasLabel = calls.some(m => m.content.includes(expectedLabel))
        expect(hasLabel).toBe(true)
      },
    )
  })

  // ── edge cases ──────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('throws when the reasoning model returns no JSON', async () => {
      const { factory, reasoningModel } = makeModelFactory()
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage('I cannot extract any reminder information from this.'),
      )
      const node = await buildNode(
        factory,
        makeContextService(),
        makeReminderService(),
      )

      await expect(
        node.invoke(buildState('remind me about something')),
      ).rejects.toThrow('No JSON found')
    })

    it('throws when the reasoning model returns malformed JSON', async () => {
      const { factory, reasoningModel } = makeModelFactory()
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage('{"action": "create", "what": '),
      )
      const node = await buildNode(
        factory,
        makeContextService(),
        makeReminderService(),
      )

      await expect(
        node.invoke(buildState('remind me about something')),
      ).rejects.toThrow()
    })

    it('stores partial context and prompts for missing fields when what is absent after merge', async () => {
      const { factory, reasoningModel } = makeModelFactory()
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(
          makeExtractionJson({
            action: 'create',
            what: null,
            day: null,
            scheduledAt: null,
          }),
        ),
      )
      const contextService = makeContextService('reminder', {
        timestamp: Date.now(),
        isActive: true,
        partialExtraction: { day: 'tomorrow' },
      })
      const node = await buildNode(
        factory,
        contextService,
        makeReminderService(),
      )

      await node.invoke(buildState('tomorrow'))

      expect(contextService.setContext).toHaveBeenCalled()
    })
  })

  // ── error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('propagates when the reasoning model throws during extraction', async () => {
      const { factory, reasoningModel } = makeModelFactory('Done!')
      reasoningModel.invoke.mockRejectedValue(new Error('OpenAI unavailable'))
      const node = await buildNode(
        factory,
        makeContextService(),
        makeReminderService(),
      )

      await expect(
        node.invoke(buildState('remind me to pay rent tomorrow')),
      ).rejects.toThrow('OpenAI unavailable')
    })

    it('propagates when reminderService.create rejects', async () => {
      const { factory } = makeModelFactory('Done!')
      const reminderService = makeReminderService()
      reminderService.create.mockRejectedValue(new Error('DB connection lost'))
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await expect(
        node.invoke(buildState('remind me to pay rent tomorrow')),
      ).rejects.toThrow('DB connection lost')
    })

    it('propagates when reminderService.listForUser rejects', async () => {
      const { factory, reasoningModel } = makeModelFactory('Done!')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeListExtractionJson()),
      )
      const reminderService = makeReminderService()
      reminderService.listForUser.mockRejectedValue(new Error('DB timeout'))
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await expect(
        node.invoke(buildState('show my reminders')),
      ).rejects.toThrow('DB timeout')
    })

    it('propagates when reminderService.cancel rejects', async () => {
      const { factory, reasoningModel } = makeModelFactory('Done!')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeCancelExtractionJson('dentist')),
      )
      const reminder = createTestReminder({ what: 'dentist appointment' })
      const reminderService = makeReminderService([reminder])
      reminderService.cancel.mockRejectedValue(new Error('DB write failed'))
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await expect(
        node.invoke(buildState('cancel dentist reminder')),
      ).rejects.toThrow('DB write failed')
    })

    it('does not cancel when extraction.what is null', async () => {
      const { factory, reasoningModel } = makeModelFactory('No match found.')
      reasoningModel.invoke.mockResolvedValue(
        new AIMessage(makeCancelExtractionJson('')),
      )
      const reminder = createTestReminder({ what: 'dentist appointment' })
      const reminderService = makeReminderService([reminder])
      const node = await buildNode(
        factory,
        makeContextService(),
        reminderService,
      )

      await node.invoke(buildState('cancel reminder'))

      expect(reminderService.cancel).not.toHaveBeenCalled()
    })
  })
})
