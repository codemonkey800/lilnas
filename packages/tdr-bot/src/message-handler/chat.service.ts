import { Injectable, Logger } from '@nestjs/common'
import { Client, EmbedBuilder } from 'discord.js'
import { nanoid } from 'nanoid'
import { remark } from 'remark'

import { MAX_SEND_TYPING_COUNT, TYPING_DELAY_MS } from 'src/constants/chat'
import {
  ErrorCategory,
  ErrorClassificationService,
} from 'src/utils/error-classifier'
import { remarkFixLinkPlugin } from 'src/utils/fix-link'
import { RetryService } from 'src/utils/retry.service'

import { BaseMessageHandlerService } from './base-message-handler.service'
import { LLMOrchestrationService } from './llm-orchestration.service'
import { Message } from './types'

const INITIAL_SEND_TYPING_COUNT = 1

/**
 * Service for responding to chat messages using ChatGPT.
 */
@Injectable()
export class ChatService extends BaseMessageHandlerService {
  constructor(
    protected override readonly client: Client,
    private readonly llm: LLMOrchestrationService,
    private readonly retryService: RetryService,
    private readonly errorClassifier: ErrorClassificationService,
  ) {
    super(client)
  }

  handlers = [this.handleChatMessage]

  private readonly logger = new Logger(ChatService.name)

  private sendTypingCount = INITIAL_SEND_TYPING_COUNT
  private typingInterval: NodeJS.Timeout | null = null

  private startBotTyping(message: Message) {
    const sendTyping = async () => {
      if (this.sendTypingCount > MAX_SEND_TYPING_COUNT) {
        this.logger.log({ log: 'sending long typing message' })

        try {
          await this.retryService.executeWithRetry(
            () =>
              message.reply(
                "sorry i'm taking me longer than usual to respond, i'm a little nervous <:Sadge:781403152258826281>",
              ),
            {
              maxAttempts: 3,
              baseDelay: 1000,
              maxDelay: 5000,
            },
            'Discord-longTypingMessage',
            ErrorCategory.DISCORD_API,
          )
        } catch (error) {
          this.logger.error('Failed to send long typing message', {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }

        this.stopBotTyping()
        return
      }

      this.sendTypingCount++

      try {
        await this.retryService.executeWithRetry(
          () => message.channel.sendTyping(),
          {
            maxAttempts: 2,
            baseDelay: 500,
            maxDelay: 2000,
          },
          'Discord-sendTyping',
          ErrorCategory.DISCORD_API,
        )
      } catch (error) {
        this.logger.warn('Failed to send typing indicator', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    sendTyping()
    this.typingInterval = setInterval(sendTyping, TYPING_DELAY_MS)
  }

  private stopBotTyping() {
    if (this.typingInterval) {
      clearInterval(this.typingInterval)
    }

    this.sendTypingCount = INITIAL_SEND_TYPING_COUNT
  }

  private async sanitizeContent(content: string) {
    const result = await remark().use(remarkFixLinkPlugin).process(content)
    return result.toString()
  }

  private async sendErrorMessage(message: Message, errorMessage: string) {
    this.stopBotTyping()

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
      this.logger.error('Failed to send error message to user', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorMessage,
      })
    }
  }

  private async handleChatMessage(message: Message): Promise<boolean> {
    const isBotMention = message.mentions.users.some(
      user => user.id === this.client.user?.id,
    )

    const isTdrBotChannel =
      'name' in message.channel && message.channel.name === 'tdr-bot-chat'

    const isQuestion = message.content.endsWith('?')

    const isTdrQuestion = isTdrBotChannel && isQuestion

    // Don't respond to messages that don't mention the bot or is not a question
    // in TDR channel
    if (!isBotMention && !isTdrQuestion) {
      return false
    }

    const content = message.content
      .replace(`<@${this.client.user?.id}>`, '')
      .trim()

    const id = nanoid()

    this.logger.log(
      {
        id,
        message: content,
        user: message.author.displayName,
      },
      'Responding to message',
    )

    this.startBotTyping(message)

    try {
      const response = await this.retryService.executeWithRetry(
        () =>
          this.llm.sendMessage({
            message: content,
            user: message.author.displayName,
          }),
        {
          maxAttempts: 2,
          baseDelay: 2000,
          maxDelay: 10000,
          timeout: 120000, // 2 minutes for LLM response
        },
        'LLM-sendMessage',
        ErrorCategory.OPENAI_API,
      )

      if (response) {
        this.logger.log(
          {
            id,
            images: response.images,
            response: response.content,
            user: message.author.displayName,
          },
          'Sending response to user',
        )

        await this.retryService.executeWithRetry(
          () =>
            message.reply({
              content: response.content,
              embeds:
                response.images instanceof Array && response.images.length > 0
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

        this.stopBotTyping()
      } else {
        await this.sendErrorMessage(
          message,
          "sorry open AI is being dumb so I can't respond <:Sadge:781403152258826281>",
        )
      }
    } catch (error) {
      this.logger.error('Failed to process chat message', {
        id,
        error: error instanceof Error ? error.message : 'Unknown error',
        user: message.author.displayName,
        message: content,
      })

      const classification = this.errorClassifier.classifyError(
        error as Error,
        ErrorCategory.SYSTEM,
      )

      let errorMessage =
        "sorry something went wrong and I can't respond right now <:Sadge:781403152258826281>"

      if (classification.errorType === 'timeout') {
        errorMessage =
          "sorry I'm taking too long to respond, please try again later <:Sadge:781403152258826281>"
      }

      await this.sendErrorMessage(message, errorMessage)
    }

    return true
  }
}
