import type BetterSqlite3 from 'better-sqlite3'

import { checkIntegrity } from 'src/db/migrate'
import { jobs } from 'src/db/schema'

import {
  openPartiallyMigratedDb,
  type PartiallyMigratedDb,
} from './helpers/partial-migrations'
import { createTestDb } from './test-utils'

/**
 * Migration 0007 (plan 024) is purely additive: four nullable columns on
 * `jobs` (`status_note` and the three `upstream_command_*`) plus two new
 * tables, `job_downloads` and `arr_history_cursors`. Unlike 0002/0005 it is
 * **not** a `jobs` recreate - `ALTER TABLE ADD` only - so the thing to pin is
 * that it stays that way: every existing row is untouched, the new columns
 * read back NULL, and no `__new_jobs` is ever involved.
 *
 * Both prod and dev are on 0006 when this lands.
 */

const PREVIOUS_TAG = '0006_careful_quasar'

const CREATED_AT = Date.parse('2026-09-01T10:00:00.000Z')
const UPDATED_AT = Date.parse('2026-09-01T10:05:00.000Z')

function seedJobs(sqlite: BetterSqlite3.Database): void {
  const insert = sqlite.prepare(
    `INSERT INTO jobs (id, type, status, requester_email, requester_user_id, origin, error, media_id, scope, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run(
    'job-web',
    'movie',
    'completed',
    'alice@example.com',
    'user_1',
    'web',
    null,
    'tmdb:438631',
    null,
    CREATED_AT,
    UPDATED_AT,
  )
  insert.run(
    'job-upstream',
    'show',
    'downloading',
    null,
    null,
    'upstream',
    'a transient error',
    'tvdb:121361',
    JSON.stringify({ seasonNumber: 3 }),
    CREATED_AT,
    UPDATED_AT,
  )
}

function jobRows(
  sqlite: BetterSqlite3.Database,
): Array<Record<string, unknown>> {
  return sqlite.prepare(`SELECT * FROM jobs ORDER BY id`).all() as Array<
    Record<string, unknown>
  >
}

function names(sqlite: BetterSqlite3.Database, type: string): string[] {
  return (
    sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
      )
      .all(type) as Array<{ name: string }>
  )
    .map(row => row.name)
    .sort()
}

function columns(sqlite: BetterSqlite3.Database, table: string): string[] {
  return (
    sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string
    }>
  ).map(row => row.name)
}

function migrateSeeded(): PartiallyMigratedDb {
  const handle = openPartiallyMigratedDb(PREVIOUS_TAG)
  seedJobs(handle.sqlite)
  handle.migrateRest()
  return handle
}

const NEW_JOB_COLUMNS = [
  'status_note',
  'upstream_command_id',
  'upstream_command_kind',
  'upstream_command_at',
]

describe('migration 0007 (job download links, history cursors, job command columns)', () => {
  it('has none of its tables or columns before 0007', () => {
    const { close, sqlite } = openPartiallyMigratedDb(PREVIOUS_TAG)
    try {
      expect(names(sqlite, 'table')).not.toContain('job_downloads')
      expect(names(sqlite, 'table')).not.toContain('arr_history_cursors')
      for (const column of NEW_JOB_COLUMNS) {
        expect(columns(sqlite, 'jobs')).not.toContain(column)
      }
    } finally {
      close()
    }
  })

  it('creates both tables, the job_downloads index, and the four jobs columns on a fresh database', () => {
    const { close, sqlite } = createTestDb()
    try {
      expect(names(sqlite, 'table')).toEqual(
        expect.arrayContaining(['arr_history_cursors', 'job_downloads']),
      )
      expect(names(sqlite, 'index')).toContain(
        'job_downloads_app_download_id_idx',
      )
      expect(columns(sqlite, 'jobs')).toEqual(
        expect.arrayContaining(NEW_JOB_COLUMNS),
      )
      expect(columns(sqlite, 'job_downloads')).toEqual([
        'job_id',
        'app',
        'download_id',
        'grabbed_at',
        'imported_at',
        'failed_at',
        'fail_reason',
        'interactive',
      ])
      expect(columns(sqlite, 'arr_history_cursors')).toEqual([
        'app',
        'cursor_date',
        'cursor_ids',
      ])
    } finally {
      close()
    }
  })

  describe('upgrading a 0006 database with jobs in it', () => {
    it('keeps every existing row and adds the new columns as NULL', () => {
      const { close, sqlite } = migrateSeeded()
      try {
        const rows = jobRows(sqlite)
        expect(rows.map(row => row.id)).toEqual(['job-upstream', 'job-web'])
        for (const row of rows) {
          for (const column of NEW_JOB_COLUMNS) {
            expect(row[column]).toBeNull()
          }
        }
        // The pre-existing columns come through untouched.
        expect(rows[0]).toMatchObject({
          error: 'a transient error',
          origin: 'upstream',
          scope: JSON.stringify({ seasonNumber: 3 }),
          status: 'downloading',
        })
        expect(rows[1]).toMatchObject({
          requester_email: 'alice@example.com',
          status: 'completed',
        })
      } finally {
        close()
      }
    })

    // An `ALTER TABLE ADD` leaves the table and its indexes alone - the
    // guard against drizzle-kit ever regenerating this as a recreate.
    it('does not recreate jobs - every jobs index survives and no __new_jobs is left', () => {
      const { close, sqlite } = migrateSeeded()
      try {
        expect(
          names(sqlite, 'index').filter(name => name.startsWith('jobs')),
        ).toEqual([
          'jobs_created_at_id_idx',
          'jobs_created_at_idx',
          'jobs_discord_user_id_idx',
          'jobs_requester_email_idx',
          'jobs_status_idx',
          'jobs_type_media_id_idx',
        ])
        expect(names(sqlite, 'table')).not.toContain('__new_jobs')
      } finally {
        close()
      }
    })

    it('links existing jobs to downloads and cascades a job delete', () => {
      const { close, sqlite } = migrateSeeded()
      try {
        sqlite
          .prepare(
            `INSERT INTO job_downloads (job_id, app, download_id) VALUES ('job-upstream', 'sonarr', 'SABnzbd_nzo_1')`,
          )
          .run()
        sqlite.prepare(`DELETE FROM jobs WHERE id = 'job-upstream'`).run()

        expect(
          sqlite.prepare(`SELECT COUNT(*) AS n FROM job_downloads`).get(),
        ).toEqual({ n: 0 })
      } finally {
        close()
      }
    })

    it('rejects a link to a job that does not exist, and an unknown app', () => {
      const { close, sqlite } = migrateSeeded()
      try {
        expect(() =>
          sqlite
            .prepare(
              `INSERT INTO job_downloads (job_id, app, download_id) VALUES ('nope', 'radarr', 'd1')`,
            )
            .run(),
        ).toThrow(/FOREIGN KEY constraint failed/)
        expect(() =>
          sqlite
            .prepare(
              `INSERT INTO job_downloads (job_id, app, download_id) VALUES ('job-web', 'lidarr', 'd1')`,
            )
            .run(),
        ).toThrow(/CHECK constraint failed/)
        expect(() =>
          sqlite
            .prepare(
              `INSERT INTO arr_history_cursors (app, cursor_date, cursor_ids) VALUES ('lidarr', '2026-09-01T00:00:00Z', '[]')`,
            )
            .run(),
        ).toThrow(/CHECK constraint failed/)
      } finally {
        close()
      }
    })

    it('leaves the database structurally sound and readable through the TS schema', () => {
      const { close, db, sqlite } = migrateSeeded()
      try {
        expect(() => checkIntegrity(db)).not.toThrow()
        expect(sqlite.prepare(`PRAGMA foreign_key_check`).all()).toEqual([])
        expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
        expect(
          db
            .select()
            .from(jobs)
            .all()
            .map(row => row.statusNote),
        ).toEqual([null, null])
      } finally {
        close()
      }
    })
  })
})
