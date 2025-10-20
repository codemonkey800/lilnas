import { Injectable, Logger } from '@nestjs/common'
import { Context, type ContextOf, On } from 'necord'

import { ChatService } from './chat.service'
import { KeywordsService } from './keywords.service'
import { MessageLoggerService } from './message-logger.service'

/**
 * Service for handling `messageCreate` events. This works by running through a
 * series of handlers until one returns `true`, indicating that the message was
 * handled.
 *
 * Really simple handlers can be implemented directly in this service, but more complex handlers
 * should be implemented as a separate service.
 */
@Injectable()
export class MessageHandlerService {
  private readonly logger = new Logger(MessageHandlerService.name)

  constructor(
    private readonly chatService: ChatService,
    private readonly keywordsService: KeywordsService,
    private readonly messageLogger: MessageLoggerService,
  ) {}

  @On('messageCreate')
  async onMessage(@Context() [message]: ContextOf<'messageCreate'>) {
    // Log the message to JSONL files before processing
    try {
      await this.messageLogger.logMessage(message)
    } catch (error) {
      this.logger.error('Failed to log message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageId: message.id,
      })
    }

    const handlers = [
      ...this.keywordsService.getHandlers(),
      ...this.chatService.getHandlers(),
    ]

    for (const handler of handlers) {
      if (await handler(message)) {
        return
      }
    }
  }
}
