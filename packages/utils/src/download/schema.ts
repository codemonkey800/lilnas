import { z } from 'zod'

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
  /**
   * Plan 020. The download finished and the bytes are on disk, but
   * Radarr/Sonarr refused to import them - their queue row reads
   * "Downloaded - Waiting to Import" with a one-line reason, and nothing
   * moves until a human acts. Deliberately **not** `failed` (Retry would
   * re-grab a file we already have) and **not** `importing` (nothing is
   * moving).
   *
   * Non-terminal for the same reason as {@link DownloadJobStatus.Paused}:
   * the job is still an open piece of work, so it stays on the Activity feed
   * rather than dropping into history. It always **survives** a restart,
   * whatever the job's type - the finished file sits in Radarr/Sonarr's
   * download directory rather than in this process's memory, so a reboot
   * changes nothing about what the human still has to do.
   * `reconcileInterruptedJobs()`
   * (`apps/download/src/db/reconcile-interrupted-jobs.ts`) leaves it alone
   * instead of sweeping it to `failed` at boot, and
   * `DownloadStateService.adoptOpenJobs()` re-adopts it.
   */
  NeedsAttention = 'needs_attention',
  /**
   * Phase 5. Deliberately **not** in `TERMINAL_DOWNLOAD_JOB_STATUSES`
   * (./types.ts): a paused job is still an open piece of work, so it stays on
   * the Activity feed rather than dropping into history. The other half of
   * that choice is that a paused video does *not* survive a restart -
   * `reconcileInterruptedJobs()`
   * (`apps/download/src/db/reconcile-interrupted-jobs.ts`) sweeps every
   * non-terminal video row (bar `needs_attention`) to `failed` at boot, and
   * that is intended: the partial file lives under `/download/videos`, which
   * has no volume behind it, so there is nothing left to resume from. A
   * paused movie/show is Radarr/Sonarr's state, not ours, so it survives and
   * is re-adopted like any other open movie/show job.
   */
  Paused = 'paused',
  /** Phase 5. Pause requested, not yet acknowledged - non-terminal for the
   * same reasons as {@link DownloadJobStatus.Paused}. */
  Pausing = 'pausing',
  Pending = 'pending',
  Requested = 'requested',
  Searching = 'searching',
  Uploading = 'uploading',
}

export const TIME_REGEX = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/

export const TimeRangeSchema = z.object({
  start: z.string().regex(TIME_REGEX),
  end: z.string().regex(TIME_REGEX),
})

/**
 * A snapshot of a title's last-known Radarr/Sonarr queue entry - per media,
 * not per job. The resolver sets `media.queueSnapshot` from
 * `MediaStateService`'s queue cache (a series' entries rolled up into one
 * series-wide figure), so an episode job and a whole-series job on the same
 * show carry the same progress. An episode's own entry rides on
 * `EpisodeSchema.queueSnapshot`.
 */
export const DownloadQueueSnapshotSchema = z.object({
  progress: z.number().optional(),
  status: z.string().optional(),
  timeLeft: z.string().optional(),
})

/**
 * How far yt-dlp has got with a job's current file - per job, per file. The
 * download app maps yt-dlp's own progress fields into this shape and hangs it
 * on `DownloadJob.progress`. Video jobs only today, and process-lifetime:
 * held in memory while the job runs and never persisted, so a restart drops
 * it. The managed-media (Radarr/Sonarr) counterpart is
 * {@link DownloadQueueSnapshotSchema}, which is per media rather than per job.
 */
export const VideoProgressSchema = z.object({
  /** Bytes of the current file yt-dlp has written so far. */
  downloadedBytes: z.number().int().min(0),
  /**
   * yt-dlp's `eta`, seconds. Absent when it has none (`null` on the wire
   * from yt-dlp).
   */
  etaSeconds: z.number().min(0).optional(),
  /**
   * How many separate files this grab downloads before merging
   * (`160+139` -> 2). Absent when the info line was not seen.
   */
  fileCount: z.number().int().positive().optional(),
  /** 1-based; increments each time yt-dlp starts a new `filename`. */
  fileIndex: z.number().int().positive(),
  /** Present only for fragmented (HLS/DASH) downloads. */
  fragmentCount: z.number().int().positive().optional(),
  /** 0-based, as yt-dlp counts it - `frag 0/123` is what it prints. */
  fragmentIndex: z.number().int().min(0).optional(),
  /**
   * 0-100, two decimals, `downloadedBytes / totalBytes`. Absent when
   * `totalBytes` is.
   */
  percent: z.number().min(0).max(100).optional(),
  /** yt-dlp's `speed`, bytes per second. Absent when it reports `null`. */
  speedBps: z.number().min(0).optional(),
  /** `total_bytes`, else `total_bytes_estimate`; absent when neither is known. */
  totalBytes: z.number().int().positive().optional(),
  /** `true` when `totalBytes` came from `total_bytes_estimate`. */
  totalIsEstimate: z.boolean().optional(),
})

/**
 * The identity of whoever asked for a job, threaded down from the
 * `X-Forwarded-User`/`X-Forwarded-User-Id` headers set by Traefik's
 * `lilnas-auth` middleware (see `apps/download/src/auth/forwarded-user.ts`).
 * `null`/absent means a service caller with no forwarded identity (e.g.
 * `apps/tdr-bot`'s `DownloadClient.dockerInstance` calls).
 */
export const JobRequesterSchema = z.object({
  email: z.string(),
  userId: z.string(),
})

