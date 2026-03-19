import { AIMessage, HumanMessage } from '@langchain/core/messages'

import { createTestingModule } from 'src/__tests__/test-utils'
import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import { MediaResponseNode } from 'src/messages/llm/nodes/media-response.node'
import { ResponseType } from 'src/schemas/graph'

function makeHuman(content = 'find Inception'): HumanMessage {
  return new HumanMessage({ id: 'h-1', content })
}

function makeAI(content = 'Found Inception'): AIMessage {
  return new AIMessage({ id: 'ai-1', content })
}

describe('MediaResponseNode', () => {
  let node: MediaResponseNode
  let mediaRequestHandler: jest.Mocked<MediaRequestHandler>

  beforeEach(async () => {
    mediaRequestHandler = {
      handleRequest: jest.fn().mockResolvedValue({
        messages: [makeAI()],
        images: [],
      }),
      hasActiveMediaContext: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<MediaRequestHandler>

    const module = await createTestingModule([
      MediaResponseNode,
      { provide: MediaRequestHandler, useValue: mediaRequestHandler },
    ])

    node = module.get(MediaResponseNode)
  })

  it('delegates to mediaRequestHandler.handleRequest', async () => {
    const message = makeHuman('find Inception')
    const messages = [makeHuman('previous')]
    const state = {
      message,
      messages,
      userId: 'user-1',
      guildId: 'g',
      userInput: 'find Inception',
      images: [],
      responseType: ResponseType.Media,
    }

    await node.invoke(state)

    expect(mediaRequestHandler.handleRequest).toHaveBeenCalledWith(
      message,
      messages,
      'user-1',
      undefined,
    )
  })

  it('returns the result from mediaRequestHandler.handleRequest', async () => {
    const aiMsg = makeAI('Found it!')
    const images = [
      {
        title: 'Inception',
        url: 'https://example.com/img.png',
        parentId: 'p1',
      },
    ]
    mediaRequestHandler.handleRequest.mockResolvedValue({
      messages: [aiMsg],
      images,
    })

    const state = {
      message: makeHuman(),
      messages: [],
      userId: 'user-1',
      guildId: 'g',
      userInput: '',
      images: [],
      responseType: ResponseType.Media,
    }

    const result = await node.invoke(state)

    expect(result.messages).toEqual([aiMsg])
    expect(result.images).toEqual(images)
  })
})
