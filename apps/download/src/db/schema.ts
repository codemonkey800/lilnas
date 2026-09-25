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
  // Plan 020. Same story as the two below - no migration, the enum is
  // TypeScript-only. Unlike them, this one is *meant* to outlive the
  // process: it describes Radarr/Sonarr's queue row, not anything this
  // process holds (see reconcile-interrupted-jobs.ts).
  'needs_attention',
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
// above) — this distinction was new in Phase 1, so there was nothing
// external to drift out of sync with. See `resolveForwardedUser`/
// `getForwardedUser` (`src/auth/forwarded-user.ts`) for where a request lands
// in the first two buckets, and `getDiscordRequester`
// (`src/auth/discord-user.ts`) for the third.
//
// ⚠️ No `AssertSameUnion` pin guards this tuple, unlike `DOWNLOAD_TYPES` /
// `DOWNLOAD_JOB_STATUSES` / the audit tuples below: origins have no shared TS
// enum to pin against. They do, however, have a *wire* counterpart -
// `AuditLogEntrySchema.origin` in `@lilnas/utils/download/schema` is an
// inline `z.enum(['service', 'web', 'discord'])`. That literal and this tuple
// must stay identical, and nothing but this comment says so; a zod value
// import here is not an option (drizzle-kit bundles this file - see the
// `audit_log` banner comment below for the full reasoning).
export const JOB_ORIGINS = ['service', 'web', 'discord'] as const

