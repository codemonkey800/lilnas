import { AIMessage, BaseMessage } from '@langchain/core/messages'
import { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'

import { ModelRole } from 'src/llm/models/roles'

export interface LlmCall<T = string> {
  /** Stable label for metrics and logs, e.g. 'router.classify'. */
  operation: string
  role: Exclude<ModelRole, 'image'>
  messages: BaseMessage[]
  /** Enables structured output; a parse failure is counted and retried once. */
  schema?: z.ZodType<T>
  tools?: StructuredToolInterface[]
  overrides?: {
    model?: string
    temperature?: number
    maxTokens?: number
    timeoutMs?: number
    maxAttempts?: number
  }
  signal?: AbortSignal
}

export interface LlmResult<T = string> {
  /** String content when no schema was given. */
  output: T
  message: AIMessage
  model: string
  usage: { input: number; output: number; cached: number; costUsd: number }
  durationMs: number
  retries: number
  finishReason?: string
}

export interface ImageCall {
  operation: string
  prompt: string
  overrides?: { model?: string; size?: string }
}

export interface ImageResult {
  url: string
  model: string
  durationMs: number
}
