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
 * A snapshot of a movie/show job's last-known Radarr/Sonarr queue entry.
 * The queue poller keeps one of these per tracked job and diffs it against
 * the latest queue response each tick, only emitting an update when
 * something has changed.
 */
export const DownloadQueueSnapshotSchema = z.object({
  progress: z.number().optional(),
  status: z.string().optional(),
  timeLeft: z.string().optional(),
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

export const RequestShowInputSchema = z.object({
  tvdbId: z.number().int().positive(),
})

// ---- The Media hierarchy ----

export const MediaBaseSchema = z.object({
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

export const ManagedMediaBaseSchema = MediaBaseSchema.extend({
  filePath: z.string().optional(),
  queueSnapshot: DownloadQueueSnapshotSchema.optional(),
})

export const MovieSchema = ManagedMediaBaseSchema.extend({
  radarrId: z.number().int().positive().optional(),
  tmdbId: z.number().int().positive(),
  type: z.literal(DownloadType.Movie),
})

export const ShowSchema = ManagedMediaBaseSchema.extend({
  sonarrId: z.number().int().positive().optional(),
  tvdbId: z.number().int().positive(),
  type: z.literal(DownloadType.Show),
})

export const MediaSchema = z.discriminatedUnion('type', [
  MovieSchema,
  ShowSchema,
  VideoSchema,
])

export const DownloadJobSchema = z.object({
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  error: z.string().optional(),
  hiddenAttribution: z.boolean(),
  id: z.string(),
  media: MediaSchema,
  requester: JobRequesterSchema.nullable(),
  status: z.enum(DownloadJobStatus),
  updatedAt: z.iso.datetime(),
})

export const GalleryItemSchema = z.object({
  downloadCount: z.number().int(),
  lastDownloadedAt: z.iso.datetime(),
  /** Masked per the attribution-oracle rules — see `attribution.ts`. */
  lastRequester: JobRequesterSchema.nullable(),
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
  // An inverted range (`from` after `to`) would otherwise just look like an
  // empty result set, indistinguishable from "no data in that window" - a
  // loud 400 is more honest than a silently misleading empty page.
  .refine(q => !q.from || !q.to || q.from <= q.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  })

export const GalleryFacetsQuerySchema = z
  .object({
    from: z.iso.date().transform(startOfDayUtc).optional(),
    to: z.iso.date().transform(endOfDayUtc).optional(),
  })
  .refine(q => !q.from || !q.to || q.from <= q.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  })

export const HistoryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: LimitSchema,
  requester: z.string().min(1).optional(),
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
