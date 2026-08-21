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
