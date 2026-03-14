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

export interface ChannelInfo {
  id: string
  name: string
  type: string
}

export interface SendMessageRequest {
  content: string
}

export interface SendMessageResponse {
  success: boolean
  message?: string
  sentAt?: string
}

export interface GraphHistoryFile {
  filename: string
  index: number
  label: string
}

export type GraphHistoryFilesResponse = GraphHistoryFile[]
