import { Injectable, Logger } from '@nestjs/common'
import { Client, EmbedBuilder } from 'discord.js'
import { nanoid } from 'nanoid'
import { remark } from 'remark'

import { remarkFixLinkPlugin } from 'src/utils/fix-link'

import { BaseMessageHandlerService } from './base-message-handler.service'
import { LLMService } from './llm.service'
import { Message } from './types'

const INITIAL_SEND_TYPING_COUNT = 1
const MAX_SEND_TYPING_COUNT = 5

/**
 * The default max time for typing is 10 seconds
 */
const MAX_TYPING_DELAY = 10 * 1000

/**
 * Service for responding to chat messages using ChatGPT.
 */
@Injectable()
export class ChatService extends BaseMessageHandlerService {
  constructor(
    protected readonly client: Client,
    private readonly llm: LLMService,
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
        await message.reply(
          "sorry i'm taking me longer than usual to respond, i'm a little nervous <:Sadge:781403152258826281>",
        )

        this.stopBotTyping()
        return
      }

      this.sendTypingCount++
      message.channel.sendTyping()
    }

    sendTyping()
    this.typingInterval = setInterval(sendTyping, MAX_TYPING_DELAY)
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

    const response = await this.llm.sendMessage({
      message: content,
      user: message.author.displayName,
    })

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

      await message.reply({
        content: response.content,
        embeds:
          response.images instanceof Array && response.images.length > 0
            ? response.images.map(image =>
                new EmbedBuilder().setTitle(image.title).setImage(image.url),
              )
            : undefined,
      })

      this.stopBotTyping()
    } else {
      message.reply(
        "sorry open AI is being dumb so I can't respond <:Sadge:781403152258826281>",
      )
    }

    return true
  }
}
