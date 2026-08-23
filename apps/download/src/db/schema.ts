// Phase 1: the `jobs` table — durable system-of-record for every download
// job, replacing the in-memory-only `DownloadStateService.jobs` Map.
//
// Column-naming convention this file follows (NOT identical across the
// monorepo — apps/swole/src/db/schema.ts omits the redundant string arg on
// a single-word property; apps/auth/src/db/schema.ts passes it explicitly
// even for those. This file follows auth's side of that split):
//   - camelCase TS property names; every column gets an explicit snake_case
//     string column name, including single-word ones (e.g. `url: text('url')`)
//     — so `jobs.id`'s explicit name is this file's norm, not a deviation.
//     See the `id` column's own comment for why it's TEXT rather than this
//     file's usual autoincrement integer.
//   - No global `casing` option is configured anywhere in this monorepo's
//     drizzle configs — naming is manual, per column, every time.
//   - Primary keys: `integer({ mode: 'number' }).primaryKey({ autoIncrement: true })`
//     by default, always named `id`.
//   - Foreign keys: `.references(() => otherTable.id, { onDelete: 'restrict' })`.
//   - Timestamps: `integer('col_name', { mode: 'timestamp_ms' })`, defaulted
//     via `.$defaultFn(() => new Date())` — never a SQL-side default.
//   - JSON columns: `text({ mode: 'json' }).$type<T>()`.
import type {
  DownloadJobStatus,
  DownloadType,
  TimeRange,
} from '@lilnas/utils/download/types'
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const DOWNLOAD_TYPES = ['movie', 'show', 'video'] as const

export const DOWNLOAD_JOB_STATUSES = [
  'cancelled',
  'cancelling',
  'cleaning',
  'completed',
  'converting',
  'downloading',
  'failed',
  'importing',
  'pending',
  'requested',
  'searching',
  'uploading',
] as const

// Not mirrored by any pre-existing shared TS enum (unlike the two tuples
// above) — this distinction is new in Phase 1, so there's nothing external
// to drift out of sync with. See `resolveForwardedUser`/`getForwardedUser`
// (`src/auth/forwarded-user.ts`) for where a request lands in one bucket or
// the other.
export const JOB_ORIGINS = ['service', 'web'] as const

// Compile-time-only guard that the two SQL enum tuples above never silently
// drift from the shared TS enums they mirror (`DownloadType`/
// `DownloadJobStatus` in `@lilnas/utils/download/types`). `import type` is
// fully erased, so this carries no runtime cost and pulls nothing (not
// `child_process`, not `zod`) into drizzle-kit's bundle of this file.
type AssertSameUnion<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never

export const typePin: AssertSameUnion<
  (typeof DOWNLOAD_TYPES)[number],
  `${DownloadType}`
> = true

export const statusPin: AssertSameUnion<
  (typeof DOWNLOAD_JOB_STATUSES)[number],
  `${DownloadJobStatus}`
> = true

