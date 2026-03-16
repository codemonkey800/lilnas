import { Injectable, Logger } from '@nestjs/common'

import { HandlerResult, Message, MessageContext } from 'src/messages/types'
import { RetryService } from 'src/utils/retry.service'

import { IMessageHandler } from './handler.interface'

interface KeywordConfig {
  keyword: string
  response: string | (() => string)
}

const KEYWORDS: KeywordConfig[] = [
  { keyword: 'cabin', response: 'wen cabin' },
  { keyword: 'prog', response: 'prog' },
  { keyword: 'cum', response: 'CUM' },
  {
    keyword: 'war',
    response: () =>
      Math.floor(Math.random() * 420) + 1 === 420 ? 'war never changes' : 'war',
  },
]

@Injectable()
export class KeywordsHandler implements IMessageHandler {
  readonly name = 'keywords'

  private readonly logger = new Logger(KeywordsHandler.name)

  constructor(private readonly retryService: RetryService) {}

  canHandle(message: Message): boolean {
    if (message.content.trim().endsWith('?')) return false

    const words = message.content.toLowerCase().split(/\s+/)
    return KEYWORDS.some(kw => words.includes(kw.keyword))
  }

  async handle(
    message: Message,
    _context: MessageContext, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<HandlerResult> {
    const words = message.content.toLowerCase().split(/\s+/)
    const matched = KEYWORDS.find(kw => words.includes(kw.keyword))

    if (!matched) return { handled: false }

    const response =
      typeof matched.response === 'function'
        ? matched.response()
        : matched.response

    this.logger.log({ handler: 'keywords', keyword: matched.keyword, response })

    try {
      await this.retryService.executeWithRetry(
        () => message.reply(response),
        { maxAttempts: 3, baseDelay: 1000, maxDelay: 5000 },
        `Discord-keyword-${matched.keyword}`,
      )
      return { handled: true }
    } catch (error) {
      this.logger.error('Failed to send keyword response', {
        keyword: matched.keyword,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return { handled: false }
    }
  }
}
