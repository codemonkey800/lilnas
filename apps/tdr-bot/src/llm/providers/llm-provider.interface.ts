import { BaseChatModel } from '@langchain/core/language_models/chat_models'

import { ReasoningEffort } from 'src/llm/client/llm-call.types'
import { ModelSpec } from 'src/llm/models/catalog'

export interface ResolvedParams {
  /** Omitted for models without temperature support. */
  temperature?: number
  maxTokens?: number
  /** Only set for models that support reasoning effort. */
  reasoningEffort?: ReasoningEffort
}

export interface LlmProvider {
  id: 'openai'
  chatModel(spec: ModelSpec, params: ResolvedParams): BaseChatModel
  imageModel(
    spec: ModelSpec,
    options?: { size?: string },
  ): { invoke(prompt: string): Promise<string> }
}
