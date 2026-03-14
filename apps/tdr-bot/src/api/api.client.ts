import {
  ChannelInfo,
  EditableAppState,
  GraphHistoryFile,
  MessageState,
  SendMessageResponse,
} from './api.types'

const API_URL = '/api'

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

  async getMessages(): Promise<MessageState[]> {
    const response = await this.request('/messages')
    return await response.json()
  }

  async getState(): Promise<EditableAppState> {
    const response = await this.request('/state')
    return response.json()
  }

  async updateState(
    state: Partial<EditableAppState>,
  ): Promise<EditableAppState> {
    const response = await this.request('/state', {
      method: 'POST',
      body: JSON.stringify(state),
    })

    return await response.json()
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

  async getGraphHistoryFiles(): Promise<GraphHistoryFile[]> {
    const response = await this.request('/graph-history/files')
    return await response.json()
  }

  async getGraphHistoryMessages(filename: string): Promise<MessageState[]> {
    const response = await this.request(`/graph-history/files/${filename}`)
    return await response.json()
  }

  static getInstance(): ApiClient {
    if (!instance) {
      instance = new ApiClient()
    }

    return instance
  }
}
