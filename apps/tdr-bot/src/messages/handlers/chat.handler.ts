import { Injectable, Logger } from '@nestjs/common'
import { ChannelType, Client } from 'discord.js'

import { TDR_CHAT_CHANNEL } from 'src/constants/chat'
import { LLMOrchestrationService } from 'src/messages/llm/llm-orchestration.service'
import { ResponseService } from 'src/messages/response/response.service'
import { TypingIndicatorService } from 'src/messages/response/typing-indicator.service'
import { HandlerResult, Message, MessageContext } from 'src/messages/types'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import {
  ErrorCategory,
  ErrorClassificationService,
} from 'src/utils/error-classifier'
import { isError } from 'src/utils/type-guards'

import { IMessageHandler } from './handler.interface'

/**
 * Handles messages directed at TDR Bot — either via `@mention`
 * or questions posted in the `tdr-bot-chat` channel.
 *
 * Delegates to {@link LLMOrchestrationService} for response
 * generation and sends the reply back through
 * {@link ResponseService}.
 */
@Injectable()
export class ChatHandler implements IMessageHandler {
  readonly name = 'chat'

  private readonly logger = new Logger(ChatHandler.name)

  constructor(
    private readonly client: Client,
    private readonly llm: LLMOrchestrationService,
    private readonly responseService: ResponseService,
    private readonly typingIndicator: TypingIndicatorService,
    private readonly errorClassifier: ErrorClassificationService,
    private readonly metrics: TdrBotMetricsService,
  ) {}

  /** Returns `true` if the message mentions the bot or is a question in the chat channel. */
  canHandle(message: Message): boolean {
    const isBotMention = message.mentions.users.some(
      user => user.id === this.client.user?.id,
    )
    const isTdrBotChannel =
      message.channel.type === ChannelType.GuildText &&
      message.channel.name === TDR_CHAT_CHANNEL
    const isQuestion = message.content.endsWith('?')

    return isBotMention || (isTdrBotChannel && isQuestion)
  }

  /**
   * Processes a chat message through the LLM pipeline and sends the
   * response back to Discord. Shows a typing indicator while waiting
   * for the AI response.
   */
  async handle(
    message: Message,
    context: MessageContext,
  ): Promise<HandlerResult> {
    const content = message.content
      .replace(`<@${this.client.user?.id}>`, '')
      .trim()

    this.logger.log(
      {
        id: context.requestId,
        message: content,
        user: message.author.displayName,
      },
      'Responding to message',
    )

    this.typingIndicator.start(message.channel)

    try {
      const response = await this.llm.sendMessage({
        message: content,
        user: message.author.displayName,
        userId: context.userId,
        guildId: message.guildId ?? '',
      })

      this.logger.log(
        {
          id: context.requestId,
          images: response.images,
          response: response.content,
          user: message.author.displayName,
        },
        'Sending response to user',
      )

      await this.responseService.sendReply(message, response)
      this.metrics.messageHandled('chat', 'success')
      return { handled: true, response }
    } catch (error) {
      this.logger.error('Failed to process chat message', {
        id: context.requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        user: message.author.displayName,
        message: content,
      })

      this.metrics.messageHandled('chat', 'error')

      const errorToClassify = isError(error)
        ? error
        : new Error('Unknown error occurred')

      const classification = this.errorClassifier.classifyError(
        errorToClassify,
        ErrorCategory.SYSTEM,
      )

      const errorMessage =
        classification.errorType === 'timeout'
          ? "sorry I'm taking too long to respond, please try again later <:Sadge:781403152258826281>"
          : "sorry something went wrong and I can't respond right now <:Sadge:781403152258826281>"

      await this.responseService.sendErrorReply(message, errorMessage)
      return { handled: true }
    } finally {
      this.typingIndicator.stop(message.channelId)
    }
  }
}