/**
 * The Discord identity of whoever asked for a job, threaded down from the
 * `x-discord-user-id`/`x-discord-username` headers set by `apps/tdr-bot` on
 * its `/download` command (see `DownloadClient.withDiscordIdentity`).
 * `null`/absent means the job did not arrive over Discord at all - a browser
 * request, or a service caller with no Discord identity to declare.
 *
 * `discordUserId` is a snowflake and therefore always a `string`: it exceeds
 * `Number.MAX_SAFE_INTEGER`, so a `number` would silently round it.
 * `discordUsername` is the post-2023 handle (2-32 chars of `a-z0-9._`),
 * never the display name - that rides the separate, optional
 * `x-discord-display-name` header, which exists only to make `apps/auth`'s
 * linking roster legible and deliberately never reaches a job row.
 */
export const DiscordRequesterSchema = z.object({
  discordUserId: z.string(),
  discordUsername: z.string(),
})

/**
 * A Discord account *linked to* a lilnas user - the link is owned by
 * `apps/auth` and resolved at read time by `apps/download`, so linking
 * retroactively unifies a person's whole history.
 *
 * Structurally identical to {@link DiscordRequesterSchema} and deliberately
 * kept separate rather than merged: this one answers "which Discord account
 * belongs to this job's `requester`", while `DiscordRequesterSchema` answers
 * "which Discord account submitted this job". Collapsing the two would make
 * a web job indistinguishable from a Discord-submitted one at the type
 * level, leaving every consumer to remember to consult `origin` instead.
 */
export const DiscordIdentitySchema = z.object({
  discordUserId: z.string(),
  discordUsername: z.string(),
})

export const CreateDownloadJobInputSchema = z.object({
  // Deliberately `.optional()` with NO `.default(false)`: this schema is
  // consumed via `z.infer<>` (the *output* type) for
  // `CreateDownloadJobInput`, and a `.default(false)` would make the field
  // required on that inferred type — breaking tdr-bot's existing
  // `createVideoJob({ url, timeRange })` call at compile time. Default to
  // `false` at the job-construction site instead
  // (`DownloadService.createVideoDownloadJob`).
  hiddenAttribution: z.boolean().optional(),

  timeRange: TimeRangeSchema.optional(),

  url: z.string().url(),
})

export const VideoInfoSchema = z.object({
  description: z.string().nullish().optional(),
  playlist: z.string().nullish().optional(),
  title: z.string().nullish().optional(),
})

export const MediaSearchQuerySchema = z.object({
  query: z.string().min(1),
})

export const RequestMovieInputSchema = z.object({
  tmdbId: z.number().int().positive(),
})

/**
 * `POST /download/shows`. `episodeId`/`seasonNumber` are the Phase 4
 * additions and are flat (not a nested `scope`) to match
 * `GrabReleaseInputSchema`, which already ships them that way. Both stay
 * optional so `DownloadClient.requestShow({ tvdbId })` keeps compiling.
 *
 * Plain `z.number()`, deliberately **not** the `z.coerce.number()` the query
 * schemas use: this is a JSON body, where a string `"3"` is a client bug
 * worth a 400 rather than something to silently coerce. That difference is
 * also why there is no shared zod fragment between the two - see
 * `DeleteMediaFilesQuerySchema`.
 */
export const RequestShowInputSchema = z.object({
  episodeId: z.number().int().positive().optional(),
  seasonNumber: z.number().int().min(0).optional(),
  tvdbId: z.number().int().positive(),
})

// ---- The Media hierarchy ----

/**
 * Plan 021. Where a piece of media stands right now, derived from upstream
 * (Radarr/Sonarr's library and queue, or the `videos` row plus its yt-dlp
 * job) on every poll. This is what a page renders as a title's status - a job
 * is only one download attempt, and pages don't read status off it.
 *
 *   - `absent` - not in the library, or in it unmonitored with no file.
 *     Video: no row, or a row with no file.
 *   - `wanted` - monitored, no file, nothing in the queue. Video: queued, not
 *     started.
 *   - `downloading` - a queue item is moving bytes. Video: yt-dlp running, or
 *     cancelling.
 *   - `importing` - the bytes are down and the file is being made available:
 *     a Radarr/Sonarr import, or yt-dlp's convert/upload/clean.
 *   - `needs_attention` - a queue item is stuck and a human must act; the
 *     media carries a `stateReason` saying why.
 *   - `paused` - video only today: yt-dlp paused or pausing.
 *   - `available` - a file is on disk. Movie: `filePath`; show:
 *     `episodeFileCount > 0`; video: `downloadUrls` non-empty.
 *
 * A closed tuple rather than a TS `enum` so the literals read the same on the
 * wire, in a `Record<MediaState, …>` table, and in a test. The order here is
 * the lifecycle, not the rollup precedence - that is
 * `MEDIA_STATE_PRECEDENCE` (./types.ts).
 */
export const MEDIA_STATES = [
  'absent',
  'wanted',
  'downloading',
  'importing',
  'needs_attention',
  'paused',
  'available',
] as const

export const MediaStateSchema = z.enum(MEDIA_STATES)

