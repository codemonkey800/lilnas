import { ChildProcessWithoutNullStreams } from 'child_process'
import { z } from 'zod'

import {
  CreateDownloadJobInputSchema,
  MediaSearchQuerySchema,
  RequestMovieInputSchema,
  RequestShowInputSchema,
  VideoInfoSchema,
} from './schema'

export enum DownloadType {
  Movie = 'movie',
  Show = 'show',
  Video = 'video',
}

export enum DownloadJobStatus {
  Cancelled = 'cancelled',
  Cancelling = 'cancelling',
  Cleaning = 'cleaning',
  Completed = 'completed',
  Converting = 'converting',
  Downloading = 'downloading',
  Failed = 'failed',
  Importing = 'importing',
  Pending = 'pending',
  Requested = 'requested',
  Searching = 'searching',
  Uploading = 'uploading',
}

export type CreateDownloadJobInput = z.infer<
  typeof CreateDownloadJobInputSchema
>

/**
 * A snapshot of a movie/show job's last-known Radarr/Sonarr queue entry.
 * The queue poller (built in a later unit) keeps one of these per tracked
 * job and diffs it against the latest queue response each tick, only
 * emitting an update when something has changed.
 */
export interface DownloadQueueSnapshot {
  progress?: number
  status?: string
  timeLeft?: string
}

// The `Video` member intentionally has the exact same fields/names/types as
// the original (pre-union) `DownloadJob` interface - only `type` narrows
// from `DownloadType` to the `DownloadType.Video` literal. Zero shape change
// for existing callers.
export interface VideoDownloadJob extends CreateDownloadJobInput {
  description?: string
  downloadUrls?: string[]
  error?: string
  file?: string
  id: string
  proc?: ChildProcessWithoutNullStreams
  status: DownloadJobStatus
  timeRange?: {
    start: string
    end: string
  }
  title?: string
  type: DownloadType.Video
  url: string
}

export interface MovieDownloadJob {
  description?: string
  error?: string
  id: string
  mediaTitle?: string
  posterUrl?: string
  queueSnapshot?: DownloadQueueSnapshot
  radarrId?: number
  status: DownloadJobStatus
  title?: string
  type: DownloadType.Movie
  url: string
}

export interface ShowDownloadJob {
  description?: string
  error?: string
  id: string
  mediaTitle?: string
  posterUrl?: string
  queueSnapshot?: DownloadQueueSnapshot
  sonarrId?: number
  status: DownloadJobStatus
  title?: string
  type: DownloadType.Show
  url: string
}

export type DownloadJob = VideoDownloadJob | MovieDownloadJob | ShowDownloadJob

export function isVideoDownloadJob(job: DownloadJob): job is VideoDownloadJob {
  return job.type === DownloadType.Video
}

export function isMovieDownloadJob(job: DownloadJob): job is MovieDownloadJob {
  return job.type === DownloadType.Movie
}

export function isShowDownloadJob(job: DownloadJob): job is ShowDownloadJob {
  return job.type === DownloadType.Show
}

export type GetDownloadJobResponse = Pick<
  Extract<DownloadJob, { type: DownloadType.Video }>,
  | 'description'
  | 'downloadUrls'
  | 'error'
  | 'id'
  | 'status'
  | 'timeRange'
  | 'title'
  | 'type'
  | 'url'
>

export type VideoInfo = z.infer<typeof VideoInfoSchema>

export type MediaSearchQuery = z.infer<typeof MediaSearchQuerySchema>
export type RequestMovieInput = z.infer<typeof RequestMovieInputSchema>
export type RequestShowInput = z.infer<typeof RequestShowInputSchema>

/**
 * A single Radarr movie-lookup result, returned by the movie search endpoint
 * so the caller can pick which candidate to request.
 */
export interface MovieSearchResult {
  overview?: string
  posterUrl?: string
  title: string
  tmdbId: number
  year?: number
}

/**
 * A single Sonarr series-lookup result, returned by the show search endpoint
 * so the caller can pick which candidate to request.
 */
export interface ShowSearchResult {
  overview?: string
  posterUrl?: string
  title: string
  tvdbId: number
  year?: number
}

export interface SearchMoviesResponse {
  results: MovieSearchResult[]
}

export interface SearchShowsResponse {
  results: ShowSearchResult[]
}

export type GetMovieJobResponse = Pick<
  MovieDownloadJob,
  | 'description'
  | 'error'
  | 'id'
  | 'mediaTitle'
  | 'posterUrl'
  | 'queueSnapshot'
  | 'radarrId'
  | 'status'
  | 'title'
  | 'type'
>

export type GetShowJobResponse = Pick<
  ShowDownloadJob,
  | 'description'
  | 'error'
  | 'id'
  | 'mediaTitle'
  | 'posterUrl'
  | 'queueSnapshot'
  | 'sonarrId'
  | 'status'
  | 'title'
  | 'type'
>
