import { ChildProcessWithoutNullStreams } from 'child_process'
import { z } from 'zod'

import {
  ActivityQuerySchema,
  CreateDownloadJobInputSchema,
  DiscoverQuerySchema,
  GalleryFacetsQuerySchema,
  GalleryQuerySchema,
  HistoryQuerySchema,
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

// Terminal = a status that will never change again on its own (see
// reconcile-interrupted-jobs.ts, the original owner of this exact list).
// In-progress is derived by filtering the full status enum rather than
// hand-listing the complement, so the two sets can never drift apart -
// adding a new DownloadJobStatus member automatically lands it in
// "in progress" unless it's explicitly added to the terminal list too.
export const TERMINAL_DOWNLOAD_JOB_STATUSES = [
  DownloadJobStatus.Cancelled,
  DownloadJobStatus.Completed,
  DownloadJobStatus.Failed,
] as const

export function isTerminalDownloadJobStatus(
  status: DownloadJobStatus,
): boolean {
  return (
    TERMINAL_DOWNLOAD_JOB_STATUSES as readonly DownloadJobStatus[]
  ).includes(status)
}

export const IN_PROGRESS_DOWNLOAD_JOB_STATUSES = Object.values(
  DownloadJobStatus,
).filter(status => !isTerminalDownloadJobStatus(status))

export type CreateDownloadJobInput = z.infer<
  typeof CreateDownloadJobInputSchema
>

/**
 * The identity of whoever asked for a job, threaded down from the
 * `X-Forwarded-User`/`X-Forwarded-User-Id` headers set by Traefik's
 * `lilnas-auth` middleware (see `apps/download/src/auth/forwarded-user.ts`).
 * `null`/absent means a service caller with no forwarded identity (e.g.
 * `apps/tdr-bot`'s `DownloadClient.dockerInstance` calls).
 */
export interface JobRequester {
  email: string
  userId: string
}

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
  completedAt?: Date
  description?: string
  downloadUrls?: string[]
  error?: string
  file?: string
  id: string
  proc?: ChildProcessWithoutNullStreams
  requester?: JobRequester | null
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
  completedAt?: Date
  description?: string
  error?: string
  filePath?: string
  id: string
  mediaTitle?: string
  overview?: string
  posterUrl?: string
  queueSnapshot?: DownloadQueueSnapshot
  radarrId?: number
  requester?: JobRequester | null
  status: DownloadJobStatus
  title?: string
  type: DownloadType.Movie
  url: string
}

