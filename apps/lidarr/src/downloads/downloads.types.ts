// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

import { z } from 'zod'

/**
 * Computes download completion as an integer percentage clamped to [0, 100],
 * or null if size data is unavailable. Negative values (sizeleft > size) are
 * clamped to 0 to handle transient reporting anomalies from Radarr/Sonarr.
 */
export function computeProgress(
  size: number | undefined,
  sizeleft: number | undefined,
): number | null {
  if (size == null || sizeleft == null || size <= 0) return null
  return Math.max(0, Math.round(((size - sizeleft) / size) * 100))
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

/** Derives the display state for a tracked download from its current fields. */
export function computeDownloadState(entry: {
  queueId: number | null
  lastProgress: number | null
  lastStatus: string | null
}): 'searching' | 'downloading' | 'importing' {
  if (entry.queueId === null) return 'searching'
  const progress = entry.lastProgress ?? 0
  return isImportStatus(progress, entry.lastStatus)
    ? 'importing'
    : 'downloading'
}

// ---------------------------------------------------------------------------
// Request schemas and DTOs
// ---------------------------------------------------------------------------

/** Schema for a movie download request, optionally targeting a specific release. */
export const downloadMovieSchema = z
  .object({
    mediaType: z.literal('movie'),
    tmdbId: z.number(),
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

export type DownloadMovieRequest = z.infer<typeof downloadMovieSchema>
export type DownloadShowRequest = z.infer<typeof downloadShowSchema>
export type DownloadRequest = z.infer<typeof downloadRequestSchema>

// ---------------------------------------------------------------------------
// Internal state tracking
// ---------------------------------------------------------------------------

export interface TrackedMovieDownload {
  kind: 'movie'
  tmdbId: number
  radarrMovieId: number
  commandId: number | null
  queueId: number | null
  lastProgress: number | null
  lastStatus: string | null
  lastSizeleft: number | null
  lastTitle: string | null
  lastSize: number | null
  lastEta: string | null
  initiatedAt: number
  commandTerminalAt: number | null
}

export interface TrackedEpisodeDownload {
  kind: 'episode'
  tvdbId: number
  sonarrSeriesId: number
  sonarrEpisodeId: number
  seasonNumber: number
  episodeNumber: number
  commandId: number | null
  queueId: number | null
  lastProgress: number | null
  lastStatus: string | null
  lastSizeleft: number | null
  lastTitle: string | null
  lastSize: number | null
  lastEta: string | null
  initiatedAt: number
  commandTerminalAt: number | null
}

export type TrackedDownload = TrackedMovieDownload | TrackedEpisodeDownload

const NULL_PROGRESS_FIELDS = {
  commandId: null,
  queueId: null,
  lastProgress: null,
  lastStatus: null,
  lastSizeleft: null,
  lastTitle: null,
  lastSize: null,
  lastEta: null,
  commandTerminalAt: null,
} as const

export function createTrackedMovie(
  tmdbId: number,
  radarrMovieId: number,
  commandId: number | null = null,
): TrackedMovieDownload {
  return {
    kind: 'movie',
    tmdbId,
    radarrMovieId,
    ...NULL_PROGRESS_FIELDS,
    commandId,
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

export function createTrackedEpisode(
  ep: EpisodeIdentity,
  commandId: number | null = null,
): TrackedEpisodeDownload {
  return {
    kind: 'episode',
    ...ep,
    ...NULL_PROGRESS_FIELDS,
    commandId,
    initiatedAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Internal EventEmitter2 event (Service/Poller -> Gateway)
// ---------------------------------------------------------------------------

export const INTERNAL_DOWNLOAD_EVENT = 'download.internal'

// ---------------------------------------------------------------------------
// Re-exports from @lilnas/lidarr-client (single source of truth for wire types)
// ---------------------------------------------------------------------------

export type {
  AllDownloadsResponse,
  DownloadCancelledPayload,
  DownloadCompletedPayload,
  DownloadEventMap,
  DownloadEventName,
  DownloadEventPayload,
  DownloadFailedPayload,
  DownloadGrabbingPayload,
  DownloadInitiatedPayload,
  DownloadProgressPayload,
  EpisodeDownloadItem,
  EpisodeDownloadStatusItem,
  MovieDownloadItem,
  MovieDownloadStatusResponse,
  SeasonDownloadGroup,
  ShowDownloadItem,
  ShowDownloadStatusResponse,
} from '@lilnas/lidarr-client'
export { DownloadEvents } from '@lilnas/lidarr-client'

export type InternalDownloadEvent = {
  eventName: import('@lilnas/lidarr-client').DownloadEventName
  payload: import('@lilnas/lidarr-client').DownloadEventPayload
}
