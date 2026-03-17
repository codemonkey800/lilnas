import { AIMessage, HumanMessage } from '@langchain/core/messages'

import {
  createMockMetricsService,
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { IntentDetectionNode } from 'src/messages/llm/nodes/intent-detection.node'
import { ResponseType } from 'src/schemas/graph'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import { RetryService } from 'src/utils/retry.service'

function makeModelFactory(response: AIMessage): {
  factory: jest.Mocked<ModelFactoryService>
  mockModel: { invoke: jest.Mock }
} {
  const mockModel = { invoke: jest.fn().mockResolvedValue(response) }
  const factory = {
    createReasoningModel: jest.fn().mockReturnValue(mockModel),
    createChatModel: jest.fn(),
  } as unknown as jest.Mocked<ModelFactoryService>
  return { factory, mockModel }
}

function makeMediaHandler(
  hasContext = false,
): jest.Mocked<MediaRequestHandler> {
  return {
    hasActiveMediaContext: jest.fn().mockResolvedValue(hasContext),
    handleRequest: jest.fn(),
  } as unknown as jest.Mocked<MediaRequestHandler>
}

function buildState(userInput = 'hello', userId = 'user-1') {
  return {
    userInput,
    userId,
    messages: [],
    images: [],
    message: new HumanMessage({ content: userInput }),
    responseType: ResponseType.Default,
  }
}

describe('IntentDetectionNode', () => {
  let node: IntentDetectionNode
  let retryService: jest.Mocked<RetryService>

  async function buildNode(
    factory: jest.Mocked<ModelFactoryService>,
    mediaHandler: jest.Mocked<MediaRequestHandler>,
  ) {
    retryService = createMockRetryService()
    const module = await createTestingModule([
      IntentDetectionNode,
      { provide: ModelFactoryService, useValue: factory },
      { provide: RetryService, useValue: retryService },
      { provide: MediaRequestHandler, useValue: mediaHandler },
      { provide: TdrBotMetricsService, useValue: createMockMetricsService() },
    ])
    return module.get(IntentDetectionNode)
  }

  describe('when active media context exists', () => {
    it('returns ResponseType.Media without calling the LLM', async () => {
      const { factory } = makeModelFactory(new AIMessage('default'))
      const mediaHandler = makeMediaHandler(true)
      node = await buildNode(factory, mediaHandler)

      const result = await node.invoke(buildState())

      expect(result.responseType).toBe(ResponseType.Media)
      expect(factory.createReasoningModel).not.toHaveBeenCalled()
    })

    it('includes the constructed HumanMessage in the result', async () => {
      const { factory } = makeModelFactory(new AIMessage('default'))
      const node2 = await buildNode(factory, makeMediaHandler(true))

      const result = await node2.invoke(buildState('find Inception', 'u-1'))

      expect(result.message).toBeInstanceOf(HumanMessage)
      expect((result.message as HumanMessage).content).toBe('find Inception')
    })
  })

  describe('when no active media context', () => {
    it.each([
      ['default', ResponseType.Default],
      ['math', ResponseType.Math],
      ['image', ResponseType.Image],
      ['media', ResponseType.Media],
    ])(
      'parses "%s" from LLM response as ResponseType.%s',
      async (llmContent, expected) => {
        const { factory } = makeModelFactory(new AIMessage(llmContent))
        node = await buildNode(factory, makeMediaHandler(false))

        const result = await node.invoke(buildState())

        expect(result.responseType).toBe(expected)
      },
    )

    it('calls the reasoning model with the user input message', async () => {
      const { factory, mockModel } = makeModelFactory(
        new AIMessage(ResponseType.Default),
      )
      node = await buildNode(factory, makeMediaHandler(false))

      await node.invoke(buildState('what is 2+2?', 'u-2'))

      expect(mockModel.invoke).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content: 'what is 2+2?' }),
        ]),
      )
    })

    it('creates a HumanMessage from userInput', async () => {
      const { factory } = makeModelFactory(new AIMessage(ResponseType.Default))
      node = await buildNode(factory, makeMediaHandler(false))

      const result = await node.invoke(buildState('hello there'))

      expect(result.message).toBeInstanceOf(HumanMessage)
      expect((result.message as HumanMessage).content).toBe('hello there')
    })

    it('checks hasActiveMediaContext with userId and the constructed message', async () => {
      const { factory } = makeModelFactory(new AIMessage(ResponseType.Default))
      const mediaHandler = makeMediaHandler(false)
      node = await buildNode(factory, mediaHandler)

      await node.invoke(buildState('test input', 'specific-user'))

      expect(mediaHandler.hasActiveMediaContext).toHaveBeenCalledWith(
        'specific-user',
        expect.any(HumanMessage),
      )
    })

    it('throws when LLM returns an unrecognized response type', async () => {
      const { factory } = makeModelFactory(
        new AIMessage('I think you want default'),
      )
      node = await buildNode(factory, makeMediaHandler(false))

      await expect(node.invoke(buildState())).rejects.toThrow()
    })
  })
})
