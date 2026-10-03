import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { Logger } from '@nestjs/common'
import { z } from 'zod'

import { RetryConfigService } from 'src/config/retry.config'
import { NewLlmCallRow } from 'src/db/schema'
import { LlmCallsRepository } from 'src/llm/audit/llm-calls.repository'
import {
  DefaultLlmClient,
  LlmSchemaError,
  LlmTimeoutError,
} from 'src/llm/client/default-llm-client'
import { ModelSpec } from 'src/llm/models/catalog'
import { ModelRegistry } from 'src/llm/models/model-registry'
import { LlmMetricsService } from 'src/llm/observability/llm-metrics.service'
import { runWithRequestContext } from 'src/llm/observability/request-context'
import { ResolvedParams } from 'src/llm/providers/llm-provider.interface'
import { OpenAiProvider } from 'src/llm/providers/openai.provider'
import { Settings } from 'src/llm/settings/settings.schema'
import { SettingsService } from 'src/llm/settings/settings.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

const settings: Settings = {
  models: { chat: 'gpt-4o', reasoning: 'gpt-5-mini', image: 'dall-e-3' },
  temperature: 0.7,
  reasoningEffort: 'medium',
  systemPrompt: 'sys',
}

const messages = [new HumanMessage('hi')]

function aiMessage(content: string, extra: Partial<AIMessage> = {}): AIMessage {
  return new AIMessage({
    content,
    usage_metadata: {
      input_tokens: 1000,
      output_tokens: 500,
      total_tokens: 1500,
      input_token_details: { cache_read: 200 },
    },
    response_metadata: { finish_reason: 'stop' },
    ...extra,
  })
}

type Invoke = (
  messages: unknown,
  options: { signal: AbortSignal },
) => Promise<unknown>

function setup() {
  const invoke = jest.fn<ReturnType<Invoke>, Parameters<Invoke>>()
  const structuredInvoke = jest.fn<ReturnType<Invoke>, Parameters<Invoke>>()
  const model = {
    invoke,
    bindTools: jest.fn(() => ({ invoke })),
    withStructuredOutput: jest.fn(() => ({ invoke: structuredInvoke })),
  }
  const chatModel = jest.fn<BaseChatModel, [ModelSpec, ResolvedParams]>(
    () => model as unknown as BaseChatModel,
  )
  const imageInvoke = jest.fn<Promise<string>, [string]>()
  const imageModel = jest.fn(() => ({ invoke: imageInvoke }))
  const provider = { id: 'openai', chatModel, imageModel } as OpenAiProvider

  const metrics = {
    callStarted: jest.fn(() => jest.fn()),
    callFinished: jest.fn(),
    tokens: jest.fn(),
    cost: jest.fn(),
    retry: jest.fn(),
  }
  const settingsService = {
    get: jest.fn(() => settings),
  } as unknown as SettingsService
  const retryConfig = {
    getOpenAIConfig: () => ({
      maxAttempts: 3,
      baseDelay: 10,
      maxDelay: 10,
      backoffFactor: 1,
      jitter: false,
      logRetryAttempts: false,
      logSuccessfulRetries: false,
      logFailedRetries: false,
      logRetryDelays: false,
    }),
  } as unknown as RetryConfigService

  const insert = jest.fn<Promise<void>, [NewLlmCallRow]>(() =>
    Promise.resolve(),
  )
  const audit = { insert } as unknown as LlmCallsRepository
  const client = new DefaultLlmClient(
    settingsService,
    new ModelRegistry(),
    metrics as unknown as LlmMetricsService,
    new RetryService(new ErrorClassificationService()),
    retryConfig,
    provider,
    audit,
  )
  return {
    client,
    insert,
    model,
    invoke,
    structuredInvoke,
    chatModel,
    imageModel,
    imageInvoke,
    metrics,
  }
}

