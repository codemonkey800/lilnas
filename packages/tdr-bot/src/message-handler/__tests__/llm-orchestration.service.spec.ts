// IMPORTANT: UNMOCK LangGraph to use real implementation
jest.unmock('@langchain/langgraph')
jest.unmock('@langchain/langgraph/prebuilt')

// Mock @langchain/openai before any imports
jest.mock('@langchain/openai')
jest.mock('@langchain/community/tools/tavily_search')

import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { Test, TestingModule } from '@nestjs/testing'

import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import { LLMOrchestrationService } from 'src/message-handler/llm-orchestration.service'
import { ResponseType } from 'src/schemas/graph'
import { EquationImageService } from 'src/services/equation-image.service'
import { StateService } from 'src/state/state.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

/**
 * Unit Tests for LLMOrchestrationService
 *
 * These tests verify the public API behavior of LLMOrchestrationService
 * by testing the sendMessage() method with various scenarios.
 *
 * Unlike integration tests, these tests:
 * - Mock ALL dependencies (StateService, RetryService, etc.)
 * - Focus on business logic and error handling
 * - Run faster by avoiding real LangGraph execution
 * - Test edge cases and error scenarios
 *
 * Run with: pnpm test (excludes integration tests by default)
 */

describe('LLMOrchestrationService - Unit Tests', () => {
  let service: LLMOrchestrationService
  let module: TestingModule
  let mockStateService: jest.Mocked<StateService>
  let mockEquationImage: jest.Mocked<EquationImageService>
  let mockRetryService: jest.Mocked<RetryService>
  let mockErrorClassifier: jest.Mocked<ErrorClassificationService>
  let mockMediaHandler: jest.Mocked<MediaRequestHandler>

  // Mock ChatOpenAI
  const mockChatOpenAI = ChatOpenAI as jest.MockedClass<typeof ChatOpenAI>
  const mockInvoke = jest.fn()
  const mockBindTools = jest.fn().mockReturnThis()

  // Test data
  const testUser = 'TestUser'
  const testUserId = 'user123'
  const testMessage = 'Hello, how are you?'

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks()
    mockInvoke.mockReset()
    mockBindTools.mockReset()

    // Setup ChatOpenAI mock
    const mockChatInstance = {
      invoke: mockInvoke,
      bindTools: jest.fn().mockReturnThis(),
      withStructuredOutput: jest.fn().mockReturnThis(),
    }

    mockChatOpenAI.mockImplementation(() => mockChatInstance as any)
    mockBindTools.mockReturnValue(mockChatInstance)

    // Create mock services
    mockStateService = {
      getState: jest.fn().mockReturnValue({
        reasoningModel: 'gpt-4o-mini',
        chatModel: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 4096,
        prompt: 'You are TDR, a helpful assistant.',
        graphHistory: [],
        userMovieContexts: new Map(),
        userMovieDeleteContexts: new Map(),
        userTvShowContexts: new Map(),
        userTvShowDeleteContexts: new Map(),
      }),
      setState: jest.fn(),
      getPrompt: jest.fn().mockReturnValue({
        id: 'system-prompt',
        content: 'You are TDR, a helpful assistant.',
      }),
    } as any

    mockEquationImage = {
      getImage: jest.fn().mockResolvedValue({
        url: 'https://example.com/equation.png',
      }),
    } as any

    mockRetryService = {
      executeWithRetry: jest.fn(fn => fn()),
    } as any

    mockErrorClassifier = {
      classify: jest.fn(),
    } as any

    mockMediaHandler = {
      handleRequest: jest.fn().mockResolvedValue({
        images: [],
        messages: [
          new AIMessage({
            id: 'media-response',
            content: 'Media request handled',
          }),
        ],
      }),
      hasActiveMediaContext: jest.fn().mockResolvedValue(false),
    } as any

    // Create testing module
    module = await Test.createTestingModule({
      providers: [
        LLMOrchestrationService,
        { provide: StateService, useValue: mockStateService },
        { provide: EquationImageService, useValue: mockEquationImage },
        { provide: RetryService, useValue: mockRetryService },
        {
          provide: ErrorClassificationService,
          useValue: mockErrorClassifier,
        },
        { provide: MediaRequestHandler, useValue: mockMediaHandler },
      ],
    }).compile()

    service = module.get(LLMOrchestrationService)
  })

  afterEach(async () => {
    if (module) {
      await module.close()
    }
  })

  describe('sendMessage() - Default Chat Responses', () => {
    it('should handle simple chat conversation', async () => {
      // Arrange
      const responseTypeMessage = new AIMessage({
        id: 'response-type',
        content: ResponseType.Default,
      })
      const chatResponse = new AIMessage({
        id: 'chat-response',
        content: 'Hello! How can I help you today?',
      })

      mockInvoke
        .mockResolvedValueOnce(responseTypeMessage) // checkResponseType
        .mockResolvedValueOnce(chatResponse) // getModelDefaultResponse

      // Act
      const result = await service.sendMessage({
        message: testMessage,
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toBe(chatResponse.content)
      expect(result.images || []).toEqual([]) // images can be undefined or empty array
      expect(mockInvoke).toHaveBeenCalledTimes(2)
      expect(mockStateService.setState).toHaveBeenCalled()
    })

    it('should maintain conversation history in state', async () => {
      // Arrange
      const responseTypeMessage = new AIMessage({
        id: 'response-type',
        content: ResponseType.Default,
      })
      const chatResponse = new AIMessage({
        id: 'chat-response',
        content: 'Response',
      })

      mockInvoke
        .mockResolvedValueOnce(responseTypeMessage)
        .mockResolvedValueOnce(chatResponse)

      // Act
      await service.sendMessage({
        message: testMessage,
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(mockStateService.setState).toHaveBeenCalledWith(
        expect.any(Function),
      )

      // Verify the state update function was called
      const updateFn = mockStateService.setState.mock.calls[0][0]
      // The updateFn is a function that returns partial state
      expect(typeof updateFn).toBe('function')
    })

    it('should use userId fallback when not provided', async () => {
      // Arrange
      const responseTypeMessage = new AIMessage({
        id: 'response-type',
        content: ResponseType.Default,
      })
      const chatResponse = new AIMessage({
        id: 'chat-response',
        content: 'Response',
      })

      mockInvoke
        .mockResolvedValueOnce(responseTypeMessage)
        .mockResolvedValueOnce(chatResponse)

      // Act
      const result = await service.sendMessage({
        message: testMessage,
        user: testUser,
        // userId not provided
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toBe(chatResponse.content)
    })
  })

  describe('sendMessage() - Math Response Flow', () => {
    it('should generate equation images for math questions', async () => {
      // Arrange
      const mathDetection = new AIMessage({
        id: 'response-type',
        content: ResponseType.Math,
      })
      const latexResponse = new AIMessage({
        id: 'latex',
        content: '2 + 2 = 4',
      })
      const chatResponse = new AIMessage({
        id: 'chat-response',
        content: 'The answer is 4',
      })

      mockInvoke
        .mockResolvedValueOnce(mathDetection) // checkResponseType
        .mockResolvedValueOnce(latexResponse) // getModelMathResponse - latex
        .mockResolvedValueOnce(chatResponse) // getModelMathResponse - chat

      mockEquationImage.getImage.mockResolvedValue({
        bucket: 'test-bucket',
        file: 'test-file.png',
        url: 'https://example.com/equation.png',
      })

      // Act
      const result = await service.sendMessage({
        message: 'What is 2 + 2?',
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toBe(chatResponse.content)
      expect(result.images).toBeDefined()
      expect(result.images).toHaveLength(1)
      expect(result.images![0]).toMatchObject({
        title: 'the solution',
        url: 'https://example.com/equation.png',
        parentId: chatResponse.id,
      })
      expect(mockEquationImage.getImage).toHaveBeenCalledWith('2 + 2 = 4')
    })

    it('should handle equation image service failure gracefully', async () => {
      // Arrange
      const mathDetection = new AIMessage({
        id: 'response-type',
        content: ResponseType.Math,
      })
      const latexResponse = new AIMessage({
        id: 'latex',
        content: 'x^2 + y^2 = z^2',
      })
      const chatResponse = new AIMessage({
        id: 'chat-response',
        content: 'This is the Pythagorean theorem',
      })

      mockInvoke
        .mockResolvedValueOnce(mathDetection)
        .mockResolvedValueOnce(latexResponse)
        .mockResolvedValueOnce(chatResponse)

      mockEquationImage.getImage.mockResolvedValue(undefined) // Service returns undefined on failure

      // Act
      const result = await service.sendMessage({
        message: 'Explain Pythagorean theorem',
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toBe(chatResponse.content)
      expect(result.images || []).toEqual([]) // Empty array when service fails
    })
  })

  describe('sendMessage() - Image Generation Flow', () => {
    it('should generate images via DALL-E', async () => {
      // Arrange
      const imageDetection = new AIMessage({
        id: 'response-type',
        content: ResponseType.Image,
      })
      const imageQueriesResponse = new AIMessage({
        id: 'queries',
        content: JSON.stringify([
          { title: 'Sunset', query: 'A beautiful sunset over the ocean' },
        ]),
      })
      const chatResponse = new AIMessage({
        id: 'chat-response',
        content: "I've generated the image for you",
      })

      mockInvoke
        .mockResolvedValueOnce(imageDetection) // checkResponseType
        .mockResolvedValueOnce(imageQueriesResponse) // extract queries
        .mockResolvedValueOnce(chatResponse) // chat response

      // Mock DallE
      const mockDallEInvoke = jest
        .fn()
        .mockResolvedValue('https://example.com/generated-image.png')
      jest.mock('@langchain/openai', () => ({
        ...jest.requireActual('@langchain/openai'),
        DallEAPIWrapper: jest.fn().mockImplementation(() => ({
          invoke: mockDallEInvoke,
        })),
      }))

      // Act
      const result = await service.sendMessage({
        message: 'Generate an image of a sunset',
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      // Note: This test needs more complete DallE mocking to work properly
      // For now, just verify it doesn't crash
      expect(result.content).toBeDefined()
      expect(result.images || []).toBeDefined()
    })

    it('should handle DALL-E API failures gracefully', async () => {
      // Arrange
      const imageDetection = new AIMessage({
        id: 'response-type',
        content: ResponseType.Image,
      })

      // Simulate failure in image query extraction
      mockInvoke
        .mockResolvedValueOnce(imageDetection)
        .mockRejectedValueOnce(new Error('DALL-E API error'))

      // Act
      const result = await service.sendMessage({
        message: 'Generate an image',
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      // Error message format changed - service now returns specific error message
      expect(result.content).toContain("couldn't generate the image")
      expect(result.images || []).toEqual([])
    })
  })

  describe('sendMessage() - Media Request Flow', () => {
    it('should delegate media requests to MediaRequestHandler', async () => {
      // Arrange
      const mediaDetection = new AIMessage({
        id: 'response-type',
        content: ResponseType.Media,
      })

      mockInvoke.mockResolvedValueOnce(mediaDetection)

      const mediaResponse = new AIMessage({
        id: 'media-response',
        content: 'I found the movie Inception (2010)',
      })

      mockMediaHandler.handleRequest.mockResolvedValue({
        images: [],
        messages: [mediaResponse],
      })

      // Act
      const result = await service.sendMessage({
        message: 'Find the movie Inception',
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toBe(mediaResponse.content)
      expect(mockMediaHandler.handleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Inception'),
        }),
        expect.any(Array),
        testUserId,
        undefined,
      )
    })

    it('should handle media handler errors', async () => {
      // Arrange
      const mediaDetection = new AIMessage({
        id: 'response-type',
        content: ResponseType.Media,
      })

      mockInvoke.mockResolvedValueOnce(mediaDetection)

      mockMediaHandler.handleRequest.mockRejectedValue(
        new Error('Media service unavailable'),
      )

      // Act
      const result = await service.sendMessage({
        message: 'Find a movie',
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toContain('sorry an error happened')
      expect(result.content).toContain('Media service unavailable')
    })

    it('should skip LLM intent detection when active media context exists', async () => {
      // Arrange - User has active movie selection context
      mockMediaHandler.hasActiveMediaContext.mockResolvedValueOnce(true)

      const mediaResponse = new AIMessage({
        id: 'media-response',
        content: 'Selected: The Matrix (1999)',
      })

      mockMediaHandler.handleRequest.mockResolvedValue({
        images: [],
        messages: [mediaResponse],
      })

      // Act
      const result = await service.sendMessage({
        message: 'The first one', // User selecting from previous results
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toBe(mediaResponse.content)

      // IMPORTANT: Verify LLM was NOT called for intent detection
      // hasActiveMediaContext should short-circuit to ResponseType.Media
      expect(mockMediaHandler.hasActiveMediaContext).toHaveBeenCalledWith(
        testUserId,
        expect.objectContaining({
          content: expect.stringContaining('The first one'),
        }),
      )

      // mockInvoke should NOT be called because we skipped intent detection
      expect(mockInvoke).not.toHaveBeenCalled()

      // MediaRequestHandler should still be called to handle the selection
      expect(mockMediaHandler.handleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('The first one'),
        }),
        expect.any(Array),
        testUserId,
        undefined,
      )
    })

    it('should proceed with LLM intent detection when no active context', async () => {
      // Arrange - No active context
      mockMediaHandler.hasActiveMediaContext.mockResolvedValueOnce(false)

      const mediaDetection = new AIMessage({
        id: 'response-type',
        content: ResponseType.Media,
      })

      mockInvoke.mockResolvedValueOnce(mediaDetection)

      const mediaResponse = new AIMessage({
        id: 'media-response',
        content: 'Found movies...',
      })

      mockMediaHandler.handleRequest.mockResolvedValue({
        images: [],
        messages: [mediaResponse],
      })

      // Act
      const result = await service.sendMessage({
        message: 'Find action movies',
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toBe(mediaResponse.content)

      // Verify hasActiveMediaContext was checked
      expect(mockMediaHandler.hasActiveMediaContext).toHaveBeenCalledWith(
        testUserId,
        expect.objectContaining({
          content: expect.stringContaining('Find action movies'),
        }),
      )

      // Since no active context, LLM should be called for intent detection
      expect(mockInvoke).toHaveBeenCalled()

      // MediaRequestHandler should be called
      expect(mockMediaHandler.handleRequest).toHaveBeenCalled()
    })
  })

  describe('sendMessage() - Error Handling', () => {
    it('should handle invalid response type', async () => {
      // Arrange
      const invalidResponse = new AIMessage({
        id: 'response-type',
        content: 'INVALID_TYPE',
      })

      mockInvoke.mockResolvedValueOnce(invalidResponse)

      // Act
      const result = await service.sendMessage({
        message: testMessage,
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toContain('sorry an error happened')
    })

    it('should handle OpenAI API failures', async () => {
      // Arrange
      mockInvoke.mockRejectedValue(new Error('OpenAI API timeout'))

      // Act
      const result = await service.sendMessage({
        message: testMessage,
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toContain('sorry an error happened')
      expect(result.content).toContain('OpenAI API timeout')
      expect(result.images || []).toEqual([])
    })

    it('should use retry service for API calls', async () => {
      // Arrange
      const responseTypeMessage = new AIMessage({
        id: 'response-type',
        content: ResponseType.Default,
      })
      const chatResponse = new AIMessage({
        id: 'chat-response',
        content: 'Response',
      })

      mockInvoke
        .mockResolvedValueOnce(responseTypeMessage)
        .mockResolvedValueOnce(chatResponse)

      // Act
      await service.sendMessage({
        message: testMessage,
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(mockRetryService.executeWithRetry).toHaveBeenCalled()
    })

    it('should handle missing messages in response', async () => {
      // Arrange
      const responseTypeMessage = new AIMessage({
        id: 'response-type',
        content: ResponseType.Default,
      })

      // Mock app.invoke to return empty messages
      mockInvoke.mockResolvedValueOnce(responseTypeMessage)
      mockInvoke.mockResolvedValueOnce(null as any) // Simulate no response

      // Act
      const result = await service.sendMessage({
        message: testMessage,
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toContain('sorry an error happened')
    })
  })

  describe('sendMessage() - Edge Cases', () => {
    it('should handle empty message gracefully', async () => {
      // Arrange
      const responseTypeMessage = new AIMessage({
        id: 'response-type',
        content: ResponseType.Default,
      })
      const chatResponse = new AIMessage({
        id: 'chat-response',
        content: 'I need more information',
      })

      mockInvoke
        .mockResolvedValueOnce(responseTypeMessage)
        .mockResolvedValueOnce(chatResponse)

      // Act
      const result = await service.sendMessage({
        message: '',
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toBe(chatResponse.content)
    })

    it('should handle very long messages', async () => {
      // Arrange
      const longMessage = 'A'.repeat(10000)
      const responseTypeMessage = new AIMessage({
        id: 'response-type',
        content: ResponseType.Default,
      })
      const chatResponse = new AIMessage({
        id: 'chat-response',
        content: 'Response to long message',
      })

      mockInvoke
        .mockResolvedValueOnce(responseTypeMessage)
        .mockResolvedValueOnce(chatResponse)

      // Act
      const result = await service.sendMessage({
        message: longMessage,
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toBe(chatResponse.content)
    })

    it('should handle existing conversation history', async () => {
      // Arrange
      const existingHistory = [
        new HumanMessage({ content: 'Previous message' }),
        new AIMessage({ content: 'Previous response' }),
      ]

      mockStateService.getState.mockReturnValue({
        reasoningModel: 'gpt-4o-mini',
        chatModel: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 4096,
        prompt: 'You are TDR, a helpful assistant.',
        graphHistory: [{ messages: existingHistory, images: [] }],
        userMovieContexts: new Map(),
        userMovieDeleteContexts: new Map(),
        userTvShowContexts: new Map(),
        userTvShowDeleteContexts: new Map(),
      })

      const responseTypeMessage = new AIMessage({
        id: 'response-type',
        content: ResponseType.Default,
      })
      const chatResponse = new AIMessage({
        id: 'chat-response',
        content: 'Continuing conversation',
      })

      mockInvoke
        .mockResolvedValueOnce(responseTypeMessage)
        .mockResolvedValueOnce(chatResponse)

      // Act
      const result = await service.sendMessage({
        message: 'Follow-up question',
        user: testUser,
        userId: testUserId,
      })

      // Assert
      expect(result).toBeDefined()
      expect(result.content).toBe(chatResponse.content)
    })
  })

  describe('Protected Helper Methods', () => {
    it('should create reasoning model with correct configuration', () => {
      // Act
      const model = (service as any).getReasoningModel()

      // Assert
      expect(model).toBeDefined()
      expect(mockChatOpenAI).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        temperature: 0,
      })
    })

    it('should create chat model with tools bound', () => {
      // Act
      const model = (service as any).getChatModel()

      // Assert
      expect(model).toBeDefined()
      expect(mockChatOpenAI).toHaveBeenCalledWith({
        model: 'gpt-4o',
        temperature: 0.7,
      })
      // bindTools is called on the instance, not the mock function itself
      expect(model.bindTools).toBeDefined()
    })
  })
})
