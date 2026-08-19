import { z } from 'zod'

export const TIME_REGEX = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/

export const CreateDownloadJobInputSchema = z.object({
  // Deliberately `.optional()` with NO `.default(false)`: this schema is
  // consumed via `z.infer<>` (the *output* type) for
  // `CreateDownloadJobInput`, and a `.default(false)` would make the field
  // required on that inferred type — breaking tdr-bot's existing
  // `createVideoJob({ url, timeRange })` call at compile time. Default to
  // `false` at the job-construction site instead
  // (`DownloadService.createVideoDownloadJob`).
  hiddenAttribution: z.boolean().optional(),

  timeRange: z
    .object({
      start: z.string().regex(TIME_REGEX),
      end: z.string().regex(TIME_REGEX),
    })
    .optional(),

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
function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .preprocess(csvRaw, z.array(z.enum(values)))
    .transform(parsed => (parsed.length > 0 ? parsed : undefined))
    .optional()
}

const DOWNLOAD_TYPE_VALUES = ['movie', 'show', 'video'] as const

type AssertSameUnion<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never

// Compile-time-only guard that this tuple never silently drifts from
// `DownloadType` in `./types` - this file must not import *from* `./types`
// (types.ts already imports the schemas above out of this one, and a
// second import back would make it a two-way module dependency), so the
// pin uses an inline `import('./types').DownloadType` type reference
// instead of a top-level `import type` statement. Inline type-only imports
// like this are fully erased and never become a real module edge.
export const downloadTypeValuesPin: AssertSameUnion<
  (typeof DOWNLOAD_TYPE_VALUES)[number],
  `${import('./types').DownloadType}`
> = true

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
  type: csvEnum(DOWNLOAD_TYPE_VALUES),
})

export const GalleryQuerySchema = z
  .object({
    cursor: z.string().optional(),
    from: z.iso.date().transform(startOfDayUtc).optional(),
    limit: LimitSchema,
    requester: z.string().min(1).optional(),
    to: z.iso.date().transform(endOfDayUtc).optional(),
    type: csvEnum(DOWNLOAD_TYPE_VALUES),
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
