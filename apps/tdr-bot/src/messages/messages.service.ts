import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'
import { Context, type ContextOf, On } from 'necord'

import { HandlerRegistry } from './handlers/handler.registry'
import { GuardMiddleware } from './middleware/guard.middleware'
import { Message, MessageContext } from './types'

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name)

  constructor(
    private readonly guard: GuardMiddleware,
    private readonly registry: HandlerRegistry,
  ) {}

  @On('messageCreate')
  async onMessage(@Context() [message]: ContextOf<'messageCreate'>) {
    try {
      if (!this.guard.process(message)) return

      const context: MessageContext = {
        requestId: nanoid(),
        userId: message.author.id,
      }

      await this.runHandlers(message, context)
    } catch (error) {
      this.logger.error('Unhandled error in onMessage', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageContent: message.content?.substring(0, 100),
        author: message.author?.displayName,
      })
    }
  }

  private async runHandlers(
    message: Message,
    context: MessageContext,
  ): Promise<void> {
    for (const handler of this.registry.getHandlers()) {
      if (await handler.canHandle(message)) {
        const result = await handler.handle(message, context)
        if (result.handled) return
      }
    }
  }
}
