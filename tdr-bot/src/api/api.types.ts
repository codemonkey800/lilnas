import { BaseMessage, MessageType } from '@langchain/core/messages'

export interface MessageState {
  id?: string
  content: string
  type: MessageType
  kwargs: BaseMessage['additional_kwargs']
}
