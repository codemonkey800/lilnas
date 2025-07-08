import { TavilySearchResults } from '@langchain/community/tools/tavily_search'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { StateGraph } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI, DallEAPIWrapper } from '@langchain/openai'
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter'
import { Test } from '@nestjs/testing'
import axios from 'axios'
import { Client, Collection, User } from 'discord.js'

import {
  createMockAxiosResponse,
  createMockChatOpenAI,
  createMockStateGraph,
  MessageBuilder,
} from 'src/__tests__/test-utils'
import { ChatService } from 'src/message-handler/chat.service'
import { KeywordsService } from 'src/message-handler/keywords.service'
import { LLMService } from 'src/message-handler/llm.service'
import { MessageHandlerService } from 'src/message-handler/message-handler.service'
import { ResponseType } from 'src/schemas/graph'
import { EquationImageService } from 'src/services/equation-image.service'
import { StateService } from 'src/state/state.service'

// Mock all external dependencies
jest.mock('@langchain/openai')
jest.mock('@langchain/langgraph')
jest.mock('@langchain/langgraph/prebuilt')
jest.mock('@langchain/community/tools/tavily_search')
jest.mock('axios')

describe('Message Handler Integration Tests', () => {
  let messageHandler: MessageHandlerService
  // let _llmService: LLMService
  let stateService: StateService
  let eventEmitter: EventEmitter2
  let mockChatOpenAI: ReturnType<typeof createMockChatOpenAI>
  let mockStateGraph: ReturnType<typeof createMockStateGraph>
  let mockClient: jest.Mocked<Client>

  beforeEach(async () => {
    // Setup mocks
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
      () => jest.fn() as unknown as ToolNode,
    )
    ;(
      TavilySearchResults as jest.MockedClass<typeof TavilySearchResults>
    ).mockImplementation(
      () =>
        ({
          name: 'tavily_search_results',
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

    // Create mock Discord client
    mockClient = {
      user: { id: 'bot-id', username: 'TestBot' },
      on: jest.fn(),
      once: jest.fn(),
      guilds: {
        cache: new Collection(),
      },
      channels: {
        cache: new Collection(),
        fetch: jest.fn(),
      },
      users: {
        cache: new Collection(),
        fetch: jest.fn(),
      },
    } as unknown as jest.Mocked<Client>

    // Create testing module with all services
    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        MessageHandlerService,
        ChatService,
        KeywordsService,
        LLMService,
        StateService,
        EquationImageService,
        {
          provide: Client,
          useValue: mockClient,
        },
      ],
    }).compile()

    messageHandler = module.get<MessageHandlerService>(MessageHandlerService)
    // _llmService = module.get<LLMService>(LLMService)
    stateService = module.get<StateService>(StateService)
    eventEmitter = module.get<EventEmitter2>(EventEmitter2)
  })

  describe('full message flow', () => {
    it('should process a simple chat message', async () => {
      // Setup LLM responses
      mockChatOpenAI.invoke
        .mockResolvedValueOnce({
          content: ResponseType.Default,
          additional_kwargs: {},
        })
        .mockResolvedValueOnce({
          content: 'Hello! How can I help you today?',
          tool_calls: [],
          additional_kwargs: {},
        })

      const compiledGraph = mockStateGraph.compile()
      compiledGraph.invoke.mockImplementation(
        async ({ userInput }: { userInput: string }) => ({
          images: [],
          messages: [
            new HumanMessage({ content: userInput }),
            new AIMessage({ content: 'Hello! How can I help you today?' }),
          ],
        }),
      )

      // Create and process message
      const message = new MessageBuilder()
        .withContent('Hello')
        .withAuthor({ id: 'user123', username: 'testuser' } as Partial<User>)
        .inGuild()
        .withMention('bot-id')
        .build()

      await messageHandler.onMessage([message])

      // Verify the message was processed
      expect(message.channel.sendTyping).toHaveBeenCalled()
      expect(message.reply).toHaveBeenCalledWith({
        content: 'Hello! How can I help you today?',
      })
    })

    it('should handle math equations with image generation', async () => {
      // Setup for math response type
      mockChatOpenAI.invoke
        .mockResolvedValueOnce({
          content: ResponseType.Math,
          additional_kwargs: {},
        })
        .mockResolvedValueOnce({
          content: 'x^2 + 2x + 1 = (x + 1)^2',
          additional_kwargs: {},
        })
        .mockResolvedValueOnce({
          content: 'The solution is x = -1',
          additional_kwargs: {},
        })

      // Mock equation service
      ;(axios as jest.Mocked<typeof axios>).post.mockResolvedValue(
        createMockAxiosResponse({
          bucket: 'equations',
          file: 'equation.png',
          url: 'https://storage.lilnas.io/equations/equation.png',
        }),
      )

      const compiledGraph = mockStateGraph.compile()
      compiledGraph.invoke.mockImplementation(async () => ({
        images: [
          {
            title: 'the solution',
            url: 'https://storage.lilnas.io/equations/equation.png',
            parentId: 'msg123',
          },
        ],
        messages: [
          new HumanMessage({ content: 'Solve x^2 + 2x + 1 = 0' }),
          new AIMessage({
            id: 'msg123',
            content: 'The solution is x = -1',
          }),
        ],
      }))

      const message = new MessageBuilder()
        .withContent('Solve x^2 + 2x + 1 = 0')
        .inGuild()
        .withMention('bot-id')
        .build()

      await messageHandler.onMessage([message])

      expect(message.reply).toHaveBeenCalledWith({
        content: 'The solution is x = -1',
        embeds: [
          expect.objectContaining({
            setTitle: expect.any(Function),
            setImage: expect.any(Function),
          }),
        ],
      })
    })

    it('should handle image generation requests', async () => {
      // Setup for image response type
      mockChatOpenAI.invoke
        .mockResolvedValueOnce({
          content: ResponseType.Image,
          additional_kwargs: {},
        })
        .mockResolvedValueOnce({
          content: JSON.stringify([
            { title: 'sunset', query: 'beautiful sunset over ocean' },
          ]),
          additional_kwargs: {},
        })
        .mockResolvedValueOnce({
          content: 'Here is your beautiful sunset image!',
          additional_kwargs: {},
        })

      const compiledGraph = mockStateGraph.compile()
      compiledGraph.invoke.mockImplementation(async () => ({
        images: [
          {
            title: 'sunset',
            url: 'https://dalle-image-url.com',
            parentId: 'msg456',
          },
        ],
        messages: [
          new HumanMessage({ content: 'Draw me a sunset' }),
          new AIMessage({
            id: 'msg456',
            content: 'Here is your beautiful sunset image!',
          }),
        ],
      }))

      const message = new MessageBuilder()
        .withContent('Draw me a sunset')
        .inGuild()
        .withMention('bot-id')
        .build()

      await messageHandler.onMessage([message])

      expect(message.reply).toHaveBeenCalledWith({
        content: 'Here is your beautiful sunset image!',
        embeds: [
          expect.objectContaining({
            setTitle: expect.any(Function),
            setImage: expect.any(Function),
          }),
        ],
      })
    })

    it('should handle tool usage in responses', async () => {
      // Setup for tool usage
      mockChatOpenAI.invoke
        .mockResolvedValueOnce({
          content: ResponseType.Default,
          additional_kwargs: {},
        })
        .mockResolvedValueOnce({
          content: '',
          tool_calls: [
            {
              id: 'call_123',
              name: 'tavily_search_results',
              args: { query: 'latest AI news' },
            },
          ],
          additional_kwargs: {},
        })
        .mockResolvedValueOnce({
          content: 'Here are the latest AI news...',
          tool_calls: [],
          additional_kwargs: {},
        })

      const compiledGraph = mockStateGraph.compile()
      compiledGraph.invoke.mockImplementation(async () => ({
        images: [],
        messages: [
          new HumanMessage({ content: 'What are the latest AI news?' }),
          new AIMessage({
            content: '',
            tool_calls: [
              {
                id: 'call_123',
                name: 'tavily_search_results',
                args: { query: 'latest AI news' },
              },
            ],
          }),
          new AIMessage({
            content: 'Here are the latest AI news...',
          }),
        ],
      }))

      const message = new MessageBuilder()
        .withContent('What are the latest AI news?')
        .inGuild()
        .withMention('bot-id')
        .build()

      await messageHandler.onMessage([message])

      expect(message.reply).toHaveBeenCalledWith({
        content: 'Here are the latest AI news...',
      })
    })

    it('should handle errors gracefully', async () => {
      // Make the graph throw an error
      const compiledGraph = mockStateGraph.compile()
      compiledGraph.invoke.mockRejectedValue(new Error('API Error'))

      const message = new MessageBuilder()
        .withContent('This will fail')
        .inGuild()
        .withMention('bot-id')
        .build()

      await messageHandler.onMessage([message])

      expect(message.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('sorry an error happened'),
        }),
      )
    })

    it('should skip messages from the bot itself', async () => {
      const message = new MessageBuilder()
        .withContent('Bot message')
        .withAuthor({ id: 'bot-id', bot: true } as Partial<User>)
        .inGuild()
        .withMention('bot-id')
        .build()

      await messageHandler.onMessage([message])

      expect(message.reply).not.toHaveBeenCalled()
      expect(message.channel.sendTyping).not.toHaveBeenCalled()
    })

    it('should maintain conversation history', async () => {
      // First message
      mockChatOpenAI.invoke
        .mockResolvedValueOnce({
          content: ResponseType.Default,
          additional_kwargs: {},
        })
        .mockResolvedValueOnce({
          content: 'Hello! I am TDR bot.',
          tool_calls: [],
          additional_kwargs: {},
        })

      const compiledGraph = mockStateGraph.compile()
      compiledGraph.invoke.mockImplementationOnce(async () => ({
        images: [],
        messages: [
          new HumanMessage({ content: 'Hello' }),
          new AIMessage({ content: 'Hello! I am TDR bot.' }),
        ],
      }))

      const message1 = new MessageBuilder()
        .withContent('Hello')
        .inGuild()
        .withMention('bot-id')
        .build()

      await messageHandler.onMessage([message1])

      // Second message - should include history
      mockChatOpenAI.invoke
        .mockResolvedValueOnce({
          content: ResponseType.Default,
          additional_kwargs: {},
        })
        .mockResolvedValueOnce({
          content: 'I am doing great, thank you for asking!',
          tool_calls: [],
          additional_kwargs: {},
        })

      compiledGraph.invoke.mockImplementationOnce(
        async ({ messages }: { messages: (HumanMessage | AIMessage)[] }) => {
          expect(messages).toHaveLength(2) // Should have previous messages
          return {
            images: [],
            messages: [
              ...messages,
              new HumanMessage({ content: 'How are you?' }),
              new AIMessage({
                content: 'I am doing great, thank you for asking!',
              }),
            ],
          }
        },
      )

      const message2 = new MessageBuilder()
        .withContent('How are you?')
        .inGuild()
        .withMention('bot-id')
        .build()

      await messageHandler.onMessage([message2])

      expect(message2.reply).toHaveBeenCalledWith({
        content: 'I am doing great, thank you for asking!',
      })
    })

    it('should handle state changes during processing', async () => {
      let stateChangeCount = 0

      eventEmitter.on('state.change', () => {
        stateChangeCount++
      })

      // Update state during message processing
      mockChatOpenAI.invoke
        .mockResolvedValueOnce({
          content: ResponseType.Default,
          additional_kwargs: {},
        })
        .mockResolvedValueOnce({
          content: 'Response with state change',
          tool_calls: [],
          additional_kwargs: {},
        })

      const compiledGraph = mockStateGraph.compile()
      compiledGraph.invoke.mockImplementation(async () => {
        // Simulate state change during processing
        stateService.setState({ temperature: 0.8 })

        return {
          images: [],
          messages: [
            new HumanMessage({ content: 'Test' }),
            new AIMessage({ content: 'Response with state change' }),
          ],
        }
      })

      const message = new MessageBuilder()
        .withContent('Test')
        .inGuild()
        .withMention('bot-id')
        .build()

      await messageHandler.onMessage([message])

      expect(stateChangeCount).toBeGreaterThan(0)
      expect(stateService.getState().temperature).toBe(0.8)
    })
  })

  describe('edge cases and error scenarios', () => {
    it('should handle empty message content', async () => {
      const message = new MessageBuilder()
        .withContent('')
        .inGuild()
        .withMention('bot-id')
        .build()

      await messageHandler.onMessage([message])

      // Empty messages will be processed but result in an error
      expect(message.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('sorry an error happened'),
        }),
      )
    })

    it('should handle concurrent messages', async () => {
      const compiledGraph = mockStateGraph.compile()
      let resolveFirst: () => void
      let resolveSecond: () => void

      const firstPromise = new Promise<void>(resolve => {
        resolveFirst = resolve
      })

      const secondPromise = new Promise<void>(resolve => {
        resolveSecond = resolve
      })

      compiledGraph.invoke
        .mockImplementationOnce(async () => {
          await firstPromise
          return {
            images: [],
            messages: [
              new HumanMessage({ content: 'First' }),
              new AIMessage({ content: 'First response' }),
            ],
          }
        })
        .mockImplementationOnce(async () => {
          await secondPromise
          return {
            images: [],
            messages: [
              new HumanMessage({ content: 'Second' }),
              new AIMessage({ content: 'Second response' }),
            ],
          }
        })

      const message1 = new MessageBuilder()
        .withContent('First')
        .inGuild()
        .withMention('bot-id')
        .build()

      const message2 = new MessageBuilder()
        .withContent('Second')
        .inGuild()
        .withMention('bot-id')
        .build()

      // Start both message processing
      const promise1 = messageHandler.onMessage([message1])
      const promise2 = messageHandler.onMessage([message2])

      // Resolve in reverse order
      resolveSecond!()
      resolveFirst!()

      await Promise.all([promise1, promise2])

      // Both should complete successfully
      expect(message1.reply).toHaveBeenCalledWith({
        content: 'First response',
      })
      expect(message2.reply).toHaveBeenCalledWith({
        content: 'Second response',
      })
    })
  })
})
