import { Injectable } from '@nestjs/common'
import { Context, type ContextOf, On } from 'necord'

import { ChatService } from './chat.service'
import { KeywordsService } from './keywords.service'

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
  constructor(
    private readonly chatService: ChatService,
    private readonly keywordsService: KeywordsService,
  ) {}

  @On('messageCreate')
  async onMessage(@Context() [message]: ContextOf<'messageCreate'>) {
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
