import { BaseMessage } from '@langchain/core/messages'
import { ChatOpenAI, DallEAPIWrapper } from '@langchain/openai'
import { Test, TestingModule } from '@nestjs/testing'

import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import { createMockAppState } from 'src/message-handler/__tests__/fixtures/state.fixture'
import {
  TEST_INTERVALS,
  TEST_STORAGE,
  TEST_TIMEOUTS,
} from 'src/message-handler/__tests__/test-constants'
import { LLMOrchestrationService } from 'src/message-handler/llm-orchestration.service'
import { EquationImageService } from 'src/services/equation-image.service'
import { AppState, StateService } from 'src/state/state.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

/**
 * Integration Test Utilities
 *
 * Helper functions for setting up and running integration tests.
 * These utilities set up a real NestJS testing module with actual LangGraph
 * execution, while mocking external API calls.
 */

/**
 * Setup options for integration tests
 */
export interface IntegrationTestSetup {
  /**
   * OpenAI responses to return in order
   * Each call to ChatOpenAI.invoke() will return the next response in the array
   */
  openAIResponses: BaseMessage[]

  /**
   * Optional: Custom state to use for testing
   */
  initialState?: Partial<AppState>

  /**
   * Optional: Mock responses for specific services
   */
  serviceMocks?: {
    equationImage?: Partial<EquationImageService>
    mediaRequestHandler?: Partial<MediaRequestHandler>
    dallE?: { invoke: jest.Mock }
  }
}

/**
 * Setup an integration test environment
 *
 * This creates a real NestJS testing module with:
 * - Real LLMOrchestrationService (not mocked)
 * - Real LangGraph execution (not mocked)
 * - Mocked external APIs (ChatOpenAI, Tavily, DallE)
 * - Mocked dependent services (StateService, EquationImageService, etc.)
 *
 * @param setup Configuration for the test setup
 * @returns TestingModule and service instance
 */
export async function setupIntegrationTest(
  setup: IntegrationTestSetup,
): Promise<{
  module: TestingModule
  service: LLMOrchestrationService
  mocks: {
    stateService: StateService
    equationImageService: EquationImageService
    mediaRequestHandler: MediaRequestHandler
    retryService: RetryService
    errorClassifier: ErrorClassificationService
  }
}> {
  // Create mock state
  const mockState = createMockAppState(setup.initialState)

  // Mock StateService
  const mockStateService = {
    getState: jest.fn().mockReturnValue(mockState),
    setState: jest.fn(),
    getPrompt: jest.fn().mockReturnValue({
      id: 'tdr-system-prompt',
      content: 'You are TDR, a helpful AI assistant.',
    }),
  } as unknown as StateService

  // Mock EquationImageService
  const mockEquationImageService = {
    getImage: jest.fn().mockResolvedValue({
      bucket: TEST_STORAGE.BUCKET,
      file: 'equation.png',
      url: TEST_STORAGE.EXAMPLE_IMAGE_URL,
    }),
    ...setup.serviceMocks?.equationImage,
  } as unknown as EquationImageService

  // Mock MediaRequestHandler
  const mockMediaRequestHandler = {
    handleRequest: jest.fn().mockResolvedValue({
      messages: [],
      images: [],
    }),
    ...setup.serviceMocks?.mediaRequestHandler,
  } as unknown as MediaRequestHandler

  // Mock RetryService (pass through by default)
  const mockRetryService = {
    executeWithRetry: jest.fn((fn: () => unknown) => fn()),
  } as unknown as RetryService

  // Mock ErrorClassificationService
  const mockErrorClassifier = {} as unknown as ErrorClassificationService

  // Create the testing module
  const module = await Test.createTestingModule({
    providers: [
      LLMOrchestrationService,
      {
        provide: StateService,
        useValue: mockStateService,
      },
      {
        provide: EquationImageService,
        useValue: mockEquationImageService,
      },
      {
        provide: MediaRequestHandler,
        useValue: mockMediaRequestHandler,
      },
      {
        provide: RetryService,
        useValue: mockRetryService,
      },
      {
        provide: ErrorClassificationService,
        useValue: mockErrorClassifier,
      },
    ],
  }).compile()

  const service = module.get<LLMOrchestrationService>(LLMOrchestrationService)

  return {
    module,
    service,
    mocks: {
      stateService: mockStateService,
      equationImageService: mockEquationImageService,
      mediaRequestHandler: mockMediaRequestHandler,
      retryService: mockRetryService,
      errorClassifier: mockErrorClassifier,
    },
  }
}

