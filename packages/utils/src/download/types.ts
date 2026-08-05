import { ChildProcessWithoutNullStreams } from 'child_process'
import { z } from 'zod'

import { CreateDownloadJobInputSchema, VideoInfoSchema } from './schema'

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
