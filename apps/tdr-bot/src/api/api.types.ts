import { MessageType } from '@langchain/core/messages'

import type {
  EmojiSource,
  LlmCallRow,
  ReminderSource,
  ReminderStatus,
} from 'src/db/schema'
import type { EmojiAnalysis } from 'src/emojis/emoji-analysis'
import type { ReconcileStatus } from 'src/emojis/emoji-sync.service'
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

export interface ReminderRuns {
  runs: string[]
}

export interface ReminderPreview {
  runs: string[]
  description: string
}

export type { ReconcileStatus }

export interface EmojiView {
  id: string
  guildId: string
  name: string
  animated: boolean
  /** '<:name:id>' or '<a:name:id>'. */
  key: string
  imageUrl: string
  description: string | null
  source: EmojiSource | null
  model: string | null
  describedAt: string | null
  deletedAt: string | null
  updatedAt: string
}

export interface EmojiListResponse {
  emojis: EmojiView[]
  reconcile: ReconcileStatus
}

export interface UpdateEmojiBody {
  description: string
}

export interface PlaygroundMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface PlaygroundChatBody {
  model: string
  messages: PlaygroundMessage[]
  /** Replaces the saved system prompt for this call when non-empty. */
  systemPromptDraft?: string
  /** Discord-style author name stamped on user messages. */
  author?: string
}

export interface PlaygroundChatResponse {
  /** The model output as written: shortcodes and whatever tokens it made up. */
  raw: string
  /** `raw` after emoji resolution: what Discord would get. */
  reply: string
  model: string
  usage: { input: number; output: number; cached: number; costUsd: number }
  durationMs: number
  emojis: EmojiAnalysis
  dictionarySize: number
}
