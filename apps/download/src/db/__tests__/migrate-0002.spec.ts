import type BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { checkIntegrity } from 'src/db/migrate'
import * as schema from 'src/db/schema'

import { openPartiallyMigratedDb } from './helpers/partial-migrations'

/**
 * Migration 0002 is the first one in this package that **recreates** a table
 * rather than adding to it: SQLite cannot `ALTER` a CHECK, so widening
 * `jobs_origin_matches_requester` / `audit_log_origin_matches_actor` with the
 * `discord` arm forces drizzle-kit into the `CREATE TABLE __new_x` /
 * `INSERT … SELECT` / `DROP` / `RENAME` dance. That dance either preserves
 * every existing row or silently destroys the production job log, so it gets
 * its own spec rather than an assertion tacked onto `schema.spec.ts`.
 *
 * Every other DB spec builds a fresh `:memory:` database at the *current*
 * schema, which by construction can never exercise a migration's upgrade
 * path. This one instead:
 *
 *   1. migrates a real on-disk file up to 0001 **only** (a trimmed copy of
 *      the migrations folder, selected via `MIGRATIONS_FOLDER`),
 *   2. seeds it with the `web`/`service` rows a pre-018 production database
 *      actually contains, written through raw SQL against the *old* column
 *      list,
 *   3. runs the real migrator over the full folder, and
 *   4. asserts the rows came through byte-identical and the new shape is in
 *      force.
 */

const CREATED_AT = Date.parse('2026-05-01T10:00:00.000Z')
const UPDATED_AT = Date.parse('2026-05-01T10:05:00.000Z')
const COMPLETED_AT = Date.parse('2026-05-01T10:09:00.000Z')

/**
 * The pre-018 row shapes, written column-by-column rather than through
 * drizzle: the TS `jobs`/`auditLog` objects already carry the Discord
 * columns, so an insert through them would not compile against the 0001
 * schema this seeds into.
 */