export const MediaBaseSchema = z.object({
  /**
   * Plan 021. When the file landed - movie: `movieFile.dateAdded`; series:
   * `series.added`; video: `videos.updated_at` once `download_urls` is set.
   * Optional because a title with no file (and every search/discovery hit)
   * has no such moment.
   */
  addedAt: z.iso.datetime().optional(),
  certification: z.string().optional(),
  genres: z.array(z.string()).optional(),
  /** Derived by `mediaId()` — e.g. `tmdb:438631` — never minted directly. */
  id: z.string(),
  overview: z.string().optional(),
  posterUrl: z.string().optional(),
  /**
   * `ratings.tmdb.value` upstream — `ratings` is a nested per-source object,
   * never a scalar, so the source is picked explicitly at the mapper.
   */
  ratingValue: z.number().optional(),
  /** Radarr `releaseDate` / Sonarr `firstAired`. */
  releaseDate: z.string().optional(),
  /**
   * **Seconds.** Radarr/Sonarr report minutes, so `toMovie()`/`toShow()`
   * multiply by 60 — the one place the conversion happens. Seconds is the
   * lossless direction: the gallery shows video durations to the second
   * (`14:02`, `0:58`) while movie/show detail renders `2h 04m`.
   */
  runtime: z.number().int().optional(),
  /**
   * Plan 021. See {@link MEDIA_STATES} for what each value means.
   *
   * **Optional on purpose, like `embyStatus`**: the mappers (`toMovie`,
   * `toShow`, `hydrateVideo`) and a few dozen test fixtures build a `Media`
   * before anything has looked at the queue, and the resolver always fills it
   * on anything the API serves. So readers never read `media.state` directly -
   * they call `mediaState(media)` (./types.ts), which falls back to `absent`.
   */
  state: MediaStateSchema.optional(),
  /**
   * Plan 021. Upstream's one-line reason a queue item is stuck - present iff
   * `state === 'needs_attention'`.
   */
  stateReason: z.string().optional(),
  title: z.string(),
  type: z.enum(DownloadType),
  year: z.number().int().optional(),
})

export const VideoSchema = MediaBaseSchema.extend({
  downloadUrls: z.array(z.string()).optional(),
  /**
   * Plain `z.string()`, not `.url()` — URL *validation* belongs on the
   * request boundary (`CreateDownloadJobInputSchema.url`, which does have
   * `.url()`), not on the derived read model. `MediaResolverService` emits a
   * degraded placeholder `Video` for a `video:` key with no row behind it,
   * and a stricter schema here would make the frontend's
   * `DownloadJobSchema.safeParse()` silently drop that job's live updates
   * instead of rendering it degraded.
   */
  sourceUrl: z.string(),
  timeRange: TimeRangeSchema.optional(),
  type: z.literal(DownloadType.Video),
})

/**
 * Emby indexed-state for a downloaded movie/show. `itemId` and
 * `watchUrl` are present iff state is 'indexed'. Absent entirely when
 * the title has no file on disk (Emby is never consulted then).
 */
export const EmbyStatusSchema = z.object({
  itemId: z.string().optional(),
  state: z.enum(['indexed', 'indexing', 'unknown']),
  watchUrl: z.string().optional(),
})

export const ManagedMediaBaseSchema = MediaBaseSchema.extend({
  embyStatus: EmbyStatusSchema.optional(),
  filePath: z.string().optional(),
  /**
   * Plan 021. Radarr's/Sonarr's own `monitored` flag on the movie/series -
   * what tells `wanted` (monitored, no file) from `absent` (unmonitored, no
   * file). Absent when the title isn't in the library at all.
   */
  monitored: z.boolean().optional(),
  queueSnapshot: DownloadQueueSnapshotSchema.optional(),
})

export const MovieSchema = ManagedMediaBaseSchema.extend({
  /**
   * The guid of the indexer release that produced the file currently on
   * disk, when this app can recover it. Absent means it could not be -
   * a manually imported file, or history that has since been pruned -
   * and the UI degrades to no `current` chip and no report control.
   */
  currentReleaseGuid: z.string().optional(),
  radarrId: z.number().int().positive().optional(),
  tmdbId: z.number().int().positive(),
  type: z.literal(DownloadType.Movie),
})

export const ShowSchema = ManagedMediaBaseSchema.extend({
  /**
   * Plan 021. Straight from Sonarr's series `statistics`, like
   * `SeasonSchema`'s per-season counts - Sonarr's number is the honest one.
   * Optional because a series not yet in the library has no statistics.
   */
  episodeCount: z.number().int().min(0).optional(),
  /**
   * Plan 021. Sonarr's series `statistics.episodeFileCount`. Anything above
   * `0` makes the series `available`; together with `episodeCount` it says
   * how much of it is.
   */
  episodeFileCount: z.number().int().min(0).optional(),
  sonarrId: z.number().int().positive().optional(),
  tvdbId: z.number().int().positive(),
  type: z.literal(DownloadType.Show),
})

export const MediaSchema = z.discriminatedUnion('type', [
  MovieSchema,
  ShowSchema,
  VideoSchema,
])

/**
 * Which part of a series a show job was created for - Phase 4's addition to
 * an otherwise all-or-nothing show download. Absent means the whole series,
 * which is exactly the pre-Phase-4 behavior, so every job that already
 * exists stays correct with no backfill.
 *
 * The scope lives on the **job**, never in the media id: `media_id` stays
 * `tvdb:121361` so `mediaIdSuffix()` + `Number()` keeps parsing it, and the
 * gallery keeps grouping a show into one card instead of fragmenting it into
 * one per episode.
 *
 * Declared here rather than under the Phase 4 banner at the bottom of this
 * file only because `DownloadJobSchema` carries it, and a `const` can't be
 * read before its initializer has run.
 */
export const ShowScopeSchema = z.object({
  /** Sonarr's own episode id - the search/grab key, not a display value. */
  episodeId: z.number().int().positive().optional(),
  /**
   * Display only, resolved server-side from `episodeId` at request time.
   * Denormalized on purpose (like `bad_files.release_title`): without it an
   * activity row can only say "The Wire", not "The Wire - S03E05", unless
   * the frontend fetches the seasons endpoint once per job.
   */
  episodeNumber: z.number().int().positive().optional(),
  /** `.min(0)` - Sonarr numbers specials as season 0. */
  seasonNumber: z.number().int().min(0).optional(),
})

