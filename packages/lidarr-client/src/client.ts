import { LidarrApiError } from './errors'
import { LidarrDownloadSocket } from './socket'
import type {
  AllDownloadsResponse,
  DownloadRequest,
  LidarrClientOptions,
  MovieDetail,
  MovieDownloadStatusResponse,
  ShowDetail,
  ShowDownloadStatusResponse,
} from './types'

// ---------------------------------------------------------------------------
// Internal fetch helper
// ---------------------------------------------------------------------------

async function request<T>(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-token-value': token,
      ...init.headers,
    },
  })

  if (!res.ok) {
    throw await LidarrApiError.fromResponse(res)
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }

  const text = await res.text()
  if (!text) return undefined as T

  return JSON.parse(text) as T
}

// ---------------------------------------------------------------------------
// Movies namespace
// ---------------------------------------------------------------------------

class MoviesClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  /** Returns full details for a movie by its TMDB ID. */
  get(tmdbId: number): Promise<MovieDetail> {
    return request<MovieDetail>(this.baseUrl, this.token, `/movies/${tmdbId}`)
  }

  /** Deletes a specific movie file by TMDB ID and file ID. */
  deleteFile(tmdbId: number, fileId: number): Promise<void> {
    return request<void>(
      this.baseUrl,
      this.token,
      `/movies/${tmdbId}/files/${fileId}`,
      { method: 'DELETE' },
    )
  }
}

// ---------------------------------------------------------------------------
// Shows namespace
// ---------------------------------------------------------------------------

class ShowsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  /** Returns full details for a show by its TVDB ID. */
  get(tvdbId: number): Promise<ShowDetail> {
    return request<ShowDetail>(this.baseUrl, this.token, `/shows/${tvdbId}`)
  }

  /** Deletes a specific episode file by TVDB ID and episode file ID. */
  deleteEpisodeFile(tvdbId: number, episodeFileId: number): Promise<void> {
    return request<void>(
      this.baseUrl,
      this.token,
      `/shows/${tvdbId}/files/${episodeFileId}`,
      { method: 'DELETE' },
    )
  }

  /** Deletes all episode files for a season. Returns the deleted file IDs. */
  deleteSeasonFiles(
    tvdbId: number,
    seasonNumber: number,
    body: { seriesId: number },
  ): Promise<{ deletedFileIds: number[] }> {
    return request<{ deletedFileIds: number[] }>(
      this.baseUrl,
      this.token,
      `/shows/${tvdbId}/seasons/${seasonNumber}/files`,
      { method: 'DELETE', body: JSON.stringify(body) },
    )
  }
}

// ---------------------------------------------------------------------------
// Downloads namespace
// ---------------------------------------------------------------------------

class DownloadsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly options: LidarrClientOptions,
  ) {}

  /**
   * Initiates a download request. Resolves when the server accepts the
   * request (HTTP 202). Throws `LidarrApiError` on failure.
   */
  request(body: DownloadRequest): Promise<void> {
    return request<void>(this.baseUrl, this.token, '/downloads', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /** Returns the current download status for a movie, or null if not tracked. */
  getMovieStatus(tmdbId: number): Promise<MovieDownloadStatusResponse | null> {
    return request<MovieDownloadStatusResponse | null>(
      this.baseUrl,
      this.token,
      `/downloads/movie/${tmdbId}`,
    )
  }

  /** Returns the current download status for all episodes of a show. */
  getShowStatus(tvdbId: number): Promise<ShowDownloadStatusResponse> {
    return request<ShowDownloadStatusResponse>(
      this.baseUrl,
      this.token,
      `/downloads/show/${tvdbId}`,
    )
  }

  /** Returns all active downloads (movies and shows). */
  getAll(): Promise<AllDownloadsResponse> {
    return request<AllDownloadsResponse>(
      this.baseUrl,
      this.token,
      '/downloads/all',
    )
  }

  /** Cancels all active downloads for a movie. */
  cancelMovie(tmdbId: number): Promise<void> {
    return request<void>(
      this.baseUrl,
      this.token,
      `/downloads/movie/${tmdbId}`,
      { method: 'DELETE' },
    )
  }

  /** Cancels all active downloads for a show. Returns the cancelled episode IDs. */
  cancelShow(
    tvdbId: number,
    body: { seriesId: number },
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    return request<{ cancelledEpisodeIds: number[] }>(
      this.baseUrl,
      this.token,
      `/downloads/show/${tvdbId}`,
      { method: 'DELETE', body: JSON.stringify(body) },
    )
  }

  /** Cancels the active download for a single episode. */
  cancelEpisode(episodeId: number): Promise<void> {
    return request<void>(
      this.baseUrl,
      this.token,
      `/downloads/episode/${episodeId}`,
      { method: 'DELETE' },
    )
  }

  /** Cancels all active downloads for a season. Returns the cancelled episode IDs. */
  cancelSeason(
    tvdbId: number,
    seasonNumber: number,
    body: { seriesId: number },
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    return request<{ cancelledEpisodeIds: number[] }>(
      this.baseUrl,
      this.token,
      `/downloads/show/${tvdbId}/season/${seasonNumber}`,
      { method: 'DELETE', body: JSON.stringify(body) },
    )
  }

  /**
   * Opens a WebSocket connection to the `/downloads` namespace and returns a
   * typed `LidarrDownloadSocket` for listening to real-time download events.
   */
  connect(): LidarrDownloadSocket {
    return new LidarrDownloadSocket(this.options)
  }
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------

/**
 * TypeScript client for the Lidarr service REST and WebSocket APIs.
 *
 * Usage:
 * ```ts
 * const client = new LidarrClient({
 *   baseUrl: 'https://lidarr.lilnas.io',
 *   token: 'my-token',
 * })
 *
 * // REST
 * const movie = await client.movies.get(12345)
 * const allDownloads = await client.downloads.getAll()
 * await client.downloads.request({ mediaType: 'movie', tmdbId: 12345 })
 *
 * // WebSocket
 * const socket = client.downloads.connect()
 * socket.on('download:progress', payload => {
 *   console.log(payload.progress) // fully typed
 * })
 * socket.disconnect()
 * ```
 */
export class LidarrClient {
  readonly movies: MoviesClient
  readonly shows: ShowsClient
  readonly downloads: DownloadsClient

  constructor(options: LidarrClientOptions) {
    const baseUrl = options.baseUrl.replace(/\/$/, '')
    const token = options.token
    const normalizedOptions: LidarrClientOptions = { baseUrl, token }

    this.movies = new MoviesClient(baseUrl, token)
    this.shows = new ShowsClient(baseUrl, token)
    this.downloads = new DownloadsClient(baseUrl, token, normalizedOptions)
  }
}
