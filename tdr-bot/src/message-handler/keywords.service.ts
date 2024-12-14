import { Injectable, Logger } from '@nestjs/common'
import { Client } from 'discord.js'
import _ from 'lodash'

import { BaseMessageHandlerService } from './base-message-handler.service'
import { Message, MessageHandler } from './types'

/**
 * Service for responding to chat messages that include a certain keyword.
 */
@Injectable()
export class KeywordsService extends BaseMessageHandlerService {
  constructor(protected readonly client: Client) {
    super(client)
  }

  private readonly logger = new Logger(KeywordsService.name)

  handlers = [
    this.getSimpleKeywordHandler('cabin', 'wen cabin'),
    this.getSimpleKeywordHandler('prog', 'prog'),
    this.getSimpleKeywordHandler('cum', 'CUM'),
    this.handleWarMessage,
  ]

  private hasKeyword(message: Message, keyword: string): boolean {
    return message.content.toLowerCase().split(' ').includes(keyword)
  }

  private getSimpleKeywordHandler(
    keyword: string,
    response: string,
  ): MessageHandler {
    return async (message: Message): Promise<boolean> => {
      if (!this.hasKeyword(message, keyword)) {
        return false
      }

      this.logger.log({
        handler: 'simpleKeywordHandler',
        keyword,
        response,
      })

      await message.reply(response)

      return true
    }
  }

  private async handleWarMessage(message: Message): Promise<boolean> {
    if (!this.hasKeyword(message, 'war')) {
      return false
    }

    this.logger.log({ handler: 'handleWarMessage' })

    const response = _.random(1, 420) === 420 ? 'war never changes' : 'war'
    await message.reply(response)

    return true
  }
}
