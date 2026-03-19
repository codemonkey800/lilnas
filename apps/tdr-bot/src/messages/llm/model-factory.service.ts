import { StructuredToolInterface } from '@langchain/core/tools'
import { ChatOpenAI } from '@langchain/openai'
import { Injectable, Logger } from '@nestjs/common'

import { REASONING_TEMPERATURE } from 'src/constants/llm'
import { StateService } from 'src/state/state.service'

/**
 * Factory that creates pre-configured OpenAI model instances
 * using the model names and temperatures stored in the runtime
 * {@link StateService}.
 */
@Injectable()
export class ModelFactoryService {
  private readonly logger = new Logger(ModelFactoryService.name)

  constructor(private readonly state: StateService) {}

  /**
   * Creates a {@link ChatOpenAI} instance using the active chat model.
   *
   * @overload Returns a plain `ChatOpenAI` when called without tools.
   * @overload Returns a tool-bound model when `tools` are provided.
   */
  createChatModel(): ChatOpenAI
  createChatModel(
    tools: StructuredToolInterface[],
  ): ReturnType<ChatOpenAI['bindTools']>
  createChatModel(
    tools?: StructuredToolInterface[],
  ): ChatOpenAI | ReturnType<ChatOpenAI['bindTools']> {
    const { chatModel, temperature } = this.state.getState()
    this.logger.log({ model: chatModel }, 'Creating chat model')

    const model = new ChatOpenAI({ model: chatModel, temperature })
    if (tools) return model.bindTools(tools)
    return model
  }

  /** Creates a {@link ChatOpenAI} instance configured for structured reasoning tasks. */
  createReasoningModel(): ChatOpenAI {
    const { reasoningModel } = this.state.getState()
    this.logger.log({ model: reasoningModel }, 'Creating reasoning model')

    return new ChatOpenAI({
      model: reasoningModel,
      temperature: REASONING_TEMPERATURE,
    })
  }
}
