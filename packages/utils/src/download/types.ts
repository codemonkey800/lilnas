import { z } from 'zod'

import {
  ActivityQuerySchema,
  BadFileSchema,
  CreateDownloadJobInputSchema,
  DeleteMediaFilesQuerySchema,
  DiscoverQuerySchema,
  DownloadJobSchema,
  DownloadJobStatus,
  DownloadQueueSnapshotSchema,
  DownloadType,
  EmbyStatusSchema,
  EpisodeSchema,
  FlagBadFileInputSchema,
  GalleryFacetsQuerySchema,
  GalleryItemSchema,
  GalleryQuerySchema,
  GrabReleaseInputSchema,
  HistoryQuerySchema,
  JobRequesterSchema,
  ListReleasesQuerySchema,
  ManagedMediaBaseSchema,
  MediaBaseSchema,
  MediaSchema,
  MediaSearchQuerySchema,
  MovieSchema,
  ReleaseProtocolSchema,
  ReleaseQualitySchema,
  ReleaseSchema,
  ReplaceReleaseInputSchema,
  RequestMovieInputSchema,
  RequestShowInputSchema,
  SeasonSchema,
  ShowSchema,
  ShowScopeSchema,
  TimeRangeSchema,
  VideoInfoSchema,
  VideoSchema,
} from './schema'

export { DownloadJobStatus, DownloadType }

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

export function isInProgressDownloadJobStatus(
  status: DownloadJobStatus,
): boolean {
  return (
    IN_PROGRESS_DOWNLOAD_JOB_STATUSES as readonly DownloadJobStatus[]
  ).includes(status)
}

export type CreateDownloadJobInput = z.infer<
  typeof CreateDownloadJobInputSchema
>

export type TimeRange = z.infer<typeof TimeRangeSchema>

/**
 * The identity of whoever asked for a job, threaded down from the
 * `X-Forwarded-User`/`X-Forwarded-User-Id` headers set by Traefik's
 * `lilnas-auth` middleware (see `apps/download/src/auth/forwarded-user.ts`).
 * `null`/absent means a service caller with no forwarded identity (e.g.
 * `apps/tdr-bot`'s `DownloadClient.dockerInstance` calls).
 */
export type JobRequester = z.infer<typeof JobRequesterSchema>

/**
 * A snapshot of a movie/show job's last-known Radarr/Sonarr queue entry.
 * Read live off the Radarr/Sonarr queue by `MediaPollerService` and attached
 * to the resolved `Movie`/`Show` - never persisted, since the queue is where
 * it was always coming from.
 */
export type DownloadQueueSnapshot = z.infer<typeof DownloadQueueSnapshotSchema>

/**
 * Emby's indexed-state for a downloaded movie/show, attached to the resolved
 * `Movie`/`Show` alongside {@link DownloadQueueSnapshot}. `itemId` and
 * `watchUrl` are populated only when `state` is `'indexed'`; the whole field
 * is absent when the title has no file on disk, since Emby is never consulted
 * in that case.
 */
export type EmbyStatus = z.infer<typeof EmbyStatusSchema>

// ---- The Media hierarchy (see docs/features/download/plans/001-media-entity-refactor.md §1) ----

export type MediaBase = z.infer<typeof MediaBaseSchema>
export type Video = z.infer<typeof VideoSchema>
export type ManagedMediaBase = z.infer<typeof ManagedMediaBaseSchema>
export type Movie = z.infer<typeof MovieSchema>
export type Show = z.infer<typeof ShowSchema>
export type Media = z.infer<typeof MediaSchema>

export function isVideo(media: Media): media is Video {
  return media.type === DownloadType.Video
}

export function isMovie(media: Media): media is Movie {
  return media.type === DownloadType.Movie
}

export function isShow(media: Media): media is Show {
  return media.type === DownloadType.Show
}

export function isManagedMedia(media: Media): media is Movie | Show {
  return media.type === DownloadType.Movie || media.type === DownloadType.Show
}

/**
 * A download *event*: who asked, when, and what happened. A plain,
 * non-union object - the only type-varying part is nested at `media`, which
 * is the discriminated union. This is simultaneously the domain type, the
 * REST body, and the WebSocket frame payload, so there is no serializer
 * layer between them; the only read-path transform is attribution masking
 * (`projectJobForViewer`).
 */
export type DownloadJob = z.infer<typeof DownloadJobSchema>

/**
 * The app-internal storage shape: a `DownloadJob` with `media` (a live,
 * re-derived lookup) replaced by the durable `mediaId` key it's derived
 * from, plus the `type` needed to know *how* to derive it. This is what
 * `DownloadStateService.jobs` holds and what the `jobs` table stores -
 * caching a resolved `Media` copy per job would just be a second cache with
 * its own staleness.
 */
export type DownloadJobRecord = Omit<DownloadJob, 'media'> & {
  mediaId: string
  type: DownloadType
}

export type GalleryItem = z.infer<typeof GalleryItemSchema>

