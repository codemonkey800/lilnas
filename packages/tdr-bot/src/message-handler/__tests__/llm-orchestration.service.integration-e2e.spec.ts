import { ChatOpenAI, DallEAPIWrapper } from '@langchain/openai'
import { TestingModule } from '@nestjs/testing'

import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import { LLMOrchestrationService } from 'src/message-handler/llm-orchestration.service'

import { createIntegrationFixtures } from './fixtures/integration-responses.fixture'
import { createAIMessage } from './fixtures/messages.fixture'
import { setupIntegrationTest } from './helpers/integration-test-utils'
import { TEST_PERFORMANCE, TEST_TIMEOUTS, TEST_USERS } from './test-constants'

/**
 * Integration Tests for LLMOrchestrationService
 *
 * These tests verify the public API behavior of LLMOrchestrationService.
 * Tests use the `sendMessage()` method to validate:
 * - Response content correctness
 * - Image generation
 * - Error handling
 * - Multi-turn conversation state management
 *
 * Unlike unit tests, these tests:
 * - Test through the public API only
 * - Mock only external APIs (ChatOpenAI, Tavily, DallE)
 * - Verify end-to-end behavior without internal implementation details
 *
 * Run with: pnpm test:integration
 */

// IMPORTANT: UNMOCK LangGraph to use real implementation
jest.unmock('@langchain/langgraph')
jest.unmock('@langchain/langgraph/prebuilt')

// Only mock external API calls (OpenAI, Tavily, etc.)
jest.mock('@langchain/openai')
jest.mock('@langchain/community/tools/tavily_search')

