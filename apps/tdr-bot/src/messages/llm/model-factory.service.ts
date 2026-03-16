import { StructuredToolInterface } from '@langchain/core/tools'
import { ChatOpenAI } from '@langchain/openai'
import { Injectable, Logger } from '@nestjs/common'

import { REASONING_TEMPERATURE } from 'src/constants/llm'
import { StateService } from 'src/state/state.service'

@Injectable()
export class ModelFactoryService {
  private readonly logger = new Logger(ModelFactoryService.name)

  constructor(private readonly state: StateService) {}

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

  createReasoningModel(): ChatOpenAI {
    const { reasoningModel } = this.state.getState()
    this.logger.log({ model: reasoningModel }, 'Creating reasoning model')

    return new ChatOpenAI({
      model: reasoningModel,
      temperature: REASONING_TEMPERATURE,
    })
  }
}
