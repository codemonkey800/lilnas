import { AIMessage, HumanMessage } from '@langchain/core/messages'

import {
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { DefaultResponseNode } from 'src/messages/llm/nodes/default-response.node'
import { ResponseType } from 'src/schemas/graph'
import { RetryService } from 'src/utils/retry.service'

jest.mock('src/messages/llm/tools', () => ({
  getTools: jest.fn().mockReturnValue([]),
}))

function makeHuman(content = 'user msg'): HumanMessage {
  return new HumanMessage({ id: 'h-1', content })
}

function makeAI(content = 'ai response'): AIMessage {
  return new AIMessage({ id: 'ai-1', content })
}

describe('DefaultResponseNode', () => {
  let node: DefaultResponseNode
  let retryService: jest.Mocked<RetryService>
  let mockModel: { invoke: jest.Mock }
  let modelFactory: jest.Mocked<ModelFactoryService>

  beforeEach(async () => {
    retryService = createMockRetryService()
    mockModel = { invoke: jest.fn().mockResolvedValue(makeAI()) }
    modelFactory = {
      createChatModel: jest.fn().mockReturnValue(mockModel),
      createReasoningModel: jest.fn(),
    } as unknown as jest.Mocked<ModelFactoryService>

    const module = await createTestingModule([
      DefaultResponseNode,
      { provide: ModelFactoryService, useValue: modelFactory },
      { provide: RetryService, useValue: retryService },
    ])

    node = module.get(DefaultResponseNode)
  })

  it('concatenates existing messages with the new user message before invoking', async () => {
    const existingMsg = makeHuman('previous')
    const newMsg = makeHuman('new msg')
    const state = {
      messages: [existingMsg],
      message: newMsg,
      userInput: '',
      userId: 'u',
      images: [],
      responseType: ResponseType.Default,
    }

    await node.invoke(state)

    expect(mockModel.invoke).toHaveBeenCalledWith([existingMsg, newMsg])
  })

  it('creates chat model with tools', async () => {
    const state = {
      messages: [],
      message: makeHuman(),
      userInput: '',
      userId: 'u',
      images: [],
      responseType: ResponseType.Default,
    }

    await node.invoke(state)

    expect(modelFactory.createChatModel).toHaveBeenCalledWith(expect.any(Array))
  })

  it('returns messages array containing the user message and AI response', async () => {
    const aiResponse = makeAI('Here is the answer')
    mockModel.invoke.mockResolvedValue(aiResponse)

    const userMsg = makeHuman('What is 2+2?')
    const state = {
      messages: [],
      message: userMsg,
      userInput: '',
      userId: 'u',
      images: [],
      responseType: ResponseType.Default,
    }

    const result = await node.invoke(state)

    expect(result.messages).toEqual([userMsg, aiResponse])
  })

  it('invokes through retryService with correct config', async () => {
    const state = {
      messages: [],
      message: makeHuman(),
      userInput: '',
      userId: 'u',
      images: [],
      responseType: ResponseType.Default,
    }

    await node.invoke(state)

    expect(retryService.executeWithRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        timeout: 45000,
      }),
      'OpenAI-getModelDefaultResponse',
    )
  })

  it('propagates errors when model invocation fails', async () => {
    mockModel.invoke.mockRejectedValue(new Error('OpenAI rate limit'))

    const state = {
      messages: [],
      message: makeHuman(),
      userInput: '',
      userId: 'u',
      images: [],
      responseType: ResponseType.Default,
    }

    await expect(node.invoke(state)).rejects.toThrow('OpenAI rate limit')
  })
})
