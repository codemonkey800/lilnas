import { MessageType } from '@langchain/core/messages'

import type { LlmCallRow } from 'src/db/schema'
import type { Settings } from 'src/llm/settings/settings.schema'
import { ImageResponse } from 'src/schemas/graph'

export interface ConversationToolCall {
  id?: string
  name: string
  args: Record<string, unknown>
}

/** One checkpointed message in a channel's conversation thread. */
export interface ConversationMessage {
  id?: string
  type: MessageType
  content: string
  name?: string
  /** Request that produced this message (AI messages from the graph only). */
  requestId?: string
  toolCalls?: ConversationToolCall[]
  images?: ImageResponse[]
}

export type SettingsResponse = Settings & { updatedAt: string }

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

export interface TranscriptChannel {
  channelId: string
  /** Discord channel name, or the id when the channel isn't cached. */
  name: string
  lastAt: string
  calls: number
}

export interface TranscriptTotals {
  costUsd: number
  inputTokens: number
  outputTokens: number
}

export interface TranscriptResponse {
  messages: ConversationMessage[]
  calls: LlmCallRow[]
  totals: TranscriptTotals
}
