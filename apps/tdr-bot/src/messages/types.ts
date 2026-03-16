import { ContextOf } from 'necord'

import { MessageResponse } from 'src/schemas/messages'

export type Message = ContextOf<'messageCreate'>[0]

export interface MessageContext {
  requestId: string
  userId: string
}

export type HandlerResult =
  | { handled: true; response?: MessageResponse }
  | { handled: false }