// Plan 022: `jobs.origin`'s own tuple - `JOB_ORIGINS` plus `upstream`, a
// movie/show job adopted from a download someone started in Radarr's or
// Sonarr's own UI (`DownloadJobRecord.startedUpstream`). Kept separate rather
// than widening `JOB_ORIGINS` because that tuple is shared with
// `audit_log.origin` and mirrored by `AuditLogEntrySchema.origin`: an audit
// actor is a person or a service caller acting on this app, never Radarr.
// `service` is not reused either - it means tdr-bot or an unauthenticated
// caller, which is a different answer to "who started this".
export const JOB_ROW_ORIGINS = [...JOB_ORIGINS, 'upstream'] as const

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
    // (apps/tdr-bot), or a job adopted from Radarr/Sonarr (`origin`
    // `upstream`). NEVER nulled to implement hiding — hiding is a
    // presentation filter applied at serialization
    // (src/download/attribution.ts), the truth stays here.
    requesterEmail: text('requester_email'),
    requesterUserId: text('requester_user_id'),

    // Phase 018: who submitted this job over `apps/tdr-bot`'s `/download`
    // command. Populated *instead of* the two requester columns above, never
    // alongside them - a Discord submission reaches this service as a
    // tdr-bot service call carrying `x-discord-user-id`/`x-discord-username`,
    // with no `X-Forwarded-User` to resolve. `jobs_origin_matches_requester`
    // below is what makes that mutual exclusion a DB-level invariant.
    //
    // TEXT, not INTEGER, for `discord_user_id`: a snowflake exceeds
    // `Number.MAX_SAFE_INTEGER`, so an integer column would hand JS back a
    // rounded id. `discord_username` is the post-2023 handle, never the
    // display name - that rides the optional `x-discord-display-name` header
    // and deliberately never reaches a row here (see
    // `DiscordRequesterSchema`).
    //
    // The *linked* Discord account (`DownloadJob.linkedDiscord`) has no
    // columns here on purpose: that link is owned by `apps/auth` and resolved
    // at read time, so persisting a copy would just be a second cache with
    // its own staleness.
    discordUserId: text('discord_user_id'),
    discordUsername: text('discord_username'),

    origin: text({ enum: JOB_ROW_ORIGINS }).notNull(),
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
    // The Discord-side counterpart of `jobs_requester_email_idx`: "everything
    // this Discord account asked for" is the same lookup, keyed on the only
    // stable handle a Discord submission carries (the username is renameable,
    // the snowflake is not).
    index('jobs_discord_user_id_idx').on(t.discordUserId),
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
    // Ties `origin` to the attribution columns' nullability so the three
    // can't drift apart at the DB layer - `origin` is otherwise a write-only
    // derived column (see `buildJobRow()` in job-row.ts, the only place it is
    // derived) with nothing else enforcing the pairing.
    //
    // Each arm pins *both* halves: the columns that must be set and the ones
    // that must not. Without the negative half a `web` row could also carry a
    // Discord pair, which would make `origin` decorative rather than
    // authoritative and leave every consumer guessing which attribution to
    // render.
    //
    // Plan 022 added the `upstream` arm, the same all-NULL shape as
    // `service`: Radarr/Sonarr started the download, so there is no person to
    // record. The two arms differ only in what `origin` says about it, which
    // is exactly why `upstream` needed its own value. `audit_log`'s mirror
    // CHECK has no such arm - see `JOB_ROW_ORIGINS`.
    check(
      'jobs_origin_matches_requester',
      sql`(
        (${t.origin} = 'web'      AND ${t.requesterEmail} IS NOT NULL AND ${t.requesterUserId} IS NOT NULL
                                  AND ${t.discordUserId} IS NULL      AND ${t.discordUsername} IS NULL) OR
        (${t.origin} = 'discord'  AND ${t.discordUserId} IS NOT NULL  AND ${t.discordUsername} IS NOT NULL
                                  AND ${t.requesterEmail} IS NULL     AND ${t.requesterUserId} IS NULL) OR
        (${t.origin} = 'service'  AND ${t.requesterEmail} IS NULL     AND ${t.requesterUserId} IS NULL
                                  AND ${t.discordUserId} IS NULL      AND ${t.discordUsername} IS NULL) OR
        (${t.origin} = 'upstream' AND ${t.requesterEmail} IS NULL     AND ${t.requesterUserId} IS NULL
                                  AND ${t.discordUserId} IS NULL      AND ${t.discordUsername} IS NULL)
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
  'file.unflag_bad',
  'ytdlp.check_update',
  'media.manual_import',
  'media.discard_download',
  'movie.cancel',
  'show.cancel',
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
    // Same `service`/`web`/`discord` split - and the same meaning - as
    // `jobs.origin`, reusing that tuple rather than a parallel one (minus
    // `jobs`' `upstream`, which no audit actor can be): a null
    // actor on a `web` row would mean a browser request arrived without
    // `X-Forwarded-User`, which is a bug, not a shape the log should be able
    // to record.
    origin: text({ enum: JOB_ORIGINS }).notNull(),
    // Nullable, unlike `bad_files`' NOT NULL flagger columns: a service
    // caller (tdr-bot, the yt-dlp update poller) has no forwarded identity,
    // and those actions still belong in the log. The CHECK below is what
    // ties the nullability back to `origin`.
    actorEmail: text('actor_email'),
    actorUserId: text('actor_user_id'),
    // Phase 018, the exact counterpart of `jobs.discord_user_id`/
    // `jobs.discord_username` - same TEXT-for-a-snowflake reasoning, same
    // handle-not-display-name rule, same mutual exclusion with the two
    // columns above. Prefixed `actor_` to match this table's half of the
    // naming rather than `jobs`': everything here is "who did it".
    actorDiscordUserId: text('actor_discord_user_id'),
    actorDiscordUsername: text('actor_discord_username'),
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
    // The Discord-side counterpart of `audit_log_actor_email_idx`, mirroring
    // `jobs_discord_user_id_idx` for the same "everything this account did"
    // lookup.
    index('audit_log_actor_discord_user_id_idx').on(t.actorDiscordUserId),
    // The exact shape of `jobs_origin_matches_requester`, for the exact same
    // reason: `origin` is a derived, write-only column, so without this the
    // three halves of "who did it" could drift apart at the DB layer. Each
    // arm pins the columns that must be NULL as well as the ones that must
    // not - see that CHECK's comment for why the negative half matters.
    check(
      'audit_log_origin_matches_actor',
      sql`(
        (${t.origin} = 'web'     AND ${t.actorEmail} IS NOT NULL         AND ${t.actorUserId} IS NOT NULL
                                 AND ${t.actorDiscordUserId} IS NULL     AND ${t.actorDiscordUsername} IS NULL) OR
        (${t.origin} = 'discord' AND ${t.actorDiscordUserId} IS NOT NULL AND ${t.actorDiscordUsername} IS NOT NULL
                                 AND ${t.actorEmail} IS NULL             AND ${t.actorUserId} IS NULL) OR
        (${t.origin} = 'service' AND ${t.actorEmail} IS NULL             AND ${t.actorUserId} IS NULL
                                 AND ${t.actorDiscordUserId} IS NULL     AND ${t.actorDiscordUsername} IS NULL)
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

// The durable answer to "which indexer release produced this file on disk".
// Radarr and Sonarr both remember the guid of every release they grabbed, but
// only as a history event - nothing on the file record itself points back at
// it, so recovering the link means walking history and matching an event to a
// file. That walk returns the same answer every time, so it runs once and
// lands here rather than on every page view. A cache, in other words: every
// row is reconstructible from upstream, and losing one costs a re-resolve.
export const mediaFileReleases = sqliteTable(
  'media_file_releases',
  {
    // Autoincrement integer, this file's default PK - same reasoning as
    // `bad_files.id`: nothing outside the DB mints one or routes on it.
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    // `mediaType`/`mediaId` in exactly the shapes `bad_files` uses (same
    // tuple, same non-FK reasoning, same naming) so the two join cleanly -
    // see those columns' comments.
    mediaType: text('media_type', { enum: DOWNLOAD_TYPES }).notNull(),
    mediaId: text('media_id').notNull(),
    // Radarr's `movieFile.id` or Sonarr's `episodeFileId` - the upstream file
    // this release produced. Deliberately not unique on its own: the two
    // services number their files independently, so Radarr's file 42 and
    // Sonarr's file 42 are different files that happen to share an integer.
    // `mediaType` is what tells them apart, which is why it's half of the
    // unique index below rather than decoration on it.
    upstreamFileId: integer('upstream_file_id').notNull(),
    // Sonarr's episode id. NULL for movies - Radarr tracks one file per movie
    // and offers no finer-grained handle, so there is nothing to record. The
    // `media_file_releases_episode_only_for_shows` CHECK is what says so.
    episodeId: integer('episode_id'),
    // The indexer's stable id for the release - the same key `bad_files`
    // flags on, which is what lets a file on disk be matched against the
    // flag list without another upstream round-trip.
    releaseGuid: text('release_guid').notNull(),
    // Everything from here to `releaseGroup` is a denormalized copy of what
    // the grab recorded, kept for the same reason `bad_files` keeps its
    // copies: the row has to stay readable after the release ages out of the
    // indexer and can no longer be looked up. All nullable - upstream history
    // events vary in how much detail they carry, and a missing field is never
    // a reason to drop the guid-to-file link on the floor.
    indexerId: integer('indexer_id'),
    indexer: text('indexer'),
    releaseTitle: text('release_title'),
    // The download client's id for the grab - the link the resolver actually
    // followed to get from a history event to this file.
    downloadId: text('download_id'),
    protocol: text('protocol'),
    publishDate: integer('publish_date', { mode: 'timestamp_ms' }),
    size: integer('size'),
    releaseGroup: text('release_group'),
    // When the join was computed, not when the release was grabbed or
    // published (`publishDate` above is the latter) - this row is a cache
    // entry and this is its age.
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  t => [
    // One release per file, which is what makes the resolver idempotent: it
    // can insert-or-replace rather than read-then-write. Keyed on the pair,
    // not on `upstream_file_id` alone, because that id collides across
    // Radarr and Sonarr - see the column's comment.
    uniqueIndex('media_file_releases_type_file_idx').on(
      t.mediaType,
      t.upstreamFileId,
    ),
    // The read path is always "every resolved release for this one media
    // id", the same shape `bad_files_media_id_idx` serves - a detail page
    // asking about all of a series' files at once.
    index('media_file_releases_media_id_idx').on(t.mediaId),
    // The same prefix invariant `bad_files_media_id_matches_type` enforces,
    // and no `video` arm for the same reason: a video has no indexer release
    // behind it, so a `video` row here would be a bug in whatever wrote it.
    check(
      'media_file_releases_media_id_matches_type',
      sql`(
        (${t.mediaType} = 'movie' AND ${t.mediaId} LIKE 'tmdb:%') OR
        (${t.mediaType} = 'show'  AND ${t.mediaId} LIKE 'tvdb:%')
      )`,
    ),
    // An episode id only means anything for a series - the same class of
    // invariant `jobs_scope_only_for_shows` pins one table over, expressed
    // the same way.
    check(
      'media_file_releases_episode_only_for_shows',
      sql`(${t.episodeId} IS NULL OR ${t.mediaType} = 'show')`,
    ),
  ],
)

export type MediaFileReleaseRow = typeof mediaFileReleases.$inferSelect