export const DownloadJobSchema = z.object({
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /**
   * Who submitted this job over Discord - populated for `origin: 'discord'`
   * rows only, and `null` for every other job.
   */
  discordRequester: DiscordRequesterSchema.nullable(),
  error: z.string().optional(),
  hiddenAttribution: z.boolean(),
  id: z.string(),
  /**
   * The Discord account linked to `requester`, whoever submitted the job -
   * resolved at read time, not persisted. A separate field from
   * `discordRequester`; see {@link DiscordIdentitySchema} for why the two
   * are never merged.
   */
  linkedDiscord: DiscordIdentitySchema.nullable(),
  media: MediaSchema,
  /**
   * Video jobs only, while the process lives; absent for movies/shows and
   * for any job after a restart.
   */
  progress: VideoProgressSchema.optional(),
  requester: JobRequesterSchema.nullable(),
  /** Phase 4. Absent = the whole series (and always absent for a movie). */
  scope: ShowScopeSchema.optional(),
  /**
   * Plan 022. `true` only on a movie/show job adopted from a download
   * someone started in Radarr's or Sonarr's own UI - such a job has no
   * `requester` and no `discordRequester`, and this is what tells it apart
   * from a service caller's (tdr-bot's) job, which has neither either.
   * Absent on every other job, so existing fixtures, stored rows and
   * `apps/tdr-bot`'s parse stay valid unchanged.
   */
  startedUpstream: z.boolean().optional(),
  status: z.enum(DownloadJobStatus),
  updatedAt: z.iso.datetime(),
})

export const GalleryItemSchema = z.object({
  /**
   * Plan 021. When the title's file landed in the library - the gallery's
   * sort key and what `from`/`to` filter on. Read off the media itself
   * (Radarr's file `dateAdded`, Sonarr's series `added`, a video's last
   * write), so a title nobody downloaded through this app still has one.
   */
  addedAt: z.iso.datetime(),
  /**
   * Completed download attempts for the title. `0` is an honest answer: the
   * gallery lists the library, and a title can be in it without ever having
   * been downloaded through this app.
   */
  downloadCount: z.number().int(),
  /**
   * The Discord identity that submitted the last download, when it came in
   * over Discord; `null` otherwise. Masked alongside `lastRequester`.
   */
  lastDiscordRequester: DiscordRequesterSchema.nullable(),
  /**
   * When the latest completed download attempt finished, or `null` when the
   * title has none (see `downloadCount`).
   */
  lastDownloadedAt: z.iso.datetime().nullable(),
  /** Masked per the attribution-oracle rules — see `attribution.ts`. */
  lastRequester: JobRequesterSchema.nullable(),
  /**
   * `DownloadJob.startedUpstream` of the same latest job the other `last*`
   * fields describe - `true` when that job was adopted from a download
   * someone started in Radarr's or Sonarr's own UI, which is what tells its
   * pair of `null` identity slots apart from a masked pair. Names nobody, so
   * it is never masked. Absent otherwise, so existing rows, fixtures and
   * `apps/tdr-bot`'s parse stay valid unchanged.
   */
  lastStartedUpstream: z.boolean().optional(),
  media: MediaSchema,
})

// ---- Phase 2: list/query endpoint schemas ----

function csvRaw(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
  return values
    .flatMap(v => String(v).split(','))
    .map(v => v.trim())
    .filter(Boolean)
}

/**
 * Normalizes a query param that may arrive as a bare `string` (one
 * occurrence), a `string[]` (two-plus occurrences), or a single
 * comma-separated value (`?genre=Action,Comedy`) - or any mix of those -
 * into one flat array. Returns `undefined` (not `[]`) when nothing was
 * supplied, so "no filter" and "filtered to nothing" stay distinguishable
 * downstream.
 */
function csvStringList() {
  return z
    .preprocess(csvRaw, z.array(z.string()))
    .transform(values => (values.length > 0 ? values : undefined))
    .optional()
}

/** Same normalization as `csvStringList()`, restricted to a fixed vocabulary. */
function csvEnum<T extends z.util.EnumLike>(enumObject: T) {
  return z
    .preprocess(csvRaw, z.array(z.enum(enumObject)))
    .transform(parsed => (parsed.length > 0 ? parsed : undefined))
    .optional()
}

const LimitSchema = z.coerce.number().int().min(1).max(100).default(24)

