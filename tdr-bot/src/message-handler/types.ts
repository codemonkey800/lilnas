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

export enum ResponseType {
  Default = 'default',
  Image = 'image',
  Math = 'math',
}

export enum GraphNode {
  AddTdrSystemPrompt = 'addTdrSystemPrompt',
  CheckResponseType = 'checkResponseType',
  End = '__end__',
  GetModelDefaultResponse = 'getModelDefaultResponse',
  GetModelImageResponse = 'getModelImageResponse',
  GetModelMathResponse = 'getModelMathResponse',
  Start = '__start__',
  Tools = 'tools',
}
