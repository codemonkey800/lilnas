// Relative rather than `src/auth/types`: this specifier is emitted verbatim
// into dist/download/client.d.ts, where only a path relative to the built
// file resolves. `@lilnas/utils/auth/types` does not resolve inside this
// package (no self-reference under moduleResolution: node), and the
// `src`-prefixed form would resolve to the *consumer's* src/ once built.
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths
import { WhoamiResponse } from '../auth/types'
import {
  ActivityQuery,
  AdminStatsQuery,
  AdminStatsResponse,
  AuditLogEntry,
  AuditLogQuery,
  CreateDownloadJobInput,
  DeleteMediaFilesQuery,
  DeleteMediaFilesResponse,
  DiscoverQuery,
  DiscoveryPage,
  DownloadGalleryFacets,
  DownloadJob,
  DownloadPage,
  FlagBadFileInput,
  FlagBadFileResponse,
  GalleryFacetsQuery,
  GalleryItem,
  GalleryQuery,
  GetMediaFileQuery,
  GrabReleaseInput,
  HistoryQuery,
  ListBadFilesResponse,
  ListReleasesQuery,
  ListReleasesResponse,
  ListSeasonsResponse,
  MediaDetailResponse,
  ReplaceReleaseInput,
  RequestMovieInput,
  RequestShowInput,
  SearchMediaResponse,
  UnflagBadFileResponse,
  UpdateCheckResult,
  YtdlpUpdateStatusResponse,
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
   * Holds a running or queued job in place. `id` is a job id, the same pool
   * `getJob`/`cancelJob` take - not a media key, so it is not encoded here.
   */
  async pauseJob(id: string): Promise<DownloadJob> {
    const response = await this.request(`/download/videos/${id}/pause`, {
      method: 'PATCH',
    })

    return response.json()
  }

  /** Puts a job paused by `pauseJob` back on the queue. */
  async resumeJob(id: string): Promise<DownloadJob> {
    const response = await this.request(`/download/videos/${id}/resume`, {
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

  /**
   * Removes a flag so this app can pick that release again.
   *
   * Gated the same as `flagBadFile`: call this on a client from
   * `withForwardedIdentity()`, or the 401 arrives as a `DownloadApiError`.
   */
  async unflagBadFile(
    id: string,
    flagId: number,
  ): Promise<UnflagBadFileResponse> {
    const response = await this.request(
      `/download/media/${encodeURIComponent(id)}/bad-files/${flagId}`,
      { method: 'DELETE' },
    )

    return response.json()
  }

  /**
   * A series' seasons and their episodes.
   *
   * Shows only: a `tmdb:` key has no seasons to list and 404s, arriving as a
   * `DownloadApiError`.
   */
  async listSeasons(id: string): Promise<ListSeasonsResponse> {
    const response = await this.request(
      `/download/media/${encodeURIComponent(id)}/seasons`,
    )

    return response.json()
  }

  /**
   * The URL a media file can be downloaded from - deliberately a string, not
   * a fetch.
   *
   * That route streams the file itself (a MinIO object stream, or `sendFile`
   * with `Range`/206 support for movie-sized files). Pulling those bytes
   * through this client would only make things worse: a browser loses `Range`
   * resumability, and a server-side caller pays for the transfer twice. So
   * this builds the same query-stringed URL every other method builds and
   * hands it back, for use as an `<a href>`, a `window.location`, or a
   * redirect target.
   *
   * The one limitation: a URL cannot carry headers, so this does **not**
   * attach `forwardedHeaders` even on a client from `withForwardedIdentity()`.
   * A same-origin browser navigation is fine - the cookie authenticates it.
   * A server-side caller that needs forwarded identity should treat the
   * result as a redirect target rather than a `fetch()` input, unless it
   * attaches those headers itself.
   */
  getMediaFileUrl(id: string, query: Partial<GetMediaFileQuery> = {}): string {
    return `${this.baseUrl}/download/media/${encodeURIComponent(id)}/file${toQueryString(query)}`
  }

  /**
   * Deletes the files of a title, scoped narrowest-first by the query
   * (`episodeId`, then `seasonNumber`, then everything).
   *
   * Deletes files only - see `DeleteMediaFilesResponse` for what survives.
   */
  async deleteMediaFiles(
    id: string,
    query: Partial<DeleteMediaFilesQuery> = {},
  ): Promise<DeleteMediaFilesResponse> {
    const response = await this.request(
      `/download/media/${encodeURIComponent(id)}/files${toQueryString(query)}`,
      { method: 'DELETE' },
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

  /**
   * The audit log, in the same `{ items, nextCursor, total }` envelope every
   * other list route uses, with real actor emails unmasked.
   *
   * Admin-only server-side (`AdminGuard` sits at the class level on
   * `AdminController`, so it covers this route and every future one). Nothing
   * is checked here on purpose: a non-admin - or a caller that never went
   * through `withForwardedIdentity()` - gets the 403/401 back as a
   * `DownloadApiError`, exactly like any other failure.
   */
  async getAuditLog(
    query: Partial<AuditLogQuery> = {},
  ): Promise<DownloadPage<AuditLogEntry>> {
    const response = await this.request(
      `/download/admin/audit-log${toQueryString(query)}`,
    )

    return response.json()
  }

  /**
   * The admin dashboard's aggregate counts over the last `days` (the default
   * window is the backend's, not this method's).
   *
   * Admin-only on the same terms as `getAuditLog` - and for the same reason:
   * these totals deliberately skip the hidden-attribution filter.
   */
  async getStats(
    query: Partial<AdminStatsQuery> = {},
  ): Promise<AdminStatsResponse> {
    const response = await this.request(
      `/download/admin/stats${toQueryString(query)}`,
    )

    return response.json()
  }

  /**
   * Who the backend believes the caller is, plus whether they are an admin -
   * the way to resolve admin status without guessing at it client-side.
   *
   * Needs forwarded identity: call it on a client from
   * `withForwardedIdentity()`, or `ForwardedUserGuard` answers 401 and that
   * arrives as a `DownloadApiError`.
   */
  async whoami(): Promise<WhoamiResponse> {
    const response = await this.request('/auth/whoami')
    return response.json()
  }

  // ---- yt-dlp updater ----
  //
  // The three paths below really do begin with `/api`, and that is not a
  // mistake to tidy up. `YtdlpUpdateController` is declared
  // `@Controller('api/ytdlp-update')` - the only controller in the backend
  // carrying an `api` segment of its own - so `/api/ytdlp-update/status` is
  // the literal Nest route. It has nothing to do with the Next.js `/api`
  // rewrite that `browserInstance` is built around.
  //
  // The two stack rather than collapse. From `localInstance`/`dockerInstance`
  // the request is `/api/ytdlp-update/status`; from `browserInstance` it is
  // the doubled `/api/api/ytdlp-update/status`, because the rewrite strips
  // exactly one `/api` before Nest ever sees the path. The doubling is
  // correct - removing it would send the request to a route that does not
  // exist. Keeping both prefixes inside these methods, where no caller has to
  // reason about either, is the entire point of having them.

  /** Whether an update is in flight, and when the updater last ran. */
  async getYtdlpStatus(): Promise<YtdlpUpdateStatusResponse> {
    const response = await this.request('/api/ytdlp-update/status')
    return response.json()
  }

  /**
   * The yt-dlp binary's current version.
   *
   * Answers `{ version: 'error' }` rather than failing when the binary cannot
   * be probed at all, so treat `'error'` as a sentinel - there is no
   * exception to catch for that case.
   */
  async getYtdlpVersion(): Promise<{ version: string }> {
    const response = await this.request('/api/ytdlp-update/version')
    return response.json()
  }

  /**
   * Checks GitHub for a newer yt-dlp and, unless `dryRun`, lets the updater
   * act on what it finds - this can replace the binary the whole download
   * pipeline shells out to.
   *
   * `?dryRun=true` is appended only when asked. The handler tests the raw
   * query value against the string `'true'`, so a `?dryRun=false` would be
   * read as "not a dry run" anyway - sending it would just imply a knob that
   * does not exist.
   */
  async checkYtdlpUpdate(dryRun = false): Promise<UpdateCheckResult> {
    const response = await this.request(
      `/api/ytdlp-update/check${dryRun ? '?dryRun=true' : ''}`,
      { method: 'POST' },
    )

    return response.json()
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