export const jobs = sqliteTable(
  'jobs',
  {
    // TEXT PK, deviating from the convention comment's autoincrement-integer
    // default: job IDs are nanoid() strings minted by the app before the row
    // exists (download.service.ts, media-download.service.ts) and are the
    // public route param. Precedent: apps/auth/src/db/schema.ts uses
    // text('id').primaryKey() for its externally-generated user/session ids
    // and integer().primaryKey() only for rows it mints itself.
    id: text('id').primaryKey(),
    type: text({ enum: DOWNLOAD_TYPES }).notNull(),
    status: text({ enum: DOWNLOAD_JOB_STATUSES }).notNull(),

    // Attribution. Null = a service caller with no forwarded identity
    // (apps/tdr-bot). NEVER nulled to implement hiding — hiding is a
    // presentation filter applied at serialization
    // (src/download/attribution.ts), the truth stays here.
    requesterEmail: text('requester_email'),
    requesterUserId: text('requester_user_id'),
    origin: text({ enum: JOB_ORIGINS }).notNull(),
    hiddenAttribution: integer('hidden_attribution', { mode: 'boolean' })
      .notNull()
      .default(false),

    error: text('error'),

    // The derived media key (`tmdb:438631` / `tvdb:121361` / `video:<id>`,
    // see `media-id.ts`). Deliberately **not** a foreign key: it points at
    // `videos` for a third of rows and at TMDB/TVDB for the rest, and
    // SQLite FKs can't be conditional on another column. Referential
    // integrity for the `video:` case rests on `videos.repo.ts`'s
    // `upsertVideoByNaturalKey` being the only writer of `videos`, plus the
    // `jobs_media_id_matches_type` CHECK below.
    mediaId: text('media_id').notNull(),

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  t => [
    index('jobs_status_idx').on(t.status),
    index('jobs_requester_email_idx').on(t.requesterEmail),
    index('jobs_created_at_idx').on(t.createdAt),
    // Every Phase 2 list endpoint shares the identical
    // `ORDER BY created_at DESC, id DESC` (see jobs.repo.ts's cursor
    // predicate) - this composite index turns that into a bare ordered
    // index scan instead of a full table scan plus a temp b-tree sort.
    // `jobs_created_at_idx` above stays for query shapes that only ever
    // filter/sort on `created_at` alone.
    index('jobs_created_at_id_idx').on(t.createdAt, t.id),
    // The gallery's `GROUP BY (type, media_id)` (plan §3.2).
    index('jobs_type_media_id_idx').on(t.type, t.mediaId),
    // Ties `origin` to the requester columns' nullability so the two can't
    // drift apart at the DB layer - `origin` is otherwise a write-only
    // derived column (see download-state.service.ts's buildJobRow()) with
    // nothing else enforcing the pairing.
    check(
      'jobs_origin_matches_requester',
      sql`(
        (${t.origin} = 'web'     AND ${t.requesterEmail} IS NOT NULL AND ${t.requesterUserId} IS NOT NULL) OR
        (${t.origin} = 'service' AND ${t.requesterEmail} IS NULL     AND ${t.requesterUserId} IS NULL)
      )`,
    ),
    // Ties `media_id`'s prefix to `type`, the DB-level expression of the
    // same invariant `mediaId()` (media-id.ts) enforces in code. `IS NULL`
    // stays part of the expression even though the column is `.notNull()` -
    // harmless once the column can never be null, and it means this CHECK
    // didn't have to change shape between Phase 3 (nullable) and Phase 7
    // (`.notNull()`).
    check(
      'jobs_media_id_matches_type',
      sql`(
        ${t.mediaId} IS NULL OR
        (${t.type} = 'movie' AND ${t.mediaId} LIKE 'tmdb:%') OR
        (${t.type} = 'show'  AND ${t.mediaId} LIKE 'tvdb:%') OR
        (${t.type} = 'video' AND ${t.mediaId} LIKE 'video:%')
      )`,
    ),
  ],
)

export type JobRow = typeof jobs.$inferSelect

// Phase 3: the only media type nothing upstream (Radarr/Sonarr) tracks -
// movies and shows are always derived from a live lookup (plan §"What
// 'derived' means"). A nanoid PK (rather than the natural key itself) keeps
// `/media/video:V1StGXR8_Z5` a sane URL, while `videos_natural_key_idx`
// still gives dedupe on re-request.
export const videos = sqliteTable(
  'videos',
  {
    id: text('id').primaryKey(),
    // The dedupe key - `{sourceUrl}#{start}-{end}`, computed by
    // `videoNaturalKey()` (media-id.ts) and nowhere else. A clip is a
    // distinct video from its full-length download, so the range is part
    // of the key.
    naturalKey: text('natural_key').notNull(),
    sourceUrl: text('source_url').notNull(),
    timeRange: text('time_range', { mode: 'json' }).$type<TimeRange>(),
    // NOT NULL, seeded from the source URL at request time and overwritten
    // the moment yt-dlp reports the real one - so no UI surface needs a
    // `?? sourceUrl` fallback.
    title: text('title').notNull(),
    overview: text('overview'),
    posterUrl: text('poster_url'),
    runtime: integer('runtime'),
    downloadUrls: text('download_urls', { mode: 'json' }).$type<string[]>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  t => [uniqueIndex('videos_natural_key_idx').on(t.naturalKey)],
)

export type VideoRow = typeof videos.$inferSelect

// Phase 3: releases a user marked as bad, so the app stops picking them.
// Enforcement is app-side only (`MediaDownloadService.requestMovie`/
// `requestShow` branch here before choosing a release) - Radarr's and
// Sonarr's own selection logic is untouched, so a search started from their
// UI can still re-pick a flagged release. That's the spec's accepted gap,
// not an oversight.
export const badFiles = sqliteTable(
  'bad_files',
  {
    // Autoincrement integer, this file's default PK - unlike `jobs.id` and
    // `videos.id`, nothing outside the DB mints a flag id or routes on it.
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    // `mediaType`, not `jobs`' bare `type` - this row is about a *release*,
    // so an unqualified `type` here would read as the release's own kind.
    // Same `DOWNLOAD_TYPES` tuple either way.
    mediaType: text('media_type', { enum: DOWNLOAD_TYPES }).notNull(),
    // Same non-FK reasoning as `jobs.media_id`, and deliberately the same
    // column shape so the two join cleanly - see that column's comment.
    // Videos have no releases at all, so in practice this is only ever a
    // `tmdb:`/`tvdb:` key; the CHECK below is what says so.
    mediaId: text('media_id').notNull(),
    // The indexer's stable id for the release - the thing actually matched
    // against when annotating and filtering, and the other half of the
    // unique index that makes re-flagging idempotent.
    releaseGuid: text('release_guid').notNull(),
    // Nullable: the flag is keyed on the guid alone, and a client that only
    // has the guid to hand can still file one.
    indexerId: integer('indexer_id'),
    // Denormalized copies of what the user was looking at when they
    // flagged, kept so an old flag stays readable after the release ages
    // out of the indexer and can no longer be looked up.
    releaseTitle: text('release_title'),
    reason: text('reason'),
    // Who flagged it. NOT NULL on both, unlike `jobs`' nullable requester
    // columns: flagging is gated behind ForwardedUserGuard precisely
    // because a flag records a judgement someone made.
    flaggedByEmail: text('flagged_by_email').notNull(),
    flaggedByUserId: text('flagged_by_user_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  t => [
    // Makes `insertBadFile` idempotent via insert-or-ignore rather than a
    // read-then-write race (bad-files.repo.ts).
    uniqueIndex('bad_files_media_id_release_guid_idx').on(
      t.mediaId,
      t.releaseGuid,
    ),
    // The annotate/filter read path is always "every flag for this one
    // media id" - see `listBadFilesByMediaId`.
    index('bad_files_media_id_idx').on(t.mediaId),
    // The same prefix invariant `jobs_media_id_matches_type` enforces,
    // minus the `video` arm: a video has no indexer releases to flag.
    check(
      'bad_files_media_id_matches_type',
      sql`(
        (${t.mediaType} = 'movie' AND ${t.mediaId} LIKE 'tmdb:%') OR
        (${t.mediaType} = 'show'  AND ${t.mediaId} LIKE 'tvdb:%')
      )`,
    ),
  ],
)

export type BadFileRow = typeof badFiles.$inferSelect
