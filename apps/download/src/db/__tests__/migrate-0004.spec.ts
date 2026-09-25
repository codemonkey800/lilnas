import type BetterSqlite3 from 'better-sqlite3'

import { checkIntegrity } from 'src/db/migrate'
import { jobs } from 'src/db/schema'

import {
  openPartiallyMigratedDb,
  type PartiallyMigratedDb,
} from './helpers/partial-migrations'

/**
 * Migration 0004 (plan 021 · Phase 4 · A3) is hand-edited: drizzle-kit only
 * generated the `DROP COLUMN removed_from_library`, and a `DELETE` of the
 * fake `completed` jobs `library-sync` backfilled at boot was prepended by
 * hand. Its predicate - service origin, completed, movie/show, and
 * `created_at = completed_at` - is the whole safety argument, so each arm of
 * it gets a row that must survive for lack of it.
 *
 * Two starting shapes, because two real databases meet this migration:
 *
 * - **prod** is on 0002 (no `removed_from_library` at all), so it applies
 *   0003 then 0004 in one boot;
 * - **dev** is on 0003 (column present, backfilled rows in it).
 */

const ADDED_AT = Date.parse('2026-04-01T08:00:00.000Z')
const CREATED_AT = Date.parse('2026-05-01T10:00:00.000Z')
const UPDATED_AT = Date.parse('2026-05-01T10:05:00.000Z')
const COMPLETED_AT = Date.parse('2026-05-01T10:09:00.000Z')

interface SeedJob {
  completedAt: number | null
  createdAt: number
  id: string
  mediaId: string
  origin: 'service' | 'web'
  status: string
  type: 'movie' | 'show' | 'video'
}

/**
 * What `syncDownloadedLibrary()` wrote: service origin, completed, no
 * requester, and every timestamp the title's `addedAt`.
 */
const BACKFILLED_MOVIE: SeedJob = {
  completedAt: ADDED_AT,
  createdAt: ADDED_AT,
  id: 'backfilled-movie',
  mediaId: 'tmdb:438631',
  origin: 'service',
  status: 'completed',
  type: 'movie',
}

const BACKFILLED_SHOW: SeedJob = {
  completedAt: ADDED_AT,
  createdAt: ADDED_AT,
  id: 'backfilled-show',
  mediaId: 'tvdb:121361',
  origin: 'service',
  status: 'completed',
  type: 'show',
}

/** Prod's 21 service rows: real tdr-bot video jobs from before Discord attribution. */
const REAL_SERVICE_VIDEO: SeedJob = {
  completedAt: COMPLETED_AT,
  createdAt: CREATED_AT,
  id: 'real-service-video',
  mediaId: 'video:v1',
  origin: 'service',
  status: 'completed',
  type: 'video',
}

/** A genuine service-origin movie download: it took time to finish. */
const REAL_SERVICE_MOVIE: SeedJob = {
  completedAt: COMPLETED_AT,
  createdAt: CREATED_AT,
  id: 'real-service-movie',
  mediaId: 'tmdb:27205',
  origin: 'service',
  status: 'completed',
  type: 'movie',
}

/** Equal timestamps, but a person asked for it - never library-sync's. */
const WEB_MOVIE_EQUAL_TIMES: SeedJob = {
  completedAt: ADDED_AT,
  createdAt: ADDED_AT,
  id: 'web-movie-equal-times',
  mediaId: 'tmdb:603',
  origin: 'web',
  status: 'completed',
  type: 'movie',
}

/** Service origin and a show, but still open - `completed_at` is NULL. */
const OPEN_SERVICE_SHOW: SeedJob = {
  completedAt: null,
  createdAt: CREATED_AT,
  id: 'open-service-show',
  mediaId: 'tvdb:81189',
  origin: 'service',
  status: 'downloading',
  type: 'show',
}

const SURVIVORS = [
  OPEN_SERVICE_SHOW,
  REAL_SERVICE_MOVIE,
  REAL_SERVICE_VIDEO,
  WEB_MOVIE_EQUAL_TIMES,
]

/**
 * Raw SQL against the pre-0004 column list rather than drizzle: the TS `jobs`
 * table no longer declares `removed_from_library`, and at 0002 the column
 * doesn't exist yet. A `web` row carries a requester, as the origin CHECK
 * requires; a `service` row carries none.
 */
