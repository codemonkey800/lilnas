import { EditableAppState, MessageState } from './api.types'

const API_URL = 'http://localhost:8081'

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

  static getInstance(): ApiClient {
    if (!instance) {
      instance = new ApiClient()
    }

    return instance
  }
}
