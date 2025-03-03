import { BaseMessage, MessageType } from '@langchain/core/messages'

import { ImageResponse } from 'src/schemas/graph'

export interface MessageState {
  id?: string
  content: string
  type: MessageType
  kwargs: BaseMessage['additional_kwargs']
  equationImage?: string
  images?: ImageResponse[]
}