function seedPre018Rows(sqlite: BetterSqlite3.Database): void {
  const insertJob = sqlite.prepare(
    `INSERT INTO jobs (id, type, status, requester_email, requester_user_id, origin, hidden_attribution, error, media_id, scope, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  insertJob.run(
    'job-web',
    'movie',
    'completed',
    'alice@example.com',
    'user_1',
    'web',
    1,
    null,
    'tmdb:438631',
    null,
    CREATED_AT,
    UPDATED_AT,
    COMPLETED_AT,
  )

  insertJob.run(
    'job-service',
    'show',
    'downloading',
    null,
    null,
    'service',
    0,
    'a transient error',
    'tvdb:121361',
    JSON.stringify({ episodeId: 7, episodeNumber: 5, seasonNumber: 3 }),
    CREATED_AT,
    UPDATED_AT,
    null,
  )

  const insertAudit = sqlite.prepare(
    `INSERT INTO audit_log (id, origin, actor_email, actor_user_id, action, target_type, target_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  insertAudit.run(
    1,
    'web',
    'alice@example.com',
    'user_1',
    'movie.request',
    'media',
    'tmdb:438631',
    JSON.stringify({ title: 'Inception' }),
    CREATED_AT,
  )

  insertAudit.run(
    2,
    'service',
    null,
    null,
    'ytdlp.check_update',
    null,
    null,
    null,
    UPDATED_AT,
  )
}

interface MigratedDb {
  sqlite: BetterSqlite3.Database
  close: () => void
}

/**
 * A real file-backed database migrated to 0001, seeded, then migrated the
 * rest of the way by the production `runMigrations()` - i.e. exactly what
 * happens at boot (`DbService`) the first time the new code meets an existing
 * `/data/download.db`.
 */
function migrateSeededDbThrough0002(): MigratedDb {
  const { close, migrateRest, sqlite } = openPartiallyMigratedDb(
    '0001_absent_outlaw_kid',
  )

  seedPre018Rows(sqlite)

  // The real folder - 0002 included.
  migrateRest()

  return { close, sqlite }
}

describe('migration 0002 (the jobs/audit_log table recreate)', () => {
  it('preserves every pre-existing `jobs` row verbatim and leaves the new Discord columns NULL', () => {
    const { sqlite, close } = migrateSeededDbThrough0002()
    try {
      const rows = sqlite
        .prepare(`SELECT * FROM jobs ORDER BY id`)
        .all() as Array<Record<string, unknown>>

      expect(rows).toEqual([
        {
          completed_at: null,
          created_at: CREATED_AT,
          discord_user_id: null,
          discord_username: null,
          error: 'a transient error',
          hidden_attribution: 0,
          id: 'job-service',
          media_id: 'tvdb:121361',
          origin: 'service',
          requester_email: null,
          requester_user_id: null,
          scope: JSON.stringify({
            episodeId: 7,
            episodeNumber: 5,
            seasonNumber: 3,
          }),
          status: 'downloading',
          type: 'show',
          updated_at: UPDATED_AT,
        },
        {
          completed_at: COMPLETED_AT,
          created_at: CREATED_AT,
          discord_user_id: null,
          discord_username: null,
          error: null,
          // Preserved as the integer 1, not coerced to a boolean or to
          // `hidden_attribution`'s `DEFAULT false` - the recreate copies the
          // stored value rather than re-applying column defaults.
          hidden_attribution: 1,
          id: 'job-web',
          media_id: 'tmdb:438631',
          origin: 'web',
          requester_email: 'alice@example.com',
          requester_user_id: 'user_1',
          scope: null,
          status: 'completed',
          type: 'movie',
          updated_at: UPDATED_AT,
        },
      ])
    } finally {
      close()
    }
  })

  it('preserves every pre-existing `audit_log` row verbatim, including its autoincrement ids', () => {
    const { sqlite, close } = migrateSeededDbThrough0002()
    try {
      const rows = sqlite
        .prepare(`SELECT * FROM audit_log ORDER BY id`)
        .all() as Array<Record<string, unknown>>

      expect(rows).toEqual([
        {
          action: 'movie.request',
          actor_discord_user_id: null,
          actor_discord_username: null,
          actor_email: 'alice@example.com',
          actor_user_id: 'user_1',
          created_at: CREATED_AT,
          id: 1,
          metadata: JSON.stringify({ title: 'Inception' }),
          origin: 'web',
          target_id: 'tmdb:438631',
          target_type: 'media',
        },
        {
          action: 'ytdlp.check_update',
          actor_discord_user_id: null,
          actor_discord_username: null,
          actor_email: null,
          actor_user_id: null,
          created_at: UPDATED_AT,
          id: 2,
          metadata: null,
          origin: 'service',
          target_id: null,
          target_type: null,
        },
      ])
    } finally {
      close()
    }
  })

  it('leaves the scratch `__new_*` tables behind on neither table', () => {
    const { sqlite, close } = migrateSeededDbThrough0002()
    try {
      const tableNames = (
        sqlite
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
          )
          .all() as Array<{ name: string }>
      )
        .map(row => row.name)
        .sort()

      expect(tableNames).toEqual([
        'audit_log',
        'bad_files',
        'jobs',
        'media_file_releases',
        'videos',
      ])
    } finally {
      close()
    }
  })

  // A recreate drops the old table, and dropping a table drops its indexes
  // with it. Re-creating them is a separate set of statements at the bottom
  // of the migration, which is exactly the kind of thing a hand-edit can
  // lose.
  it('re-creates every index on both recreated tables', () => {
    const { sqlite, close } = migrateSeededDbThrough0002()
    try {
      const indexesFor = (table: string) =>
        (
          sqlite
            .prepare(
              `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'`,
            )
            .all(table) as Array<{ name: string }>
        )
          .map(row => row.name)
          .sort()

      expect(indexesFor('jobs')).toEqual([
        'jobs_created_at_id_idx',
        'jobs_created_at_idx',
        'jobs_discord_user_id_idx',
        'jobs_requester_email_idx',
        'jobs_status_idx',
        'jobs_type_media_id_idx',
      ])
      expect(indexesFor('audit_log')).toEqual([
        'audit_log_action_idx',
        'audit_log_actor_discord_user_id_idx',
        'audit_log_actor_email_idx',
        'audit_log_created_at_id_idx',
      ])
    } finally {
      close()
    }
  })

  it('puts the widened CHECKs in force on the migrated database, not just on a fresh one', () => {
    const { sqlite, close } = migrateSeededDbThrough0002()
    try {
      // The new arm is accepted...
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO jobs (id, type, status, discord_user_id, discord_username, origin, media_id, created_at, updated_at)
             VALUES ('job-discord', 'video', 'pending', '183948273649182736', 'jeremy', 'discord', 'video:v1', ?, ?)`,
          )
          .run(CREATED_AT, UPDATED_AT),
      ).not.toThrow()

      // ...and the mutual exclusion it brought with it is enforced.
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO jobs (id, type, status, requester_email, requester_user_id, discord_user_id, discord_username, origin, media_id, created_at, updated_at)
             VALUES ('job-both', 'video', 'pending', 'alice@example.com', 'user_1', '183948273649182736', 'jeremy', 'web', 'video:v1', ?, ?)`,
          )
          .run(CREATED_AT, UPDATED_AT),
      ).toThrow(/CHECK constraint failed/)
    } finally {
      close()
    }
  })

  it('leaves the database structurally sound and foreign_keys back ON', () => {
    const { sqlite, close } = migrateSeededDbThrough0002()
    try {
      const db = drizzle(sqlite, { schema })
      expect(() => checkIntegrity(db)).not.toThrow()

      // The migration file toggles `foreign_keys` off for the recreate;
      // `runMigrations()` is what puts it back, and a silently-off
      // `foreign_keys` degrades every ON DELETE RESTRICT to a no-op.
      expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    } finally {
      close()
    }
  })
})
