import { createHash, randomUUID } from 'node:crypto'

import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, BaseMessage } from '@langchain/core/messages'
import { Injectable, Logger } from '@nestjs/common'

import { RetryConfigService } from 'src/config/retry.config'
import { NewLlmCallRow } from 'src/db/schema'
import { LlmCallsRepository } from 'src/llm/audit/llm-calls.repository'
import { ModelRegistry } from 'src/llm/models/model-registry'
import { LlmMetricsService } from 'src/llm/observability/llm-metrics.service'
import { getRequestContext } from 'src/llm/observability/request-context'
import {
  LlmProvider,
  ResolvedParams,
} from 'src/llm/providers/llm-provider.interface'
import { OpenAiProvider } from 'src/llm/providers/openai.provider'
import { SettingsService } from 'src/llm/settings/settings.service'
import { ErrorCategory } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

import { ImageCall, ImageResult, LlmCall, LlmResult } from './llm-call.types'
import { LlmClient } from './llm-client'

const DEFAULT_TIMEOUT_MS = 30_000
const IMAGE_TIMEOUT_MS = 60_000
// RetryService's own timeout is only a backstop; the attempt aborts first.
const RETRY_TIMEOUT_BACKSTOP_MS = 1_000

type RetryReason = 'timeout' | 'rate_limit' | 'server_error' | 'other'
type CallStatus = 'success' | 'error' | 'timeout' | 'schema_failure'

export class LlmTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`LLM call timed out after ${timeoutMs}ms`)
    this.name = 'LlmTimeoutError'
  }
}

export class LlmSchemaError extends Error {
  constructor(
    readonly operation: string,
    cause?: unknown,
  ) {
    super(`LLM output did not match the schema for ${operation}`, { cause })
    this.name = 'LlmSchemaError'
  }
}

interface Attempt {
  message: AIMessage
  parsed: unknown
}

function classify(error: unknown): RetryReason {
  if (error instanceof LlmTimeoutError) return 'timeout'
  const status = (error as { status?: number } | null)?.status
  if (status === 429) return 'rate_limit'
  if (typeof status === 'number' && status >= 500) return 'server_error'
  return 'other'
}

function auditContent(): boolean {
  return process.env.LLM_AUDIT_CONTENT === 'true'
}

function hashPrompt(prompt: BaseMessage[] | string): string {
  return createHash('sha256').update(JSON.stringify(prompt)).digest('hex')
}

function messageText(message: AIMessage): string {
  const { content } = message
  if (typeof content === 'string') return content
  return content
    .map(part => (part.type === 'text' ? (part as { text: string }).text : ''))
    .join('')
}

@Injectable()
export class DefaultLlmClient extends LlmClient {
  private readonly logger = new Logger(DefaultLlmClient.name)
  private readonly provider: LlmProvider

  constructor(
    private readonly settings: SettingsService,
    private readonly registry: ModelRegistry,
    private readonly metrics: LlmMetricsService,
    private readonly retry: RetryService,
    private readonly retryConfig: RetryConfigService,
    openai: OpenAiProvider,
    private readonly audit: LlmCallsRepository,
  ) {
    super()
    this.provider = openai
  }

