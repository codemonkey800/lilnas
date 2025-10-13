import { Injectable, Logger } from '@nestjs/common'
import { Client } from 'discord.js'
import _ from 'lodash'

import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

import { BaseMessageHandlerService } from './base-message-handler.service'
import { Message, MessageHandler } from './types'

/**
 * Service for responding to chat messages that include a certain keyword.
 */
@Injectable()
export class KeywordsService extends BaseMessageHandlerService {
  constructor(
    protected override readonly client: Client,
    private readonly retryService: RetryService,
    private readonly errorClassifier: ErrorClassificationService,
  ) {
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

      try {
        await this.retryService.executeWithRetry(
          () => message.reply(response),
          {
            maxAttempts: 3,
            baseDelay: 1000,
            maxDelay: 5000,
          },
          `Discord-keyword-${keyword}`,
        )
      } catch (error) {
        this.logger.error('Failed to send keyword response', {
          keyword,
          response,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }

      return true
    }
  }

  private async handleWarMessage(message: Message): Promise<boolean> {
    if (!this.hasKeyword(message, 'war')) {
      return false
    }

    this.logger.log({ handler: 'handleWarMessage' })

    const response = _.random(1, 420) === 420 ? 'war never changes' : 'war'

    try {
      await this.retryService.executeWithRetry(
        () => message.reply(response),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 5000,
        },
        'Discord-war-keyword',
      )
    } catch (error) {
      this.logger.error('Failed to send war keyword response', {
        response,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    return true
  }
}
