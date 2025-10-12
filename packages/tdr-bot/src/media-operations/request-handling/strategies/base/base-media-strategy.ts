import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { getErrorMessage } from '@lilnas/utils/error'
import { Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'
import { StrategyResult } from 'src/media-operations/request-handling/types/strategy-result.type'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { StateService } from 'src/state/state.service'

import { MediaOperationStrategy } from './media-operation-strategy.interface'

/**
 * Abstract base class for media operation strategies
 * Provides common error handling and utility methods
 */
export abstract class BaseMediaStrategy implements MediaOperationStrategy {
  protected abstract readonly logger: Logger
  protected abstract readonly strategyName: string
  protected stateService!: StateService
  protected contextService!: ContextManagementService

  /**
   * Handle a media operation request with error handling
   */
  async handleRequest(params: StrategyRequestParams): Promise<StrategyResult> {
    this.logger.log(
      {
        userId: params.userId,
        messageContent:
          typeof params.message.content === 'string'
            ? params.message.content.substring(0, 100)
            : 'non-string content',
      },
      `${this.strategyName}: Handling request`,
    )

    try {
      return await this.executeRequest(params)
    } catch (error) {
      this.logger.error(
        {
          error: getErrorMessage(error),
          userId: params.userId,
          strategyName: this.strategyName,
        },
        `${this.strategyName}: Error handling request`,
      )

      // Generate fallback error response
      return this.generateErrorResponse(params.messages, getErrorMessage(error))
    }
  }

  /**
   * Execute the actual request handling logic
   * Must be implemented by concrete strategies
   */
  protected abstract executeRequest(
    params: StrategyRequestParams,
  ): Promise<StrategyResult>

  /**
   * Generate a fallback error response
   */
  protected generateErrorResponse(
    messages: BaseMessage[],
    errorMessage: string,
  ): StrategyResult {
    const fallbackMessage = new HumanMessage({
      id: nanoid(),
      content: `Sorry, I encountered an error: ${errorMessage}. Please try again.`,
    })

    return {
      images: [],
      messages: messages.concat(fallbackMessage),
    }
  }

  /**
   * Get message content as string
   */
  protected getMessageContent(message: HumanMessage): string {
    return typeof message.content === 'string'
      ? message.content
      : message.content.toString()
  }

  /**
   * Get chat model configured from state
   * Requires stateService to be injected in the concrete strategy
   */
  protected getChatModel(): ChatOpenAI {
    if (!this.stateService) {
      throw new Error(
        `${this.strategyName}: StateService not injected for getChatModel()`,
      )
    }
    const state = this.stateService.getState()
    return new ChatOpenAI({
      model: state.chatModel,
      temperature: state.temperature,
    })
  }
}
