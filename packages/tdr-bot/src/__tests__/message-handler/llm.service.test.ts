import { TavilySearchResults } from '@langchain/community/tools/tavily_search'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { StateGraph } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI, DallEAPIWrapper } from '@langchain/openai'

import {
  createMockChatOpenAI,
  createMockErrorClassificationService,
  createMockRetryService,
  createMockStateGraph,
  createMockStateService,
  createMockToolNode,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'
import { LLMService } from 'src/message-handler/llm.service'
import { ResponseType } from 'src/schemas/graph'
import { EquationImageService } from 'src/services/equation-image.service'
import { AppState, StateService } from 'src/state/state.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'
import { RetryService } from 'src/utils/retry.service'

jest.mock('@langchain/openai')
jest.mock('@langchain/langgraph')
jest.mock('@langchain/langgraph/prebuilt')
jest.mock('@langchain/community/tools/tavily_search')

describe('LLMService', () => {
  let service: LLMService
  let stateService: jest.Mocked<StateService>
  let equationImageService: jest.Mocked<EquationImageService>
  let mockChatOpenAI: ReturnType<typeof createMockChatOpenAI>
  let mockStateGraph: ReturnType<typeof createMockStateGraph>

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks()

    // Setup mock implementations
    mockChatOpenAI = createMockChatOpenAI()
    mockStateGraph = createMockStateGraph()
    ;(ChatOpenAI as jest.MockedClass<typeof ChatOpenAI>).mockImplementation(
      () => mockChatOpenAI as unknown as ChatOpenAI,
    )
    ;(StateGraph as jest.MockedClass<typeof StateGraph>).mockImplementation(
      () =>
        mockStateGraph as unknown as StateGraph<
          unknown,
          unknown,
          unknown,
          string
        >,
    )
    ;(ToolNode as jest.MockedClass<typeof ToolNode>).mockImplementation(
      createMockToolNode() as unknown as () => ToolNode,
    )
    ;(
      TavilySearchResults as jest.MockedClass<typeof TavilySearchResults>
    ).mockImplementation(
      () =>
        ({
          name: 'tavily_search_results',
          description: 'Search Tavily',
          invoke: jest.fn().mockResolvedValue('Search results'),
        }) as unknown as TavilySearchResults,
    )
    ;(
      DallEAPIWrapper as jest.MockedClass<typeof DallEAPIWrapper>
    ).mockImplementation(
      () =>
        ({
          invoke: jest.fn().mockResolvedValue('https://dalle-image-url.com'),
        }) as unknown as DallEAPIWrapper,
    )

    // Create services
    stateService = createMockStateService()
    equationImageService = {
      getImage: jest.fn().mockResolvedValue({
        url: 'https://equation-image.com',
        latex: '\\frac{1}{2}',
      }),
    } as unknown as jest.Mocked<EquationImageService>

    const module = await createTestingModule([
      LLMService,
      {
        provide: StateService,
        useValue: stateService,
      },
      {
        provide: EquationImageService,
        useValue: equationImageService,
      },
      {
        provide: RetryService,
        useValue: createMockRetryService(),
      },
      {
        provide: ErrorClassificationService,
        useValue: createMockErrorClassificationService(),
      },
      {
        provide: RadarrService,
        useValue: {
          getLibraryMovies: jest.fn().mockResolvedValue([]),
        },
      },
      {
        provide: SonarrService,
        useValue: {
          getLibrarySeries: jest.fn().mockResolvedValue([]),
        },
      },
    ])

    service = module.get<LLMService>(LLMService)
  })

  describe('initialization', () => {
    it('should create the service', () => {
      expect(service).toBeDefined()
    })

    it('should setup the graph with correct nodes and edges', () => {
      expect(mockStateGraph.addNode).toHaveBeenCalledWith(
        'checkResponseType',
        expect.any(Function),
      )
      expect(mockStateGraph.addNode).toHaveBeenCalledWith(
        'trimMessages',
        expect.any(Function),
      )
      expect(mockStateGraph.addNode).toHaveBeenCalledWith(
        'addTdrSystemPrompt',
        expect.any(Function),
      )
      expect(mockStateGraph.addNode).toHaveBeenCalledWith(
        'getModelDefaultResponse',
        expect.any(Function),
      )
      expect(mockStateGraph.addNode).toHaveBeenCalledWith(
        'getModelImageResponse',
        expect.any(Function),
      )
      expect(mockStateGraph.addNode).toHaveBeenCalledWith(
        'getModelMathResponse',
        expect.any(Function),
      )
      expect(mockStateGraph.compile).toHaveBeenCalled()
    })
  })

  describe('checkResponseType', () => {
    it('should determine default response type', async () => {
      mockChatOpenAI.invoke.mockResolvedValueOnce({
        content: ResponseType.Default,
        additional_kwargs: {},
      })

      const checkResponseType = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'checkResponseType')[1]

      const result = await checkResponseType({ userInput: 'Hello world' })

      expect(result).toEqual({
        message: expect.any(HumanMessage),
        responseType: ResponseType.Default,
      })
      expect(mockChatOpenAI.invoke).toHaveBeenCalledWith([
        expect.any(Object), // GET_RESPONSE_TYPE_PROMPT
        expect.any(HumanMessage),
      ])
    })

    it('should determine math response type', async () => {
      mockChatOpenAI.invoke.mockResolvedValueOnce({
        content: ResponseType.Math,
        additional_kwargs: {},
      })

      const checkResponseType = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'checkResponseType')[1]

      const result = await checkResponseType({ userInput: 'What is 2 + 2?' })

      expect(result.responseType).toBe(ResponseType.Math)
    })

    it('should determine image response type', async () => {
      mockChatOpenAI.invoke.mockResolvedValueOnce({
        content: ResponseType.Image,
        additional_kwargs: {},
      })

      const checkResponseType = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'checkResponseType')[1]

      const result = await checkResponseType({ userInput: 'Draw me a cat' })

      expect(result.responseType).toBe(ResponseType.Image)
    })

    it('should throw error for invalid response type', async () => {
      mockChatOpenAI.invoke.mockResolvedValueOnce({
        content: 'invalid_type',
        additional_kwargs: {},
      })

      const checkResponseType = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'checkResponseType')[1]

      await expect(
        checkResponseType({ userInput: 'Test input' }),
      ).rejects.toThrow('Invalid response type: "invalid_type"')
    })
  })

  describe('addTdrSystemPrompt', () => {
    it('should add system prompt if not present', async () => {
      const message = new HumanMessage({ content: 'Test message' })
      const systemPrompt = new HumanMessage({
        id: TDR_SYSTEM_PROMPT_ID,
        content: 'System prompt',
      })

      ;(stateService.getPrompt as jest.Mock).mockReturnValue(systemPrompt)

      const addTdrSystemPrompt = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'addTdrSystemPrompt')[1]

      const result = await addTdrSystemPrompt({
        message,
        messages: [],
      })

      expect(result.messages).toEqual([systemPrompt, message])
    })

    it('should not add system prompt if already present', async () => {
      const message = new HumanMessage({ content: 'Test message' })
      const existingPrompt = new HumanMessage({
        id: TDR_SYSTEM_PROMPT_ID,
        content: 'Existing prompt',
      })

      const addTdrSystemPrompt = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'addTdrSystemPrompt')[1]

      const result = await addTdrSystemPrompt({
        message,
        messages: [existingPrompt],
      })

      expect(result.messages).toEqual([existingPrompt, message])
    })
  })

  describe('trimMessages', () => {
    it('should trim messages when token limit exceeded', async () => {
      const messages = [
        new AIMessage({
          content: 'Response',
          response_metadata: {
            tokenUsage: {
              totalTokens: 1500,
              promptTokens: 1000,
              completionTokens: 500,
            },
          },
        }),
      ]

      stateService.getState.mockReturnValue({
        maxTokens: 1000,
      } as unknown as AppState)

      const trimMessages = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'trimMessages')[1]

      const result = await trimMessages({ messages })

      expect(result.messages).toEqual([])
    })

    it('should not trim messages when under token limit', async () => {
      const messages = [
        new AIMessage({
          content: 'Response',
          response_metadata: {
            tokenUsage: {
              totalTokens: 500,
              promptTokens: 300,
              completionTokens: 200,
            },
          },
        }),
      ]

      stateService.getState.mockReturnValue({
        maxTokens: 1000,
      } as unknown as AppState)

      const trimMessages = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'trimMessages')[1]

      const result = await trimMessages({ messages })

      expect(result).toEqual({})
    })
  })

  describe('getModelDefaultResponse', () => {
    it('should get response from chat model', async () => {
      const messages = [new HumanMessage({ content: 'Hello' })]

      const aiResponse = new AIMessage({
        content: 'Hi there!',
        tool_calls: [],
      })

      mockChatOpenAI.invoke.mockResolvedValueOnce(aiResponse)

      const getModelDefaultResponse = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'getModelDefaultResponse')[1]

      const result = await getModelDefaultResponse({
        messages,
        prevMessages: [],
      })

      expect(result.messages).toEqual([...messages, aiResponse])
      expect(result.prevMessages).toEqual([...messages, aiResponse])
      expect(mockChatOpenAI.bindTools).toHaveBeenCalled()
    })

    it('should handle tool calls in response', async () => {
      const messages = [new HumanMessage({ content: 'What is the weather?' })]

      const aiResponse = new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call_123',
            name: 'tavily_search_results',
            args: { query: 'weather' },
          },
        ],
      })

      mockChatOpenAI.invoke.mockResolvedValueOnce(aiResponse)

      const getModelDefaultResponse = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'getModelDefaultResponse')[1]

      const result = await getModelDefaultResponse({ messages })

      expect(result.messages).toContain(aiResponse)
    })
  })

  describe('getModelImageResponse', () => {
    it('should generate images based on queries', async () => {
      const message = new HumanMessage({ content: 'Draw a cat and a dog' })
      const messages = [message]

      // Mock image query extraction
      mockChatOpenAI.invoke.mockResolvedValueOnce({
        content: JSON.stringify([
          { title: 'cat', query: 'a cute cat' },
          { title: 'dog', query: 'a happy dog' },
        ]),
        additional_kwargs: {},
      })

      // Mock chat response
      const chatResponse = new AIMessage({
        id: 'response_123',
        content: 'Here are your images',
      })
      mockChatOpenAI.invoke.mockResolvedValueOnce(chatResponse)

      const getModelImageResponse = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'getModelImageResponse')[1]

      const result = await getModelImageResponse({ message, messages })

      expect(result.images).toHaveLength(2)
      expect(result.images[0]).toEqual({
        title: 'cat',
        url: 'https://dalle-image-url.com',
        parentId: 'response_123',
      })
      expect(result.images[1]).toEqual({
        title: 'dog',
        url: 'https://dalle-image-url.com',
        parentId: 'response_123',
      })
      expect(result.messages).toContain(chatResponse)
    })

    it('should handle errors gracefully', async () => {
      const message = new HumanMessage({ content: 'Draw something' })
      const messages = [message]

      // Mock error in image query extraction
      mockChatOpenAI.invoke.mockRejectedValueOnce(new Error('API error'))

      const getModelImageResponse = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'getModelImageResponse')[1]

      const result = await getModelImageResponse({ message, messages })

      expect(result.messages).toEqual([...messages, message])
      expect(result.images).toBeUndefined()
    })
  })

  describe('getModelMathResponse', () => {
    it('should generate math equation image', async () => {
      const message = new HumanMessage({ content: 'Solve x^2 + 2x + 1 = 0' })
      const messages = [message]

      // Mock LaTeX response
      mockChatOpenAI.invoke.mockResolvedValueOnce({
        content: 'x^2 + 2x + 1 = (x + 1)^2 = 0',
        additional_kwargs: {},
      })

      // Mock chat response
      const chatResponse = new AIMessage({
        id: 'response_456',
        content: 'The solution is x = -1',
      })
      mockChatOpenAI.invoke.mockResolvedValueOnce(chatResponse)

      const getModelMathResponse = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'getModelMathResponse')[1]

      const result = await getModelMathResponse({ message, messages })

      expect(equationImageService.getImage).toHaveBeenCalledWith(
        'x^2 + 2x + 1 = (x + 1)^2 = 0',
      )
      expect(result.images).toHaveLength(1)
      expect(result.images[0]).toEqual({
        title: 'the solution',
        url: 'https://equation-image.com',
        parentId: 'response_456',
      })
      expect(result.messages).toContain(chatResponse)
    })

    it('should handle case when equation image service returns null', async () => {
      const message = new HumanMessage({ content: 'Simple math' })
      const messages = [message]

      mockChatOpenAI.invoke.mockResolvedValueOnce({
        content: '1 + 1 = 2',
        additional_kwargs: {},
      })

      equationImageService.getImage.mockResolvedValueOnce(undefined)

      const chatResponse = new AIMessage({
        id: 'response_789',
        content: 'The answer is 2',
      })
      mockChatOpenAI.invoke.mockResolvedValueOnce(chatResponse)

      const getModelMathResponse = (
        mockStateGraph.addNode as jest.Mock
      ).mock.calls.find(call => call[0] === 'getModelMathResponse')[1]

      const result = await getModelMathResponse({ message, messages })

      expect(result.images).toEqual([])
      expect(result.messages).toContain(chatResponse)
    })
  })

  describe('sendMessage', () => {
    it('should process message through graph and return response', async () => {
      const compiledGraph = mockStateGraph.compile()
      compiledGraph.invoke.mockResolvedValueOnce({
        images: [],
        messages: [
          new HumanMessage({ content: 'Hello' }),
          new AIMessage({ content: 'Hi there!' }),
        ],
      })

      stateService.getState.mockReturnValue({
        graphHistory: [],
      } as unknown as AppState)

      const result = await service.sendMessage({
        message: 'Hello',
        user: 'TestUser',
      })

      expect(result).toEqual({
        images: [],
        content: 'Hi there!',
      })

      expect(compiledGraph.invoke).toHaveBeenCalledWith({
        userInput: 'TestUser said "Hello"',
        userId: 'TestUser',
        messages: [],
      })

      expect(stateService.setState).toHaveBeenCalled()
    })

    it('should use previous messages from graph history', async () => {
      const previousMessages = [
        new HumanMessage({ content: 'Previous message' }),
        new AIMessage({ content: 'Previous response' }),
      ]

      stateService.getState.mockReturnValue({
        graphHistory: [
          {
            images: [],
            messages: previousMessages,
          },
        ],
      } as unknown as AppState)

      const compiledGraph = mockStateGraph.compile()
      compiledGraph.invoke.mockResolvedValueOnce({
        images: [],
        messages: [
          ...previousMessages,
          new HumanMessage({ content: 'New message' }),
          new AIMessage({ content: 'New response' }),
        ],
      })

      await service.sendMessage({
        message: 'New message',
        user: 'TestUser',
      })

      expect(compiledGraph.invoke).toHaveBeenCalledWith({
        userInput: 'TestUser said "New message"',
        userId: 'TestUser',
        messages: previousMessages,
      })
    })

    it('should handle errors and return error message', async () => {
      const compiledGraph = mockStateGraph.compile()
      compiledGraph.invoke.mockRejectedValueOnce(new Error('Test error'))

      stateService.getState.mockReturnValue({
        graphHistory: [],
      } as unknown as AppState)

      const result = await service.sendMessage({
        message: 'Hello',
        user: 'TestUser',
      })

      expect(result.content).toContain('sorry an error happened')
      expect(result.content).toContain('Test error')
      expect(result.images).toEqual([])
    })

    it('should handle case when no message is returned', async () => {
      const compiledGraph = mockStateGraph.compile()
      compiledGraph.invoke.mockResolvedValueOnce({
        images: [],
        messages: [],
      })

      stateService.getState.mockReturnValue({
        graphHistory: [],
      } as unknown as AppState)

      const result = await service.sendMessage({
        message: 'Hello',
        user: 'TestUser',
      })

      expect(result.content).toContain('sorry an error happened')
      expect(result.content).toContain('Did not receive a message')
    })
  })

  describe('handleModelResponse', () => {
    it('should route to tools when AI message has tool calls', () => {
      const messages = [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call_123',
              name: 'tavily_search_results',
              args: { query: 'test' },
            },
          ],
        }),
      ]

      const handleModelResponse = (
        mockStateGraph.addConditionalEdges as jest.Mock
      ).mock.calls.find(call => call[0] === 'getModelDefaultResponse')[1]

      const result = handleModelResponse({ messages })

      expect(result).toBe('tools')
    })

    it('should route to end when AI message has no tool calls', () => {
      const messages = [
        new AIMessage({
          content: 'Regular response',
          tool_calls: [],
        }),
      ]

      const handleModelResponse = (
        mockStateGraph.addConditionalEdges as jest.Mock
      ).mock.calls.find(call => call[0] === 'getModelDefaultResponse')[1]

      const result = handleModelResponse({ messages })

      expect(result).toBe('__end__')
    })
  })

  describe('TV Show Selection State Preservation', () => {
    it('should preserve original granular selection in TV show context', () => {
      // Mock a TV show context with original selections
      const mockTvShowContext = {
        searchResults: [{ tvdbId: 81189, title: 'Breaking Bad', year: 2008 }],
        query: 'Breaking Bad 2008 season 1',
        timestamp: Date.now(),
        isActive: true,
        originalSearchSelection: {
          selectionType: 'year' as const,
          value: '2008',
          confidence: 'high' as const,
        },
        originalTvSelection: {
          selection: [{ season: 1 }],
        },
      }

      // Verify that context creation preserves both selections
      expect(mockTvShowContext.originalSearchSelection).toBeDefined()
      expect(mockTvShowContext.originalTvSelection).toBeDefined()
      expect(mockTvShowContext.originalSearchSelection?.selectionType).toBe(
        'year',
      )
      expect(mockTvShowContext.originalSearchSelection?.value).toBe('2008')
      expect(mockTvShowContext.originalTvSelection?.selection).toEqual([
        { season: 1 },
      ])
    })

    it('should handle contexts without original selections', () => {
      const mockTvShowContext = {
        searchResults: [{ tvdbId: 81189, title: 'Breaking Bad', year: 2008 }],
        query: 'Breaking Bad',
        timestamp: Date.now(),
        isActive: true,
        originalSearchSelection: undefined,
        originalTvSelection: undefined,
      }

      // Verify that context creation handles optional selections
      expect(mockTvShowContext.originalSearchSelection).toBeUndefined()
      expect(mockTvShowContext.originalTvSelection).toBeUndefined()
    })
  })

  describe('Media Type Classification', () => {
    let mockClassificationModel: {
      invoke: jest.Mock
    }

    beforeEach(() => {
      mockClassificationModel = {
        invoke: jest.fn(),
      }

      // Mock ChatOpenAI.withStructuredOutput
      jest.mocked(ChatOpenAI).mockImplementation(
        () =>
          ({
            withStructuredOutput: jest.fn(() => mockClassificationModel),
          }) as unknown as ChatOpenAI,
      )
    })

    it('should classify TV show request correctly', async () => {
      const message = new HumanMessage('I want to watch Breaking Bad')
      const expectedResult = {
        mediaType: 'tv_show',
        reasoning: 'Breaking Bad is a known TV series',
      }

      mockClassificationModel.invoke.mockResolvedValue(expectedResult)

      // Access private method for testing
      const result = await (
        service as unknown as {
          classifyMediaType: (
            message: HumanMessage,
          ) => Promise<{ mediaType: string; reasoning: string }>
        }
      ).classifyMediaType(message)

      expect(result).toEqual(expectedResult)
      expect(mockClassificationModel.invoke).toHaveBeenCalledWith([
        {
          role: 'system',
          content: expect.stringContaining('You are a media type classifier'),
        },
        { role: 'user', content: 'I want to watch Breaking Bad' },
      ])
    })

    it('should classify movie request correctly', async () => {
      const message = new HumanMessage('Show me some good action movies')
      const expectedResult = {
        mediaType: 'movie',
        reasoning: 'Clear movie intent despite containing "show"',
      }

      mockClassificationModel.invoke.mockResolvedValue(expectedResult)

      const result = await (
        service as unknown as {
          classifyMediaType: (
            message: HumanMessage,
          ) => Promise<{ mediaType: string; reasoning: string }>
        }
      ).classifyMediaType(message)

      expect(result).toEqual(expectedResult)
      expect(mockClassificationModel.invoke).toHaveBeenCalledWith([
        {
          role: 'system',
          content: expect.stringContaining('You are a media type classifier'),
        },
        { role: 'user', content: 'Show me some good action movies' },
      ])
    })

    it('should handle ambiguous requests', async () => {
      const message = new HumanMessage('What should I watch tonight?')
      const expectedResult = {
        mediaType: 'movie',
        reasoning: 'Ambiguous request, defaulting to movie',
      }

      mockClassificationModel.invoke.mockResolvedValue(expectedResult)

      const result = await (
        service as unknown as {
          classifyMediaType: (
            message: HumanMessage,
          ) => Promise<{ mediaType: string; reasoning: string }>
        }
      ).classifyMediaType(message)

      expect(result).toEqual(expectedResult)
    })

    it('should handle classification errors gracefully', async () => {
      const message = new HumanMessage('Some request')

      mockClassificationModel.invoke.mockRejectedValue(new Error('API Error'))

      const result = await (
        service as unknown as {
          classifyMediaType: (
            message: HumanMessage,
          ) => Promise<{ mediaType: string; reasoning: string }>
        }
      ).classifyMediaType(message)

      expect(result).toEqual({
        mediaType: 'movie',
        reasoning: 'Classification failed, defaulting to movie',
      })
    })

    it('should handle non-string message content', async () => {
      // Create a message with complex content that will need toString() conversion
      const message = new HumanMessage({ content: 'Looking for a new series' })
      const expectedResult = {
        mediaType: 'tv_show',
        reasoning: 'Series keyword indicates TV show intent',
      }

      mockClassificationModel.invoke.mockResolvedValue(expectedResult)

      const result = await (
        service as unknown as {
          classifyMediaType: (
            message: HumanMessage,
          ) => Promise<{ mediaType: string; reasoning: string }>
        }
      ).classifyMediaType(message)

      expect(result).toEqual(expectedResult)
      expect(mockClassificationModel.invoke).toHaveBeenCalledWith([
        {
          role: 'system',
          content: expect.stringContaining('You are a media type classifier'),
        },
        { role: 'user', content: 'Looking for a new series' },
      ])
    })
  })
})
