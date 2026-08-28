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
  AuditAction,
  AuditTargetType,
  DownloadJobStatus,
  DownloadType,
  ShowScope,
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
  // Phase 5. No migration accompanies these two: `status` is a bare
  // `text NOT NULL` column with no CHECK constraint behind it (the enum
  // lives only in drizzle's TS types), so widening the tuple emits no SQL.
  'paused',
  'pausing',
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

// Compile-time-only guard that the SQL enum tuples in this file never
// silently drift from the shared TS enums they mirror (`DownloadType`/
// `DownloadJobStatus` in `@lilnas/utils/download/types`, plus Phase 8's
// audit tuples at the bottom of the file). `import type` is fully erased, so
// this carries no runtime cost and pulls nothing (not `child_process`, not
// `zod`) into drizzle-kit's bundle of this file.
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

    // Phase 4: which part of a series this job was created for. NULL = the
    // whole series, which is what every pre-Phase-4 row means, so there is
    // nothing to backfill.
    //
    // One nullable JSON column rather than three integer ones: nothing
    // filters or sorts on a season or an episode (the poller reads the scope
    // off a job it already has in hand), so three indexed columns would buy
    // nothing and cost three migrations' worth of surface. Same
    // `text({ mode: 'json' })` convention `videos.timeRange` follows.
    scope: text('scope', { mode: 'json' }).$type<ShowScope>(),

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
    // A season/episode scope only means anything for a series. Radarr tracks
    // one file per movie and a video has no upstream structure at all, so a
    // scope on either is a bug in whatever wrote the row - the same class of
    // invariant `jobs_media_id_matches_type` above pins.
    check(
      'jobs_scope_only_for_shows',
      sql`(${t.scope} IS NULL OR ${t.type} = 'show')`,
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

// Phase 8: the admin audit log. Spelled out here rather than imported from
// `@lilnas/utils/download/schema` because drizzle-kit *bundles* this file to
// generate migrations, and that module is a `zod` entry point - a value
// import would drag zod (and everything else reachable from it) into the
// bundle. The `auditActionPin`/`auditTargetTypePin` guards below are what
// keep these copies honest: they fail `type-check` the moment the shared
// tuples gain, lose, or reorder a member, so the duplication can't rot.
export const AUDIT_ACTIONS_LOCAL = [
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
  'ytdlp.check_update',
] as const

export const AUDIT_TARGET_TYPES_LOCAL = ['job', 'media'] as const

export const auditActionPin: AssertSameUnion<
  (typeof AUDIT_ACTIONS_LOCAL)[number],
  AuditAction
> = true

export const auditTargetTypePin: AssertSameUnion<
  (typeof AUDIT_TARGET_TYPES_LOCAL)[number],
  AuditTargetType
> = true

// Append-only: nothing updates or deletes an audit row, which is what makes
// `bad_files` (not `jobs`) the closest structural analogue - an autoincrement
// integer PK nothing outside the DB mints, and denormalized actor columns
// rather than a FK to a users table this service doesn't own.
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    // Same `service`/`web` split - and the same meaning - as `jobs.origin`,
    // reusing that tuple rather than a parallel one: a null actor on a `web`
    // row would mean a browser request arrived without `X-Forwarded-User`,
    // which is a bug, not a shape the log should be able to record.
    origin: text({ enum: JOB_ORIGINS }).notNull(),
    // Nullable, unlike `bad_files`' NOT NULL flagger columns: a service
    // caller (tdr-bot, the yt-dlp update poller) has no forwarded identity,
    // and those actions still belong in the log. The CHECK below is what
    // ties the nullability back to `origin`.
    actorEmail: text('actor_email'),
    actorUserId: text('actor_user_id'),
    action: text({ enum: AUDIT_ACTIONS_LOCAL }).notNull(),
    // Null together: `ytdlp.check_update` acts on nothing addressable.
    // `targetId` is a `jobs.id` when `targetType` is `'job'` and a
    // `mediaId()` key when it's `'media'` - deliberately not a FK, for the
    // same reason `jobs.media_id` isn't one (see that column's comment), plus
    // the stronger one that an audit row must outlive whatever it describes.
    targetType: text('target_type', { enum: AUDIT_TARGET_TYPES_LOCAL }),
    targetId: text('target_id'),
    // Per-action detail, rendered as key/value pairs and never branched on -
    // so `Record<string, unknown>` rather than a discriminated union keyed on
    // `action`. Same `text({ mode: 'json' })` convention as `jobs.scope`.
    metadata: text('metadata', { mode: 'json' }).$type<
      Record<string, unknown>
    >(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  t => [
    // The cursor index, mirroring `jobs_created_at_id_idx`: the audit list
    // endpoint shares the identical `ORDER BY created_at DESC, id DESC`
    // keyset pagination, so this turns it into a bare ordered index scan
    // instead of a full scan plus a temp b-tree sort.
    index('audit_log_created_at_id_idx').on(t.createdAt, t.id),
    // The two filter facets the admin UI exposes.
    index('audit_log_actor_email_idx').on(t.actorEmail),
    index('audit_log_action_idx').on(t.action),
    // The exact shape of `jobs_origin_matches_requester`, for the exact same
    // reason: `origin` is a derived, write-only column, so without this the
    // two halves of "who did it" could drift apart at the DB layer.
    check(
      'audit_log_origin_matches_actor',
      sql`(
        (${t.origin} = 'web'     AND ${t.actorEmail} IS NOT NULL AND ${t.actorUserId} IS NOT NULL) OR
        (${t.origin} = 'service' AND ${t.actorEmail} IS NULL     AND ${t.actorUserId} IS NULL)
      )`,
    ),
    // A target type with no id (or an id with no type) is a half-written row:
    // it would render as a link to nowhere and drop out of any target filter.
    check(
      'audit_log_target_pair',
      sql`(
        (${t.targetType} IS NULL     AND ${t.targetId} IS NULL) OR
        (${t.targetType} IS NOT NULL AND ${t.targetId} IS NOT NULL)
      )`,
    ),
  ],
)

export type AuditLogRow = typeof auditLog.$inferSelect
