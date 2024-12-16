import { Axios } from 'axios'

import { MessageState } from './api.types'

let instance: ApiClient | null = null

export class ApiClient {
  private client = new Axios({
    baseURL: '/api',
  })

  async getMessages(): Promise<MessageState[]> {
    const response = await this.client.get('/messages')
    return JSON.parse(response.data)
  }

  static getInstance(): ApiClient {
    if (!instance) {
      instance = new ApiClient()
    }

    return instance
  }
}
