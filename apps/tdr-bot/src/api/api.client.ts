import type { ModelSpec } from 'src/llm/models/catalog'
import type { ModelRole } from 'src/llm/models/roles'
import type { SettingsPatch } from 'src/llm/settings/settings.schema'

import {
  ChannelInfo,
  ConversationMessage,
  CreateReminderBody,
  EmojiListResponse,
  EmojiView,
  MemberInfo,
  PlaygroundChatBody,
  PlaygroundChatResponse,
  ReminderFilter,
  ReminderPreview,
  ReminderRuns,
  ReminderView,
  ScheduleBody,
  SendMessageResponse,
  SettingsResponse,
  TranscriptChannel,
  TranscriptResponse,
  UpdateEmojiBody,
  UpdateReminderBody,
} from './api.types'

const API_URL = '/api'

export interface ValidationIssue {
  path: string
  message: string
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function parseOrThrow<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof body?.message === 'string' ? body.message : response.statusText
    const issues: ValidationIssue[] = Array.isArray(body?.issues)
      ? body.issues
      : []
    throw new ApiRequestError(message, response.status, issues)
  }

  return body as T
}

let instance: ApiClient | null = null

export class ApiClient {
  private async request(url: string, options?: RequestInit) {
    return fetch(`${API_URL}${url}`, {
      ...options,

      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })
  }

  async getConversation(channelId: string): Promise<ConversationMessage[]> {
    const response = await this.request(
      `/conversations/${encodeURIComponent(channelId)}`,
    )
    return await parseOrThrow<ConversationMessage[]>(response)
  }

  async getTranscriptChannels(): Promise<TranscriptChannel[]> {
    const response = await this.request('/transcript/channels')
    return await parseOrThrow<TranscriptChannel[]>(response)
  }

  async getTranscript(
    channelId: string,
    page: { before?: number; limit?: number; from?: string; to?: string } = {},
  ): Promise<TranscriptResponse> {
    const params = new URLSearchParams()
    if (page.before !== undefined) params.set('before', String(page.before))
    if (page.limit !== undefined) params.set('limit', String(page.limit))
    if (page.from) params.set('from', page.from)
    if (page.to) params.set('to', page.to)
    const query = params.size ? `?${params}` : ''
    const response = await this.request(
      `/transcript/${encodeURIComponent(channelId)}${query}`,
    )
    return await parseOrThrow<TranscriptResponse>(response)
  }

  async getSettings(): Promise<SettingsResponse> {
    const response = await this.request('/settings')
    return await parseOrThrow<SettingsResponse>(response)
  }

  async updateSettings(patch: SettingsPatch): Promise<SettingsResponse> {
    const response = await this.request('/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    })

    return await parseOrThrow<SettingsResponse>(response)
  }

  async resetSettings(): Promise<SettingsResponse> {
    const response = await this.request('/settings/reset', { method: 'POST' })
    return await parseOrThrow<SettingsResponse>(response)
  }

  async getModels(role: ModelRole): Promise<ModelSpec[]> {
    const response = await this.request(`/models?role=${role}`)
    return await parseOrThrow<ModelSpec[]>(response)
  }

  async getChannels(): Promise<ChannelInfo[]> {
    const response = await this.request('/channels')
    return await response.json()
  }

  async sendMessage(
    channelId: string,
    content: string,
  ): Promise<SendMessageResponse> {
    const response = await this.request(`/channels/${channelId}/message`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })

    return await response.json()
  }

  async getReminders(filter: ReminderFilter): Promise<ReminderView[]> {
    const params = new URLSearchParams({ status: filter.status })
    if (filter.userId) params.set('userId', filter.userId)
    const response = await this.request(`/reminders?${params}`)
    return await parseOrThrow<ReminderView[]>(response)
  }

  async getMembers(): Promise<MemberInfo[]> {
    const response = await this.request('/reminders/members')
    return await parseOrThrow<MemberInfo[]>(response)
  }

  async previewReminder(schedule: ScheduleBody): Promise<ReminderPreview> {
    const response = await this.request('/reminders/preview', {
      method: 'POST',
      body: JSON.stringify({ schedule }),
    })

    return await parseOrThrow<ReminderPreview>(response)
  }

  async createReminder(body: CreateReminderBody): Promise<ReminderView> {
    const response = await this.request('/reminders', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    return await parseOrThrow<ReminderView>(response)
  }

  async updateReminder(
    id: string,
    body: UpdateReminderBody,
  ): Promise<ReminderView> {
    const response = await this.request(
      `/reminders/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    )

    return await parseOrThrow<ReminderView>(response)
  }

  async getReminderRuns(id: string): Promise<ReminderRuns> {
    const response = await this.request(
      `/reminders/${encodeURIComponent(id)}/runs`,
    )

    return await parseOrThrow<ReminderRuns>(response)
  }

  async testReminder(id: string, at: string): Promise<void> {
    const response = await this.request(
      `/reminders/${encodeURIComponent(id)}/test`,
      { method: 'POST', body: JSON.stringify({ at }) },
    )

    await parseOrThrow<{ ok: true }>(response)
  }

  async cancelReminder(id: string): Promise<ReminderView> {
    const response = await this.request(
      `/reminders/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    )

    return await parseOrThrow<ReminderView>(response)
  }

  async getEmojis(): Promise<EmojiListResponse> {
    const response = await this.request('/emojis')
    return await parseOrThrow<EmojiListResponse>(response)
  }

  async updateEmoji(id: string, body: UpdateEmojiBody): Promise<EmojiView> {
    const response = await this.request(`/emojis/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })

    return await parseOrThrow<EmojiView>(response)
  }

  async redescribeEmoji(id: string): Promise<EmojiView> {
    const response = await this.request(
      `/emojis/${encodeURIComponent(id)}/redescribe`,
      { method: 'POST' },
    )

    return await parseOrThrow<EmojiView>(response)
  }

  async reconcileEmojis(): Promise<{ started: boolean }> {
    const response = await this.request('/emojis/reconcile', {
      method: 'POST',
    })

    return await parseOrThrow<{ started: boolean }>(response)
  }

  async redescribeAllEmojis(): Promise<{ started: boolean }> {
    const response = await this.request('/emojis/redescribe-all', {
      method: 'POST',
    })

    return await parseOrThrow<{ started: boolean }>(response)
  }

  async playgroundChat(
    body: PlaygroundChatBody,
  ): Promise<PlaygroundChatResponse> {
    const response = await this.request('/playground/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    return await parseOrThrow<PlaygroundChatResponse>(response)
  }

  static getInstance(): ApiClient {
    if (!instance) {
      instance = new ApiClient()
    }

    return instance
  }
}
