import { Injectable } from '@nestjs/common'
import { Counter, Gauge, Histogram, register } from 'prom-client'

type CallStatus = 'success' | 'error' | 'timeout' | 'schema_failure'
type RetryReason = 'timeout' | 'rate_limit' | 'server_error' | 'other'
type RouterSource = 'fastpath' | 'llm' | 'followup'

// Registered at module scope against the default registry; module caching
// makes re-imports safe, and getSingleMetric guards against duplicate loads
// (e.g. jest.resetModules) throwing on re-registration.
function getOrCreate<T>(name: string, create: () => T): T {
  return (register.getSingleMetric(name) as T | undefined) ?? create()
}

const callsTotal = getOrCreate(
  'tdr_bot_llm_calls_total',
  () =>
    new Counter({
      name: 'tdr_bot_llm_calls_total',
      help: 'Total LLM calls by operation, model, role and status',
      labelNames: ['operation', 'model', 'role', 'status'],
      registers: [register],
    }),
)

const callDurationSeconds = getOrCreate(
  'tdr_bot_llm_call_duration_seconds',
  () =>
    new Histogram({
      name: 'tdr_bot_llm_call_duration_seconds',
      help: 'Duration of LLM calls by operation and model',
      labelNames: ['operation', 'model'],
      buckets: [0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 45, 60],
      registers: [register],
    }),
)

const tokensByModelTotal = getOrCreate(
  'tdr_bot_llm_tokens_by_model_total',
  () =>
    new Counter({
      name: 'tdr_bot_llm_tokens_by_model_total',
      help: 'Tokens consumed by model and type',
      labelNames: ['model', 'type'],
      registers: [register],
    }),
)

const costUsdTotal = getOrCreate(
  'tdr_bot_llm_cost_usd_total',
  () =>
    new Counter({
      name: 'tdr_bot_llm_cost_usd_total',
      help: 'Estimated LLM spend in USD by model',
      labelNames: ['model'],
      registers: [register],
    }),
)

const retriesTotal = getOrCreate(
  'tdr_bot_llm_retries_total',
  () =>
    new Counter({
      name: 'tdr_bot_llm_retries_total',
      help: 'LLM call retries by operation and reason',
      labelNames: ['operation', 'reason'],
      registers: [register],
    }),
)

const inflight = getOrCreate(
  'tdr_bot_llm_inflight',
  () =>
    new Gauge({
      name: 'tdr_bot_llm_inflight',
      help: 'LLM calls currently in flight by model',
      labelNames: ['model'],
      registers: [register],
    }),
)

const schemaFailuresTotal = getOrCreate(
  'tdr_bot_llm_schema_failures_total',
  () =>
    new Counter({
      name: 'tdr_bot_llm_schema_failures_total',
      help: 'Structured-output schema failures by operation',
      labelNames: ['operation'],
      registers: [register],
    }),
)

const routerDecisionsTotal = getOrCreate(
  'tdr_bot_router_decisions_total',
  () =>
    new Counter({
      name: 'tdr_bot_router_decisions_total',
      help: 'Router decisions by skill and decision source',
      labelNames: ['skill', 'source'],
      registers: [register],
    }),
)

/** Prometheus metrics for the LLM client and router (default registry). */
@Injectable()
export class LlmMetricsService {
  /** Increments inflight; the returned `done()` decrements it (idempotent). */
  callStarted(labels: { operation: string; model: string }): () => void {
    inflight.inc({ model: labels.model })
    let finished = false
    return () => {
      if (finished) return
      finished = true
      inflight.dec({ model: labels.model })
    }
  }

  callFinished(l: {
    operation: string
    model: string
    role: string
    status: CallStatus
    durationMs: number
    retries: number
  }): void {
    callsTotal.inc({
      operation: l.operation,
      model: l.model,
      role: l.role,
      status: l.status,
    })
    callDurationSeconds.observe(
      { operation: l.operation, model: l.model },
      l.durationMs / 1000,
    )
    if (l.status === 'schema_failure') {
      schemaFailuresTotal.inc({ operation: l.operation })
    }
  }

  tokens(l: {
    model: string
    input: number
    output: number
    cached?: number
  }): void {
    tokensByModelTotal.inc({ model: l.model, type: 'input' }, l.input)
    tokensByModelTotal.inc({ model: l.model, type: 'output' }, l.output)
    if (l.cached) {
      tokensByModelTotal.inc({ model: l.model, type: 'cached' }, l.cached)
    }
  }

  cost(model: string, usd: number): void {
    if (usd > 0) costUsdTotal.inc({ model }, usd)
  }

  retry(l: { operation: string; reason: RetryReason }): void {
    retriesTotal.inc({ operation: l.operation, reason: l.reason })
  }

  routerDecision(l: { skill: string; source: RouterSource }): void {
    routerDecisionsTotal.inc({ skill: l.skill, source: l.source })
  }
}
