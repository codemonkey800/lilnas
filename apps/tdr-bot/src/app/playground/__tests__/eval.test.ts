import type { PlaygroundChatResponse } from 'src/api/api.types'
import {
  bestDictionaryRate,
  estimateCostUsd,
  type EvalCell,
  evalJobs,
  type EvalRow,
  runEval,
  summarize,
} from 'src/app/playground/eval'
import type { ModelSpec } from 'src/llm/models/catalog'

const response = (
  overrides: {
    model?: string
    counts?: Partial<PlaygroundChatResponse['emojis']['counts']>
    costUsd?: number
    durationMs?: number
  } = {},
): PlaygroundChatResponse => ({
  reply: 'hi',
  model: overrides.model ?? 'gpt-5-mini',
  usage: { input: 10, output: 5, cached: 0, costUsd: overrides.costUsd ?? 0 },
  durationMs: overrides.durationMs ?? 0,
  emojis: {
    counts: {
      dictionary: 0,
      hallucinated: 0,
      unicode: 0,
      shortcode: 0,
      ...overrides.counts,
    },
    dictionary: [],
    hallucinated: [],
    unicode: [],
    shortcodes: [],
  },
  dictionarySize: 10,
})

const spec = (id: string, pricing: ModelSpec['pricing']): ModelSpec => ({
  id,
  provider: 'openai',
  label: id,
  description: '',
  roles: ['chat'],
  capabilities: {
    tools: true,
    structuredOutput: true,
    temperature: true,
    reasoningEffort: false,
    vision: false,
    image: false,
  },
  pricing,
})

const row = (overrides: Partial<EvalRow>): EvalRow => ({
  model: 'm',
  calls: 10,
  failed: 0,
  repliesWithDictionary: 0,
  dictionary: 0,
  hallucinated: 0,
  unicode: 0,
  shortcode: 0,
  avgCostUsd: 0,
  avgDurationMs: 0,
  ...overrides,
})

describe('evalJobs', () => {
  it('pairs every model with every prompt, grouped by model', () => {
    expect(evalJobs(['a', 'b'], ['p1', 'p2'])).toEqual([
      { model: 'a', prompt: 'p1' },
      { model: 'a', prompt: 'p2' },
      { model: 'b', prompt: 'p1' },
      { model: 'b', prompt: 'p2' },
    ])
  })
})

describe('summarize', () => {
  it('counts successes and failures per model, in input order', () => {
    const cells: EvalCell[] = [
      {
        model: 'gpt-5-mini',
        prompt: 'a',
        result: response({
          counts: { dictionary: 2, unicode: 1 },
          costUsd: 0.002,
          durationMs: 1000,
        }),
      },
      { model: 'gpt-5-mini', prompt: 'b', error: 'timed out' },
      {
        model: 'gpt-5-mini',
        prompt: 'c',
        result: response({
          counts: { dictionary: 0, hallucinated: 1, shortcode: 2 },
          costUsd: 0.004,
          durationMs: 3000,
        }),
      },
      {
        model: 'gpt-4.1',
        prompt: 'a',
        result: response({ counts: { dictionary: 1 }, costUsd: 0.01 }),
      },
    ]

    const rows = summarize(cells)

    expect(rows.map(r => r.model)).toEqual(['gpt-5-mini', 'gpt-4.1'])
    expect(rows[0]).toEqual({
      model: 'gpt-5-mini',
      calls: 3,
      failed: 1,
      repliesWithDictionary: 1,
      dictionary: 2,
      hallucinated: 1,
      unicode: 1,
      shortcode: 2,
      // averages over the two successes only
      avgCostUsd: 0.003,
      avgDurationMs: 2000,
    })
    expect(rows[1]).toMatchObject({
      calls: 1,
      failed: 0,
      repliesWithDictionary: 1,
      avgCostUsd: 0.01,
    })
  })

  it('leaves averages at 0 when every call failed', () => {
    const rows = summarize([
      { model: 'm', prompt: 'a', error: 'x' },
      { model: 'm', prompt: 'b', error: 'y' },
    ])
    expect(rows).toEqual([
      row({ model: 'm', calls: 2, failed: 2, avgCostUsd: 0, avgDurationMs: 0 }),
    ])
  })

  it('returns no rows for no cells', () => {
    expect(summarize([])).toEqual([])
  })
})

describe('estimateCostUsd', () => {
  it('sums per-model cost from per-1M pricing and counts null pricing as 0', () => {
    const models = [
      spec('a', { inputPer1M: 1, outputPer1M: 10 }),
      spec('img', null),
      spec('b', { inputPer1M: 2, outputPer1M: 20 }),
    ]
    // a: (6000*1 + 150*10) / 1e6 = 0.0075 per call; b: 0.015 per call
    expect(estimateCostUsd(models, 10, 6000, 150)).toBeCloseTo(0.225, 10)
  })

  it('is 0 with no models', () => {
    expect(estimateCostUsd([], 10, 6000, 150)).toBe(0)
  })
})

describe('bestDictionaryRate', () => {
  it('picks the highest replies-with-dictionary rate', () => {
    const rows = [
      row({ model: 'a', calls: 10, repliesWithDictionary: 6 }),
      row({ model: 'b', calls: 5, repliesWithDictionary: 4 }),
      row({ model: 'c', calls: 10, repliesWithDictionary: 7 }),
    ]
    expect(bestDictionaryRate(rows)).toBe('b')
  })

  it('breaks ties in favour of the first row', () => {
    const rows = [
      row({ model: 'a', calls: 10, repliesWithDictionary: 8 }),
      row({ model: 'b', calls: 5, repliesWithDictionary: 4 }),
    ]
    expect(bestDictionaryRate(rows)).toBe('a')
  })

  it('skips zero-call rows and returns null when none remain', () => {
    const zero = row({ model: 'z', calls: 0 })
    expect(bestDictionaryRate([zero])).toBeNull()
    expect(bestDictionaryRate([])).toBeNull()
    expect(
      bestDictionaryRate([zero, row({ model: 'a', repliesWithDictionary: 0 })]),
    ).toBe('a')
  })
})

describe('runEval', () => {
  const jobs = evalJobs(['m'], ['p1', 'p2', 'p3', 'p4'])

  it('keeps at most `concurrency` calls in flight and returns cells in job order', async () => {
    let inFlight = 0
    let peak = 0
    const progress: number[] = []
    const call = jest.fn(async (job: { prompt: string }) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(resolve =>
        setTimeout(resolve, job.prompt === 'p1' ? 20 : 5),
      )
      inFlight--
      if (job.prompt === 'p3') throw new Error('boom')
      return response()
    })

    const cells = await runEval(jobs, call, {
      concurrency: 2,
      signal: new AbortController().signal,
      onProgress: done => progress.push(done),
    })

    expect(peak).toBe(2)
    expect(call).toHaveBeenCalledTimes(4)
    expect(cells.map(c => c.prompt)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(cells[2]).toEqual({ model: 'm', prompt: 'p3', error: 'boom' })
    expect(cells[3].result).toBeDefined()
    expect(progress).toEqual([1, 2, 3, 4])
  })

  it('stops starting calls once aborted but lets in-flight calls finish', async () => {
    const controller = new AbortController()
    const call = jest.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return response()
    })

    const cells = await runEval(jobs, call, {
      concurrency: 2,
      signal: controller.signal,
      onProgress: done => {
        if (done === 1) controller.abort()
      },
    })

    // the two in-flight calls completed; the remaining two never started
    expect(call).toHaveBeenCalledTimes(2)
    expect(cells).toHaveLength(2)
    expect(cells.every(c => c.result)).toBe(true)
  })
})
