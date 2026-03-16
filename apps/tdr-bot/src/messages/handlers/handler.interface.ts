import { HandlerResult, Message, MessageContext } from 'src/messages/types'

export const MESSAGE_HANDLERS = Symbol('MESSAGE_HANDLERS')

export interface IMessageHandler {
  readonly name: string
  canHandle(message: Message): boolean | Promise<boolean>
  handle(message: Message, context: MessageContext): Promise<HandlerResult>
}