function seedJobs(
  sqlite: BetterSqlite3.Database,
  rows: readonly SeedJob[],
): void {
  const insert = sqlite.prepare(
    `INSERT INTO jobs (id, type, status, requester_email, requester_user_id, origin, media_id, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  for (const row of rows) {
    const web = row.origin === 'web'
    insert.run(
      row.id,
      row.type,
      row.status,
      web ? 'alice@example.com' : null,
      web ? 'user_1' : null,
      row.origin,
      row.mediaId,
      row.createdAt,
      UPDATED_AT,
      row.completedAt,
    )
  }
}

function jobIds(sqlite: BetterSqlite3.Database): string[] {
  return (
    sqlite.prepare(`SELECT id FROM jobs ORDER BY id`).all() as Array<{
      id: string
    }>
  ).map(row => row.id)
}

function jobColumns(sqlite: BetterSqlite3.Database): string[] {
  return (
    sqlite.prepare(`PRAGMA table_info(jobs)`).all() as Array<{
      name: string
    }>
  ).map(column => column.name)
}

/** Opens a DB at `throughTag`, seeds it, and runs the real migrator on it. */
function migrateSeeded(
  throughTag: string,
  rows: readonly SeedJob[],
): PartiallyMigratedDb {
  const handle = openPartiallyMigratedDb(throughTag)
  seedJobs(handle.sqlite, rows)
  handle.migrateRest()
  return handle
}

const PROD_TAG = '0002_even_newton_destine'
const DEV_TAG = '0003_lazy_supernaut'

describe('migration 0004 (drop library-sync rows and removed_from_library)', () => {
  it('starts prod-shaped - at 0002 there is no removed_from_library column yet', () => {
    const { close, sqlite } = openPartiallyMigratedDb(PROD_TAG)
    try {
      expect(jobColumns(sqlite)).not.toContain('removed_from_library')
    } finally {
      close()
    }
  })

  describe.each([
    ['prod-shaped (0002 -> 0003 -> 0004)', PROD_TAG],
    ['dev-shaped (0003 -> 0004)', DEV_TAG],
  ])('on a %s database', (_label, throughTag) => {
    it('deletes the backfilled movie and show rows and keeps every other row', () => {
      const { close, sqlite } = migrateSeeded(throughTag, [
        BACKFILLED_MOVIE,
        BACKFILLED_SHOW,
        ...SURVIVORS,
      ])
      try {
        expect(jobIds(sqlite)).toEqual(SURVIVORS.map(row => row.id).sort())
      } finally {
        close()
      }
    })

    it('keeps a surviving row byte-identical', () => {
      const { close, sqlite } = migrateSeeded(throughTag, [REAL_SERVICE_VIDEO])
      try {
        expect(
          sqlite
            .prepare(`SELECT * FROM jobs WHERE id = ?`)
            .get(REAL_SERVICE_VIDEO.id),
        ).toEqual({
          completed_at: COMPLETED_AT,
          created_at: CREATED_AT,
          discord_user_id: null,
          discord_username: null,
          error: null,
          hidden_attribution: 0,
          id: REAL_SERVICE_VIDEO.id,
          media_id: 'video:v1',
          origin: 'service',
          requester_email: null,
          requester_user_id: null,
          scope: null,
          status: 'completed',
          type: 'video',
          updated_at: UPDATED_AT,
        })
      } finally {
        close()
      }
    })

    it('drops the removed_from_library column', () => {
      const { close, sqlite } = migrateSeeded(throughTag, SURVIVORS)
      try {
        expect(jobColumns(sqlite)).not.toContain('removed_from_library')
      } finally {
        close()
      }
    })

    // Prod's case: 21 service rows, none of them backfilled.
    it('deletes nothing from a database with no backfilled rows', () => {
      const { close, db, sqlite } = migrateSeeded(throughTag, SURVIVORS)
      try {
        expect(jobIds(sqlite)).toEqual(SURVIVORS.map(row => row.id).sort())
        expect(() => checkIntegrity(db)).not.toThrow()
        // The TS schema and the migrated table agree - a select through
        // drizzle names every column it declares.
        expect(db.select().from(jobs).all()).toHaveLength(SURVIVORS.length)
      } finally {
        close()
      }
    })

    it('applies cleanly to an empty jobs table', () => {
      const { close, sqlite } = migrateSeeded(throughTag, [])
      try {
        expect(jobIds(sqlite)).toEqual([])
      } finally {
        close()
      }
    })
  })

  it('keeps a dev row flagged removed_from_library unless it is a backfilled one', () => {
    const handle = openPartiallyMigratedDb(DEV_TAG)
    try {
      seedJobs(handle.sqlite, [BACKFILLED_MOVIE, REAL_SERVICE_MOVIE])
      handle.sqlite.prepare(`UPDATE jobs SET removed_from_library = 1`).run()

      handle.migrateRest()

      expect(jobIds(handle.sqlite)).toEqual([REAL_SERVICE_MOVIE.id])
    } finally {
      handle.close()
    }
  })

  it('leaves the database structurally sound and foreign_keys ON', () => {
    const { close, db, sqlite } = migrateSeeded(PROD_TAG, [
      BACKFILLED_MOVIE,
      ...SURVIVORS,
    ])
    try {
      expect(() => checkIntegrity(db)).not.toThrow()
      expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    } finally {
      close()
    }
  })
})