/**
 * Create a mock ChatOpenAI that returns responses in sequence
 *
 * @param responses Array of responses to return in order
 * @returns Mock ChatOpenAI instance
 */
export function createMockChatOpenAI(
  responses: BaseMessage[],
): jest.Mocked<ChatOpenAI> {
  const mockChatModel = {
    invoke: jest.fn(),
    bindTools: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<ChatOpenAI>

  // Set up sequential responses
  responses.forEach(response => {
    ;(mockChatModel.invoke as jest.Mock).mockResolvedValueOnce(response)
  })

  return mockChatModel
}

/**
 * Create a mock DallEAPIWrapper
 *
 * @param imageUrls Array of image URLs to return
 * @returns Mock DallEAPIWrapper instance
 */
export function createMockDallE(
  imageUrls: string[],
): jest.Mocked<DallEAPIWrapper> {
  return {
    invoke: jest.fn().mockResolvedValue(imageUrls.join('\n')),
  } as unknown as jest.Mocked<DallEAPIWrapper>
}

/**
 * Verify that a graph execution completed successfully
 *
 * @param result The result from service.processMessage()
 */
export function expectSuccessfulGraphExecution(result: {
  messages?: unknown[]
  responseType?: string
}) {
  expect(result).toBeDefined()
  expect(result.messages).toBeDefined()
  expect(Array.isArray(result.messages)).toBe(true)
  expect(result.responseType).toBeDefined()
}

/**
 * Verify that messages were added to the conversation
 *
 * @param messages The messages array from the result
 * @param expectedCount Expected number of messages
 */
export function expectMessagesAdded(
  messages: BaseMessage[],
  expectedCount: number,
) {
  expect(messages).toHaveLength(expectedCount)
}

/**
 * Verify that a specific message exists in the conversation
 *
 * @param messages The messages array to search
 * @param content Content to search for (substring match)
 */
export function expectMessageWithContent(
  messages: BaseMessage[],
  content: string,
) {
  const found = messages.some(
    msg => typeof msg.content === 'string' && msg.content.includes(content),
  )
  expect(found).toBe(true)
}

/**
 * Verify that tool calls were made
 *
 * @param messages The messages array to search
 * @param toolName Optional: specific tool name to verify
 */
export function expectToolCallsInMessages(
  messages: BaseMessage[],
  toolName?: string,
) {
  const aiMessages = messages.filter(msg => msg._getType() === 'ai')
  const hasToolCalls = aiMessages.some(msg => {
    const toolCalls = (
      msg as BaseMessage & {
        additional_kwargs?: {
          tool_calls?: Array<{ function?: { name: string } }>
        }
      }
    ).additional_kwargs?.tool_calls
    if (!toolCalls || toolCalls.length === 0) return false
    if (toolName) {
      return toolCalls.some(call => call.function?.name === toolName)
    }
    return true
  })
  expect(hasToolCalls).toBe(true)
}

/**
 * Wait for a condition to be true (useful for async operations)
 *
 * @param condition Function that returns true when condition is met
 * @param timeout Maximum time to wait in ms
 * @param interval Check interval in ms
 */
export async function waitFor(
  condition: () => boolean,
  timeout: number = TEST_TIMEOUTS.WAIT_FOR,
  interval: number = TEST_INTERVALS.WAIT_FOR_CHECK,
): Promise<void> {
  const startTime = Date.now()
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition')
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
}
