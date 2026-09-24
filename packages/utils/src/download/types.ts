import { z } from 'zod'

import {
  ActivityQuerySchema,
  AdminStatsQuerySchema,
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  AuditLogEntrySchema,
  AuditLogQuerySchema,
  BadFileSchema,
  CreateDownloadJobInputSchema,
  DeleteMediaFilesQuerySchema,
  DiscardImportQuerySchema,
  DiscordIdentitySchema,
  DiscordRequesterSchema,
  DiscoverQuerySchema,
  DownloadJobSchema,
  DownloadJobStatus,
  DownloadQueueSnapshotSchema,
  DownloadType,
  EmbyStatusSchema,
  EpisodeSchema,
  EpisodeStateEntrySchema,
  FlagBadFileInputSchema,
  GalleryFacetsQuerySchema,
  GalleryItemSchema,
  GalleryQuerySchema,
  GetMediaFileQuerySchema,
  GrabReleaseInputSchema,
  HistoryQuerySchema,
  ImportFilesInputSchema,
  JobRequesterSchema,
  ListImportCandidatesQuerySchema,
  ListReleasesQuerySchema,
  ManagedMediaBaseSchema,
  ManualImportCandidateSchema,
  MEDIA_STATES,
  MediaBaseSchema,
  MediaSchema,
  MediaSearchQuerySchema,
  MediaStateSchema,
  MovieSchema,
  ProfileQuerySchema,
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
  UpdateCheckResultSchema,
  VideoInfoSchema,
  VideoProgressSchema,
  VideoSchema,
} from './schema'

