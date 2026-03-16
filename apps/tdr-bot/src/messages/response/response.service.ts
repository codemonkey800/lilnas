import { HumanMessage } from '@langchain/core/messages'
import { Injectable, Logger } from '@nestjs/common'
import { EmbedBuilder } from 'discord.js'

import { DISCORD_MAX_MESSAGE_LENGTH } from 'src/constants/chat'
import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { Message } from 'src/messages/types'
import { LLMStringContentSchema } from 'src/schemas/llm.schemas'
import { MessageResponse } from 'src/schemas/messages'
import { ErrorCategory } from 'src/utils/error-classifier'
import { SHORTEN_RESPONSE_PROMPT } from 'src/utils/prompts'
import { RetryService } from 'src/utils/retry.service'

import { ResponseSanitizer } from './response-sanitizer'

@Injectable()
export class ResponseService {
  private readonly logger = new Logger(ResponseService.name)

  constructor(
    private readonly retryService: RetryService,
    private readonly modelFactory: ModelFactoryService,
    private readonly sanitize: ResponseSanitizer,
  ) {}

  async sendReply(message: Message, response: MessageResponse): Promise<void> {
    let content = await this.sanitize.sanitizeResponse(response.content)

    if (content.length > DISCORD_MAX_MESSAGE_LENGTH) {
      this.logger.warn(
        { length: content.length },
        'Response exceeds Discord limit, attempting to shorten',
      )
      content = await this.shortenResponse(content)

      if (content.length > DISCORD_MAX_MESSAGE_LENGTH) {
        this.logger.warn(
          { length: content.length },
          'Shortened response still exceeds Discord limit, truncating',
        )
        content = this.truncateAtNaturalBreak(content)
      }
    }

    try {
      await this.retryService.executeWithRetry(
        () =>
          message.reply({
            content,
            embeds:
              Array.isArray(response.images) && response.images.length > 0
                ? response.images.map(image =>
                    new EmbedBuilder()
                      .setTitle(image.title)
                      .setImage(image.url),
                  )
                : undefined,
          }),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 5000,
        },
        'Discord-sendResponse',
        ErrorCategory.DISCORD_API,
      )
    } catch (error) {
      this.logger.error('Failed to send reply, sending fallback', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contentLength: content.length,
      })

      try {
        await message.reply(
          "sorry, my response was too long and I couldn't shorten it <:Sadge:781403152258826281>",
        )
      } catch (fallbackError) {
        this.logger.error('Failed to send fallback message', {
          error:
            fallbackError instanceof Error
              ? fallbackError.message
              : 'Unknown error',
          channelId: message.channelId,
        })
      }
    }
  }

  async sendErrorReply(message: Message, errorMessage: string): Promise<void> {
    try {
      await this.retryService.executeWithRetry(
        () => message.reply(errorMessage),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 5000,
        },
        'Discord-sendErrorMessage',
        ErrorCategory.DISCORD_API,
      )
    } catch (error) {
      this.logger.error('Failed to send error message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorMessage,
      })
    }
  }

  private async shortenResponse(content: string): Promise<string> {
    try {
      const model = this.modelFactory.createChatModel()
      const response = await this.retryService.executeWithRetry(
        () =>
          model.invoke([SHORTEN_RESPONSE_PROMPT, new HumanMessage(content)]),
        {
          maxAttempts: 2,
          baseDelay: 1000,
          maxDelay: 5000,
          timeout: 30000,
        },
        'OpenAI-shortenResponse',
      )
      const shortened = LLMStringContentSchema.parse(response.content)
      if (shortened.length <= DISCORD_MAX_MESSAGE_LENGTH) return shortened

      this.logger.warn(
        { length: shortened.length },
        'LLM-shortened response still exceeds Discord limit, truncating',
      )
      return this.truncateAtNaturalBreak(shortened)
    } catch (error) {
      this.logger.error('Failed to shorten response', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return this.truncateAtNaturalBreak(content)
    }
  }

  private truncateAtNaturalBreak(content: string): string {
    const limit = DISCORD_MAX_MESSAGE_LENGTH - 3
    const truncated = content.slice(0, limit)
    const lastNewline = truncated.lastIndexOf('\n')
    const breakpoint = lastNewline > limit * 0.5 ? lastNewline : limit
    return content.slice(0, breakpoint) + '...'
  }
}
