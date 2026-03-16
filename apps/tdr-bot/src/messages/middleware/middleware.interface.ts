import { Message } from 'src/messages/types'

export interface IMessageMiddleware {
  process(message: Message): boolean
}
