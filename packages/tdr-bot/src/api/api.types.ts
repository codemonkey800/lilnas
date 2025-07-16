import { BaseMessage, MessageType } from '@langchain/core/messages'

import { ImageResponse } from 'src/schemas/graph'
import { AppState } from 'src/state/state.service'

export interface MessageState {
  id?: string
  content: string
  type: MessageType
  kwargs: BaseMessage['additional_kwargs']
  images?: ImageResponse[]
}

export type EditableAppState = Pick<
  AppState,
  'maxTokens' | 'chatModel' | 'reasoningModel' | 'prompt' | 'temperature'
>

export interface HealthResponse {
  status: string
  timestamp: string
  uptime: number
  version: string
}
