import { ContextOf } from 'necord'

/**
 * Message data structure received when a message is created.
 */
export type Message = ContextOf<'messageCreate'>[0]

/**
 * A function that handles responding to a message. It should return `true` if
 * the message was handled, otherwise `false` so that the next handler can
 * attempt to respond.
 */
export type MessageHandler = (message: Message) => boolean | Promise<boolean>