export {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  DownloadJobStatus,
  DownloadType,
  MEDIA_STATES,
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
 * The Discord identity of whoever submitted a job over `apps/tdr-bot`'s
 * `/download` command, threaded down from the
 * `x-discord-user-id`/`x-discord-username` headers
 * `DownloadClient.withDiscordIdentity()` sets. `null` on every job that did
 * not arrive over Discord. Never carries the Discord display name - see
 * {@link DiscordRequesterSchema}.
 */
export type DiscordRequester = z.infer<typeof DiscordRequesterSchema>

/**
 * A Discord account *linked to* a lilnas user (the link lives in
 * `apps/auth`), resolved at read time onto `DownloadJob.linkedDiscord`.
 * Deliberately a distinct type from {@link DiscordRequester} even though the
 * two share a shape - see {@link DiscordIdentitySchema}.
 */
export type DiscordIdentity = z.infer<typeof DiscordIdentitySchema>

/**
 * A snapshot of a movie/show job's last-known Radarr/Sonarr queue entry.
 * Read live off the Radarr/Sonarr queue by `MediaPollerService` and attached
 * to the resolved `Movie`/`Show` - never persisted, since the queue is where
 * it was always coming from.
 */
export type DownloadQueueSnapshot = z.infer<typeof DownloadQueueSnapshotSchema>

/**
 * yt-dlp's progress on a video job's current file, per job and per file.
 * Process-lifetime only - see {@link VideoProgressSchema}; the managed-media
 * counterpart is {@link DownloadQueueSnapshot}.
 */
export type VideoProgress = z.infer<typeof VideoProgressSchema>

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

// ---- Plan 021: media state ----

/**
 * Where a piece of media stands right now - one of {@link MEDIA_STATES},
 * whose doc spells out what each value means for a movie, a show and a
 * video.
 */
export type MediaState = z.infer<typeof MediaStateSchema>

/**
 * One episode's state, keyed by Sonarr's episode id. See
 * `EpisodeStateEntrySchema` for why `state` is required here but optional on
 * `Episode`.
 */
export type EpisodeStateEntry = z.infer<typeof EpisodeStateEntrySchema>

/**
 * Highest first: the order {@link rollupMediaState} picks a season's or a
 * series' state by. Something a human must act on outranks anything moving,
 * anything moving outranks anything settled, and a file on disk outranks
 * having none - so a series with 3 of 45 episodes on disk is `available`,
 * and the counts say how much of it.
 */
export const MEDIA_STATE_PRECEDENCE: readonly MediaState[] = [
  'needs_attention',
  'downloading',
  'importing',
  'paused',
  'available',
  'wanted',
  'absent',
]

/**
 * The one way to read a media's state. `Media.state` is optional because the
 * mappers build a `Media` before anything has looked at the queue (see
 * `MediaBaseSchema.state`), so an unresolved media - a placeholder, a search
 * hit - reads as `absent`.
 */
export function mediaState(media: Pick<Media, 'state'>): MediaState {
  return media.state ?? 'absent'
}

const IN_FLIGHT_MEDIA_STATES: ReadonlySet<MediaState> = new Set<MediaState>([
  'downloading',
  'importing',
  'needs_attention',
  'paused',
])

/**
 * Whether a download is under way - moving bytes, importing them, stuck on a
 * human, or paused. `wanted` is deliberately not in-flight: nothing has been
 * grabbed yet.
 */
export function isMediaInFlight(state: MediaState): boolean {
  return IN_FLIGHT_MEDIA_STATES.has(state)
}

/**
 * Rolls episode (or season) states up into one, taking the highest
 * {@link MEDIA_STATE_PRECEDENCE} entry present. Nothing to roll up means
 * nothing is there, so an empty input is `absent`.
 */
export function rollupMediaState(states: Iterable<MediaState>): MediaState {
  let best: MediaState = 'absent'
  let bestRank = MEDIA_STATE_PRECEDENCE.indexOf(best)
  for (const state of states) {
    const rank = MEDIA_STATE_PRECEDENCE.indexOf(state)
    if (rank !== -1 && rank < bestRank) {
      best = state
      bestRank = rank
    }
  }
  return best
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
 *
 * `progress` is left off too: `toJob()` attaches it from process-lifetime
 * state (the running yt-dlp's latest line), so it is never stored.
 */
export type DownloadJobRecord = Omit<DownloadJob, 'media' | 'progress'> & {
  mediaId: string
  type: DownloadType
}

/**
 * One gallery card: a title in the library, when it landed there
 * (`addedAt`), plus a summary of its download attempts - how many there were,
 * and who made the latest one and when. The gallery lists the library, not
 * the job log (plan 021), so a title nobody downloaded through this app is a
 * card too: `downloadCount: 0`, `lastDownloadedAt: null` and no requester.
 * Each job is one attempt at getting the media, never the media's status;
 * that comes from `media.state` (read it through `mediaState()`).
 */
export type GalleryItem = z.infer<typeof GalleryItemSchema>

/** `GET /download/media/:id`'s response - see plan §3.1. */
export interface MediaDetailResponse {
  /**
   * The download attempts for this media, newest first. History, not status:
   * pages don't derive what state the media is in from these - that is
   * `media.state`, read through `mediaState()`.
   */
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
 * The `type` field of the `DownloadGatewayMessage` envelope used for every
 * {@link MediaEvent} broadcast - the media-side sibling of
 * {@link DOWNLOAD_JOB_EVENT_TYPE}.
 */
export const MEDIA_EVENT_TYPE = 'media'

/**
 * The `event` of the one message a client sends the gateway, in the
 * `{ event, data }` shape Nest's `WsAdapter` routes on: the movie/show ids the
 * tab has a detail page open for, as a {@link WatchMediaMessage}. Each message
 * replaces the tab's previous set, and an empty list clears it.
 *
 * The gateway re-reads those titles' library entries every second, so a file
 * deleted or added in Radarr's/Sonarr's own UI reaches the open page as a
 * {@link MediaEvent} without a reload. Titles no page is watching are still
 * covered, just once a minute.
 */
export const WATCH_MEDIA_EVENT = 'watch-media'

/**
 * The most ids one {@link WatchMediaMessage} may carry. Each costs an
 * upstream call a second, and a detail page watches one.
 */
export const MAX_WATCHED_MEDIA_IDS = 20

export interface WatchMediaMessage {
  data: { mediaIds: string[] }
  event: typeof WATCH_MEDIA_EVENT
}

/**
 * Plan 021. Broadcast over the download WebSocket gateway as the `data` of a
 * `DownloadGatewayMessage` whenever a media's derived state changes. A media
 * snapshot carries no requester, so unlike a job event there is no
 * per-viewer projection - every subscriber gets the same frame.
 */
export interface MediaEvent {
  /**
   * Per-episode states, only for a show. Absent for a movie or a video, and
   * for a show frame that only moved the series-level state.
   */
  episodes?: EpisodeStateEntry[]
  /**
   * A full, current media snapshot - it carries `state`, `stateReason` and
   * `queueSnapshot`, so a subscriber may replace its copy blind.
   */
  media: Media
}

/**
 * The WS envelope every gateway frame is wrapped in. Deliberately
 * loosely-typed: `type` discriminates between payload kinds and `data`
 * varies per kind. {@link DOWNLOAD_JOB_EVENT_TYPE} carries a
 * {@link DownloadJobEvent} (see `DownloadStateService.broadcastJobEvent`);
 * {@link MEDIA_EVENT_TYPE} carries a {@link MediaEvent}.
 */
export interface DownloadGatewayMessage {
  type: string
  data?: unknown
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

/** `DELETE /download/media/:id/bad-files/:flagId`. Returns the removed row. */
export interface UnflagBadFileResponse {
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
 * The delete **cascades upward**. Emptying a season unmonitors that season,
 * and emptying the last monitored season removes the series from Sonarr
 * outright; a movie, or a whole-title show scope, always removes the title
 * from Radarr/Sonarr. `removedFromLibrary` reports whether that happened.
 * Nothing here is permanent - requesting the title again re-adds it.
 */
export interface DeleteMediaFilesResponse {
  deletedCount: number
  mediaId: string
  /**
   * `true` when the delete reached the whole title and it was removed from
   * Radarr/Sonarr.
   */
  removedFromLibrary: boolean
}

// ---- Phase 7: local save-to-device ----

export type GetMediaFileQuery = z.infer<typeof GetMediaFileQuerySchema>

// No response interface for `GET /download/media/:id/file` on purpose: it
// answers with a raw byte stream (an attachment), not JSON.

// ---- Phase 8: admin dashboard & audit log ----

/**
 * One of {@link AUDIT_ACTIONS} - the closed `<subject>.<verb>` vocabulary
 * every audit row is written and filtered with.
 */
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/**
 * What an audit row's `targetId` points at: a `jobs.id` or a `mediaId()`
 * key. `null` for an action with no target (e.g. `ytdlp.check_update`).
 */
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number]

/**
 * One persisted audit row. `actor` is `null` for a service caller with no
 * forwarded identity - see `AuditLogEntrySchema` for why `origin` sits next
 * to it, and why `metadata` stays deliberately untyped.
 */
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>

export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>
export type AdminStatsQuery = z.infer<typeof AdminStatsQuerySchema>

// `GET /download/admin/audit-log` answers with `DownloadPage<AuditLogEntry>` -
// the same envelope every other list endpoint uses, so there is no
// audit-specific response interface here on purpose.

/**
 * `GET /download/admin/stats`. Every breakdown is an array of
 * `{ count, ...key }` rows rather than a keyed object: the counts come
 * straight out of `GROUP BY` queries, and a row that never occurred in the
 * window is simply absent (not a zero), which an object keyed by the full
 * enum would have to invent.
 *
 * `windowDays` echoes the `days` that was actually applied, so a cached or
 * clamped response still says which window it describes.
 */
export interface AdminStatsResponse {
  jobsPerDay: Array<{
    count: number
    /** `YYYY-MM-DD`, bucketed in UTC to match the query's day boundaries. */
    day: string
    type: DownloadType
  }>
  topRequesters: Array<{ count: number; requesterEmail: string }>
  totalsByStatus: Array<{ count: number; status: DownloadJobStatus }>
  totalsByType: Array<{ count: number; type: DownloadType }>
  totalJobs: number
  windowDays: number
}

export type ProfileQuery = z.infer<typeof ProfileQuerySchema>

/**
 * `GET /download/profile`. A computed view over the `jobs` table - there is
 * no `users` table, so an email with no jobs yields an empty profile (nulls
 * and empty arrays), never a 404. Aggregates follow `AdminStatsResponse`'s
 * sparse convention: a row that never occurred is absent, not a zero. There
 * is no `totalJobs` field - sum `totalsByType` if you need one.
 *
 * Only `jobsPerDay` is windowed by the query's `days`; totals and the
 * first/last timestamps are all-time. `windowDays` echoes the window that
 * was actually applied.
 */
export interface ProfileResponse {
  /** The resolved target - the caller, or the admin-requested `requester` - echoed verbatim. */
  user: { email: string }
  /** ISO-8601; `null` when the user has no jobs. */
  firstDownloadAt: string | null
  /** ISO-8601; `null` when the user has no jobs. */
  lastDownloadAt: string | null
  jobsPerDay: Array<{
    count: number
    /** `YYYY-MM-DD`, bucketed in UTC to match the query's day boundaries. */
    day: string
    type: DownloadType
  }>
  totalsByStatus: Array<{ count: number; status: DownloadJobStatus }>
  totalsByType: Array<{ count: number; type: DownloadType }>
  windowDays: number
}

// ---- yt-dlp updater ----

/**
 * `POST /api/ytdlp-update/check`'s response - what the updater found and
 * whether it is willing to act on it. See `UpdateCheckResultSchema`.
 */
export type UpdateCheckResult = z.infer<typeof UpdateCheckResultSchema>

/**
 * `GET /api/ytdlp-update/status`'s response.
 *
 * `lastCheck`/`lastAttempt` are `string | null`, not `Date | null`:
 * `YtdlpUpdateService.getUpdateStatus()` holds real `Date` objects
 * internally, but Nest `JSON.stringify`s the handler's return value, so what
 * actually arrives on the wire is an ISO-8601 string. This is the wire shape;
 * the service's inline return type is the internal one.
 */
export interface YtdlpUpdateStatusResponse {
  isUpdating: boolean
  lastCheck: string | null
  lastAttempt: string | null
  retryCount: number
}

// ---- Plan 020: stuck imports and the in-app importer ----

/**
 * One file Radarr/Sonarr is offering for manual import. `path` is the
 * identity of the row - the only field the commit sends back; see
 * `ManualImportCandidateSchema` for why everything else is re-resolved
 * server-side.
 */
export type ManualImportCandidate = z.infer<typeof ManualImportCandidateSchema>

export type ListImportCandidatesQuery = z.infer<
  typeof ListImportCandidatesQuerySchema
>
export type ImportFilesInput = z.infer<typeof ImportFilesInputSchema>
export type DiscardImportQuery = z.infer<typeof DiscardImportQuerySchema>

/**
 * `GET /download/media/:id/imports`. The candidates of *every* queue item in
 * scope, flattened into one list - a stuck download can span several queue
 * items, and the dialog picks files, not queue rows.
 */
export interface ListImportCandidatesResponse {
  candidates: ManualImportCandidate[]
}

/**
 * `POST /download/media/:id/imports`. `importedCount` is how many of the
 * requested paths were handed to upstream's `ManualImport` command, not how
 * many files ended up on disk: the command is asynchronous, so the move
 * itself is still in flight when this answers.
 */
export interface ImportFilesResponse {
  importedCount: number
}

/**
 * `DELETE /download/media/:id/imports`. Discards every queue item in scope,
 * client files included - the give-up path for a download that will never
 * import. Discarding zero items is a success, not a 404, for the reason
 * `DeleteMediaFilesResponse` gives: the caller asked for a state, and that
 * state already held.
 */
export interface DiscardImportResponse {
  discardedCount: number
}
