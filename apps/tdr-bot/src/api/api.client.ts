import type { ModelSpec } from 'src/llm/models/catalog'
import type { ModelRole } from 'src/llm/models/roles'
import type { SettingsPatch } from 'src/llm/settings/settings.schema'

import {
  ChannelInfo,
  ConversationMessage,
  SendMessageResponse,
  SettingsResponse,
  TranscriptChannel,
  TranscriptResponse,
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
    range: { from?: string; to?: string } = {},
  ): Promise<TranscriptResponse> {
    const params = new URLSearchParams()
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
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

  static getInstance(): ApiClient {
    if (!instance) {
      instance = new ApiClient()
    }

    return instance
  }
}