  async call<T = string>(call: LlmCall<T>): Promise<LlmResult<T>> {
    const settings = this.settings.get()
    const modelId = call.overrides?.model ?? settings.models[call.role]
    const spec = this.registry.get(modelId)
    const caps = spec.capabilities
    if (call.schema && call.tools?.length) {
      throw new Error(
        `${call.operation}: schema and tools cannot be combined in one call`,
      )
    }

    const params: ResolvedParams = {}
    if (caps.temperature) {
      params.temperature = call.overrides?.temperature ?? settings.temperature
    }
    if (caps.reasoningEffort) params.reasoningEffort = settings.reasoningEffort
    if (call.overrides?.maxTokens !== undefined) {
      params.maxTokens = call.overrides.maxTokens
    }

    const base = this.provider.chatModel(spec, params)
    const timeoutMs = call.overrides?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const schemaRunnable = call.schema
      ? base.withStructuredOutput(call.schema as never, { includeRaw: true })
      : undefined
    const toolBound = call.tools?.length
      ? (base.bindTools?.(call.tools) ?? base)
      : base

    const attemptErrors: unknown[] = []
    let schemaRetries = 0
    const labels = { operation: call.operation, model: modelId }
    const done = this.metrics.callStarted(labels)
    const startedAt = Date.now()

    const invokeOnce = async (): Promise<Attempt> => {
      // RetryService retries any failure, including a caller abort; skip the
      // provider (and the attempt record) once the caller has given up.
      if (call.signal?.aborted) {
        throw call.signal.reason ?? new Error(`${call.operation}: aborted`)
      }
      const controller = new AbortController()
      const onCallerAbort = () => controller.abort(call.signal?.reason)
      call.signal?.addEventListener('abort', onCallerAbort)
      let timer: NodeJS.Timeout | undefined
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new LlmTimeoutError(timeoutMs)
          controller.abort(error)
          reject(error)
        }, timeoutMs)
      })
      try {
        return await Promise.race([
          this.invokeModel(call, schemaRunnable, toolBound, controller.signal),
          timedOut,
        ])
      } catch (error) {
        attemptErrors.push(error)
        throw error
      } finally {
        clearTimeout(timer)
        call.signal?.removeEventListener('abort', onCallerAbort)
      }
    }

    // A schema parse failure is retried once outside RetryService, which
    // would otherwise retry it as a transport failure.
    const runAttempt = async (): Promise<Attempt | LlmSchemaError> => {
      const first = await invokeOnce()
      if (!call.schema || first.parsed !== null) return first
      schemaRetries++
      const second = await invokeOnce()
      if (second.parsed !== null) return second
      return new LlmSchemaError(call.operation)
    }

    let status: CallStatus = 'success'
    let result: Attempt | LlmSchemaError
    try {
      result = await this.retry.executeWithRetry(
        runAttempt,
        {
          ...this.retryConfig.getOpenAIConfig(),
          timeout: timeoutMs * 2 + RETRY_TIMEOUT_BACKSTOP_MS,
          ...(call.overrides?.maxAttempts !== undefined && {
            maxAttempts: call.overrides.maxAttempts,
          }),
        },
        call.operation,
        ErrorCategory.OPENAI_API,
      )
    } catch (error) {
      status = error instanceof LlmTimeoutError ? 'timeout' : 'error'
      return this.fail(
        call,
        labels,
        done,
        startedAt,
        attemptErrors,
        status,
        error,
      )
    }
    if (result instanceof LlmSchemaError) {
      return this.fail(
        call,
        labels,
        done,
        startedAt,
        attemptErrors,
        'schema_failure',
        result,
        schemaRetries,
      )
    }

    const durationMs = Date.now() - startedAt
    const retries = Math.max(attemptErrors.length, 0) + schemaRetries
    const { message, parsed } = result
    const meta = message.usage_metadata
    const input = meta?.input_tokens ?? 0
    const output = meta?.output_tokens ?? 0
    const cached = meta?.input_token_details?.cache_read ?? 0
    const costUsd = this.registry.costUsd(modelId, { input, output, cached })
    const finishReason = message.response_metadata?.finish_reason as
      | string
      | undefined

    this.recordRetries(call.operation, attemptErrors)
    for (let i = 0; i < schemaRetries; i++) {
      this.metrics.retry({ operation: call.operation, reason: 'other' })
    }
    done()
    this.metrics.callFinished({
      ...labels,
      role: call.role,
      status,
      durationMs,
      retries,
    })
    this.metrics.tokens({ model: modelId, input, output, cached })
    this.metrics.cost(modelId, costUsd)

    this.logger.log(
      {
        operation: call.operation,
        model: modelId,
        role: call.role,
        usage: { input, output, cached },
        costUsd,
        durationMs,
        retries,
        finishReason,
        requestId: getRequestContext()?.requestId,
      },
      'llm.call',
    )
    const output_ = call.schema ? (parsed as T) : (messageText(message) as T)
    this.recordAudit({
      operation: call.operation,
      model: modelId,
      role: call.role,
      status,
      inputTokens: input,
      outputTokens: output,
      cachedTokens: cached,
      costUsd: costUsd.toFixed(6),
      durationMs,
      retries,
      finishReason,
      promptHash: hashPrompt(call.messages),
      ...(auditContent() && { prompt: call.messages, output: output_ }),
    })
    this.logger.debug(
      { operation: call.operation, prompt: call.messages, output: output_ },
      'llm.call.io',
    )

    return {
      output: output_,
      message,
      model: modelId,
      usage: { input, output, cached, costUsd },
      durationMs,
      retries,
      finishReason,
    }
  }

  async generateImage(call: ImageCall): Promise<ImageResult> {
    const modelId = call.overrides?.model ?? this.settings.get().models.image
    const spec = this.registry.get(modelId)
    const model = this.provider.imageModel(spec, {
      size: call.overrides?.size,
    })
    const labels = { operation: call.operation, model: modelId }
    const done = this.metrics.callStarted(labels)
    const startedAt = Date.now()
    const errors: unknown[] = []
    try {
      const url = await this.retry.executeWithRetry(
        async () => {
          try {
            return await model.invoke(call.prompt)
          } catch (error) {
            errors.push(error)
            throw error
          }
        },
        {
          ...this.retryConfig.getOpenAIConfig(),
          timeout: IMAGE_TIMEOUT_MS,
        },
        call.operation,
        ErrorCategory.OPENAI_API,
      )
      const durationMs = Date.now() - startedAt
      this.recordRetries(call.operation, errors)
      done()
      this.metrics.callFinished({
        ...labels,
        role: 'image',
        status: 'success',
        durationMs,
        retries: errors.length,
      })
      this.logger.log(
        {
          operation: call.operation,
          model: modelId,
          role: 'image',
          durationMs,
          retries: errors.length,
          requestId: getRequestContext()?.requestId,
        },
        'llm.call',
      )
      this.recordAudit({
        operation: call.operation,
        model: modelId,
        role: 'image',
        status: 'success',
        durationMs,
        retries: errors.length,
        promptHash: hashPrompt(call.prompt),
        ...(auditContent() && { prompt: call.prompt, output: url }),
      })
      return { url, model: modelId, durationMs }
    } catch (error) {
      const durationMs = Date.now() - startedAt
      this.recordRetries(call.operation, errors.slice(0, -1))
      done()
      this.metrics.callFinished({
        ...labels,
        role: 'image',
        status: 'error',
        durationMs,
        retries: Math.max(errors.length - 1, 0),
      })
      this.recordAudit({
        operation: call.operation,
        model: modelId,
        role: 'image',
        status: 'error',
        durationMs,
        retries: Math.max(errors.length - 1, 0),
        promptHash: hashPrompt(call.prompt),
        ...(auditContent() && { prompt: call.prompt }),
      })
      throw error
    }
  }

  /** Fire-and-forget: audit failures are logged, never thrown. */
  private recordAudit(row: Omit<NewLlmCallRow, 'id'>): void {
    const ctx = getRequestContext()
    void this.audit
      .insert({
        id: randomUUID(),
        requestId: ctx?.requestId,
        channelId: ctx?.channelId,
        userId: ctx?.userId,
        skill: ctx?.skill,
        ...row,
      })
      .catch((error: unknown) => {
        this.logger.warn(
          {
            operation: row.operation,
            error: error instanceof Error ? error.message : String(error),
          },
          'llm.audit.failed',
        )
      })
  }

  private async invokeModel(
    call: LlmCall<unknown>,
    schemaRunnable:
      | {
          invoke(m: BaseMessage[], o: { signal: AbortSignal }): Promise<unknown>
        }
      | undefined,
    plain: BaseChatModel | { invoke: BaseChatModel['invoke'] },
    signal: AbortSignal,
  ): Promise<Attempt> {
    if (schemaRunnable) {
      const out = (await schemaRunnable.invoke(call.messages, {
        signal,
      })) as { raw: AIMessage; parsed: unknown }
      return { message: out.raw, parsed: out.parsed ?? null }
    }
    const message = (await plain.invoke(call.messages, {
      signal,
    })) as AIMessage
    return { message, parsed: undefined }
  }

  private recordRetries(operation: string, errors: unknown[]): void {
    // every failed attempt except the last (successful or final) was retried
    for (const error of errors) {
      this.metrics.retry({ operation, reason: classify(error) })
    }
  }

  private fail(
    call: LlmCall<unknown>,
    labels: { operation: string; model: string },
    done: () => void,
    startedAt: number,
    attemptErrors: unknown[],
    status: CallStatus,
    error: unknown,
    schemaRetries = 0,
  ): never {
    const durationMs = Date.now() - startedAt
    // the final failure is not a retry
    const retried =
      status === 'schema_failure' ? attemptErrors : attemptErrors.slice(0, -1)
    this.recordRetries(call.operation, retried)
    for (let i = 0; i < schemaRetries; i++) {
      this.metrics.retry({ operation: call.operation, reason: 'other' })
    }
    done()
    this.metrics.callFinished({
      ...labels,
      role: call.role,
      status,
      durationMs,
      retries: retried.length + schemaRetries,
    })
    this.recordAudit({
      operation: call.operation,
      model: labels.model,
      role: call.role,
      status,
      durationMs,
      retries: retried.length + schemaRetries,
      promptHash: hashPrompt(call.messages),
      ...(auditContent() && { prompt: call.messages }),
    })
    this.logger.warn(
      {
        operation: call.operation,
        model: labels.model,
        role: call.role,
        status,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
        requestId: getRequestContext()?.requestId,
      },
      'llm.call.failed',
    )
    throw error
  }
}
