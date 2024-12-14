import { Client } from 'discord.js'

import { Message, MessageHandler } from './types'

/**
 * Base class for handling chat messages responses. This manages the handler
 * binding and checking pre-conditions before executing a handler.
 */
export abstract class BaseMessageHandlerService {
  constructor(protected readonly client: Client) {}

  /**
   * List of handlers to execute when a message is received.
   */
  protected abstract handlers: MessageHandler[]

  /**
   * Returns list of all message handlers with its `this` binded to the message
   * handler instance. This is necessary to ensure that handlers can access any
   * local data in the service class.
   */
  getHandlers(): MessageHandler[] {
    return this.handlers.map((handler) => this.skipIfBot(handler.bind(this)))
  }

  /**
   * Skips the handler if the message was sent by the bot.
   */
  private skipIfBot(handler: MessageHandler): MessageHandler {
    return (message: Message) => {
      if (message.author.id === this.client.user?.id) {
        return false
      }

      return handler(message)
    }
  }
}
