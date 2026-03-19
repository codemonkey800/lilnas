/**
 * Integration tests for LLMOrchestrationService.
 *
 * Tests the full stack: LLMOrchestrationService + real node implementations
 * (IntentDetectionNode, DefaultResponseNode, etc.) + PromptService + ModelFactoryService
 * + the real compiled LangGraph StateGraph.
 *
 * Only external API clients (ChatOpenAI, DallEAPIWrapper, TavilySearchResults)
 * and I/O services (EquationImageService, MediaRequestHandler) are mocked.
 */

// Unmock LangGraph so the real StateGraph compiles and routes through the graph.
// This overrides the global mock in setup.ts for this file only.
jest.unmock('@langchain/langgraph')
jest.unmock('@langchain/langgraph/prebuilt')

jest.mock('@langchain/openai')
jest.mock('@langchain/community/tools/tavily_search')
jest.mock('src/messages/llm/tools', () => ({
  getTools: jest.fn().mockReturnValue([]),
}))

import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { Test, TestingModule } from '@nestjs/testing'

import {
  createMockMetricsService,
  createMockStateService,
} from 'src/__tests__/test-utils'
import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { LLMOrchestrationService } from 'src/messages/llm/llm-orchestration.service'
import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { DefaultResponseNode } from 'src/messages/llm/nodes/default-response.node'
import { ImageResponseNode } from 'src/messages/llm/nodes/image-response.node'
import { IntentDetectionNode } from 'src/messages/llm/nodes/intent-detection.node'
import { MathResponseNode } from 'src/messages/llm/nodes/math-response.node'
import { MediaResponseNode } from 'src/messages/llm/nodes/media-response.node'
import { ReminderResponseNode } from 'src/messages/llm/nodes/reminder-response.node'
import { PromptService } from 'src/messages/prompts/prompt.service'
import { ReminderService } from 'src/reminders/reminder.service'
import { ReminderContext } from 'src/reminders/reminder.types'
import { ResponseType } from 'src/schemas/graph'
import { EquationImageService } from 'src/services/equation-image.service'
import { StateService } from 'src/state/state.service'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'
import { RetryService } from 'src/utils/retry.service'

const TEST_TIMEOUT = 15_000

function ai(content: string, id = 'ai-id'): AIMessage {
  return new AIMessage({ id, content })
}

function human(content: string, id = 'h-id'): HumanMessage {
  return new HumanMessage({ id, content })
}