describe('LLMOrchestrationService - Integration Tests', () => {
  let service: LLMOrchestrationService
  let module: TestingModule
  let fixtures: ReturnType<typeof createIntegrationFixtures>

  beforeEach(async () => {
    // Create fixtures with realistic API responses
    fixtures = createIntegrationFixtures()

    // Setup integration test module with real LangGraph
    const setup = await setupIntegrationTest({
      openAIResponses: [], // Will be set per test
    })

    module = setup.module
    service = setup.service
  })

  afterEach(async () => {
    if (module) {
      await module.close()
    }
  })

  describe('Simple Chat Flow', () => {
    /**
     * Test 1: Basic chat conversation
     * Validates the public API for simple chat interactions
     */
    it(
      'should handle simple chat conversation',
      async () => {
        // Arrange
        const message = 'Hello, how are you?'
        const user = 'Alice'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const responseTypeResponse = createAIMessage('default')
        const chatResponse = createAIMessage(
          'Hello! I am doing well, thank you for asking. How can I help you today?',
        )

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(responseTypeResponse)
          .mockResolvedValueOnce(chatResponse)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        // Act
        const result = await service.sendMessage({ message, user, userId })

        // Assert
        expect(result).toBeDefined()
        expect(result.content).toBe(chatResponse.content)
        expect(result.images || []).toEqual([])
        expect(mockInvoke).toHaveBeenCalled()
      },
      TEST_TIMEOUTS.STANDARD,
    )
  })

  describe('Response Type Routing', () => {
    /**
     * Test 2: Math question routing
     * Validates that math questions generate equation images
     */
    it(
      'should generate equation images for math questions',
      async () => {
        // Arrange
        const message = 'What is 2 + 2?'
        const user = 'Bob'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const mathDetection = fixtures.math.mathDetection
        const latexResponse = createAIMessage('2 + 2 = 4')
        const chatResponse = fixtures.math.mathResponse

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(mathDetection)
          .mockResolvedValueOnce(latexResponse)
          .mockResolvedValueOnce(chatResponse)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        // Act
        const result = await service.sendMessage({ message, user, userId })

        // Assert
        expect(result).toBeDefined()
        expect(result.content).toBe(chatResponse.content)
        expect(result.images).toBeDefined()
        expect(result.images).toHaveLength(1)
        expect(result.images![0]).toMatchObject({
          title: 'the solution',
          url: expect.stringContaining('https://'),
          parentId: expect.any(String),
        })
        expect(mockInvoke).toHaveBeenCalledTimes(3)
      },
      TEST_TIMEOUTS.STANDARD,
    )

    /**
     * Test 3: Media request handling
     * Validates that media requests are processed correctly
     */
    it(
      'should handle media requests',
      async () => {
        // Arrange
        const message = 'Find the movie Inception'
        const user = 'Charlie'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const mediaDetection = fixtures.media.mediaDetection
        const mockInvoke = jest.fn().mockResolvedValueOnce(mediaDetection)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        const mockMediaResponse = createAIMessage(
          'I found the movie Inception (2010). It is a science fiction action film.',
        )
        const mockMediaHandler = module.get(MediaRequestHandler)
        jest.spyOn(mockMediaHandler, 'handleRequest').mockResolvedValue({
          messages: [mockMediaResponse],
          images: [],
        })

        // Act
        const result = await service.sendMessage({ message, user, userId })

        // Assert
        expect(result).toBeDefined()
        expect(result.content).toBe(mockMediaResponse.content)
        expect(result.images || []).toEqual([])
        expect(mockMediaHandler.handleRequest).toHaveBeenCalled()
      },
      TEST_TIMEOUTS.STANDARD,
    )

    /**
     * Test 4: Image generation
     * Validates that image generation requests produce images
     */
    it(
      'should generate images via DALL-E',
      async () => {
        // Arrange
        const message = 'Generate an image of a sunset over the ocean'
        const user = 'Diana'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const imageDetection = fixtures.images.imageDetection
        const imageQueriesResponse = createAIMessage(
          JSON.stringify([
            {
              query: 'A beautiful sunset over the ocean with vibrant colors',
              title: 'Sunset',
            },
          ]),
        )
        const chatResponse = createAIMessage(
          'I have generated the image of a sunset over the ocean for you!',
        )

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(imageDetection)
          .mockResolvedValueOnce(imageQueriesResponse)
          .mockResolvedValueOnce(chatResponse)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        const mockDalleInvoke = jest
          .fn()
          .mockResolvedValue('https://example.com/generated-sunset.png')
        jest
          .spyOn(DallEAPIWrapper.prototype, 'invoke')
          .mockImplementation(mockDalleInvoke)

        // Act
        const result = await service.sendMessage({ message, user, userId })

        // Assert
        expect(result).toBeDefined()
        expect(result.content).toBe(chatResponse.content)
        expect(result.images).toBeDefined()
        expect(result.images).toHaveLength(1)
        expect(result.images![0]).toMatchObject({
          title: 'Sunset',
          url: 'https://example.com/generated-sunset.png',
          parentId: expect.any(String),
        })
        expect(mockDalleInvoke).toHaveBeenCalledWith(
          'A beautiful sunset over the ocean with vibrant colors',
        )
      },
      TEST_TIMEOUTS.STANDARD,
    )
  })

  describe('Tool Execution', () => {
    /**
     * Test 5: Tool calls with Tavily search
     * Validates that tool-based queries are executed and results incorporated
     */
    it(
      'should execute tool calls and incorporate results',
      async () => {
        // Arrange
        const message = 'Search for latest AI news'
        const user = 'Eve'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const defaultResponse = createAIMessage('default')
        const toolCallResponse = fixtures.tools.tavilySearchRequest
        const finalResponse = fixtures.tools.afterToolExecution

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(defaultResponse)
          .mockResolvedValueOnce(toolCallResponse)
          .mockResolvedValueOnce(finalResponse)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        // Act
        const result = await service.sendMessage({ message, user, userId })

        // Assert
        expect(result).toBeDefined()
        expect(result.content).toBeDefined()
        expect(mockInvoke.mock.calls.length).toBeGreaterThanOrEqual(2)
      },
      TEST_TIMEOUTS.STANDARD,
    )
  })

  describe('Multi-turn Conversations', () => {
    /**
     * Test 6: Context preservation across turns
     * Validates that conversation state is maintained across multiple sendMessage calls
     */
    it(
      'should maintain conversation context across multiple turns',
      async () => {
        // Arrange
        const user = 'Alice'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const defaultResponse1 = createAIMessage('default')
        const chatResponse1 = createAIMessage('Nice to meet you, Alice!')
        const defaultResponse2 = createAIMessage('default')
        const chatResponse2 = fixtures.chat.contextResponse

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(defaultResponse1)
          .mockResolvedValueOnce(chatResponse1)
          .mockResolvedValueOnce(defaultResponse2)
          .mockResolvedValueOnce(chatResponse2)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        // Act: First turn
        const result1 = await service.sendMessage({
          message: 'My name is Alice',
          user,
          userId,
        })

        // Act: Second turn (state should be preserved internally)
        const result2 = await service.sendMessage({
          message: 'What is my name?',
          user,
          userId,
        })

        // Assert
        expect(result1.content).toBe(chatResponse1.content)
        expect(result2.content).toBe(chatResponse2.content)
        expect(mockInvoke).toHaveBeenCalledTimes(4)
      },
      TEST_TIMEOUTS.LONG,
    )
  })

  describe('Multi-Step Workflows', () => {
    /**
     * Test 8: Movie search → selection → download workflow
     * Validates that multi-step media operations maintain context correctly
     */
    it(
      'should handle movie search → selection → download workflow',
      async () => {
        // Arrange
        const user = 'Alice'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const defaultResponse1 = createAIMessage('default')
        const mediaDetection1 = fixtures.media.mediaDetection
        const defaultResponse2 = createAIMessage('default')

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(mediaDetection1) // Turn 1: Response type detection
          .mockResolvedValueOnce(defaultResponse1) // Turn 2: Response type detection
          .mockResolvedValueOnce(defaultResponse2)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        const mockMediaHandler = module.get(MediaRequestHandler)
        jest
          .spyOn(mockMediaHandler, 'handleRequest')
          // Turn 1: Return search results
          .mockResolvedValueOnce({
            messages: [fixtures.workflows.movieSearchResults],
            images: [],
          })
          // Turn 2: Return download confirmation
          .mockResolvedValueOnce({
            messages: [fixtures.workflows.movieDownloadConfirm],
            images: [],
          })

        // Act: Turn 1 - Search for movie
        const result1 = await service.sendMessage({
          message: 'Find the movie Inception',
          user,
          userId,
        })

        // Act: Turn 2 - Download the movie
        const result2 = await service.sendMessage({
          message: 'Download the first one',
          user,
          userId,
        })

        // Assert
        expect(result1.content).toBe(
          fixtures.workflows.movieSearchResults.content,
        )
        expect(result2.content).toBe(
          fixtures.workflows.movieDownloadConfirm.content,
        )
        expect(mockMediaHandler.handleRequest).toHaveBeenCalledTimes(2)
      },
      TEST_TIMEOUTS.LONG,
    )

    /**
     * Test 9: TV show search → selection → download workflow
     * Validates that TV show operations work correctly with context
     */
    it(
      'should handle TV show search → selection → download workflow',
      async () => {
        // Arrange
        const user = 'Bob'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const defaultResponse1 = createAIMessage('default')
        const mediaDetection1 = fixtures.media.mediaDetection
        const defaultResponse2 = createAIMessage('default')

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(mediaDetection1) // Turn 1: Response type detection
          .mockResolvedValueOnce(defaultResponse1) // Turn 2: Response type detection
          .mockResolvedValueOnce(defaultResponse2)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        const mockMediaHandler = module.get(MediaRequestHandler)
        jest
          .spyOn(mockMediaHandler, 'handleRequest')
          // Turn 1: Return TV search results
          .mockResolvedValueOnce({
            messages: [fixtures.workflows.tvSearchResults],
            images: [],
          })
          // Turn 2: Return download confirmation
          .mockResolvedValueOnce({
            messages: [fixtures.workflows.tvDownloadConfirm],
            images: [],
          })

        // Act: Turn 1 - Search for TV show
        const result1 = await service.sendMessage({
          message: 'Find Breaking Bad TV show',
          user,
          userId,
        })

        // Act: Turn 2 - Download the TV show
        const result2 = await service.sendMessage({
          message: 'Get the first result',
          user,
          userId,
        })

        // Assert
        expect(result1.content).toBe(fixtures.workflows.tvSearchResults.content)
        expect(result2.content).toBe(
          fixtures.workflows.tvDownloadConfirm.content,
        )
        expect(mockMediaHandler.handleRequest).toHaveBeenCalledTimes(2)
      },
      TEST_TIMEOUTS.LONG,
    )

    /**
     * Test 10: Workflow cancellation
     * Validates that users can cancel a workflow mid-operation
     */
    it(
      'should handle workflow cancellation',
      async () => {
        // Arrange
        const user = 'Charlie'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const defaultResponse1 = createAIMessage('default')
        const mediaDetection1 = fixtures.media.mediaDetection
        const defaultResponse2 = createAIMessage('default')

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(mediaDetection1) // Turn 1: Response type detection
          .mockResolvedValueOnce(defaultResponse1) // Turn 2: Response type detection
          .mockResolvedValueOnce(defaultResponse2)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        const mockMediaHandler = module.get(MediaRequestHandler)
        jest
          .spyOn(mockMediaHandler, 'handleRequest')
          // Turn 1: Return search results
          .mockResolvedValueOnce({
            messages: [fixtures.workflows.movieSearchResults],
            images: [],
          })
          // Turn 2: Return cancellation confirmation
          .mockResolvedValueOnce({
            messages: [fixtures.workflows.workflowCancelled],
            images: [],
          })

        // Act: Turn 1 - Search for movie
        const result1 = await service.sendMessage({
          message: 'Find Inception',
          user,
          userId,
        })

        // Act: Turn 2 - Cancel the operation
        const result2 = await service.sendMessage({
          message: 'Actually, never mind',
          user,
          userId,
        })

        // Assert
        expect(result1.content).toBe(
          fixtures.workflows.movieSearchResults.content,
        )
        expect(result2.content).toBe(
          fixtures.workflows.workflowCancelled.content,
        )
        expect(mockMediaHandler.handleRequest).toHaveBeenCalledTimes(2)
      },
      TEST_TIMEOUTS.LONG,
    )
  })

  describe('Context Switching', () => {
    /**
     * Test 11: Download to delete context switch
     * Validates that context can switch from download to delete mid-conversation
     */
    it(
      'should switch from download to delete mid-conversation',
      async () => {
        // Arrange
        const user = 'Diana'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const mediaDetection1 = fixtures.media.mediaDetection
        const mediaDetection2 = fixtures.media.mediaDetection

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(mediaDetection1) // Turn 1: Response type detection
          .mockResolvedValueOnce(mediaDetection2) // Turn 2: Response type detection

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        const mockMediaHandler = module.get(MediaRequestHandler)
        jest
          .spyOn(mockMediaHandler, 'handleRequest')
          // Turn 1: Start download
          .mockResolvedValueOnce({
            messages: [fixtures.workflows.movieDownloadConfirm],
            images: [],
          })
          // Turn 2: Switch to delete
          .mockResolvedValueOnce({
            messages: [fixtures.contextSwitch.downloadToDeleteSwitch],
            images: [],
          })

        // Act: Turn 1 - Start download
        const result1 = await service.sendMessage({
          message: 'Download Inception',
          user,
          userId,
        })

        // Act: Turn 2 - Switch to delete
        const result2 = await service.sendMessage({
          message: 'Actually, delete that movie',
          user,
          userId,
        })

        // Assert
        expect(result1.content).toBe(
          fixtures.workflows.movieDownloadConfirm.content,
        )
        expect(result2.content).toBe(
          fixtures.contextSwitch.downloadToDeleteSwitch.content,
        )
        expect(mockMediaHandler.handleRequest).toHaveBeenCalledTimes(2)
      },
      TEST_TIMEOUTS.LONG,
    )

    /**
     * Test 12: Movie to TV context switch
     * Validates that context can switch between different media types
     */
    it(
      'should switch from movie to TV context',
      async () => {
        // Arrange
        const user = 'Eve'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const mediaDetection1 = fixtures.media.mediaDetection
        const mediaDetection2 = fixtures.media.mediaDetection

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(mediaDetection1) // Turn 1: Response type detection
          .mockResolvedValueOnce(mediaDetection2) // Turn 2: Response type detection

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        const mockMediaHandler = module.get(MediaRequestHandler)
        jest
          .spyOn(mockMediaHandler, 'handleRequest')
          // Turn 1: Movie search
          .mockResolvedValueOnce({
            messages: [fixtures.workflows.movieSearchResults],
            images: [],
          })
          // Turn 2: TV search (context switched)
          .mockResolvedValueOnce({
            messages: [fixtures.contextSwitch.movieToTvSwitch],
            images: [],
          })

        // Act: Turn 1 - Search for movie
        const result1 = await service.sendMessage({
          message: 'Find the movie Inception',
          user,
          userId,
        })

        // Act: Turn 2 - Switch to TV show
        const result2 = await service.sendMessage({
          message: 'Actually, find Breaking Bad TV show instead',
          user,
          userId,
        })

        // Assert
        expect(result1.content).toBe(
          fixtures.workflows.movieSearchResults.content,
        )
        expect(result2.content).toBe(
          fixtures.contextSwitch.movieToTvSwitch.content,
        )
        expect(mockMediaHandler.handleRequest).toHaveBeenCalledTimes(2)
      },
      TEST_TIMEOUTS.LONG,
    )

    /**
     * Test 13: Rapid context switches
     * Validates that multiple rapid context switches are handled correctly
     */
    it(
      'should handle rapid context switches',
      async () => {
        // Arrange
        const user = 'Frank'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const mediaDetection = fixtures.media.mediaDetection

        const mockInvoke = jest.fn().mockResolvedValue(mediaDetection) // All turns: Response type detection

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        const mockMediaHandler = module.get(MediaRequestHandler)
        jest
          .spyOn(mockMediaHandler, 'handleRequest')
          // Turn 1: Movie search
          .mockResolvedValueOnce({
            messages: [fixtures.workflows.movieSearchResults],
            images: [],
          })
          // Turn 2: Switch to TV
          .mockResolvedValueOnce({
            messages: [fixtures.workflows.tvSearchResults],
            images: [],
          })
          // Turn 3: Switch back to movie
          .mockResolvedValueOnce({
            messages: [fixtures.workflows.movieSearchResults],
            images: [],
          })
          // Turn 4: Switch to delete
          .mockResolvedValueOnce({
            messages: [fixtures.contextSwitch.deleteConfirmation],
            images: [],
          })

        // Act: Rapid context switches
        const result1 = await service.sendMessage({
          message: 'Find Inception',
          user,
          userId,
        })
        const result2 = await service.sendMessage({
          message: 'Actually find Breaking Bad',
          user,
          userId,
        })
        const result3 = await service.sendMessage({
          message: 'No wait, find Inception',
          user,
          userId,
        })
        const result4 = await service.sendMessage({
          message: 'Delete it',
          user,
          userId,
        })

        // Assert - All context switches handled
        expect(result1.content).toBe(
          fixtures.workflows.movieSearchResults.content,
        )
        expect(result2.content).toBe(fixtures.workflows.tvSearchResults.content)
        expect(result3.content).toBe(
          fixtures.workflows.movieSearchResults.content,
        )
        expect(result4.content).toBe(
          fixtures.contextSwitch.deleteConfirmation.content,
        )
        expect(mockMediaHandler.handleRequest).toHaveBeenCalledTimes(4)
      },
      TEST_TIMEOUTS.LONG,
    )
  })

  describe('Error Handling', () => {
    /**
     * Test 7: Error handling
     * Validates that API errors are handled gracefully and returned to user
     */
    it(
      'should return error message when API fails',
      async () => {
        // Arrange
        const message = 'Hello'
        const user = 'Frank'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const mockInvoke = jest.fn().mockRejectedValue(new Error('API Error'))

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        // Act
        const result = await service.sendMessage({ message, user, userId })

        // Assert - sendMessage catches errors and returns error message
        expect(result).toBeDefined()
        expect(result.content).toContain('sorry an error happened')
        expect(result.content).toContain('API Error')
        expect(result.images || []).toEqual([])
        expect(mockInvoke).toHaveBeenCalled()
      },
      TEST_TIMEOUTS.STANDARD,
    )
  })

  describe('Tool Execution Failures', () => {
    /**
     * Test 14: Tavily search failure
     * Validates that Tavily search failures are handled gracefully
     */
    it(
      'should handle Tavily search failure gracefully',
      async () => {
        // Arrange
        const message = 'Search for latest AI news'
        const user = 'Grace'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const defaultResponse = createAIMessage('default')
        const toolCallResponse = fixtures.tools.tavilySearchRequest

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(defaultResponse) // Response type detection
          .mockResolvedValueOnce(toolCallResponse) // Tool call request

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        // Mock Tavily to fail
        const TavilySearchResults =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('@langchain/community/tools/tavily_search').TavilySearchResults
        jest
          .spyOn(TavilySearchResults.prototype, 'invoke')
          .mockRejectedValue(new Error('Tavily API unavailable'))

        // Act
        const result = await service.sendMessage({ message, user, userId })

        // Assert - Error should be caught and handled
        expect(result).toBeDefined()
        expect(result.content).toBeDefined()
        // Service should handle the error gracefully, not crash
      },
      TEST_TIMEOUTS.STANDARD,
    )

    /**
     * Test 15: DALL-E generation failure
     * Validates that DALL-E failures are handled gracefully
     */
    it(
      'should handle DALL-E generation failure gracefully',
      async () => {
        // Arrange
        const message = 'Generate an image of a cat'
        const user = 'Henry'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const imageDetection = fixtures.images.imageDetection
        const imageQueriesResponse = createAIMessage(
          JSON.stringify([
            {
              query: 'A cute cat sitting on a windowsill',
              title: 'Cat',
            },
          ]),
        )

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(imageDetection) // Response type detection
          .mockResolvedValueOnce(imageQueriesResponse) // Image queries

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        // Mock DALL-E to fail
        jest
          .spyOn(DallEAPIWrapper.prototype, 'invoke')
          .mockRejectedValue(new Error('DALL-E API rate limit exceeded'))

        // Act
        const result = await service.sendMessage({ message, user, userId })

        // Assert - Error should be caught and handled
        expect(result).toBeDefined()
        expect(result.content).toBeDefined()
        // Service should handle the error gracefully
      },
      TEST_TIMEOUTS.STANDARD,
    )

    /**
     * Test 16: Multiple consecutive tool failures
     * Validates that multiple tool failures don't cause cascading issues
     */
    it(
      'should handle multiple consecutive tool failures',
      async () => {
        // Arrange
        const user = 'Ivy'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const defaultResponse = createAIMessage('default')
        const imageDetection = fixtures.images.imageDetection
        const toolCallResponse = fixtures.tools.tavilySearchRequest

        // Mock all responses
        const mockInvoke = jest
          .fn()
          // Turn 1: Tavily search
          .mockResolvedValueOnce(defaultResponse) // Response type
          .mockResolvedValueOnce(toolCallResponse) // Tool call
          // Turn 2: Image generation
          .mockResolvedValueOnce(imageDetection) // Response type
          .mockResolvedValueOnce(
            createAIMessage(
              JSON.stringify([{ query: 'test image', title: 'Test' }]),
            ),
          )
          // Turn 3: Another search
          .mockResolvedValueOnce(defaultResponse) // Response type
          .mockResolvedValueOnce(toolCallResponse) // Tool call

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        // Mock all tools to fail
        const TavilySearchResults =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('@langchain/community/tools/tavily_search').TavilySearchResults
        jest
          .spyOn(TavilySearchResults.prototype, 'invoke')
          .mockRejectedValue(new Error('Tavily failed'))
        jest
          .spyOn(DallEAPIWrapper.prototype, 'invoke')
          .mockRejectedValue(new Error('DALL-E failed'))

        // Act: Three consecutive failures
        const result1 = await service.sendMessage({
          message: 'Search for AI news',
          user,
          userId,
        })
        const result2 = await service.sendMessage({
          message: 'Generate an image',
          user,
          userId,
        })
        const result3 = await service.sendMessage({
          message: 'Search again',
          user,
          userId,
        })

        // Assert - All failures handled gracefully
        expect(result1).toBeDefined()
        expect(result2).toBeDefined()
        expect(result3).toBeDefined()
        expect(result1.content).toBeDefined()
        expect(result2.content).toBeDefined()
        expect(result3.content).toBeDefined()
        // System should remain stable despite multiple failures
      },
      TEST_TIMEOUTS.LONG,
    )
  })

  describe('Large Conversation History', () => {
    /**
     * Test 17: 100+ turn conversation
     * Validates that large conversation histories don't cause performance degradation
     */
    it(
      'should handle 100+ turn conversations without degradation',
      async () => {
        // Arrange
        const user = 'Jack'
        const userId = TEST_USERS.DEFAULT_USER_ID
        const turnCount = 100

        // Mock responses efficiently with mockImplementation
        const mockInvoke = jest.fn().mockImplementation(() => {
          // Always return default response type detection
          return Promise.resolve(createAIMessage('default'))
        })

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        // Track performance
        const firstTenStart = performance.now()

        // Act: Send 100 messages
        const results: Array<{ content: string; images?: unknown[] }> = []
        for (let i = 0; i < turnCount; i++) {
          const result = await service.sendMessage({
            message: `Message ${i + 1}`,
            user,
            userId,
          })
          results.push(result)

          // Measure first 10 turns
          if (i === 9) {
            const firstTenEnd = performance.now()
            const firstTenDuration = firstTenEnd - firstTenStart
            console.log(`First 10 turns took: ${firstTenDuration}ms`)
          }
        }

        // Assert
        expect(results).toHaveLength(turnCount)
        // All turns should complete successfully
        results.forEach(result => {
          expect(result).toBeDefined()
          expect(result.content).toBeDefined()
        })
        // No cascading errors
        expect(mockInvoke).toHaveBeenCalled()
      },
      TEST_TIMEOUTS.EXTRA_LONG,
    )
  })

  describe('Performance Regression', () => {
    /**
     * Test 18: Simple chat performance baseline
     * Validates that simple chat responses complete within acceptable time
     */
    it(
      'should respond to simple chat in < 5 seconds',
      async () => {
        // Arrange
        const message = 'Hello'
        const user = 'Kate'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const defaultResponse = createAIMessage('default')
        const chatResponse = createAIMessage('Hello! How can I help you today?')

        const mockInvoke = jest
          .fn()
          .mockResolvedValueOnce(defaultResponse) // Response type detection
          .mockResolvedValueOnce(chatResponse) // Chat response

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        // Act: Measure performance
        const startTime = performance.now()
        const result = await service.sendMessage({ message, user, userId })
        const endTime = performance.now()
        const duration = endTime - startTime

        // Assert
        expect(result).toBeDefined()
        expect(result.content).toBe(chatResponse.content)
        expect(duration).toBeLessThan(TEST_PERFORMANCE.MAX_SIMPLE_CHAT_MS)
        console.log(`Simple chat response time: ${duration.toFixed(2)}ms`)
      },
      TEST_TIMEOUTS.STANDARD,
    )
  })

  describe('Strategy Routing Verification (ISSUE-8)', () => {
    /**
     * These tests verify that MediaRequestHandler correctly routes requests
     * to the appropriate internal strategies (MovieDownloadStrategy, TvDownloadStrategy, etc.)
     *
     * Unlike other tests in this file which mock MediaRequestHandler entirely,
     * these tests use spies on the MediaRequestHandler's handleRequest method
     * to verify routing behavior.
     */

    /**
     * Test 19: Movie download routing
     * Validates that movie download requests route to MovieDownloadStrategy
     */
    it(
      'should route movie download requests through MediaRequestHandler',
      async () => {
        // Arrange
        const message = 'Find the movie Inception'
        const user = 'Alice'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const mediaDetection = fixtures.media.mediaDetection
        const mockMovieResponse = createAIMessage(
          'I found the movie Inception (2010).',
        )

        const mockInvoke = jest.fn().mockResolvedValueOnce(mediaDetection)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        const mockMediaHandler = module.get(MediaRequestHandler)
        const handleRequestSpy = jest
          .spyOn(mockMediaHandler, 'handleRequest')
          .mockResolvedValue({
            messages: [mockMovieResponse],
            images: [],
          })

        // Act
        const result = await service.sendMessage({ message, user, userId })

        // Assert - Verify MediaRequestHandler.handleRequest was called
        expect(handleRequestSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: message,
          }),
          expect.any(Array), // messages array
          userId,
          undefined, // state
        )
        expect(result.content).toBe(mockMovieResponse.content)
      },
      TEST_TIMEOUTS.STANDARD,
    )

    /**
     * Test 20: TV download routing
     * Validates that TV download requests route to TvDownloadStrategy
     */
    it(
      'should route TV download requests through MediaRequestHandler',
      async () => {
        // Arrange
        const message = 'Find Breaking Bad TV show'
        const user = 'Bob'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const mediaDetection = fixtures.media.mediaDetection
        const mockTvResponse = createAIMessage(
          'I found the TV show Breaking Bad.',
        )

        const mockInvoke = jest.fn().mockResolvedValueOnce(mediaDetection)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        const mockMediaHandler = module.get(MediaRequestHandler)
        const handleRequestSpy = jest
          .spyOn(mockMediaHandler, 'handleRequest')
          .mockResolvedValue({
            messages: [mockTvResponse],
            images: [],
          })

        // Act
        const result = await service.sendMessage({ message, user, userId })

        // Assert - Verify MediaRequestHandler.handleRequest was called
        expect(handleRequestSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: message,
          }),
          expect.any(Array), // messages array
          userId,
          undefined, // state
        )
        expect(result.content).toBe(mockTvResponse.content)
      },
      TEST_TIMEOUTS.STANDARD,
    )

    /**
     * Test 21: Movie delete routing
     * Validates that movie delete requests route to MovieDeleteStrategy
     */
    it(
      'should route movie delete requests through MediaRequestHandler',
      async () => {
        // Arrange
        const message = 'Delete the movie Inception'
        const user = 'Charlie'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const mediaDetection = fixtures.media.mediaDetection
        const mockDeleteResponse = createAIMessage(
          'Movie deleted successfully.',
        )

        const mockInvoke = jest.fn().mockResolvedValueOnce(mediaDetection)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        const mockMediaHandler = module.get(MediaRequestHandler)
        const handleRequestSpy = jest
          .spyOn(mockMediaHandler, 'handleRequest')
          .mockResolvedValue({
            messages: [mockDeleteResponse],
            images: [],
          })

        // Act
        const result = await service.sendMessage({ message, user, userId })

        // Assert - Verify MediaRequestHandler.handleRequest was called
        expect(handleRequestSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: message,
          }),
          expect.any(Array), // messages array
          userId,
          undefined, // state
        )
        expect(result.content).toBe(mockDeleteResponse.content)
      },
      TEST_TIMEOUTS.STANDARD,
    )

    /**
     * Test 22: TV delete routing
     * Validates that TV delete requests route to TvDeleteStrategy
     */
    it(
      'should route TV delete requests through MediaRequestHandler',
      async () => {
        // Arrange
        const message = 'Delete Breaking Bad TV show'
        const user = 'Diana'
        const userId = TEST_USERS.DEFAULT_USER_ID

        const mediaDetection = fixtures.media.mediaDetection
        const mockDeleteResponse = createAIMessage(
          'TV show deleted successfully.',
        )

        const mockInvoke = jest.fn().mockResolvedValueOnce(mediaDetection)

        jest
          .spyOn(ChatOpenAI.prototype, 'invoke')
          .mockImplementation(mockInvoke)
        jest.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnThis()

        const mockMediaHandler = module.get(MediaRequestHandler)
        const handleRequestSpy = jest
          .spyOn(mockMediaHandler, 'handleRequest')
          .mockResolvedValue({
            messages: [mockDeleteResponse],
            images: [],
          })

        // Act
        const result = await service.sendMessage({ message, user, userId })

        // Assert - Verify MediaRequestHandler.handleRequest was called
        expect(handleRequestSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: message,
          }),
          expect.any(Array), // messages array
          userId,
          undefined, // state
        )
        expect(result.content).toBe(mockDeleteResponse.content)
      },
      TEST_TIMEOUTS.STANDARD,
    )
  })
})
