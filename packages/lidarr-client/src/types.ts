// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface LidarrClientOptions {
  /** Base URL of the Lidarr service, e.g. 'https://lidarr.lilnas.io' */
  baseUrl: string
  /** Token value passed as x-token-value header */
  token: string
}

// ---------------------------------------------------------------------------
// Movie types
// ---------------------------------------------------------------------------

export interface MovieFileInfo {
  id: number
  relativePath: string | null
  size: number
  quality: string | null
  dateAdded: string | null
}

export interface MovieDetail {
  id: number
  tmdbId: number | null
  title: string
  year: number
  runtime: number | null
  certification: string | null
  overview: string | null
  posterUrl: string | null
  fanartUrl: string | null
  quality: string | null
  status: 'downloaded' | 'missing'
  genres: string[]
  ratings: { imdb: number | null; tmdb: number | null }
  sizeOnDisk: number | null
  files: MovieFileInfo[]
}

// ---------------------------------------------------------------------------
// Show types
// ---------------------------------------------------------------------------

export interface EpisodeInfo {
  id: number
  episodeFileId: number | null
  seasonNumber: number
  episodeNumber: number
  title: string | null
  airDate: string | null
  hasFile: boolean
  monitored: boolean
  quality: string | null
  fileSize: number | null
  relativePath: string | null
}

export interface SeasonInfo {
  seasonNumber: number
  episodeCount: number
  downloadedCount: number
  monitored: boolean
  sizeOnDisk: number
  episodes: EpisodeInfo[]
}

export interface ShowDetail {
  id: number
  tvdbId: number | null
  title: string
  year: number
  overview: string | null
  posterUrl: string | null
  fanartUrl: string | null
  network: string | null
  status: string | null
  genres: string[]
  ratings: { value: number | null }
  runtime: number | null
  sizeOnDisk: number
  seasons: SeasonInfo[]
  firstAired: string | null
  imdbId: string | null
  tmdbId: number | null
  totalEpisodeCount: number
  episodeFileCount: number
}

// ---------------------------------------------------------------------------
// Download request types
// ---------------------------------------------------------------------------

export interface DownloadMovieRequest {
  mediaType: 'movie'
  tmdbId: number
  releaseGuid?: string
  indexerId?: number
}

export type DownloadShowRequest =
  | { mediaType: 'show'; tvdbId: number; scope: 'series' }
  | { mediaType: 'show'; tvdbId: number; scope: 'season'; seasonNumber: number }
  | { mediaType: 'show'; tvdbId: number; scope: 'episode'; episodeId: number }

export type DownloadRequest = DownloadMovieRequest | DownloadShowRequest

// ---------------------------------------------------------------------------
// Download REST response DTOs
// ---------------------------------------------------------------------------

export interface MovieDownloadStatusResponse {
  state: 'searching' | 'downloading' | 'importing'
  title: string | null
  size: number
  sizeleft: number
  progress: number
  eta: string | null
  status: string | null
}

export interface EpisodeDownloadStatusItem {
  episodeId: number
  state: 'searching' | 'downloading' | 'importing'
  title: string | null
  size: number
  sizeleft: number
  progress: number
  eta: string | null
  status: string | null
}

export type ShowDownloadStatusResponse = EpisodeDownloadStatusItem[]

export interface MovieDownloadItem {
  tmdbId: number
  title: string
  year: number
  posterUrl: string | null
  state: 'searching' | 'downloading' | 'importing'
  releaseTitle: string | null
  size: number
  sizeleft: number
  progress: number
  eta: string | null
  status: string | null
}

export interface EpisodeDownloadItem {
  episodeId: number
  seasonNumber: number
  episodeNumber: number
  state: 'searching' | 'downloading' | 'importing'
  releaseTitle: string | null
  size: number
  sizeleft: number
  progress: number
  eta: string | null
  status: string | null
}

export interface SeasonDownloadGroup {
  seasonNumber: number
  episodes: EpisodeDownloadItem[]
}

export interface ShowDownloadItem {
  tvdbId: number
  seriesId: number
  title: string
  year: number
  posterUrl: string | null
  seasons: SeasonDownloadGroup[]
}

export interface AllDownloadsResponse {
  movies: MovieDownloadItem[]
  shows: ShowDownloadItem[]
}

// ---------------------------------------------------------------------------
// WebSocket event names
// ---------------------------------------------------------------------------

export const DownloadEvents = {
  INITIATED: 'download:initiated',
  GRABBING: 'download:grabbing',
  PROGRESS: 'download:progress',
  FAILED: 'download:failed',
  CANCELLED: 'download:cancelled',
  COMPLETED: 'download:completed',
} as const

export type DownloadEventName =
  (typeof DownloadEvents)[keyof typeof DownloadEvents]

// ---------------------------------------------------------------------------
// WebSocket event payloads
// ---------------------------------------------------------------------------

export interface DownloadInitiatedPayload {
  event: 'download:initiated'
  mediaType: 'movie' | 'episode'
  tmdbId?: number
  tvdbId?: number
  episodeId?: number
  scope?: 'series' | 'season' | 'episode'
}

export interface DownloadGrabbingPayload {
  event: 'download:grabbing'
  mediaType: 'movie' | 'episode'
  tmdbId?: number
  tvdbId?: number
  episodeId?: number
  title: string | null
  size: number
}

export interface DownloadProgressPayload {
  event: 'download:progress'
  mediaType: 'movie' | 'episode'
  tmdbId?: number
  tvdbId?: number
  episodeId?: number
  progress: number
  size: number
  sizeleft: number
  eta: string | null
  status: string
}

export interface DownloadFailedPayload {
  event: 'download:failed'
  mediaType: 'movie' | 'episode'
  tmdbId?: number
  tvdbId?: number
  episodeId?: number
  error: string
}

export interface DownloadCancelledPayload {
  event: 'download:cancelled'
  mediaType: 'movie' | 'episode'
  tmdbId?: number
  tvdbId?: number
  episodeId?: number
}

export interface DownloadCompletedPayload {
  event: 'download:completed'
  mediaType: 'movie' | 'episode'
  tmdbId?: number
  tvdbId?: number
  episodeId?: number
}

export type DownloadEventPayload =
  | DownloadInitiatedPayload
  | DownloadGrabbingPayload
  | DownloadProgressPayload
  | DownloadFailedPayload
  | DownloadCancelledPayload
  | DownloadCompletedPayload

/** Maps each download event name to its specific payload type. */
export interface DownloadEventMap {
  'download:initiated': DownloadInitiatedPayload
  'download:grabbing': DownloadGrabbingPayload
  'download:progress': DownloadProgressPayload
  'download:failed': DownloadFailedPayload
  'download:cancelled': DownloadCancelledPayload
  'download:completed': DownloadCompletedPayload
}