describe('LLMOrchestrationService - Integration', () => {
  let module: TestingModule
  let service: LLMOrchestrationService
  let stateService: jest.Mocked<StateService>
  let equationImageService: jest.Mocked<EquationImageService>
  let mediaRequestHandler: jest.Mocked<MediaRequestHandler>
  let mockInvoke: jest.Mock
  let mockContextService: jest.Mocked<ContextManagementService>
  let mockReminderService: jest.Mocked<ReminderService>

  beforeEach(async () => {
    jest.clearAllMocks()

    stateService = createMockStateService()
    stateService.getState.mockReturnValue({
      chatModel: 'gpt-4-turbo',
      reasoningModel: 'gpt-4o-mini',
      temperature: 0,
      maxTokens: 1000,
      prompt: 'You are TDR, a kawaii Discord bot.',
      graphHistory: [],
    })

    equationImageService = {
      getImage: jest.fn().mockResolvedValue({
        url: 'https://example.com/eq.png',
        bucket: 'test',
        file: 'eq.png',
      }),
    } as unknown as jest.Mocked<EquationImageService>

    mediaRequestHandler = {
      handleRequest: jest.fn().mockResolvedValue({
        messages: [ai('Found the movie Inception.')],
        images: [],
      }),
      hasActiveMediaContext: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<MediaRequestHandler>

    mockInvoke = jest.fn()
    const MockChatOpenAI = ChatOpenAI as jest.MockedClass<typeof ChatOpenAI>
    MockChatOpenAI.mockImplementation(
      () =>
        ({
          invoke: mockInvoke,
          bindTools: jest.fn().mockReturnThis(),
        }) as unknown as ChatOpenAI,
    )

    const retryService: jest.Mocked<RetryService> = {
      executeWithRetry: jest
        .fn()
        .mockImplementation((fn: () => unknown) => fn()),
    } as unknown as jest.Mocked<RetryService>

    mockContextService = {
      getContextType: jest.fn().mockResolvedValue(null),
      getContext: jest.fn().mockResolvedValue(null),
      setContext: jest.fn().mockResolvedValue(undefined),
      clearContext: jest.fn().mockResolvedValue(true),
      hasContext: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<ContextManagementService>

    mockReminderService = {
      create: jest.fn(),
      listForUser: jest.fn().mockResolvedValue([]),
      cancel: jest.fn(),
      setDeliveryFunction: jest.fn(),
      recordDeliveryFailure: jest.fn(),
      deleteAfterDelivery: jest.fn(),
      scheduleReminder: jest.fn(),
      onModuleInit: jest.fn(),
    } as unknown as jest.Mocked<ReminderService>

    module = await Test.createTestingModule({
      providers: [
        LLMOrchestrationService,
        ModelFactoryService,
        PromptService,
        IntentDetectionNode,
        DefaultResponseNode,
        ImageResponseNode,
        MathResponseNode,
        MediaResponseNode,
        ReminderResponseNode,
        { provide: StateService, useValue: stateService },
        { provide: EquationImageService, useValue: equationImageService },
        { provide: MediaRequestHandler, useValue: mediaRequestHandler },
        { provide: RetryService, useValue: retryService },
        {
          provide: ErrorClassificationService,
          useValue: { classifyError: jest.fn() },
        },
        { provide: ContextManagementService, useValue: mockContextService },
        { provide: ReminderService, useValue: mockReminderService },
        { provide: TdrBotMetricsService, useValue: createMockMetricsService() },
      ],
    }).compile()

    // Trigger onModuleInit so the real LangGraph StateGraph is compiled.
    await module.init()

    service = module.get(LLMOrchestrationService)
  })

  afterEach(async () => {
    await module?.close()
  })

  describe('simple chat (Default response type)', () => {
    it(
      'routes through intent detection → default response and returns content',
      async () => {
        const chatContent = 'Hello! How can I help you?'
        // intent detection returns "default"
        mockInvoke
          .mockResolvedValueOnce(ai(ResponseType.Default)) // intent
          .mockResolvedValueOnce(ai(chatContent)) // default response

        const result = await service.sendMessage({
          message: 'Hello!',
          user: 'Alice',
          userId: 'u-1',
        })

        expect(result.content).toBe(chatContent)
        expect(result.images ?? []).toEqual([])
      },
      TEST_TIMEOUT,
    )

    it(
      'appends result to graphHistory and uses previous history in next call',
      async () => {
        mockInvoke
          .mockResolvedValueOnce(ai(ResponseType.Default)) // intent turn 1
          .mockResolvedValueOnce(ai('Nice to meet you!')) // response turn 1
          .mockResolvedValueOnce(ai(ResponseType.Default)) // intent turn 2
          .mockResolvedValueOnce(ai('Your name is Bob.')) // response turn 2

        // Turn 1
        await service.sendMessage({
          message: 'My name is Bob',
          user: 'Bob',
          userId: 'u-2',
        })

        // Simulate state update
        const updateFn = (stateService.setState as jest.Mock).mock
          .calls[0][0] as (
          p: ReturnType<typeof stateService.getState>,
        ) => Partial<ReturnType<typeof stateService.getState>>
        const prevState = stateService.getState()
        const updated = updateFn(prevState)
        stateService.getState.mockReturnValue({
          ...prevState,
          graphHistory: updated.graphHistory ?? [],
        })

        // Turn 2
        const result2 = await service.sendMessage({
          message: 'What is my name?',
          user: 'Bob',
          userId: 'u-2',
        })

        expect(result2.content).toBe('Your name is Bob.')
        // graphHistory was set after turn 1
        expect(updated.graphHistory).toHaveLength(1)
      },
      TEST_TIMEOUT,
    )
  })

  describe('media request routing', () => {
    it(
      'routes to media response when intent detection returns "media"',
      async () => {
        mockInvoke.mockResolvedValueOnce(ai(ResponseType.Media)) // intent
        const mediaMsg = ai('Found Inception (2010)')
        mediaRequestHandler.handleRequest.mockResolvedValue({
          messages: [mediaMsg],
          images: [],
        })

        const result = await service.sendMessage({
          message: 'Find the movie Inception',
          user: 'Charlie',
          userId: 'u-3',
        })

        expect(mediaRequestHandler.handleRequest).toHaveBeenCalled()
        expect(result.content).toBe('Found Inception (2010)')
      },
      TEST_TIMEOUT,
    )

    it(
      'skips LLM intent detection when active media context exists',
      async () => {
        mediaRequestHandler.hasActiveMediaContext.mockResolvedValue(true)
        mediaRequestHandler.handleRequest.mockResolvedValue({
          messages: [ai('Downloading Inception now.')],
          images: [],
        })

        const result = await service.sendMessage({
          message: '1',
          user: 'Dave',
          userId: 'u-4',
        })

        // No LLM call for intent detection
        expect(mockInvoke).not.toHaveBeenCalled()
        expect(mediaRequestHandler.handleRequest).toHaveBeenCalled()
        expect(result.content).toBe('Downloading Inception now.')
      },
      TEST_TIMEOUT,
    )
  })

  describe('math response routing', () => {
    it(
      'routes to math node and returns equation image',
      async () => {
        const latexContent = '2 + 2 = 4'
        const chatContent = 'The answer is 4.'
        mockInvoke
          .mockResolvedValueOnce(ai(ResponseType.Math)) // intent
          .mockResolvedValueOnce(ai(latexContent)) // LaTeX extraction
          .mockResolvedValueOnce(ai(chatContent, 'chat-id')) // chat response

        const result = await service.sendMessage({
          message: 'What is 2 + 2?',
          user: 'Eve',
          userId: 'u-5',
        })

        expect(result.content).toBe(chatContent)
        expect(equationImageService.getImage).toHaveBeenCalledWith(latexContent)
        expect(result.images).toHaveLength(1)
        expect(result.images![0]).toMatchObject({
          title: 'the solution',
          url: 'https://example.com/eq.png',
        })
      },
      TEST_TIMEOUT,
    )
  })

  describe('system prompt injection', () => {
    it(
      'injects the TDR system prompt when conversation starts fresh',
      async () => {
        let capturedMessages: unknown[] = []
        mockInvoke
          .mockResolvedValueOnce(ai(ResponseType.Default)) // intent
          .mockImplementationOnce(async (msgs: unknown[]) => {
            capturedMessages = msgs
            return ai('response')
          })

        await service.sendMessage({
          message: 'hi',
          user: 'Frank',
          userId: 'u-6',
        })

        const hasSystemPrompt = capturedMessages.some(
          (m: unknown) => (m as { id?: string }).id === TDR_SYSTEM_PROMPT_ID,
        )
        expect(hasSystemPrompt).toBe(true)
      },
      TEST_TIMEOUT,
    )

    it(
      'does not duplicate system prompt when it already exists in history',
      async () => {
        const { SystemMessage } = await import('@langchain/core/messages')
        const existingPrompt = new SystemMessage({
          id: TDR_SYSTEM_PROMPT_ID,
          content: 'existing',
        })
        stateService.getState.mockReturnValue({
          chatModel: 'gpt-4-turbo',
          reasoningModel: 'gpt-4o-mini',
          temperature: 0,
          maxTokens: 1000,
          prompt: 'prompt',
          graphHistory: [
            {
              messages: [existingPrompt, human('prev msg')],
              images: [],
              responseType: undefined,
            },
          ],
        })

        let capturedMessages: unknown[] = []
        mockInvoke
          .mockResolvedValueOnce(ai(ResponseType.Default)) // intent
          .mockImplementationOnce(async (msgs: unknown[]) => {
            capturedMessages = msgs
            return ai('response')
          })

        await service.sendMessage({
          message: 'follow-up',
          user: 'Grace',
          userId: 'u-7',
        })

        const systemPromptCount = capturedMessages.filter(
          (m: unknown) => (m as { id?: string }).id === TDR_SYSTEM_PROMPT_ID,
        ).length
        expect(systemPromptCount).toBe(1)
      },
      TEST_TIMEOUT,
    )
  })

  describe('reminder response routing', () => {
    it(
      'routes to reminder node when intent detection returns "reminder" and returns a confirmation',
      async () => {
        const confirmationContent = 'Got it! Reminder set for tomorrow.'

        const extractionJson = JSON.stringify({
          action: 'create',
          what: 'pay rent',
          isRecurring: false,
          day: 'tomorrow',
          time: '9:00 AM',
          recurringPattern: null,
          scheduledAt: '2026-03-19T09:00:00',
          cronExpression: null,
          reminderIdToCancel: null,
          channelId: null,
          targetUserId: null,
          actionType: 'default',
        })

        const createdReminder = {
          id: 'rem-1',
          userId: 'u-r1',
          guildId: 'guild-1',
          what: 'pay rent',
          isRecurring: false,
          cronExpression: null,
          scheduledAt: new Date('2026-03-19T09:00:00'),
          dayDescription: 'tomorrow',
          timeDescription: '9:00 AM',
          channelId: null,
          targetUserId: null,
          actionType: 'default',
          createdAt: new Date(),
        }
        mockReminderService.create.mockResolvedValue(createdReminder)

        mockInvoke
          .mockResolvedValueOnce(ai(ResponseType.Reminder)) // intent detection
          .mockResolvedValueOnce(ai(extractionJson)) // reasoning model extracts reminder
          .mockResolvedValueOnce(ai(confirmationContent)) // chat model confirms

        const result = await service.sendMessage({
          message: 'remind me to pay rent tomorrow',
          user: 'Ivan',
          userId: 'u-r1',
          guildId: 'guild-1',
        })

        expect(mockReminderService.create).toHaveBeenCalledWith(
          expect.objectContaining({ what: 'pay rent', userId: 'u-r1' }),
        )
        expect(result.content).toBe(confirmationContent)
      },
      TEST_TIMEOUT,
    )

    it(
      'continues reminder flow when active reminder context exists and user provides follow-up',
      async () => {
        // Simulate an active reminder context (user was asked for missing "what")
        mockContextService.getContextType.mockResolvedValue('reminder')
        mockContextService.getContext.mockResolvedValue({
          timestamp: Date.now(),
          isActive: true,
          partialExtraction: { day: 'tomorrow', isRecurring: false },
        } as ReminderContext)

        const confirmationContent = 'Reminder set for tomorrow!'
        const extractionWithWhat = JSON.stringify({
          action: 'create',
          what: 'call mom',
          isRecurring: false,
          day: 'tomorrow',
          time: null,
          recurringPattern: null,
          scheduledAt: '2026-03-19T09:00:00',
          cronExpression: null,
          reminderIdToCancel: null,
          channelId: null,
          targetUserId: null,
          actionType: 'default',
        })

        const createdReminder = {
          id: 'rem-2',
          userId: 'u-r2',
          guildId: 'guild-1',
          what: 'call mom',
          isRecurring: false,
          cronExpression: null,
          scheduledAt: new Date('2026-03-19T09:00:00'),
          dayDescription: 'tomorrow',
          timeDescription: '',
          channelId: null,
          targetUserId: null,
          actionType: 'default',
          createdAt: new Date(),
        }
        mockReminderService.create.mockResolvedValue(createdReminder)

        // With active reminder context: topic-switch check returns CONTINUE,
        // so intent detection short-circuits to Reminder without another LLM call.
        // Then the reasoning model extracts the merged reminder.
        mockInvoke
          .mockResolvedValueOnce(ai('CONTINUE')) // topic-switch detection
          .mockResolvedValueOnce(ai(extractionWithWhat)) // reasoning extraction
          .mockResolvedValueOnce(ai(confirmationContent)) // confirm message

        const result = await service.sendMessage({
          message: 'to call mom',
          user: 'Jane',
          userId: 'u-r2',
          guildId: 'guild-1',
        })

        expect(mockReminderService.create).toHaveBeenCalledWith(
          expect.objectContaining({ what: 'call mom', userId: 'u-r2' }),
        )
        expect(result.content).toBe(confirmationContent)
      },
      TEST_TIMEOUT,
    )
  })

  describe('graphHistory management', () => {
    it(
      'caps history at MAX_GRAPH_HISTORY_SIZE when limit is reached',
      async () => {
        const { MAX_GRAPH_HISTORY_SIZE } = await import('src/constants/llm')
        const fullHistory = Array.from(
          { length: MAX_GRAPH_HISTORY_SIZE },
          (_, i) => ({
            messages: [ai(`msg-${i}`)],
            images: [],
            responseType: undefined,
          }),
        )
        stateService.getState.mockReturnValue({
          chatModel: 'gpt-4-turbo',
          reasoningModel: 'gpt-4o-mini',
          temperature: 0,
          maxTokens: 1000,
          prompt: 'prompt',
          graphHistory: fullHistory,
        })

        mockInvoke
          .mockResolvedValueOnce(ai(ResponseType.Default))
          .mockResolvedValueOnce(ai('response'))

        await service.sendMessage({
          message: 'one more',
          user: 'Hal',
          userId: 'u-8',
        })

        const updateFn = (stateService.setState as jest.Mock).mock
          .calls[0][0] as (
          p: ReturnType<typeof stateService.getState>,
        ) => Partial<ReturnType<typeof stateService.getState>>
        const updated = updateFn(stateService.getState())
        expect(updated.graphHistory!.length).toBe(MAX_GRAPH_HISTORY_SIZE)
      },
      TEST_TIMEOUT,
    )
  })
})
