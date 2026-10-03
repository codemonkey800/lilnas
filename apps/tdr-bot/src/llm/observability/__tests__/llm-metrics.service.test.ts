import { register } from 'prom-client'

import { LlmMetricsService } from 'src/llm/observability/llm-metrics.service'

async function value(name: string, labels: Record<string, string>) {
  const base = name.replace(/_(sum|count)$/, '')
  const metric = await register.getSingleMetric(base)?.get()
  return metric?.values.find(
    v =>
      ((v as { metricName?: string }).metricName ?? base) === name &&
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  )?.value
}

describe('LlmMetricsService', () => {
  const svc = new LlmMetricsService()

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
