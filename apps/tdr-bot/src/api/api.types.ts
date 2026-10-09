import { MessageType } from '@langchain/core/messages'

import type { LlmCallRow, ReminderSource, ReminderStatus } from 'src/db/schema'
import type { Settings } from 'src/llm/settings/settings.schema'
import type { ReminderActionType } from 'src/reminders/reminder.types'
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

export interface ReminderView {
  id: string
  status: ReminderStatus
  source: ReminderSource
  what: string
  userId: string
  userName: string
  targetUserIds: string[]
  targetUserNames: string[]
  guildId: string
  channelId: string | null
  channelName: string | null
  isRecurring: boolean
  cronExpression: string | null
  scheduledAt: string | null
  endsAt: string | null
  scheduleDescription: string
  nextRunAt: string | null
  lastRunAt: string | null
  runCount: number
  actionType: ReminderActionType
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
}

export interface MemberInfo {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
}

export type ScheduleBody =
  | { kind: 'once'; at: string }
  | { kind: 'recurring'; cron: string; endsAt?: string | null }

export interface CreateReminderBody {
  userId: string
  what: string
  schedule: ScheduleBody
  scheduleDescription?: string
  channelId?: string | null
  targetUserIds?: string[]
  actionType?: ReminderActionType
}

export type UpdateReminderBody = Partial<Omit<CreateReminderBody, 'userId'>>

export interface ReminderFilter {
  status: ReminderStatus | 'all'
  userId?: string
}

export interface ReminderPreview {
  runs: string[]
  description: string
}
