import { DEFAULT_MODELS, MODEL_CATALOG } from 'src/llm/models/catalog'
import { ModelRegistry, UnknownModelError } from 'src/llm/models/model-registry'
import { MODEL_ROLES } from 'src/llm/models/roles'

describe('MODEL_CATALOG', () => {
  it('has unique ids', () => {
    const ids = MODEL_CATALOG.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never reports temperature for reasoning models', () => {
    const reasoningModels = MODEL_CATALOG.filter(
      m => m.id.startsWith('gpt-5') || /^o\d/.test(m.id),
    )
    expect(reasoningModels.length).toBeGreaterThan(0)
    for (const m of reasoningModels) {
      expect(m.capabilities.temperature).toBe(false)
      expect(m.capabilities.reasoningEffort).toBe(true)
    }
  })

  it('gives gpt-4* models temperature and no reasoning effort', () => {
    for (const m of MODEL_CATALOG.filter(m => m.id.startsWith('gpt-4'))) {
      expect(m.capabilities.temperature).toBe(true)
      expect(m.capabilities.reasoningEffort).toBe(false)
    }
  })

  it('has every default in the catalog with the right role', () => {
    const registry = new ModelRegistry()
    for (const role of MODEL_ROLES) {
      expect(registry.has(DEFAULT_MODELS[role])).toBe(true)
      expect(registry.isAllowedFor(DEFAULT_MODELS[role], role)).toBe(true)
    }
    expect(DEFAULT_MODELS.chat).toBe('gpt-4-turbo')
    expect(DEFAULT_MODELS.reasoning).toBe('gpt-4o-mini')
  })
})

describe('ModelRegistry', () => {
  const registry = new ModelRegistry()

  it('lists by role', () => {
    expect(registry.list()).toHaveLength(MODEL_CATALOG.length)
    expect(registry.list('image').map(m => m.id)).toEqual(['dall-e-3'])
    expect(registry.list('chat').every(m => !m.capabilities.image)).toBe(true)
  })

  it('gets and throws for unknown ids', () => {
    expect(registry.get('gpt-4o').id).toBe('gpt-4o')
    expect(() => registry.get('nope')).toThrow(UnknownModelError)
    expect(registry.has('nope')).toBe(false)
  })

  it('checks role allowance', () => {
    expect(registry.isAllowedFor('gpt-4o', 'chat')).toBe(true)
    expect(registry.isAllowedFor('gpt-4o', 'image')).toBe(false)
    expect(registry.isAllowedFor('dall-e-3', 'chat')).toBe(false)
    expect(registry.isAllowedFor('nope', 'chat')).toBe(false)
  })

  describe('costUsd', () => {
    it('prices input and output', () => {
      expect(
        registry.costUsd('gpt-4o', { input: 1_000_000, output: 0 }),
      ).toBeCloseTo(2.5)
      expect(
        registry.costUsd('gpt-4o', { input: 0, output: 1_000_000 }),
      ).toBeCloseTo(10)
    })

    it('bills cached tokens at the cached rate out of the input total', () => {
      // 600k uncached * 2.5 + 400k cached * 1.25 + 100k out * 10 = 1.5 + 0.5 + 1
      expect(
        registry.costUsd('gpt-4o', {
          input: 1_000_000,
          cached: 400_000,
          output: 100_000,
        }),
      ).toBeCloseTo(3)
    })

    it('falls back to the input rate when no cached price exists', () => {
      expect(
        registry.costUsd('gpt-4-turbo', {
          input: 1_000_000,
          cached: 500_000,
          output: 0,
        }),
      ).toBeCloseTo(10)
    })

    it('returns 0 for unpriced models', () => {
      expect(registry.costUsd('dall-e-3', { input: 1000, output: 1000 })).toBe(
        0,
      )
    })

    it('throws for unknown models', () => {
      expect(() => registry.costUsd('nope', { input: 1, output: 1 })).toThrow(
        UnknownModelError,
      )
    })
  })
})
