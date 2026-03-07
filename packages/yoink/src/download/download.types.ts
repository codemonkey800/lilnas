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
  queueId: number | null
  lastProgress: number | null
  lastStatus: string | null
  lastSizeleft: number | null
}

export type TrackedDownload = TrackedMovieDownload | TrackedEpisodeDownload

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
