import {
  ActivityQuery,
  CreateDownloadJobInput,
  DiscoverQuery,
  DiscoveryPage,
  DownloadGalleryFacets,
  DownloadJob,
  DownloadPage,
  DownloadType,
  GalleryFacetsQuery,
  GalleryItem,
  GalleryQuery,
  GetDownloadJobResponse,
  HistoryQuery,
  MediaDetailResponse,
  RequestMovieInput,
  RequestShowInput,
  SearchMediaResponse,
} from './types'

/**
 * Flattens a `DownloadJob` back down to the pre-Media wire shape.
 *
 * TODO(tdr-bot-migration): delete alongside the three legacy methods below.
 */
export function flattenToLegacyVideoResponse(
  job: DownloadJob,
): GetDownloadJobResponse {
  if (job.media.type !== DownloadType.Video) {
    throw new Error(
      `Expected a video job but got a '${job.media.type}' job (id: '${job.id}')`,
    )
  }

  return {
    description: job.media.overview,
    downloadUrls: job.media.downloadUrls,
    error: job.error,
    hiddenAttribution: job.hiddenAttribution,
    id: job.id,
    requester: job.requester,
    status: job.status,
    timeRange: job.media.timeRange,
    title: job.media.title,
    type: DownloadType.Video,
    url: job.media.sourceUrl,
  }
}

function toQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue

    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(
        key,
        item instanceof Date ? item.toISOString().slice(0, 10) : String(item),
      )
    }
  }

  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

export class DownloadClient {
  constructor(
    private baseUrl = 'http://localhost:8081',
    private forwardedHeaders: Record<string, string> = {},
  ) {}

  static get localInstance() {
    return new DownloadClient()
  }

  static get dockerInstance() {
    return new DownloadClient('http://download:8081')
  }

  static get remoteInstance() {
    return new DownloadClient('https://download.lilnas.io')
  }

  // Returns a new client that threads the given identity onto every
  // request as X-Forwarded-User/X-Forwarded-User-Id — for server-side
  // callers (Next.js server actions/route handlers) that received these
  // headers on their own inbound request and need to forward them onto
  // this same-container backend, which has no Traefik ForwardAuth hop of
  // its own to set them.
  withForwardedIdentity(user: { email: string; userId: string }) {
    return new DownloadClient(this.baseUrl, {
      'x-forwarded-user': user.email,
      'x-forwarded-user-id': user.userId,
    })
  }

  private request(url: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${url}`, {
      ...options,

      headers: {
        'Content-Type': 'application/json',
        ...this.forwardedHeaders,
        ...options.headers,
      },
    })
  }

  async getJob(id: string): Promise<DownloadJob> {
    const response = await this.request(`/download/videos/${id}`)
    return response.json()
  }

  async createJob(input: CreateDownloadJobInput): Promise<DownloadJob> {
    const response = await this.request('/download/videos', {
      method: 'POST',
      body: JSON.stringify(input),
    })

    return response.json()
  }

  async cancelJob(id: string): Promise<DownloadJob> {
    const response = await this.request(`/download/videos/${id}/cancel`, {
      method: 'PATCH',
    })

    return response.json()
  }

  /** The library view - a title's metadata plus every job that fetched it. */
  async getMedia(id: string): Promise<MediaDetailResponse> {
    const response = await this.request(
      `/download/media/${encodeURIComponent(id)}`,
    )

    return response.json()
  }

  async getActivity(
    query: Partial<ActivityQuery> = {},
  ): Promise<DownloadPage<DownloadJob>> {
    const response = await this.request(
      `/download/activity${toQueryString(query)}`,
    )
    return response.json()
  }

  async getGallery(
    query: Partial<GalleryQuery> = {},
  ): Promise<DownloadPage<GalleryItem>> {
    const response = await this.request(
      `/download/gallery${toQueryString(query)}`,
    )
    return response.json()
  }

  async getGalleryFacets(
    query: Partial<GalleryFacetsQuery> = {},
  ): Promise<DownloadGalleryFacets> {
    const response = await this.request(
      `/download/gallery/facets${toQueryString(query)}`,
    )

    return response.json()
  }

  async getHistory(
    query: Partial<HistoryQuery> = {},
  ): Promise<DownloadPage<DownloadJob>> {
    const response = await this.request(
      `/download/history${toQueryString(query)}`,
    )
    return response.json()
  }

  async getDiscover(query: DiscoverQuery): Promise<DiscoveryPage> {
    const response = await this.request(
      `/download/discover${toQueryString(query)}`,
    )
    return response.json()
  }

  // TODO(tdr-bot-migration): delete this block, `flattenToLegacyVideoResponse`,
  // and the deprecated `GetDownloadJobResponse` in ./types.
  //
  // `apps/tdr-bot` is the SOLE consumer: download-command.service.ts calls
  // createVideoJob/getVideoJob/cancelVideoJob and reads the flat
  // `url`/`title`/`description`/`downloadUrls` fields. It was deliberately left
  // untouched when the download backend moved to the Media union, so these three
  // methods keep their pre-Media shape by flattening `DownloadJob` back down.
  //
  // Removal: migrate tdr-bot onto getJob/createJob/cancelJob + `job.media.*`,
  // then delete all three pieces. New code must use getJob/createJob/cancelJob —
  // nothing else may call these.

  async getVideoJob(id: string): Promise<GetDownloadJobResponse> {
    return flattenToLegacyVideoResponse(await this.getJob(id))
  }

  async createVideoJob(
    input: CreateDownloadJobInput,
  ): Promise<GetDownloadJobResponse> {
    return flattenToLegacyVideoResponse(await this.createJob(input))
  }

  async cancelVideoJob(id: string): Promise<GetDownloadJobResponse> {
    return flattenToLegacyVideoResponse(await this.cancelJob(id))
  }

  async searchMovies(query: string): Promise<SearchMediaResponse> {
    const response = await this.request(
      `/download/movies/search?query=${encodeURIComponent(query)}`,
    )

    return response.json()
  }

  async requestMovie(input: RequestMovieInput): Promise<DownloadJob> {
    const response = await this.request('/download/movies', {
      method: 'POST',
      body: JSON.stringify(input),
    })

    return response.json()
  }

  async getMovieJob(id: string): Promise<DownloadJob> {
    const response = await this.request(`/download/movies/${id}`)
    return response.json()
  }

  async deleteMovieJob(id: string): Promise<DownloadJob> {
    const response = await this.request(`/download/movies/${id}`, {
      method: 'DELETE',
    })

    return response.json()
  }

  async searchShows(query: string): Promise<SearchMediaResponse> {
    const response = await this.request(
      `/download/shows/search?query=${encodeURIComponent(query)}`,
    )

    return response.json()
  }

  async requestShow(input: RequestShowInput): Promise<DownloadJob> {
    const response = await this.request('/download/shows', {
      method: 'POST',
      body: JSON.stringify(input),
    })

    return response.json()
  }

  async getShowJob(id: string): Promise<DownloadJob> {
    const response = await this.request(`/download/shows/${id}`)
    return response.json()
  }

  async deleteShowJob(id: string): Promise<DownloadJob> {
    const response = await this.request(`/download/shows/${id}`, {
      method: 'DELETE',
    })

    return response.json()
  }
}
