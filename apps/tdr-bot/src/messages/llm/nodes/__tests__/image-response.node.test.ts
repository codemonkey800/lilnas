import { AIMessage, HumanMessage } from '@langchain/core/messages'

import {
  createMockMetricsService,
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { ImageResponseNode } from 'src/messages/llm/nodes/image-response.node'
import { ResponseType } from 'src/schemas/graph'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import { RetryService } from 'src/utils/retry.service'

jest.mock('src/messages/llm/tools', () => ({
  getTools: jest.fn().mockReturnValue([]),
}))
jest.mock('@langchain/openai', () => ({
  DallEAPIWrapper: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue('https://example.com/generated.png'),
  })),
}))

function makeHuman(content = 'generate a cat'): HumanMessage {
  return new HumanMessage({ id: 'h-1', content })
}

function makeAI(content = 'Here is your image'): AIMessage {
  return new AIMessage({ id: 'ai-chat', content })
}

function makeQueriesResponse(
  queries: Array<{ title: string; query: string }>,
): AIMessage {
  return new AIMessage({ id: 'ai-q', content: JSON.stringify(queries) })
}

function buildState(message = makeHuman(), messages: AIMessage[] = []) {
  return {
    message,
    messages,
    userInput: '',
    userId: 'u',
    guildId: 'g',
    images: [],
    responseType: ResponseType.Image,
  }
}

describe('ImageResponseNode', () => {
  let node: ImageResponseNode
  let retryService: jest.Mocked<RetryService>
  let reasoningModel: { invoke: jest.Mock }
  let chatModel: { invoke: jest.Mock }
  let modelFactory: jest.Mocked<ModelFactoryService>
  let dalleInvoke: jest.Mock

  beforeEach(async () => {
    retryService = createMockRetryService()

    const queries = [{ title: 'Cat', query: 'a cute cat on a windowsill' }]
    reasoningModel = {
      invoke: jest.fn().mockResolvedValue(makeQueriesResponse(queries)),
    }
    chatModel = { invoke: jest.fn().mockResolvedValue(makeAI()) }

    modelFactory = {
      createReasoningModel: jest.fn().mockReturnValue(reasoningModel),
      createChatModel: jest.fn().mockReturnValue(chatModel),
    } as unknown as jest.Mocked<ModelFactoryService>

    const { DallEAPIWrapper } = jest.requireMock('@langchain/openai') as {
      DallEAPIWrapper: jest.Mock
    }
    dalleInvoke = jest.fn().mockResolvedValue('https://example.com/cat.png')
    DallEAPIWrapper.mockImplementation(() => ({ invoke: dalleInvoke }))

    const module = await createTestingModule([
      ImageResponseNode,
      { provide: ModelFactoryService, useValue: modelFactory },
      { provide: RetryService, useValue: retryService },
      { provide: TdrBotMetricsService, useValue: createMockMetricsService() },
    ])

    node = module.get(ImageResponseNode)
  })

  it('extracts image queries from reasoning model response', async () => {
    const queries = [
      { title: 'Cat', query: 'a cute cat' },
      { title: 'Dog', query: 'a playful dog' },
    ]
    reasoningModel.invoke.mockResolvedValue(makeQueriesResponse(queries))
    dalleInvoke.mockResolvedValue('https://example.com/img.png')

    await node.invoke(buildState())

    expect(dalleInvoke).toHaveBeenCalledTimes(2)
    expect(dalleInvoke).toHaveBeenNthCalledWith(1, 'a cute cat')
    expect(dalleInvoke).toHaveBeenNthCalledWith(2, 'a playful dog')
  })

  it('returns images with title, url, and parentId from chat response', async () => {
    const chatResponse = makeAI('Here are your images')
    chatModel.invoke.mockResolvedValue(chatResponse)
    dalleInvoke.mockResolvedValue('https://example.com/cat.png')

    const result = await node.invoke(buildState())

    expect(result.images).toHaveLength(1)
    expect(result.images![0]).toMatchObject({
      title: 'Cat',
      url: 'https://example.com/cat.png',
      parentId: chatResponse.id,
    })
  })

  it('returns message array with user message and chat response', async () => {
    const chatResponse = makeAI('Generated!')
    chatModel.invoke.mockResolvedValue(chatResponse)
    const userMsg = makeHuman('make me a picture')

    const result = await node.invoke(buildState(userMsg))

    expect(result.messages).toEqual([userMsg, chatResponse])
  })

  it('returns error fallback when query extraction fails', async () => {
    reasoningModel.invoke.mockRejectedValue(new Error('API error'))

    const result = await node.invoke(buildState())

    expect(result.images).toEqual([])
    expect(result.messages).toHaveLength(2)
    const lastMsg = result.messages![result.messages!.length - 1]
    expect((lastMsg as AIMessage).content).toContain(
      "couldn't generate the image",
    )
  })

  it('returns error fallback when DALL-E generation fails', async () => {
    dalleInvoke.mockRejectedValue(new Error('DALL-E rate limit'))

    const result = await node.invoke(buildState())

    expect(result.images).toEqual([])
    expect(result.messages).toHaveLength(2)
    const lastMsg = result.messages![result.messages!.length - 1]
    expect((lastMsg as AIMessage).content).toContain(
      "couldn't generate the image",
    )
  })

  it('invokes DALL-E with the query string for each image query', async () => {
    const queries = [{ title: 'Sunset', query: 'beautiful sunset over ocean' }]
    reasoningModel.invoke.mockResolvedValue(makeQueriesResponse(queries))

    await node.invoke(buildState())

    expect(dalleInvoke).toHaveBeenCalledWith('beautiful sunset over ocean')
  })
})
