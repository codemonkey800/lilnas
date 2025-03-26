import { CreateDownloadJobInput, GetDownloadJobResponse } from './types'

export class DownloadClient {
  private request(url: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`http://localhost:8081${url}`, {
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
