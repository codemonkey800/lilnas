import { ChatOpenAI } from '@langchain/openai'
import { Logger } from '@nestjs/common'

import { REASONING_TEMPERATURE } from 'src/constants/llm'

/**
 * State interface for accessing model configurations
 * This matches the StateService interface used in MovieOperationsService
 */
interface LLMState {
  reasoningModel: string
  chatModel: string
  temperature: number
}

/**
 * Service interface for accessing state
 * This allows the utility to work with any state provider
 */
interface StateProvider {
  getState(): LLMState
}

/**
 * Creates a ChatOpenAI instance for reasoning operations.
 * Unifies the getReasoningModel() logic from MovieOperationsService.
 */
export function createReasoningModel(
  stateProvider: StateProvider,
  logger?: Logger,
): ChatOpenAI {
  const state = stateProvider.getState()

  if (logger) {
    logger.log({ model: state.reasoningModel }, 'Creating reasoning model')
  }

  return new ChatOpenAI({
    model: state.reasoningModel,
    temperature: REASONING_TEMPERATURE,
  })
}

/**
 * Creates a ChatOpenAI instance for chat/response generation.
 * Unifies the getChatModel() logic from MovieOperationsService.
 */
export function createChatModel(
  stateProvider: StateProvider,
  logger?: Logger,
): ChatOpenAI {
  const state = stateProvider.getState()

  if (logger) {
    logger.log({ model: state.chatModel }, 'Creating chat model')
  }

  return new ChatOpenAI({
    model: state.chatModel,
    temperature: state.temperature,
  })
}
