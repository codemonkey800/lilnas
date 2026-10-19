import type { PlaygroundChatResponse } from 'src/api/api.types'
import type { ModelSpec } from 'src/llm/models/catalog'

export interface EvalJob {
  model: string
  prompt: string
}

export interface EvalCell extends EvalJob {
  result?: PlaygroundChatResponse
  error?: string
}

export interface EvalRow {
  model: string
  calls: number
  failed: number
  /** Replies with counts.dictionary >= 1. */
  repliesWithDictionary: number
  dictionary: number
  hallucinated: number
  unicode: number
  shortcode: number
  /** Averages are over successful calls only; 0 when none succeeded. */
  avgCostUsd: number
  avgDurationMs: number
}

/** Every (model, prompt) pair, grouped by model in input order. */
export function evalJobs(
  models: readonly string[],
  prompts: readonly string[],
): EvalJob[] {
  return models.flatMap(model => prompts.map(prompt => ({ model, prompt })))
}

const emptyRow = (model: string): EvalRow => ({
  model,
  calls: 0,
  failed: 0,
  repliesWithDictionary: 0,
  dictionary: 0,
  hallucinated: 0,
  unicode: 0,
  shortcode: 0,
  avgCostUsd: 0,
  avgDurationMs: 0,
})

/** One row per model, in the order models first appear in `cells`. */
export function summarize(cells: EvalCell[]): EvalRow[] {
  const rows = new Map<string, EvalRow>()
  const totals = new Map<string, { costUsd: number; durationMs: number }>()

  for (const cell of cells) {
    let row = rows.get(cell.model)
    if (!row) {
      row = emptyRow(cell.model)
      rows.set(cell.model, row)
      totals.set(cell.model, { costUsd: 0, durationMs: 0 })
    }
    row.calls++
    if (!cell.result) {
      row.failed++
      continue
    }
    const { counts } = cell.result.emojis
    if (counts.dictionary >= 1) row.repliesWithDictionary++
    row.dictionary += counts.dictionary
    row.hallucinated += counts.hallucinated
    row.unicode += counts.unicode
    row.shortcode += counts.shortcode
    const total = totals.get(cell.model)
    if (total) {
      total.costUsd += cell.result.usage.costUsd
      total.durationMs += cell.result.durationMs
    }
  }

  return [...rows.values()].map(row => {
    const succeeded = row.calls - row.failed
    const total = totals.get(row.model)
    if (succeeded === 0 || !total) return row
    return {
      ...row,
      avgCostUsd: total.costUsd / succeeded,
      avgDurationMs: total.durationMs / succeeded,
    }
  })
}

/**
 * Rough spend for `prompts` calls per model at the given token counts.
 * Pricing is per 1M tokens; models without pricing count as 0.
 */
export function estimateCostUsd(
  models: ModelSpec[],
  prompts: number,
  promptTokens: number,
  replyTokens: number,
): number {
  return models.reduce((sum, model) => {
    if (!model.pricing) return sum
    const perCall =
      (promptTokens * model.pricing.inputPer1M +
        replyTokens * model.pricing.outputPer1M) /
      1_000_000
    return sum + perCall * prompts
  }, 0)
}

/** The model with the highest repliesWithDictionary / calls; ties → first. */
export function bestDictionaryRate(rows: EvalRow[]): string | null {
  let best: { model: string; rate: number } | null = null
  for (const row of rows) {
    if (row.calls === 0) continue
    const rate = row.repliesWithDictionary / row.calls
    if (!best || rate > best.rate) best = { model: row.model, rate }
  }
  return best?.model ?? null
}

export interface RunEvalOptions {
  /** Max requests in flight at once. */
  concurrency: number
  /** Checked between calls; in-flight calls finish. */
  signal: AbortSignal
  onProgress?: (done: number) => void
}

/**
 * Runs every job through `call` with a bounded worker pool. Returns one cell
 * per started job, in job order; jobs not started before abort are omitted.
 */
export async function runEval(
  jobs: EvalJob[],
  call: (job: EvalJob) => Promise<PlaygroundChatResponse>,
  { concurrency, signal, onProgress }: RunEvalOptions,
): Promise<EvalCell[]> {
  const cells: (EvalCell | undefined)[] = new Array<EvalCell | undefined>(
    jobs.length,
  )
  let next = 0
  let done = 0

  const worker = async () => {
    while (next < jobs.length && !signal.aborted) {
      const index = next++
      const job = jobs[index]
      try {
        cells[index] = { ...job, result: await call(job) }
      } catch (err) {
        cells[index] = {
          ...job,
          error: err instanceof Error ? err.message : String(err),
        }
      }
      onProgress?.(++done)
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, jobs.length)) },
    worker,
  )
  await Promise.all(workers)

  return cells.filter((cell): cell is EvalCell => cell !== undefined)
}
