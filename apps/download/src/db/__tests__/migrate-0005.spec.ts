import type BetterSqlite3 from 'better-sqlite3'

import { checkIntegrity } from 'src/db/migrate'
import { jobs } from 'src/db/schema'

import {
  openPartiallyMigratedDb,
  type PartiallyMigratedDb,
} from './helpers/partial-migrations'

/**
 * Migration 0005 (plan 022) widens `jobs_origin_matches_requester` with an
 * `upstream` arm - a job adopted from a download started in Radarr's or
 * Sonarr's own UI. SQLite cannot `ALTER` a CHECK, so it is the second `jobs`
 * recreate after 0002 (`CREATE TABLE __new_jobs` / `INSERT … SELECT` /
 * `DROP` / `RENAME`), and the same risk applies: it either copies every row
 * or silently loses the job log at boot. Unlike 0002 it is exactly what
 * drizzle-kit generated - no column was added, so the `SELECT` list is the
 * old table's own.
 *
 * Two starting shapes, because two real databases meet this migration:
 *
 * - **prod** was still on 0000 when 0005 was written (read-only check of a
 *   copy on 2026-09-24: 73 jobs, no Discord columns), so it applies 0001
 *   through 0005 in one boot;
 * - **dev** is on 0004.
 */

const CREATED_AT = Date.parse('2026-05-01T10:00:00.000Z')
const UPDATED_AT = Date.parse('2026-05-01T10:05:00.000Z')
const COMPLETED_AT = Date.parse('2026-05-01T10:09:00.000Z')

const SCOPE = JSON.stringify({
  episodeId: 7,
  episodeNumber: 5,
  seasonNumber: 3,
})

const PROD_TAG = '0000_soft_inertia'
const DEV_TAG = '0004_eminent_prodigy'

/**
 * Raw SQL against the column list both starting shapes share (0000 has no
 * Discord columns yet), rather than drizzle: the TS `jobs` table describes
 * the post-0005 shape, which neither database has yet. None of these rows
 * match 0004's library-sync `DELETE` - the service rows either are a video
 * or took time to finish.
 */
