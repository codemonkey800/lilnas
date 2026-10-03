import { config } from 'dotenv'
import { appendFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { RetryConfigService } from 'src/config/retry.config'
import { LlmCallsRepository } from 'src/llm/audit/llm-calls.repository'
import { DefaultLlmClient } from 'src/llm/client/default-llm-client'
import { LlmCall, LlmResult } from 'src/llm/client/llm-call.types'
import { ModelRegistry } from 'src/llm/models/model-registry'
import { LlmMetricsService } from 'src/llm/observability/llm-metrics.service'
import { OpenAiProvider } from 'src/llm/providers/openai.provider'
import {
  defaultSettings,
  SettingsService,
} from 'src/llm/settings/settings.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

config({ quiet: true })

/** Ceiling for one `test:live` run, summed across every live file. */
export const MAX_RUN_COST_USD = 0.5

export const liveEnabled =
  process.env.LIVE_LLM === '1' && Boolean(process.env.OPENAI_API_KEY)

/** `describe` when live tests are enabled, `describe.skip` otherwise. */
export const describeLive = liveEnabled ? describe : describe.skip

/** The real client with default settings, recording each call's cost. */
export class LiveLlm {
  costUsd = 0
  readonly client: DefaultLlmClient

  constructor() {
    const settings = { get: () => defaultSettings() } as SettingsService
    const inner = new DefaultLlmClient(
      settings,
      new ModelRegistry(),
      new LlmMetricsService(),
      new RetryService(new ErrorClassificationService()),
      new RetryConfigService(),
      new OpenAiProvider(),
      // live runs have no database; drop audit rows
      { insert: () => Promise.resolve() } as unknown as LlmCallsRepository,
    )
    const call = inner.call.bind(inner)
    inner.call = async <T = string>(c: LlmCall<T>): Promise<LlmResult<T>> => {
      const result = await call(c)
      this.costUsd += result.usage.costUsd
      return result
    }
    this.client = inner
  }
}

// jest runs each file in its own module registry, so the run total lives in
// a file keyed by the (shared, --runInBand) process id.
const ledgerPath = join(tmpdir(), `tdr-bot-live-cost-${process.pid}.log`)

/** Adds a file's spend to the run ledger and returns the run total so far. */
export function recordCost(label: string, costUsd: number): number {
  appendFileSync(ledgerPath, `${costUsd}\n`)
  const total = readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .reduce((sum, line) => sum + Number(line), 0)

  console.log(
    `[live] ${label}: $${costUsd.toFixed(4)} (run total $${total.toFixed(4)} of $${MAX_RUN_COST_USD.toFixed(2)})`,
  )
  return total
}
