import { CreateDownloadJobInput, GetDownloadJobResponse } from './types'

export class DownloadClient {
  constructor(private baseUrl = 'http://localhost:8081') {}

  static get localInstance() {
    return new DownloadClient()
  }

  static get dockerInstance() {
    return new DownloadClient('http://download:8081')
  }

  static get remoteInstance() {
    return new DownloadClient('https://download.lilnas.io')
  }

  private request(url: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${url}`, {
      ...options,

      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  }

  async getVideoJob(id: string): Promise<GetDownloadJobResponse> {
    const response = await this.request(`/download/videos/${id}`)
    return response.json()
  }

  async createVideoJob(
    input: CreateDownloadJobInput,
  ): Promise<GetDownloadJobResponse> {
    const response = await this.request('/download/videos', {
      method: 'POST',
      body: JSON.stringify(input),
    })

    return response.json()
  }

  async cancelVideoJob(id: string): Promise<GetDownloadJobResponse> {
    const response = await this.request(`/download/videos/${id}/cancel`, {
      method: 'PATCH',
    })

    return response.json()
  }
}
