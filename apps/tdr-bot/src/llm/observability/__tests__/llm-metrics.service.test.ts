import { register } from '@prometheus-io/client'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { MODEL_CATALOG } from 'src/llm/models/catalog'
import {
  LlmMetricsService,
  OPERATIONS,
} from 'src/llm/observability/llm-metrics.service'

async function value(name: string, labels: Record<string, string>) {
  const base = name.replace(/_(sum|count)$/, '')
  const metric = await register.getSingleMetric(base)?.get()
  return metric?.values.find(
    v =>
      ((v as { metricName?: string }).metricName ?? base) === name &&
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  )?.value
}

const SRC_DIR = join(__dirname, '../../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path)
    }
    return /\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)
      ? [path]
      : []
  })
}

/** Dotted string literals on every `operation:` line, e.g. 'media.intent'. */
function usedOperations(): Set<string> {
  const used = new Set<string>()
  for (const file of sourceFiles(SRC_DIR)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!/\boperation:/.test(line)) continue
      for (const m of line.matchAll(/'([a-z]+(?:\.[A-Za-z]+)+)'/g)) {
        used.add(m[1])
      }
    }
  }
  return used
}

describe('LlmMetricsService', () => {
  const svc = new LlmMetricsService()

  it('lists every operation used by a call site', () => {
    const used = usedOperations()
    expect(used.size).toBeGreaterThan(25)
    expect([...used].filter(op => !OPERATIONS.includes(op as never))).toEqual(
      [],
    )
  })

  it('exposes retry and schema-failure series at 0 for every used operation', async () => {
    new LlmMetricsService()

    for (const operation of usedOperations()) {
      expect(
        await value('tdr_bot_llm_schema_failures_total', { operation }),
      ).toBe(0)
      expect(
        await value('tdr_bot_llm_retries_total', {
          operation,
          reason: 'other',
        }),
      ).toBe(0)
    }
  })

  it('registers each metric once, even on re-import', async () => {
    jest.resetModules()
    await import('../llm-metrics.service')
    const names = register.getMetricsAsArray().map(m => m.name)
    for (const n of [
      'tdr_bot_llm_calls_total',
      'tdr_bot_llm_call_duration_seconds',
      'tdr_bot_llm_tokens_by_model_total',
      'tdr_bot_llm_cost_usd_total',
      'tdr_bot_llm_retries_total',
      'tdr_bot_llm_inflight',
      'tdr_bot_llm_schema_failures_total',
      'tdr_bot_router_decisions_total',
    ]) {
      expect(names.filter(x => x === n)).toHaveLength(1)
    }
  })

  it('exposes token and cost series at 0 for every catalog model', async () => {
    new LlmMetricsService()

    for (const { id } of MODEL_CATALOG) {
      expect(await value('tdr_bot_llm_cost_usd_total', { model: id })).toBe(0)
      for (const type of ['input', 'output', 'cached']) {
        expect(
          await value('tdr_bot_llm_tokens_by_model_total', { model: id, type }),
        ).toBe(0)
      }
    }
  })

  it('exposes retry series at 0 for every reason', async () => {
    new LlmMetricsService()

    for (const reason of ['timeout', 'rate_limit', 'server_error', 'other']) {
      expect(
        await value('tdr_bot_llm_retries_total', {
          operation: 'chat.respond',
          reason,
        }),
      ).toBe(0)
    }
  })

  it('tracks inflight and done() is idempotent', async () => {
    const done = svc.callStarted({ operation: 'op', model: 'm-inflight' })
    expect(await value('tdr_bot_llm_inflight', { model: 'm-inflight' })).toBe(1)
    done()
    done()
    expect(await value('tdr_bot_llm_inflight', { model: 'm-inflight' })).toBe(0)
  })

  it('records finished calls, duration and schema failures', async () => {
    svc.callFinished({
      operation: 'route',
      model: 'm1',
      role: 'router',
      status: 'schema_failure',
      durationMs: 1500,
      retries: 1,
    })
    expect(
      await value('tdr_bot_llm_calls_total', {
        operation: 'route',
        model: 'm1',
        role: 'router',
        status: 'schema_failure',
      }),
    ).toBe(1)
    expect(
      await value('tdr_bot_llm_call_duration_seconds_sum', {
        operation: 'route',
        model: 'm1',
      }),
    ).toBe(1.5)
    expect(
      await value('tdr_bot_llm_schema_failures_total', { operation: 'route' }),
    ).toBe(1)
  })

  it('records tokens, cost, retries and router decisions', async () => {
    svc.tokens({ model: 'm2', input: 10, output: 5, cached: 3 })
    expect(
      await value('tdr_bot_llm_tokens_by_model_total', {
        model: 'm2',
        type: 'cached',
      }),
    ).toBe(3)
    expect(
      await value('tdr_bot_llm_tokens_by_model_total', {
        model: 'm2',
        type: 'input',
      }),
    ).toBe(10)
    svc.cost('m2', 0.25)
    expect(await value('tdr_bot_llm_cost_usd_total', { model: 'm2' })).toBe(
      0.25,
    )
    svc.retry({ operation: 'chat', reason: 'rate_limit' })
    expect(
      await value('tdr_bot_llm_retries_total', {
        operation: 'chat',
        reason: 'rate_limit',
      }),
    ).toBe(1)
    svc.routerDecision({ skill: 'math', source: 'fastpath' })
    expect(
      await value('tdr_bot_router_decisions_total', {
        skill: 'math',
        source: 'fastpath',
      }),
    ).toBe(1)
  })
})
