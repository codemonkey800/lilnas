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
  DownloadQueueSnapshot,
  DownloadType,
} from '@lilnas/utils/download/types'
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
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

    url: text('url').notNull(),
    title: text('title'),
    description: text('description'),
    error: text('error'),

    // Movie/show source metadata — currently re-fetched from Radarr/Sonarr on
    // every request and discarded; persisting it is a spec requirement.
    mediaTitle: text('media_title'),
    posterUrl: text('poster_url'),
    overview: text('overview'),
    radarrId: integer('radarr_id'),
    sonarrId: integer('sonarr_id'),
    queueSnapshot: text('queue_snapshot', {
      mode: 'json',
    }).$type<DownloadQueueSnapshot>(),

    // File locations
    timeRange: text('time_range', {
      mode: 'json',
    }).$type<{ start: string; end: string }>(),
    downloadUrls: text('download_urls', { mode: 'json' }).$type<string[]>(),
    // Phase 6's Emby-match path. Column added now so Phase 6 needs no second
    // migration; nothing populates it in Phase 1.
    filePath: text('file_path'),

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
  ],
)

export type JobRow = typeof jobs.$inferSelect
