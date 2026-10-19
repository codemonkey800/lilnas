import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { PlaygroundController } from 'src/api/playground.controller'
import { LlmTimeoutError } from 'src/llm/client/default-llm-client'
import {
  PlaygroundModelError,
  PlaygroundService,
} from 'src/playground/playground.service'

const reply = {
  raw: 'hi :EZ:',
  reply: 'hi <:EZ:758414734805696553>',
  model: 'gpt-6-luna',
  usage: { input: 10, output: 5, cached: 0, costUsd: 0.001 },
  durationMs: 42,
  emojis: {
    counts: { dictionary: 1, repaired: 0, hallucinated: 0, unicode: 0 },
    dictionary: [
      {
        raw: ':EZ:',
        form: 'shortcode',
        name: 'EZ',
        start: 3,
        end: 7,
        key: '<:EZ:758414734805696553>',
        status: 'dictionary',
        fixes: [],
      },
    ],
    repaired: [],
    hallucinated: [],
    unicode: [],
  },
  dictionarySize: 12,
}

const validBody = {
  model: 'gpt-6-luna',
  messages: [{ role: 'user', content: 'hello' }],
}

describe('PlaygroundController', () => {
  let app: INestApplication
  let base: string
  const playground = { chat: jest.fn() }

  const post = (body?: unknown) =>
    fetch(`${base}/playground/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  beforeEach(async () => {
    jest.resetAllMocks()
    const module = await Test.createTestingModule({
      controllers: [PlaygroundController],
      providers: [{ provide: PlaygroundService, useValue: playground }],
    }).compile()
    app = module.createNestApplication({ logger: false })
    await app.init()
    await app.listen(0, '127.0.0.1')
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1')
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns the service response as JSON', async () => {
    playground.chat.mockResolvedValue(reply)

    const res = await post({
      ...validBody,
      systemPromptDraft: 'draft',
      author: '  someone  ',
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(reply)
    expect(playground.chat).toHaveBeenCalledWith({
      ...validBody,
      systemPromptDraft: 'draft',
      author: 'someone',
    })
  })

  it.each([
    ['an empty body', {}],
    [
      'an assistant-last history',
      {
        ...validBody,
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'yo' },
        ],
      },
    ],
    ['an unknown field', { ...validBody, temperature: 1 }],
    ['an empty model', { ...validBody, model: '' }],
    ['no messages', { ...validBody, messages: [] }],
    [
      'a blank message',
      { ...validBody, messages: [{ role: 'user', content: '  ' }] },
    ],
  ])('400s for %s', async (_, body) => {
    const res = await post(body)

    expect(res.status).toBe(400)
    expect(playground.chat).not.toHaveBeenCalled()
  })

  it('400s for a disallowed model', async () => {
    playground.chat.mockRejectedValue(new PlaygroundModelError('gpt-image-1'))

    const res = await post({ ...validBody, model: 'gpt-image-1' })

    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe(
      "Model 'gpt-image-1' is not available for chat",
    )
  })

  it('504s on an LlmTimeoutError', async () => {
    playground.chat.mockRejectedValue(new LlmTimeoutError(90_000))

    const res = await post(validBody)

    expect(res.status).toBe(504)
    expect((await res.json()).message).toBe('LLM call timed out after 90000ms')
  })

  it('502s on any other error', async () => {
    playground.chat.mockRejectedValue(new Error('model exploded'))

    const res = await post(validBody)

    expect(res.status).toBe(502)
    expect((await res.json()).message).toBe('model exploded')
  })
})
