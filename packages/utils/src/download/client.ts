import {
  ActivityQuery,
  CreateDownloadJobInput,
  DiscoverQuery,
  DiscoveryPage,
  DownloadGalleryFacets,
  DownloadJob,
  DownloadPage,
  DownloadType,
  FlagBadFileInput,
  FlagBadFileResponse,
  GalleryFacetsQuery,
  GalleryItem,
  GalleryQuery,
  GetDownloadJobResponse,
  GrabReleaseInput,
  HistoryQuery,
  ListBadFilesResponse,
  ListReleasesQuery,
  ListReleasesResponse,
  MediaDetailResponse,
  ReplaceReleaseInput,
  RequestMovieInput,
  RequestShowInput,
  SearchMediaResponse,
} from './types'

/**
 * Thrown by every `DownloadClient` method when the backend answers with a
 * non-2xx status, so a 400/404/500 can never be mistaken for a success body.
 *
 * `body` is the parsed error payload when the response was JSON (Nest's
 * `{ statusCode, message, error }` shape for every route here), and
 * `undefined` when it was not — see `readErrorBody`.
 */
export class DownloadApiError extends Error {
  readonly status: number
  readonly statusText: string
  readonly body: unknown

  constructor(status: number, statusText: string, body: unknown) {
    super(`Download API request failed with ${status} ${statusText}`)

    this.name = 'DownloadApiError'
    this.status = status
    this.statusText = statusText
    this.body = body
  }
}

/**
 * Best-effort read of a failed response's body.
 *
 * The body is not always JSON - an HTML 502 from a proxy, or an empty 401,
 * both make `.json()` reject. The status is the useful signal in that case, so
 * swallow the parse failure rather than let a `SyntaxError` mask the real one.
 * No `.text()` fallback: a rejected `.json()` has already consumed the body
 * stream, so re-reading it would just throw again.
 */
async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

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

  // Deliberately no remoteInstance, mirroring packages/utils/src/auth/client.ts.
  // download.lilnas.io (deploy.yml) routes to port 8080 - the Next.js frontend,
  // a completely different process from the Nest backend on 8081 that every
  // route below lives on. Port 8081 has no Traefik router at all: it is reached
  // only container-to-container (dockerInstance) or through the Next.js /api
  // rewrite (browserInstance). There is therefore no legitimate
  // public-internet caller of the Nest backend directly, and a remoteInstance
  // pointed at https://download.lilnas.io would hit the wrong process and 404 -
  // omitted rather than shipped broken.

  /**
   * A relative-base client for browser callers, which reach the Nest backend
   * through the Next.js `/api` rewrite (`apps/download/next.config.js`).
   *
   * The rewrite strips its own prefix, so this client's `/api/download/videos/1`
   * arrives at Nest as `/download/videos/1` - no path juggling is needed here,
   * the base URL is prepended exactly like every other factory's.
   */
  static get browserInstance() {
    return new DownloadClient('/api')
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

  /**
   * The one place every method's `fetch` goes through, so the `response.ok`
   * check below covers all of them at once - no caller ever reaches `.json()`
   * on an error body.
   *
   * Deliberately has no `AbortSignal.timeout`, unlike `AuthClient.request`:
   * that client makes one fast admin-check call, whereas routes here can
   * legitimately run for 30s+ (a release search hits a real indexer).
   */
  private async request(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${url}`, {
      ...options,

      headers: {
        'Content-Type': 'application/json',
        ...this.forwardedHeaders,
        ...options.headers,
      },
    })

    if (!response.ok) {
      throw new DownloadApiError(
        response.status,
        response.statusText,
        await readErrorBody(response),
      )
    }

    return response
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

  /**
   * Removes a video download for good - stops it if it is still running and
   * deletes the objects it produced.
   *
   * The counterpart of `deleteMovieJob`/`deleteShowJob`, and the one thing
   * `cancelJob` cannot do: cancel 404s once the job is `Completed`.
   */
  async deleteJob(id: string): Promise<DownloadJob> {
    const response = await this.request(`/download/videos/${id}`, {
      method: 'DELETE',
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

  /**
   * The interactive-search results for a title, annotated with this app's own
   * `flaggedBad`.
   *
   * Expect this call to take 30s+: it fires a real indexer search rather than
   * reading anything cached. It can also write upstream despite being a GET -
   * Radarr/Sonarr will not surface releases for an unmonitored title, so the
   * backend borrows monitoring and puts it back.
   */
  async listReleases(
    id: string,
    query: Partial<ListReleasesQuery> = {},
  ): Promise<ListReleasesResponse> {
    const response = await this.request(
      `/download/media/${encodeURIComponent(id)}/releases${toQueryString(query)}`,
    )

    return response.json()
  }

  /** Grabs one release from `listReleases`, identified by `guid`/`indexerId`. */
  async grabRelease(id: string, input: GrabReleaseInput): Promise<DownloadJob> {
    const response = await this.request(
      `/download/media/${encodeURIComponent(id)}/releases/grab`,
      { method: 'POST', body: JSON.stringify(input) },
    )

    return response.json()
  }

  /**
   * Deletes what is on disk and grabs the chosen release, as one action - so a
   * failure can't leave the title with a deleted file and no replacement.
   */
  async replaceRelease(
    id: string,
    input: ReplaceReleaseInput,
  ): Promise<DownloadJob> {
    const response = await this.request(
      `/download/media/${encodeURIComponent(id)}/releases/replace`,
      { method: 'POST', body: JSON.stringify(input) },
    )

    return response.json()
  }

  /**
   * Flags a release as bad so this app stops picking it.
   *
   * Idempotent on `(mediaId, releaseGuid)` - re-flagging returns the original
   * row rather than erroring, so a double-click is harmless.
   *
   * The only release route that *requires* identity server-side: call this on
   * a client from `withForwardedIdentity()`, or the 401 arrives as a
   * `DownloadApiError`.
   */
  async flagBadFile(
    id: string,
    input: FlagBadFileInput,
  ): Promise<FlagBadFileResponse> {
    const response = await this.request(
      `/download/media/${encodeURIComponent(id)}/bad-files`,
      { method: 'POST', body: JSON.stringify(input) },
    )

    return response.json()
  }

  async listBadFiles(id: string): Promise<ListBadFilesResponse> {
    const response = await this.request(
      `/download/media/${encodeURIComponent(id)}/bad-files`,
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