function seedJobs(sqlite: BetterSqlite3.Database): void {
  const insert = sqlite.prepare(
    `INSERT INTO jobs (id, type, status, requester_email, requester_user_id, origin, hidden_attribution, error, media_id, scope, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  insert.run(
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

  insert.run(
    'job-service-show',
    'show',
    'downloading',
    null,
    null,
    'service',
    0,
    'a transient error',
    'tvdb:121361',
    SCOPE,
    CREATED_AT,
    UPDATED_AT,
    null,
  )

  insert.run(
    'job-service-video',
    'video',
    'completed',
    null,
    null,
    'service',
    0,
    null,
    'video:v1',
    null,
    CREATED_AT,
    UPDATED_AT,
    COMPLETED_AT,
  )
}

/** Only the dev shape has the Discord columns to seed a Discord row into. */
function seedDiscordJob(sqlite: BetterSqlite3.Database): void {
  sqlite
    .prepare(
      `INSERT INTO jobs (id, type, status, discord_user_id, discord_username, origin, media_id, created_at, updated_at)
       VALUES ('job-discord', 'video', 'pending', '183948273649182736', 'jeremy', 'discord', 'video:v2', ?, ?)`,
    )
    .run(CREATED_AT, UPDATED_AT)
}

/** The seeded rows as they must come out of the recreate, byte for byte. */
const SEEDED_ROWS: Array<Record<string, unknown>> = [
  {
    completed_at: COMPLETED_AT,
    created_at: CREATED_AT,
    discord_user_id: null,
    discord_username: null,
    error: null,
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
  {
    completed_at: null,
    created_at: CREATED_AT,
    discord_user_id: null,
    discord_username: null,
    error: 'a transient error',
    hidden_attribution: 0,
    id: 'job-service-show',
    media_id: 'tvdb:121361',
    origin: 'service',
    requester_email: null,
    requester_user_id: null,
    // The JSON text exactly as written - the recreate copies it, it never
    // round-trips it through drizzle's JSON mode.
    scope: SCOPE,
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
    hidden_attribution: 0,
    id: 'job-service-video',
    media_id: 'video:v1',
    origin: 'service',
    requester_email: null,
    requester_user_id: null,
    scope: null,
    status: 'completed',
    type: 'video',
    updated_at: UPDATED_AT,
  },
]

const DISCORD_ROW: Record<string, unknown> = {
  completed_at: null,
  created_at: CREATED_AT,
  discord_user_id: '183948273649182736',
  discord_username: 'jeremy',
  error: null,
  hidden_attribution: 0,
  id: 'job-discord',
  media_id: 'video:v2',
  origin: 'discord',
  requester_email: null,
  requester_user_id: null,
  scope: null,
  status: 'pending',
  type: 'video',
  updated_at: UPDATED_AT,
}

/** In `jobRows()`'s `ORDER BY id`. */
function byId(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

function jobRows(
  sqlite: BetterSqlite3.Database,
): Array<Record<string, unknown>> {
  return sqlite.prepare(`SELECT * FROM jobs ORDER BY id`).all() as Array<
    Record<string, unknown>
  >
}

/** Opens a DB at `throughTag`, seeds it, and runs the real migrator on it. */
function migrateSeeded(throughTag: string): PartiallyMigratedDb {
  const handle = openPartiallyMigratedDb(throughTag)
  seedJobs(handle.sqlite)
  if (throughTag === DEV_TAG) seedDiscordJob(handle.sqlite)
  handle.migrateRest()
  return handle
}

function insertUpstreamJob(
  sqlite: BetterSqlite3.Database,
  id: string,
  requester: { email: string; userId: string } | null = null,
): void {
  sqlite
    .prepare(
      `INSERT INTO jobs (id, type, status, requester_email, requester_user_id, origin, media_id, created_at, updated_at)
       VALUES (?, 'movie', 'downloading', ?, ?, 'upstream', 'tmdb:27205', ?, ?)`,
    )
    .run(
      id,
      requester?.email ?? null,
      requester?.userId ?? null,
      CREATED_AT,
      UPDATED_AT,
    )
}

describe('migration 0005 (the jobs recreate for the `upstream` origin)', () => {
  it('rejects an `upstream` row before 0005 - the arm really is new', () => {
    const { close, sqlite } = openPartiallyMigratedDb(DEV_TAG)
    try {
      expect(() => insertUpstreamJob(sqlite, 'job-upstream')).toThrow(
        /CHECK constraint failed/,
      )
    } finally {
      close()
    }
  })

  describe.each([
    ['prod-shaped (0000 -> 0005 in one boot)', PROD_TAG, byId(SEEDED_ROWS)],
    ['dev-shaped (0004 -> 0005)', DEV_TAG, byId([DISCORD_ROW, ...SEEDED_ROWS])],
  ])('on a %s database', (_label, throughTag, expectedRows) => {
    it('preserves every pre-existing `jobs` row verbatim, scope JSON included', () => {
      const { close, sqlite } = migrateSeeded(throughTag)
      try {
        expect(jobRows(sqlite)).toEqual(expectedRows)
      } finally {
        close()
      }
    })

    // A recreate drops the old table and its indexes with it; re-creating
    // them is a separate run of statements at the bottom of the migration.
    it('re-creates every `jobs` index and leaves no `__new_jobs` behind', () => {
      const { close, sqlite } = migrateSeeded(throughTag)
      try {
        const names = (type: string) =>
          (
            sqlite
              .prepare(
                `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
              )
              .all(type) as Array<{ name: string }>
          )
            .map(row => row.name)
            .filter(name => name.startsWith('jobs') || name.startsWith('__new'))
            .sort()

        expect(names('index')).toEqual([
          'jobs_created_at_id_idx',
          'jobs_created_at_idx',
          'jobs_discord_user_id_idx',
          'jobs_requester_email_idx',
          'jobs_status_idx',
          'jobs_type_media_id_idx',
        ])
        expect(names('table')).toEqual(['jobs'])
      } finally {
        close()
      }
    })

    it('accepts an `upstream` row afterwards, and only with no requester', () => {
      const { close, sqlite } = migrateSeeded(throughTag)
      try {
        expect(() => insertUpstreamJob(sqlite, 'job-upstream')).not.toThrow()
        expect(() =>
          insertUpstreamJob(sqlite, 'job-upstream-web', {
            email: 'alice@example.com',
            userId: 'user_1',
          }),
        ).toThrow(/CHECK constraint failed/)
      } finally {
        close()
      }
    })

    it('leaves the database structurally sound, readable through the TS schema and foreign_keys ON', () => {
      const { close, db, sqlite } = migrateSeeded(throughTag)
      try {
        insertUpstreamJob(sqlite, 'job-upstream')

        expect(() => checkIntegrity(db)).not.toThrow()
        expect(sqlite.prepare(`PRAGMA foreign_key_check`).all()).toEqual([])
        // The recreate toggles `foreign_keys` off; `runMigrations()` is what
        // puts it back.
        expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
        expect(
          db
            .select()
            .from(jobs)
            .all()
            .map(row => row.origin),
        ).toContain('upstream')
      } finally {
        close()
      }
    })
  })
})
