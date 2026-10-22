import { MODEL_CATALOG, ModelSpec } from 'src/llm/models/catalog'
import { OpenAiProvider } from 'src/llm/providers/openai.provider'

const spec = (id: string): ModelSpec => {
  const found = MODEL_CATALOG.find(m => m.id === id)
  if (!found) throw new Error(`no catalog entry for ${id}`)
  return found
}

describe('OpenAiProvider', () => {
  const originalKey = process.env.OPENAI_API_KEY

  beforeAll(() => {
    process.env.OPENAI_API_KEY = 'test-key'
  })

  afterAll(() => {
    process.env.OPENAI_API_KEY = originalKey
  })

  it('reuses the chat model for the same model and params', () => {
    const provider = new OpenAiProvider()

    expect(provider.chatModel(spec('gpt-4o'), { temperature: 0.5 })).toBe(
      provider.chatModel(spec('gpt-4o'), { temperature: 0.5 }),
    )
  })

  it('builds a separate chat model when the model or params differ', () => {
    const provider = new OpenAiProvider()
    const base = provider.chatModel(spec('gpt-4o'), { temperature: 0.5 })

    expect(provider.chatModel(spec('gpt-4o'), { temperature: 0.7 })).not.toBe(
      base,
    )
    expect(
      provider.chatModel(spec('gpt-4o'), { temperature: 0.5, maxTokens: 10 }),
    ).not.toBe(base)
    expect(
      provider.chatModel(spec('gpt-4o-mini'), { temperature: 0.5 }),
    ).not.toBe(base)
    expect(
      provider.chatModel(spec('gpt-5'), { reasoningEffort: 'low' }),
    ).not.toBe(provider.chatModel(spec('gpt-5'), { reasoningEffort: 'high' }))
  })
})
