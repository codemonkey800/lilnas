import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { getErrorMessage } from '@lilnas/utils/error'
import { Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { LlmClient } from 'src/llm/client/llm-client'
import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'
import { StrategyResult } from 'src/media-operations/request-handling/types/strategy-result.type'

import { MediaOperationStrategy } from './media-operation-strategy.interface'

/**
 * Abstract base class for media operation strategies
 * Provides common error handling and utility methods
 */
export abstract class BaseMediaStrategy implements MediaOperationStrategy {
  protected abstract readonly logger: Logger
  protected abstract readonly strategyName: string
  protected llm!: LlmClient

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
}
