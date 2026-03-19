import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages'

import {
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { MathResponseNode } from 'src/messages/llm/nodes/math-response.node'
import { ResponseType } from 'src/schemas/graph'
import { EquationImageService } from 'src/services/equation-image.service'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'
import { RetryService } from 'src/utils/retry.service'

jest.mock('src/messages/llm/tools', () => ({
  getTools: jest.fn().mockReturnValue([]),
}))

function makeHuman(content = 'what is 2+2?'): HumanMessage {
  return new HumanMessage({ id: 'h-1', content })
}

function makeAI(content = 'The answer is 4'): AIMessage {
  return new AIMessage({ id: 'ai-1', content })
}

function makeSystemPrompt(): SystemMessage {
  return new SystemMessage({
    id: TDR_SYSTEM_PROMPT_ID,
    content: 'You are TDR.',
  })
}

function buildState(messages = [makeHuman()], message = makeHuman()) {
  return {
    messages,
    message,
    userInput: '',
    userId: 'u',
    guildId: 'g',
    images: [],
    responseType: ResponseType.Math,
  }
}

describe('MathResponseNode', () => {
  let node: MathResponseNode
  let retryService: jest.Mocked<RetryService>
  let reasoningModel: { invoke: jest.Mock }
  let chatModel: { invoke: jest.Mock }
  let modelFactory: jest.Mocked<ModelFactoryService>
  let equationImage: jest.Mocked<EquationImageService>

  beforeEach(async () => {
    retryService = createMockRetryService()

    reasoningModel = { invoke: jest.fn().mockResolvedValue(makeAI('2+2=4')) }
    chatModel = {
      invoke: jest.fn().mockResolvedValue(makeAI('The answer is 4')),
    }

    modelFactory = {
      createReasoningModel: jest.fn().mockReturnValue(reasoningModel),
      createChatModel: jest.fn().mockReturnValue(chatModel),
    } as unknown as jest.Mocked<ModelFactoryService>

    equationImage = {
      getImage: jest.fn().mockResolvedValue({
        url: 'https://example.com/eq.png',
        bucket: 'test',
        file: 'eq.png',
      }),
    } as unknown as jest.Mocked<EquationImageService>

    const module = await createTestingModule([
      MathResponseNode,
      { provide: ModelFactoryService, useValue: modelFactory },
      { provide: RetryService, useValue: retryService },
      { provide: EquationImageService, useValue: equationImage },
    ])

    node = module.get(MathResponseNode)
  })

  it('returns equation image with parentId from chat response and user message', async () => {
    const chatResponse = makeAI('The answer is 4')
    chatModel.invoke.mockResolvedValue(chatResponse)
    equationImage.getImage.mockResolvedValue({
      url: 'https://example.com/eq.png',
      bucket: 'test',
      file: 'eq.png',
    })

    const userMsg = makeHuman('what is 2+2?')
    const result = await node.invoke(buildState([], userMsg))

    expect(result.images).toHaveLength(1)
    expect(result.images![0]).toMatchObject({
      title: 'the solution',
      url: 'https://example.com/eq.png',
      parentId: chatResponse.id,
    })
    expect(result.messages).toEqual([userMsg, chatResponse])
  })

  it('returns empty images when equationImage.getImage returns undefined', async () => {
    equationImage.getImage.mockResolvedValue(undefined)

    const result = await node.invoke(buildState())

    expect(result.images).toEqual([])
  })

  it('filters out system prompt from messages passed to LaTeX model', async () => {
    const sysPrompt = makeSystemPrompt()
    const humanMsg = makeHuman('what is e^(i*pi)?')
    const messages = [sysPrompt, humanMsg]

    await node.invoke(buildState(messages, makeHuman()))

    const latexModelCall = reasoningModel.invoke.mock.calls[0][0] as unknown[]
    const hasSystemPrompt = latexModelCall.some(
      m => (m as SystemMessage).id === TDR_SYSTEM_PROMPT_ID,
    )
    expect(hasSystemPrompt).toBe(false)
  })

  it('runs equationImage.getImage and chatModel in parallel', async () => {
    const callOrder: string[] = []

    equationImage.getImage.mockImplementation(async () => {
      callOrder.push('image-start')
      await new Promise(r => setTimeout(r, 50))
      callOrder.push('image-end')
      return { url: 'https://example.com/eq.png', bucket: 'b', file: 'f' }
    })

    chatModel.invoke.mockImplementation(async () => {
      callOrder.push('chat-start')
      await new Promise(r => setTimeout(r, 50))
      callOrder.push('chat-end')
      return makeAI()
    })

    await node.invoke(buildState())

    // With Promise.all, both operations start before either ends
    expect(callOrder.indexOf('chat-start')).toBeLessThan(
      callOrder.indexOf('image-end'),
    )
    expect(callOrder.indexOf('image-start')).toBeLessThan(
      callOrder.indexOf('chat-end'),
    )
  })

  it('uses retryService for both reasoning model and chat model calls', async () => {
    await node.invoke(buildState())

    // executeWithRetry called at least twice (one for each model)
    expect(retryService.executeWithRetry).toHaveBeenCalledTimes(2)
  })
})
