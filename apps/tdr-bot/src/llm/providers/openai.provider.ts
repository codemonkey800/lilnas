import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatOpenAI, DallEAPIWrapper } from '@langchain/openai'
import { Injectable } from '@nestjs/common'

import { ModelSpec } from 'src/llm/models/catalog'

import { LlmProvider, ResolvedParams } from './llm-provider.interface'

type ImageSize = NonNullable<
  ConstructorParameters<typeof DallEAPIWrapper>[0]
>['size']

/** The only place ChatOpenAI / DallEAPIWrapper are constructed. */
@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly id = 'openai' as const

  chatModel(spec: ModelSpec, params: ResolvedParams): BaseChatModel {
    return new ChatOpenAI({
      model: spec.id,
      // retries and timeouts are owned by RetryService
      maxRetries: 0,
      ...(params.temperature !== undefined && {
        temperature: params.temperature,
      }),
      ...(params.maxTokens !== undefined && { maxTokens: params.maxTokens }),
      ...(params.reasoningEffort && {
        reasoning: { effort: params.reasoningEffort },
      }),
    })
  }

  imageModel(
    spec: ModelSpec,
    options?: { size?: string },
  ): { invoke(prompt: string): Promise<string> } {
    const wrapper = new DallEAPIWrapper({
      model: spec.id,
      ...(options?.size && { size: options.size as ImageSize }),
    })
    return {
      invoke: async prompt => {
        const result = await wrapper.invoke(prompt)
        return typeof result === 'string' ? result : JSON.stringify(result)
      },
    }
  }
}