function startOfDayUtc(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`)
}

function endOfDayUtc(dateOnly: string): Date {
  return new Date(`${dateOnly}T23:59:59.999Z`)
}

/**
 * The `from <= to` guard every date-windowed query schema applies, paired
 * with {@link DATE_RANGE_REFINEMENT} below.
 *
 * An inverted range (`from` after `to`) would otherwise just look like an
 * empty result set, indistinguishable from "no data in that window" - a
 * loud 400 is more honest than a silently misleading empty page.
 *
 * Typed on just the two fields it reads, so it applies unchanged to any
 * object schema that carries them (gallery, facets, audit log).
 */
function isOrderedDateRange(range: { from?: Date; to?: Date }): boolean {
  return !range.from || !range.to || range.from <= range.to
}

/** The error `isOrderedDateRange` reports, reported on `from`. */
const DATE_RANGE_REFINEMENT = {
  message: '`from` must not be after `to`',
  path: ['from'],
}

export const ActivityQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: LimitSchema,
  type: csvEnum(DownloadType),
})

export const GalleryQuerySchema = z
  .object({
    cursor: z.string().optional(),
    from: z.iso.date().transform(startOfDayUtc).optional(),
    limit: LimitSchema,
    requester: z.string().min(1).optional(),
    to: z.iso.date().transform(endOfDayUtc).optional(),
    type: csvEnum(DownloadType),
  })
  .refine(isOrderedDateRange, DATE_RANGE_REFINEMENT)

export const GalleryFacetsQuerySchema = z
  .object({
    from: z.iso.date().transform(startOfDayUtc).optional(),
    to: z.iso.date().transform(endOfDayUtc).optional(),
  })
  .refine(isOrderedDateRange, DATE_RANGE_REFINEMENT)

/**
 * `GET /download/history`.
 *
 * ⚠️ **Omitting both `requester` and `scope` means "me", never "everyone".**
 * That is what a bare `GET /download/history` has always meant, and it is
 * deliberately left alone: widening the default would silently change what
 * every existing caller's request returns.
 *
 * So there are three scopes, and the third has to be asked for by name:
 *
 *   - neither param — the caller's own history.
 *   - `?requester=sam@lilnas.io` — one named user's. Self is always allowed;
 *     anybody else is admin-only (403 otherwise), enforced in
 *     `DownloadController.getHistory`.
 *   - `?scope=all` — **every** requester, including service-created jobs with
 *     no requester at all. Admin-only, same 403.
 *
 * `scope` is a separate parameter rather than a sentinel inside `requester`
 * (`?requester=*`) because `requester` holds an email, and no reserved value
 * in that space can be proven not to collide with a real address.
 *
 * The two are mutually exclusive and a request carrying both is a 400 rather
 * than a silent winner - the same call {@link isOrderedDateRange} makes for an
 * inverted date range, and for the same reason: a contradictory query answered
 * with plausible-looking rows is worse than one answered with an error.
 */
export const HistoryQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: LimitSchema,
    requester: z.string().min(1).optional(),
    /**
     * `z.literal('all')` rather than an enum with a `'self'` member: "self" is
     * already spelled by omitting this parameter, and offering two ways to say
     * it would invite the two to drift.
     */
    scope: z.literal('all').optional(),
    status: csvEnum(DownloadJobStatus),
    type: csvEnum(DownloadType),
  })
  .refine(query => query.scope !== 'all' || query.requester === undefined, {
    message: '`scope=all` and `requester` are mutually exclusive',
    path: ['scope'],
  })

export const DiscoverQuerySchema = z
  .object({
    cursor: z.string().optional(),
    genre: csvStringList(),
    limit: LimitSchema,
    // Matches spec §3's stated 2-character search threshold.
    query: z.string().min(2),
    sort: z.enum(['relevance', 'title', 'releaseDate']).default('relevance'),
    yearFrom: z.coerce.number().int().optional(),
    yearTo: z.coerce.number().int().optional(),
  })
  .refine(
    q =>
      q.yearFrom === undefined ||
      q.yearTo === undefined ||
      q.yearFrom <= q.yearTo,
    { message: '`yearFrom` must not be after `yearTo`', path: ['yearFrom'] },
  )

// ---- Phase 3: release selection, replacement, bad-file reporting ----

/** Mirrors the generated `DownloadProtocol` shared by both SDKs. */
export const ReleaseProtocolSchema = z.enum(['unknown', 'usenet', 'torrent'])

/**
 * The two fields anyone actually renders out of the SDK's nested
 * `QualityModel { quality: { name, resolution, source, modifier }, revision }`
 * - kept as a small object rather than two sibling `quality`/`resolution`
 * columns so a release row can show "1080p WEBDL" as one unit without the
 * caller re-associating them.
 */
export const ReleaseQualitySchema = z.object({
  name: z.string(),
  resolution: z.number().int().optional(),
})

/**
 * One wire type for a Radarr *or* Sonarr interactive-search result. The two
 * generated `ReleaseResource` types are only nominally distinct - Sonarr adds
 * `fullSeason`/`seasonNumber`/`episodeNumbers` and types `imdbId` as a string
 * where Radarr uses a number - so rather than leak either generated shape to
 * the frontend, each service maps into this hand-written schema via its own
 * `toRelease()`.
 *
 * `flaggedBad` is *not* an upstream field: it's this app's own annotation,
 * joined on in `ReleaseService.listReleases()` from the `bad_files` table.
 * Radarr/Sonarr know nothing about it (see the spec's accepted gap - a search
 * started from their UI can still re-pick a flagged release).
 */
export const ReleaseSchema = z.object({
  /** Days since publish, as Radarr/Sonarr compute it. */
  age: z.number().optional(),
  customFormatScore: z.number().optional(),
  downloadAllowed: z.boolean(),
  /** Show-only. */
  episodeNumbers: z.array(z.number().int()).optional(),
  /** This app's annotation, never upstream's - see the schema doc above. */
  flaggedBad: z.boolean(),
  /** Show-only. */
  fullSeason: z.boolean().optional(),
  /** The indexer's stable id for this release - the grab key. */
  guid: z.string(),
  indexer: z.string().optional(),
  indexerId: z.number().int(),
  /** Flattened from the SDK's `Array<Language>` to just the names. */
  languages: z.array(z.string()).optional(),
  leechers: z.number().int().optional(),
  protocol: ReleaseProtocolSchema.optional(),
  publishDate: z.string().optional(),
  quality: ReleaseQualitySchema.optional(),
  rejected: z.boolean(),
  rejections: z.array(z.string()).optional(),
  releaseGroup: z.string().optional(),
  /** Show-only. */
  seasonNumber: z.number().int().optional(),
  seeders: z.number().int().optional(),
  /** Bytes. */
  size: z.number().optional(),
  title: z.string(),
})

/**
 * `GET /download/media/:id/releases`. Both params are Sonarr-only - Radarr's
 * release endpoint keys on `movieId` alone - and are passed straight through
 * to it. `seasonNumber` allows 0 because Sonarr numbers specials as season 0.
 */
export const ListReleasesQuerySchema = z.object({
  episodeId: z.coerce.number().int().positive().optional(),
  seasonNumber: z.coerce.number().int().min(0).optional(),
})

/**
 * `POST /download/media/:id/releases/grab`. `postApiV3Release` takes a whole
 * `ReleaseResource` body upstream, but `{ guid, indexerId }` is all either
 * service actually needs to grab - so the client sends the identity of its
 * pick, not the release it was handed back.
 *
 * `seasonNumber`/`episodeId` are show-only and carried for the same reason
 * they're on the list query: they scope which episodes stay monitored after
 * the grab, and (for replace) which existing files get deleted first.
 */
export const GrabReleaseInputSchema = z.object({
  episodeId: z.number().int().positive().optional(),
  guid: z.string().min(1),
  indexerId: z.number().int().nonnegative(),
  seasonNumber: z.number().int().min(0).optional(),
})

/**
 * `POST /download/media/:id/releases/replace` - deliberately the identical
 * shape to a grab, because a replace *is* a grab with a delete in front of
 * it. Aliased rather than re-declared so the two can never drift.
 */
export const ReplaceReleaseInputSchema = GrabReleaseInputSchema

/**
 * `POST /download/media/:id/bad-files`. Only `guid` is required - the rest
 * are denormalized copies of what the user was looking at when they flagged
 * it, kept so a flag stays readable after the release ages out of the
 * indexer and can no longer be looked up.
 */
export const FlagBadFileInputSchema = z.object({
  guid: z.string().min(1),
  indexerId: z.number().int().nonnegative().optional(),
  reason: z.string().max(500).optional(),
  title: z.string().max(500).optional(),
})

/** A persisted `bad_files` row on the wire. */
export const BadFileSchema = z.object({
  createdAt: z.iso.datetime(),
  flaggedBy: JobRequesterSchema,
  id: z.number().int(),
  indexerId: z.number().int().nullable(),
  mediaId: z.string(),
  reason: z.string().nullable(),
  releaseGuid: z.string(),
  releaseTitle: z.string().nullable(),
})

// ---- Phase 4: per-episode/season granularity ----
//
// `ShowScopeSchema` belongs to this phase too, but is declared further up
// next to `DownloadJobSchema`, which carries it - see the comment there.

/**
 * One episode of a series, as `GET /download/media/:id/seasons` reports it.
 *
 * `id` is Sonarr's episode primary key, *not* the episode number - it's the
 * key every scoped operation (search, grab, delete, unmonitor) is expressed
 * in, while `episodeNumber` is what gets rendered.
 */
export const EpisodeSchema = z.object({
  /** Sonarr's `airDateUtc`. */
  airDate: z.string().optional(),
  /**
   * The guid of the indexer release that produced the file currently on
   * disk, when this app can recover it. Absent means it could not be -
   * a manually imported file, or history that has since been pruned -
   * and the UI degrades to no `current` chip and no report control.
   *
   * It lives here rather than on `ShowSchema` because a series has no
   * single current release: the guid is per-episode.
   */
  currentReleaseGuid: z.string().optional(),
  /**
   * Omitted entirely when there is no file - Sonarr reports `0` for that
   * case, and a `0` here would read as a real file id.
   */
  episodeFileId: z.number().int().positive().optional(),
  episodeNumber: z.number().int().min(0),
  hasFile: z.boolean(),
  /** Sonarr's episode id - the search/grab/delete key. */
  id: z.number().int().positive(),
  monitored: z.boolean(),
  overview: z.string().optional(),
  /**
   * Plan 021. This episode's live Sonarr queue entry, when it has one. Filled
   * by the server for the seasons route; optional for the same reason as
   * `state` below.
   */
  queueSnapshot: DownloadQueueSnapshotSchema.optional(),
  /**
   * **Seconds**, matching `MediaBaseSchema.runtime`'s documented convention.
   * Sonarr reports minutes, so `toEpisode()` multiplies by 60 - the same
   * conversion `toShow()`/`toMovie()` already do.
   */
  runtime: z.number().int().optional(),
  /** `.min(0)` - Sonarr numbers specials as season 0. */
  seasonNumber: z.number().int().min(0),
  /**
   * Plan 021. This episode's {@link MEDIA_STATES} value, filled by the server
   * for the seasons route. Optional because `toEpisode()` builds an `Episode`
   * before anything has looked at the queue - the same reason
   * `MediaBaseSchema.state` is optional.
   */
  state: MediaStateSchema.optional(),
  title: z.string().optional(),
})

/**
 * One season of a series plus its episodes. The counts come from Sonarr's
 * own per-season `statistics` rather than being derived from `episodes` -
 * they include episodes Sonarr knows about but hasn't listed yet, so the two
 * can legitimately disagree and Sonarr's number is the honest one.
 */
export const SeasonSchema = z.object({
  episodeCount: z.number().int().min(0),
  episodeFileCount: z.number().int().min(0),
  episodes: z.array(EpisodeSchema),
  /**
   * The **season-level** flag off `SeriesResource.seasons[]`, which is a
   * separate layer from the series row and from each episode's own
   * `monitored`. Reported, never written: episode-level monitoring is what
   * governs searching, so Phase 4 leaves this one alone.
   */
  monitored: z.boolean(),
  /** `0` for specials. */
  seasonNumber: z.number().int().min(0),
  /** Bytes, from Sonarr's per-season statistics. */
  sizeOnDisk: z.number().optional(),
})

/**
 * `DELETE /download/media/:id/files`. Scope resolution is narrowest-first:
 * `episodeId` deletes one file, `seasonNumber` deletes that season's files,
 * neither deletes every file of the title.
 *
 * `z.coerce` because these are query params and therefore always strings on
 * the wire. That's precisely why this shares no zod fragment with
 * `RequestShowInputSchema`'s flat `episodeId`/`seasonNumber`: one shared
 * object would drag the coercion into the JSON bodies too, silently
 * accepting `{ "seasonNumber": "3" }` there.
 */
export const DeleteMediaFilesQuerySchema = z.object({
  episodeId: z.coerce.number().int().positive().optional(),
  seasonNumber: z.coerce.number().int().min(0).optional(),
})

// ---- Phase 7: local save-to-device ----

/**
 * `GET /download/media/:id/file`. `episodeId` is required for `tvdb:` keys
 * and rejected for the others; `part` is video-only and indexes
 * `Video.downloadUrls` (default 0). Those cross-field rules are the
 * controller's and service's, not refinements here - the same split
 * `DeleteMediaFilesQuerySchema` makes, since which rule applies depends on
 * the `:id` prefix, which this schema never sees.
 *
 * `z.coerce` because these are query params and therefore always strings on
 * the wire - see `DeleteMediaFilesQuerySchema` for why that coercion stays
 * out of any shared fragment.
 */
export const GetMediaFileQuerySchema = z.object({
  episodeId: z.coerce.number().int().positive().optional(),
  part: z.coerce.number().int().min(0).optional(),
})

// ---- Phase 8: admin dashboard & audit log ----

/**
 * Every mutating operation the service records an audit row for, named
 * `<subject>.<verb>`.
 *
 * A closed vocabulary rather than a free-text column: the audit log is
 * filterable by action, and a typo'd or drifting string would silently drop
 * rows out of a filter that looks like it is working. Adding an action here
 * is the deliberate step that makes it loggable *and* filterable at once.
 *
 * Append-only in practice - rows already written keep whatever value they
 * were written with, so removing a member would make historical rows
 * unparseable.
 */
export const AUDIT_ACTIONS = [
  'video.create',
  'video.cancel',
  'video.pause',
  'video.resume',
  'video.delete',
  'movie.request',
  'movie.delete',
  'show.request',
  'show.delete',
  'media.delete_files',
  'media.save_file',
  'release.grab',
  'release.replace',
  'file.flag_bad',
  'file.unflag_bad',
  'ytdlp.check_update',
  'media.manual_import',
  'media.discard_download',
  'movie.cancel',
  'show.cancel',
] as const

/**
 * What `targetId` points at. `job` means a `jobs.id`, `media` means a
 * `mediaId()` key (`tmdb:438631`) - the two id spaces every Phase 1-7
 * endpoint is already addressed in. Both are nullable on a row, since an
 * action like `ytdlp.check_update` has no target at all.
 */
export const AUDIT_TARGET_TYPES = ['job', 'media'] as const

/**
 * One persisted `audit_log` row on the wire.
 *
 * `actor` is `null` for a service caller with no forwarded identity - the
 * same meaning `DownloadJobSchema.requester` gives it, and the reason
 * `origin` exists alongside it: `'service'` says the null is expected
 * (tdr-bot, the yt-dlp updater), `'web'` says a browser request somehow
 * arrived without `X-Forwarded-User`, and `'discord'` says the action came
 * in over `apps/tdr-bot`'s `/download` command - in which case `actor` may
 * still be `null` while `discordActor` carries the identity.
 *
 * `metadata` is deliberately untyped (`Record<string, unknown>`) - it is
 * per-action detail rendered as key/value pairs, never branched on. Typing
 * it per action would put a discriminated union in front of a column whose
 * whole job is to hold whatever that action found worth remembering.
 */
export const AuditLogEntrySchema = z.object({
  action: z.enum(AUDIT_ACTIONS),
  actor: JobRequesterSchema.nullable(),
  createdAt: z.iso.datetime(),
  /** The Discord identity behind an `origin: 'discord'` row; `null` otherwise. */
  discordActor: DiscordRequesterSchema.nullable(),
  id: z.number().int(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  origin: z.enum(['service', 'web', 'discord']),
  targetId: z.string().nullable(),
  targetType: z.enum(AUDIT_TARGET_TYPES).nullable(),
})

/**
 * `GET /download/admin/audit-log`. Cursor-paginated like every other list
 * endpoint, and windowed by the same day-boundary `from`/`to` transforms
 * `GalleryQuerySchema` uses, so a date picker behaves identically on both.
 *
 * `actor` is an email, matched case-insensitively server-side - the
 * forwarded identity is the only human-readable handle an audit row carries.
 */
export const AuditLogQuerySchema = z
  .object({
    action: z.enum(AUDIT_ACTIONS).optional(),
    actor: z.string().min(1).optional(),
    cursor: z.string().optional(),
    from: z.iso.date().transform(startOfDayUtc).optional(),
    limit: LimitSchema,
    to: z.iso.date().transform(endOfDayUtc).optional(),
  })
  .refine(isOrderedDateRange, DATE_RANGE_REFINEMENT)

/**
 * `GET /download/admin/stats`. A rolling window measured in whole days back
 * from now, rather than a `from`/`to` pair: the dashboard's only control is
 * "last N days", and a single number keeps the server-side bucketing (and
 * its cache key) trivial.
 *
 * `z.coerce` because this is a query param and therefore always a string on
 * the wire. The 365 ceiling bounds the per-day grouping the endpoint has to
 * do; `.default(30)` is the dashboard's own default window.
 */
export const AdminStatsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
})

/**
 * `GET /download/profile`. `days` windows only the per-day trend
 * (`jobsPerDay`) - totals and first/last timestamps are all-time - and
 * copies `AdminStatsQuerySchema`'s bounds and default for the same reasons:
 * `z.coerce` because a query param is always a string on the wire, 365 to
 * bound the per-day grouping, 30 as the page's default window.
 *
 * `requester` targets another user's profile; omitting it means "my own".
 * Access is self-or-admin, enforced server-side.
 */
export const ProfileQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  requester: z.string().min(1).optional(),
})

// ---- yt-dlp updater ----

/**
 * `POST /api/ytdlp-update/check`'s response.
 *
 * `updateAvailable` and `canUpdate` are independent: a newer release can
 * exist that this deployment still refuses to install (already updating, a
 * dry run, or a missing binary path), and `reason` is the human-readable
 * explanation for that refusal. It is absent whenever there is nothing to
 * explain.
 */
export const UpdateCheckResultSchema = z.object({
  canUpdate: z.boolean(),
  currentVersion: z.string(),
  latestVersion: z.string(),
  reason: z.string().optional(),
  updateAvailable: z.boolean(),
})

// ---- Plan 020: stuck imports and the in-app importer ----

/**
 * One file Radarr/Sonarr is offering for manual import - a row in their
 * manual-import dialog, as `GET /download/media/:id/imports` reports it.
 *
 * `path` is the identity of the row: it is what the client sends back to
 * commit, and everything else the `ManualImport` command needs (quality,
 * languages, release group, `downloadId`) is re-resolved server-side from a
 * fresh candidate list. That is the same trust boundary
 * {@link GrabReleaseInputSchema} draws with `guid` - the client names its
 * pick, it never dictates the command.
 *
 * One wire type for both services, for the reason {@link ReleaseSchema}
 * gives: the two generated `ManualImportResource` types differ only in which
 * of `movie`/`episodes` they carry, so each service maps into this shape
 * rather than leaking its own.
 */
export const ManualImportCandidateSchema = z.object({
  /** Why not, when `importable` is false - rendered beside the row. */
  blockedReason: z.string().optional(),
  /** The download client's id for the queue item this file came from. */
  downloadId: z.string().optional(),
  /** Show: the episodes this file covers. Absent for a movie. */
  episodes: z
    .array(
      z.object({
        episodeNumber: z.number().int(),
        id: z.number().int(),
        seasonNumber: z.number().int(),
        title: z.string().optional(),
      }),
    )
    .optional(),
  /**
   * Server-decided: whether the `ManualImport` command can be built for this
   * file at all. Distinct from `rejections`, which upstream raises for files
   * it would merely prefer not to import.
   */
  importable: z.boolean(),
  /** Flattened from the SDK's `Array<Language>` to just the names. */
  languages: z.array(z.string()).optional(),
  /** Movie: the resolved title. Absent for a show. */
  movieTitle: z.string().optional(),
  /** The file's own name, for a row that renders without the full path. */
  name: z.string().optional(),
  /** Absolute path in the download client's view - the commit key. */
  path: z.string(),
  quality: ReleaseQualitySchema.optional(),
  /**
   * Upstream's own words, `reason` only - informational for a manual import
   * rather than blocking, since manually importing is precisely how a human
   * overrides them. `importable`/`blockedReason` carry the blocking half.
   */
  rejections: z.array(z.string()),
  /** Relative to the queue item's output directory. */
  relativePath: z.string().optional(),
  releaseGroup: z.string().optional(),
  /** Bytes. */
  size: z.number().optional(),
})

/**
 * `GET /download/media/:id/imports` - the same show scoping, spelled the same
 * way, as the release list it sits beside. Aliased rather than re-declared so
 * the two can never drift.
 */
export const ListImportCandidatesQuerySchema = ListReleasesQuerySchema

/**
 * `POST /download/media/:id/imports`. `paths` names the candidate rows to
 * commit, and nothing else: see {@link ManualImportCandidateSchema} for why
 * the rest of each `ManualImport` file is re-resolved server-side.
 *
 * `.min(1)` because an empty commit is a client bug worth a 400, not a
 * silent no-op that reports "imported 0 files" as a success.
 *
 * `episodeId`/`seasonNumber` are show-only and scope which queue items the
 * candidates are drawn from. Plain `z.number()`, deliberately not the
 * `z.coerce.number()` the query schemas use - this is a JSON body; see
 * `DeleteMediaFilesQuerySchema` for why the two share no zod fragment.
 */
export const ImportFilesInputSchema = z.object({
  episodeId: z.number().int().positive().optional(),
  paths: z.array(z.string().min(1)).min(1),
  seasonNumber: z.number().int().min(0).optional(),
})

/**
 * `DELETE /download/media/:id/imports` - the give-up path, scoped exactly
 * like the list it discards. Aliased to {@link ListReleasesQuerySchema} for
 * the same reason {@link ListImportCandidatesQuerySchema} is.
 */
export const DiscardImportQuerySchema = ListReleasesQuerySchema

// ---- Plan 021: media is the source of truth ----
//
// `MEDIA_STATES`/`MediaStateSchema` belong to this plan too, but are declared
// up with the Media hierarchy, which carries them - the same arrangement
// `ShowScopeSchema` has with Phase 4.

/**
 * One episode's state, keyed by Sonarr's episode id - the compact form of a
 * series' per-episode states, for when the full {@link EpisodeSchema} (title,
 * overview, file ids) would be dead weight.
 *
 * `state` is **required** here, unlike on `EpisodeSchema`: an entry only
 * exists because something worked the state out, so there is no
 * pre-resolution window to allow for.
 */
export const EpisodeStateEntrySchema = z.object({
  /** Sonarr's episode id - the same key as `EpisodeSchema.id`. */
  episodeId: z.number().int().positive(),
  queueSnapshot: DownloadQueueSnapshotSchema.optional(),
  /** `.min(0)` - Sonarr numbers specials as season 0. */
  seasonNumber: z.number().int().min(0),
  state: MediaStateSchema,
})
