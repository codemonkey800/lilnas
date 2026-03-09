// ---------------------------------------------------------------------------
// Shared helpers (usable from both server and client modules)
// ---------------------------------------------------------------------------

/** Computes download completion as an integer percentage (0-100), or null if size data is unavailable. */
export function computeProgress(
  size: number | undefined,
  sizeleft: number | undefined,
): number | null {
  if (size == null || sizeleft == null || size <= 0) return null
  return Math.round(((size - sizeleft) / size) * 100)
}

export const IMPORT_STATUSES = new Set([
  'importPending',
  'importing',
  'importBlocked',
  'imported',
])

/** Returns true when the download has entered an import phase. */
export function isImportStatus(
  progress: number,
  status: string | null | undefined,
): boolean {
  return progress >= 100 || IMPORT_STATUSES.has(status ?? '')
}

// ---------------------------------------------------------------------------
// Request schemas and DTOs
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** Schema for a movie download request, optionally targeting a specific release. */
export const downloadMovieSchema = z
  .object({
    mediaType: z.literal('movie'),
    tmdbId: z.number(),
    /** If provided with {@link indexerId}, grabs this exact release instead of searching. */
    releaseGuid: z.string().optional(),
    indexerId: z.number().optional(),
  })
  .refine(d => !(d.releaseGuid && d.indexerId == null), {
    message: 'indexerId is required when releaseGuid is provided',
  })

/** Schema for a show download request, discriminated by scope. */
export const downloadShowSchema = z.discriminatedUnion('scope', [
  z.object({
    mediaType: z.literal('show'),
    tvdbId: z.number(),
    scope: z.literal('series'),
  }),
  z.object({
    mediaType: z.literal('show'),
    tvdbId: z.number(),
    scope: z.literal('season'),
    seasonNumber: z.number(),
  }),
  z.object({
    mediaType: z.literal('show'),
    tvdbId: z.number(),
    scope: z.literal('episode'),
    episodeId: z.number(),
  }),
])

/** Schema for any download request (movie or show). */
export const downloadRequestSchema = z.union([
  downloadMovieSchema,
  downloadShowSchema,
])

/** Request to download a movie, optionally targeting a specific release. */
export type DownloadMovieRequest = z.infer<typeof downloadMovieSchema>

export type DownloadShowRequest = z.infer<typeof downloadShowSchema>

export type DownloadRequest = z.infer<typeof downloadRequestSchema>

// ---------------------------------------------------------------------------
// Internal state tracking
// ---------------------------------------------------------------------------

/**
 * In-memory state for a movie download being tracked by the poller.
 * Fields like {@link queueId} and {@link lastProgress} are populated
 * once the item appears in the Radarr queue.
 */
export interface TrackedMovieDownload {
  kind: 'movie'
  tmdbId: number
  radarrMovieId: number
  queueId: number | null
  lastProgress: number | null
  lastStatus: string | null
  lastSizeleft: number | null
  lastTitle: string | null
  lastSize: number | null
  lastEta: string | null
  initiatedAt: number
}

/**
 * In-memory state for an episode download being tracked by the poller.
 * Mirrors {@link TrackedMovieDownload} but keyed on Sonarr episode ID.
 */
export interface TrackedEpisodeDownload {
  kind: 'episode'
  tvdbId: number
  sonarrSeriesId: number
  sonarrEpisodeId: number
  seasonNumber: number
  episodeNumber: number
  queueId: number | null
  lastProgress: number | null
  lastStatus: string | null
  lastSizeleft: number | null
  lastTitle: string | null
  lastSize: number | null
  lastEta: string | null
  initiatedAt: number
}

export type TrackedDownload = TrackedMovieDownload | TrackedEpisodeDownload

const NULL_PROGRESS_FIELDS = {
  queueId: null,
  lastProgress: null,
  lastStatus: null,
  lastSizeleft: null,
  lastTitle: null,
  lastSize: null,
  lastEta: null,
} as const

/** Creates a fresh {@link TrackedMovieDownload} with all progress fields null. */
export function createTrackedMovie(
  tmdbId: number,
  radarrMovieId: number,
): TrackedMovieDownload {
  return {
    kind: 'movie',
    tmdbId,
    radarrMovieId,
    ...NULL_PROGRESS_FIELDS,
    initiatedAt: Date.now(),
  }
}

export interface EpisodeIdentity {
  tvdbId: number
  sonarrSeriesId: number
  sonarrEpisodeId: number
  seasonNumber: number
  episodeNumber: number
}

/** Creates a fresh {@link TrackedEpisodeDownload} with all progress fields null. */
export function createTrackedEpisode(
  ep: EpisodeIdentity,
): TrackedEpisodeDownload {
  return {
    kind: 'episode',
    ...ep,
    ...NULL_PROGRESS_FIELDS,
    initiatedAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// WebSocket event names
// ---------------------------------------------------------------------------

/** Lifecycle event names emitted over WebSocket to connected clients. */
export const DownloadEvents = {
  INITIATED: 'download:initiated',
  GRABBING: 'download:grabbing',
  PROGRESS: 'download:progress',
  FAILED: 'download:failed',
  COMPLETED: 'download:completed',
} as const

export type DownloadEventName =
  (typeof DownloadEvents)[keyof typeof DownloadEvents]

// ---------------------------------------------------------------------------
// WebSocket event payloads (flat, easy to construct)
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
  | DownloadCompletedPayload

// ---------------------------------------------------------------------------
// Internal EventEmitter2 event (DownloadService/Poller -> Gateway)
// ---------------------------------------------------------------------------

/** EventEmitter2 event name used to forward download events from the service/poller to the gateway. */
export const INTERNAL_DOWNLOAD_EVENT = 'download.internal'

/** Envelope used on the internal EventEmitter2 bus between service and gateway. */
export interface InternalDownloadEvent {
  eventName: DownloadEventName
  payload: DownloadEventPayload
}

// ---------------------------------------------------------------------------
// REST response DTOs
// ---------------------------------------------------------------------------

/** Snapshot of the current download state for a movie, returned by GET /downloads/movie/:tmdbId. */
export interface MovieDownloadStatusResponse {
  state: 'searching' | 'downloading' | 'importing'
  title: string | null
  size: number
  sizeleft: number
  progress: number
  eta: string | null
  status: string | null
}

/** Per-episode snapshot within a show download status response. */
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

/** Array of episode download snapshots, returned by GET /downloads/show/:tvdbId. */
export type ShowDownloadStatusResponse = EpisodeDownloadStatusItem[]