export interface ShowDownloadJob {
  completedAt?: Date
  description?: string
  error?: string
  filePath?: string
  id: string
  mediaTitle?: string
  overview?: string
  posterUrl?: string
  queueSnapshot?: DownloadQueueSnapshot
  requester?: JobRequester | null
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

/**
 * Distinguishes a brand-new job (never seen before) from a status/field
 * change on a job the subscriber may already know about. Not strictly
 * required to reconstruct state - `DownloadJobEvent.job` is always a full,
 * current snapshot, so a subscriber could safely upsert by `job.id` without
 * this - but it's cheap to carry and lets a subscriber special-case a job
 * appearing for the first time (e.g. an entrance animation) without having
 * to infer that from whatever it happened to have cached locally.
 */
export enum DownloadJobEventType {
  Created = 'created',
  Updated = 'updated',
}

/**
 * Broadcast over the download WebSocket gateway
 * (`apps/download/src/download-gateway/download.gateway.ts`) as the `data`
 * of a `DownloadGatewayMessage` whenever a job is created or has any of its
 * fields updated - see `DownloadStateService.addJob()`/`updateJob()`, the
 * only two places a job's state can change.
 */
export interface DownloadJobEvent {
  job: DownloadJob
  type: DownloadJobEventType
}

/**
 * The `type` field of the `DownloadGatewayMessage` envelope used for every
 * `DownloadJobEvent` broadcast. Shared as a constant so the backend emitter
 * and any future frontend subscriber can't drift apart on the literal.
 */
export const DOWNLOAD_JOB_EVENT_TYPE = 'download-job'

export type GetDownloadJobResponse = Pick<
  Extract<DownloadJob, { type: DownloadType.Video }>,
  | 'description'
  | 'downloadUrls'
  | 'error'
  | 'hiddenAttribution'
  | 'id'
  | 'requester'
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

export type ActivityQuery = z.infer<typeof ActivityQuerySchema>
export type GalleryQuery = z.infer<typeof GalleryQuerySchema>
export type GalleryFacetsQuery = z.infer<typeof GalleryFacetsQuerySchema>
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>
export type DiscoverQuery = z.infer<typeof DiscoverQuerySchema>

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

/**
 * Fields shared by every discovery result, regardless of source - kept
 * intentionally separate from `MovieSearchResult`/`ShowSearchResult` above
 * (which back the existing `/movies/search`, `/shows/search` endpoints) so
 * widening this shape can never change those endpoints' response bytes.
 */
interface DiscoveryResultBase {
  certification?: string
  // Normalized `null` -> `[]` at the mapper (never left as `null | undefined`)
  // so discovery-ranking.ts's genre filter never has to null-check.
  genres: string[]
  overview?: string
  posterUrl?: string
  ratingValue?: number
  releaseDate?: string
  releaseYear?: number
  runtime?: number
  title: string
  year?: number
}

export interface DiscoveryMovieResult extends DiscoveryResultBase {
  tmdbId: number
  type: DownloadType.Movie
}

export interface DiscoveryShowResult extends DiscoveryResultBase {
  tvdbId: number
  type: DownloadType.Show
}

export type DiscoveryResult = DiscoveryMovieResult | DiscoveryShowResult

export type DiscoverySource = 'movies' | 'shows'

export interface DiscoveryFacets {
  genres: Array<{ count: number; genre: string }>
}

/**
 * `GET /download/discover`'s response. Extends the same `DownloadPage`
 * envelope every other list endpoint uses, plus discovery-only fields:
 * `facets` (the genre chip vocabulary, computed server-side) and
 * `degradedSources` - non-empty when one upstream (Radarr or Sonarr) failed
 * and the page was served from the other alone. An empty array here is not
 * the same as "everything is fine" being unstated - it's the explicit
 * signal that both sources answered.
 */
export interface DiscoveryPage extends DownloadPage<DiscoveryResult> {
  degradedSources: DiscoverySource[]
  facets: DiscoveryFacets
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
  | 'requester'
  | 'status'
  | 'title'
  | 'type'
>

/**
 * The shared envelope for every cursor-paginated list endpoint (activity,
 * gallery, history, discovery). `total` is always the size of the filtered
 * set - not of what remains after the cursor - so a client can show
 * "12 of 340" on every page, not just the first.
 */
export interface DownloadPage<T> {
  items: T[]
  nextCursor: string | null
  total: number
}

/**
 * The gallery's chip vocabulary - `GET /download/gallery/facets`. Computed
 * over only the date range (never the currently-selected type/uploader), so
 * narrowing by one facet never makes the others disappear. The uploader
 * list already has the attribution-oracle guard applied server-side - it
 * never includes an uploader whose only match is a hidden video, unless the
 * viewer is an admin.
 */
export interface DownloadGalleryFacets {
  types: Array<{ count: number; type: DownloadType }>
  uploaders: Array<{ count: number; email: string }>
}

export type GetShowJobResponse = Pick<
  ShowDownloadJob,
  | 'description'
  | 'error'
  | 'id'
  | 'mediaTitle'
  | 'posterUrl'
  | 'queueSnapshot'
  | 'requester'
  | 'sonarrId'
  | 'status'
  | 'title'
  | 'type'
>

/**
 * The two fields every list endpoint needs that don't exist on `DownloadJob`
 * itself - `createdAt` has no home there at all (see `hydrateJobRow()`'s own
 * comment), and `completedAt` needs to travel as an ISO string rather than a
 * `Date` for the wire, matching every other timestamp-shaped field in these
 * response types.
 */
export interface DownloadJobListFields {
  completedAt: string | null
  createdAt: string
}

/**
 * A gallery card and a detail page cannot drift field-for-field, because
 * they're literally built from the same `Get*JobResponse` types - this only
 * adds the two fields a list needs on top. Discriminated on `type`, which
 * all three already carry.
 */
export type DownloadJobListItem =
  | (GetDownloadJobResponse & DownloadJobListFields)
  | (GetMovieJobResponse & DownloadJobListFields)
  | (GetShowJobResponse & DownloadJobListFields)
