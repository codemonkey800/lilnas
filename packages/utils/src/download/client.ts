import {
  CreateDownloadJobInput,
  GetDownloadJobResponse,
  GetMovieJobResponse,
  GetShowJobResponse,
  RequestMovieInput,
  RequestShowInput,
  SearchMoviesResponse,
  SearchShowsResponse,
} from './types'

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

  async searchMovies(query: string): Promise<SearchMoviesResponse> {
    const response = await this.request(
      `/download/movies/search?query=${encodeURIComponent(query)}`,
    )

    return response.json()
  }

  async requestMovie(input: RequestMovieInput): Promise<GetMovieJobResponse> {
    const response = await this.request('/download/movies', {
      method: 'POST',
      body: JSON.stringify(input),
    })

    return response.json()
  }

  async getMovieJob(id: string): Promise<GetMovieJobResponse> {
    const response = await this.request(`/download/movies/${id}`)
    return response.json()
  }

  async deleteMovieJob(id: string): Promise<GetMovieJobResponse> {
    const response = await this.request(`/download/movies/${id}`, {
      method: 'DELETE',
    })

    return response.json()
  }

  async searchShows(query: string): Promise<SearchShowsResponse> {
    const response = await this.request(
      `/download/shows/search?query=${encodeURIComponent(query)}`,
    )

    return response.json()
  }

  async requestShow(input: RequestShowInput): Promise<GetShowJobResponse> {
    const response = await this.request('/download/shows', {
      method: 'POST',
      body: JSON.stringify(input),
    })

    return response.json()
  }

  async getShowJob(id: string): Promise<GetShowJobResponse> {
    const response = await this.request(`/download/shows/${id}`)
    return response.json()
  }

  async deleteShowJob(id: string): Promise<GetShowJobResponse> {
    const response = await this.request(`/download/shows/${id}`, {
      method: 'DELETE',
    })

    return response.json()
  }
}
