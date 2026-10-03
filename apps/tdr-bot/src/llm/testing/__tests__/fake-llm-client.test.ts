import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { z } from 'zod'

import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'

const messages = [new HumanMessage('hi')]

describe('FakeLlmClient', () => {
  it('returns scripted strings and records calls', async () => {
    const fake = new FakeLlmClient().script('a', 'hello')
    const result = await fake.call({ operation: 'a', role: 'chat', messages })
    expect(result.output).toBe('hello')
    expect(result.message.content).toBe('hello')
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].operation).toBe('a')
  })

  it('parses objects through the schema', async () => {
    const fake = new FakeLlmClient().script('a', { n: 1 })
    const result = await fake.call({
      operation: 'a',
      role: 'reasoning',
      messages,
      schema: z.object({ n: z.number() }),
    })
    expect(result.output).toEqual({ n: 1 })
  })

  it('rejects objects that fail the schema', async () => {
    const fake = new FakeLlmClient().script('a', { n: 'x' })
    await expect(
      fake.call({
        operation: 'a',
        role: 'chat',
        messages,
        schema: z.object({ n: z.number() }),
      }),
    ).rejects.toThrow()
  })

  it('supports responder functions and AIMessage results', async () => {
    const message = new AIMessage('from message')
    const fake = new FakeLlmClient().script('a', call =>
      call.messages.length === 1 ? message : 'other',
    )
    const result = await fake.call({ operation: 'a', role: 'chat', messages })
    expect(result.message).toBe(message)
    expect(result.output).toBe('from message')
  })

  it('throws an Error responder', async () => {
    const fake = new FakeLlmClient().script('a', new Error('rate limited'))
    await expect(
      fake.call({ operation: 'a', role: 'chat', messages }),
    ).rejects.toThrow('rate limited')
    expect(fake.calls).toHaveLength(1)
  })

  it('throws on an unscripted operation', async () => {
    const fake = new FakeLlmClient()
    await expect(
      fake.call({ operation: 'nope', role: 'chat', messages }),
    ).rejects.toThrow("no script for operation 'nope'")
  })

  it('serves scripted images', async () => {
    const fake = new FakeLlmClient().scriptImage('https://img/x.png')
    const result = await fake.generateImage({ operation: 'i', prompt: 'p' })
    expect(result.url).toBe('https://img/x.png')
    expect(fake.imageCalls).toHaveLength(1)
  })
})