describe('DefaultLlmClient', () => {
  let logSpy: jest.SpyInstance
  let debugSpy: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation()
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  describe('role resolution', () => {
    it('uses the model configured for the role', async () => {
      const t = setup()
      t.invoke.mockResolvedValue(aiMessage('ok'))

      const chat = await t.client.call({
        operation: 'x.chat',
        role: 'chat',
        messages,
      })
      const reasoning = await t.client.call({
        operation: 'x.reasoning',
        role: 'reasoning',
        messages,
      })

      expect(chat.model).toBe('gpt-4o')
      expect(reasoning.model).toBe('gpt-5-mini')
      expect(t.chatModel.mock.calls[0][0].id).toBe('gpt-4o')
      expect(t.chatModel.mock.calls[1][0].id).toBe('gpt-5-mini')
    })

    it('lets overrides win over settings', async () => {
      const t = setup()
      t.invoke.mockResolvedValue(aiMessage('ok'))

      const result = await t.client.call({
        operation: 'x',
        role: 'chat',
        messages,
        overrides: { model: 'gpt-4.1', temperature: 0.1, maxTokens: 50 },
      })

      expect(result.model).toBe('gpt-4.1')
      expect(t.chatModel).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'gpt-4.1' }),
        { temperature: 0.1, maxTokens: 50 },
      )
    })
  })

  describe('params', () => {
    it('passes temperature and omits maxTokens for classic models', async () => {
      const t = setup()
      t.invoke.mockResolvedValue(aiMessage('ok'))
      await t.client.call({ operation: 'x', role: 'chat', messages })
      expect(t.chatModel.mock.calls[0][1]).toEqual({ temperature: 0.7 })
    })

    it('drops temperature and passes reasoningEffort for reasoning models', async () => {
      const t = setup()
      t.invoke.mockResolvedValue(aiMessage('ok'))
      await t.client.call({
        operation: 'x',
        role: 'reasoning',
        messages,
        overrides: { temperature: 0.2 },
      })
      expect(t.chatModel.mock.calls[0][1]).toEqual({
        reasoningEffort: 'medium',
      })
    })
  })

  describe('tools and structured output', () => {
    it('binds tools', async () => {
      const t = setup()
      t.invoke.mockResolvedValue(aiMessage('ok'))
      const tools = [{ name: 'a' }] as never
      await t.client.call({ operation: 'x', role: 'chat', messages, tools })
      expect(t.model.bindTools).toHaveBeenCalledWith(tools)
    })

    it('returns parsed output when a schema is set', async () => {
      const t = setup()
      const schema = z.object({ n: z.number() })
      t.structuredInvoke.mockResolvedValue({
        raw: aiMessage('{"n":1}'),
        parsed: { n: 1 },
      })
      const result = await t.client.call({
        operation: 'x',
        role: 'reasoning',
        messages,
        schema,
      })
      expect(result.output).toEqual({ n: 1 })
      expect(t.model.withStructuredOutput).toHaveBeenCalledWith(schema, {
        includeRaw: true,
      })
    })

    it('retries a parse failure once, then fails with schema_failure', async () => {
      const t = setup()
      t.structuredInvoke.mockResolvedValue({
        raw: aiMessage('nope'),
        parsed: null,
      })

      await expect(
        t.client.call({
          operation: 'x',
          role: 'reasoning',
          messages,
          schema: z.object({ n: z.number() }),
        }),
      ).rejects.toBeInstanceOf(LlmSchemaError)

      expect(t.structuredInvoke).toHaveBeenCalledTimes(2)
      expect(t.metrics.callFinished).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'schema_failure', retries: 1 }),
      )
    })

    it('succeeds when the retry parses', async () => {
      const t = setup()
      t.structuredInvoke
        .mockResolvedValueOnce({ raw: aiMessage('bad'), parsed: null })
        .mockResolvedValueOnce({ raw: aiMessage('{"n":2}'), parsed: { n: 2 } })
      const result = await t.client.call({
        operation: 'x',
        role: 'reasoning',
        messages,
        schema: z.object({ n: z.number() }),
      })
      expect(result.output).toEqual({ n: 2 })
      expect(result.retries).toBe(1)
    })
  })

  describe('timeouts and retries', () => {
    it('aborts the signal on timeout and counts reason: timeout', async () => {
      const t = setup()
      const signals: AbortSignal[] = []
      t.invoke.mockImplementationOnce(
        (_m, { signal }) =>
          new Promise((_, reject) => {
            signals.push(signal)
            signal.addEventListener('abort', () => reject(signal.reason))
          }),
      )
      t.invoke.mockResolvedValueOnce(aiMessage('ok'))

      const pending = t.client.call({
        operation: 'x',
        role: 'chat',
        messages,
        overrides: { timeoutMs: 1000 },
      })
      await jest.advanceTimersByTimeAsync(1000)
      await jest.advanceTimersByTimeAsync(10)
      const result = await pending

      expect(signals[0].aborted).toBe(true)
      expect(signals[0].reason).toBeInstanceOf(LlmTimeoutError)
      expect(t.metrics.retry).toHaveBeenCalledWith({
        operation: 'x',
        reason: 'timeout',
      })
      expect(result.retries).toBe(1)
    })

    it('reports status timeout when every attempt times out', async () => {
      const t = setup()
      t.invoke.mockImplementation(
        (_m, { signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason))
          }),
      )
      const pending = t.client.call({
        operation: 'x',
        role: 'chat',
        messages,
        overrides: { timeoutMs: 100, maxAttempts: 1 },
      })
      const assertion = expect(pending).rejects.toBeInstanceOf(LlmTimeoutError)
      await jest.advanceTimersByTimeAsync(100)
      await assertion
      expect(t.metrics.callFinished).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'timeout', retries: 0 }),
      )
    })

    it('counts a 429 as rate_limit and retries', async () => {
      const t = setup()
      t.invoke
        .mockRejectedValueOnce(
          Object.assign(new Error('slow down'), { status: 429 }),
        )
        .mockResolvedValueOnce(aiMessage('ok'))

      const pending = t.client.call({ operation: 'x', role: 'chat', messages })
      await jest.advanceTimersByTimeAsync(50)
      await pending

      expect(t.metrics.retry).toHaveBeenCalledWith({
        operation: 'x',
        reason: 'rate_limit',
      })
    })

    it('forwards the caller abort signal', async () => {
      const t = setup()
      const caller = new AbortController()
      t.invoke.mockImplementation(
        (_m, { signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      )
      const pending = t.client.call({
        operation: 'x',
        role: 'chat',
        messages,
        signal: caller.signal,
        overrides: { maxAttempts: 1 },
      })
      const assertion = expect(pending).rejects.toThrow('aborted')
      caller.abort()
      await assertion
    })

    it('does not start further attempts after the caller aborts', async () => {
      const t = setup()
      const caller = new AbortController()
      t.invoke.mockImplementation(
        (_m, { signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      )
      const pending = t.client.call({
        operation: 'x',
        role: 'chat',
        messages,
        signal: caller.signal,
      })
      const assertion = expect(pending).rejects.toThrow()
      caller.abort(new Error('caller gone'))
      await jest.runAllTimersAsync()
      await assertion
      expect(t.invoke).toHaveBeenCalledTimes(1)
      expect(t.metrics.retry).not.toHaveBeenCalled()
      expect(t.metrics.callFinished).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error', retries: 0 }),
      )
    })
  })

  describe('observability', () => {
    it('emits metrics, cost and the llm.call log line', async () => {
      const t = setup()
      t.invoke.mockResolvedValue(aiMessage('hello'))

      const result = await runWithRequestContext({ requestId: 'req-1' }, () =>
        t.client.call({ operation: 'x.y', role: 'chat', messages }),
      )

      // 800 uncached * $2.5 + 200 cached * $1.25 + 500 out * $10, per 1M
      const costUsd = (800 * 2.5 + 200 * 1.25 + 500 * 10) / 1_000_000
      expect(result.usage).toEqual({
        input: 1000,
        output: 500,
        cached: 200,
        costUsd,
      })
      expect(result.output).toBe('hello')
      expect(result.finishReason).toBe('stop')
      expect(t.metrics.callStarted).toHaveBeenCalledWith({
        operation: 'x.y',
        model: 'gpt-4o',
      })
      expect(t.metrics.tokens).toHaveBeenCalledWith({
        model: 'gpt-4o',
        input: 1000,
        output: 500,
        cached: 200,
      })
      expect(t.metrics.cost).toHaveBeenCalledWith('gpt-4o', costUsd)
      expect(t.metrics.callFinished).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'x.y',
          role: 'chat',
          status: 'success',
          retries: 0,
        }),
      )
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'x.y',
          model: 'gpt-4o',
          role: 'chat',
          costUsd,
          retries: 0,
          finishReason: 'stop',
          requestId: 'req-1',
        }),
        'llm.call',
      )
      expect(debugSpy).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'x.y', output: 'hello' }),
        'llm.call.io',
      )
    })

    it('records an error status for non-retryable exhaustion', async () => {
      const t = setup()
      t.invoke.mockRejectedValue(new Error('boom'))
      await expect(
        t.client.call({
          operation: 'x',
          role: 'chat',
          messages,
          overrides: { maxAttempts: 1 },
        }),
      ).rejects.toThrow('boom')
      expect(t.metrics.callFinished).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error' }),
      )
    })
  })

  describe('generateImage', () => {
    it('uses the image role model through the provider', async () => {
      const t = setup()
      t.imageInvoke.mockResolvedValue('https://img/1.png')
      const result = await t.client.generateImage({
        operation: 'image.generate',
        prompt: 'a cat',
        overrides: { size: '1024x1024' },
      })
      expect(result).toEqual(
        expect.objectContaining({
          url: 'https://img/1.png',
          model: 'dall-e-3',
        }),
      )
      expect(t.imageModel).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'dall-e-3' }),
        { size: '1024x1024' },
      )
      expect(t.imageInvoke).toHaveBeenCalledWith('a cat')
    })
  })

  describe('audit', () => {
    afterEach(() => {
      delete process.env.LLM_AUDIT_CONTENT
    })

    it('writes a row with usage, cost and request context, hashing the prompt', async () => {
      const t = setup()
      t.invoke.mockResolvedValue(aiMessage('ok'))

      const result = await runWithRequestContext(
        { requestId: 'r1', channelId: 'c1', userId: 'u1', skill: 'chat' },
        () => t.client.call({ operation: 'x.chat', role: 'chat', messages }),
      )

      expect(t.insert).toHaveBeenCalledTimes(1)
      const row = t.insert.mock.calls[0][0]
      expect(row).toEqual(
        expect.objectContaining({
          requestId: 'r1',
          channelId: 'c1',
          userId: 'u1',
          skill: 'chat',
          operation: 'x.chat',
          model: 'gpt-4o',
          role: 'chat',
          status: 'success',
          inputTokens: 1000,
          outputTokens: 500,
          cachedTokens: 200,
          costUsd: result.usage.costUsd.toFixed(6),
          finishReason: 'stop',
        }),
      )
      expect(row.promptHash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('omits prompt and output by default', async () => {
      const t = setup()
      t.invoke.mockResolvedValue(aiMessage('secret'))
      await t.client.call({ operation: 'x', role: 'chat', messages })
      const row = t.insert.mock.calls[0][0]
      expect(row.prompt).toBeUndefined()
      expect(row.output).toBeUndefined()
    })

    it('stores prompt and output when LLM_AUDIT_CONTENT is true', async () => {
      process.env.LLM_AUDIT_CONTENT = 'true'
      const t = setup()
      t.invoke.mockResolvedValue(aiMessage('secret'))
      await t.client.call({ operation: 'x', role: 'chat', messages })
      const row = t.insert.mock.calls[0][0]
      expect(row.prompt).toEqual(messages)
      expect(row.output).toBe('secret')
    })

    it('logs and swallows repository failures', async () => {
      const t = setup()
      t.invoke.mockResolvedValue(aiMessage('ok'))
      t.insert.mockRejectedValue(new Error('db down'))
      await expect(
        t.client.call({ operation: 'x', role: 'chat', messages }),
      ).resolves.toEqual(expect.objectContaining({ output: 'ok' }))
    })
  })
})