/** `GET /download/media/:id`'s response - see plan §3.1. */
export interface MediaDetailResponse {
  jobs: DownloadJob[]
  media: Media
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

/**
 * @deprecated Pre-Media wire shape, retained only for `apps/tdr-bot`. Use
 * {@link DownloadJob}. Removed by TODO(tdr-bot-migration) in ./client.
 *
 * Hand-written rather than a `Pick<>` because the union it used to be
 * picked from no longer exists.
 */
export interface GetDownloadJobResponse {
  description?: string
  downloadUrls?: string[]
  error?: string
  hiddenAttribution: boolean
  id: string
  requester: JobRequester | null
  status: DownloadJobStatus
  timeRange?: TimeRange
  title?: string
  type: DownloadType.Video
  url: string
}

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
 * `GET /download/movies/search` and `GET /download/shows/search`. Both
 * return the same `Media` shape every other endpoint does - a search hit, a
 * discovery hit, and a downloaded title differ only in which optional
 * fields are populated, so they are literally the same type.
 */
export interface SearchMediaResponse {
  results: Media[]
}

export type DiscoverySource = 'movies' | 'shows'

export interface DiscoveryFacets {
  genres: Array<{ count: number; genre: string }>
}

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
 * `GET /download/discover`'s response. Extends the same `DownloadPage`
 * envelope every other list endpoint uses, plus discovery-only fields:
 * `facets` (the genre chip vocabulary, computed server-side) and
 * `degradedSources` - non-empty when one upstream (Radarr or Sonarr) failed
 * and the page was served from the other alone. An empty array here is not
 * the same as "everything is fine" being unstated - it's the explicit
 * signal that both sources answered.
 */
export interface DiscoveryPage extends DownloadPage<Media> {
  degradedSources: DiscoverySource[]
  facets: DiscoveryFacets
}

// ---- Phase 3: release selection, replacement, bad-file reporting ----

export type ReleaseProtocol = z.infer<typeof ReleaseProtocolSchema>
export type ReleaseQuality = z.infer<typeof ReleaseQualitySchema>

/**
 * One interactive-search result from Radarr *or* Sonarr, already annotated
 * with this app's own `flaggedBad`. See `ReleaseSchema` for why the two
 * nominally-distinct generated `ReleaseResource` types collapse into one
 * hand-written wire type here.
 */
export type Release = z.infer<typeof ReleaseSchema>

export type ListReleasesQuery = z.infer<typeof ListReleasesQuerySchema>
export type GrabReleaseInput = z.infer<typeof GrabReleaseInputSchema>
export type ReplaceReleaseInput = z.infer<typeof ReplaceReleaseInputSchema>
export type FlagBadFileInput = z.infer<typeof FlagBadFileInputSchema>

/**
 * A flagged release. Exclusion is enforced only inside this app - Radarr's
 * and Sonarr's own selection logic is untouched, so a search started from
 * their UI can still re-pick a flagged release (accepted gap, spec §6).
 */
export type BadFile = z.infer<typeof BadFileSchema>

/** `GET /download/media/:id/releases`. */
export interface ListReleasesResponse {
  releases: Release[]
}

/** `GET /download/media/:id/bad-files`. */
export interface ListBadFilesResponse {
  badFiles: BadFile[]
}

/**
 * `POST /download/media/:id/bad-files`. Idempotent on
 * `(mediaId, releaseGuid)` - re-flagging an already-flagged release returns
 * the original row rather than erroring, so a double-click is harmless.
 */
export interface FlagBadFileResponse {
  badFile: BadFile
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

// ---- Phase 4: per-episode/season granularity ----

/**
 * Which part of a series a show job was created for. Absent = the whole
 * series - the pre-Phase-4 behavior, and still the default. Carried on the
 * job rather than encoded in the media id; see `ShowScopeSchema` for why.
 */
export type ShowScope = z.infer<typeof ShowScopeSchema>

/**
 * One episode of a series. `id` is Sonarr's episode primary key - the key
 * every scoped operation is expressed in - while `episodeNumber` is the one
 * that gets rendered.
 */
export type Episode = z.infer<typeof EpisodeSchema>

/** One season plus its episodes, as `GET /media/:id/seasons` reports it. */
export type Season = z.infer<typeof SeasonSchema>

export type DeleteMediaFilesQuery = z.infer<typeof DeleteMediaFilesQuerySchema>

/**
 * `GET /download/media/:id/seasons`. Shows only - a `tmdb:` key 404s here,
 * since a movie has no seasons to list.
 */
export interface ListSeasonsResponse {
  seasons: Season[]
}

/**
 * `DELETE /download/media/:id/files`. Deleting zero files is a success, not
 * a 404: the caller asked for a state, and that state already held.
 *
 * This removes **files**, never the library entry - the series/movie stays
 * in Sonarr/Radarr. Removing the title entirely is still
 * `DELETE /download/shows/:jobId` / `DELETE /download/movies/:jobId`.
 */
export interface DeleteMediaFilesResponse {
  deletedCount: number
  mediaId: string
}
