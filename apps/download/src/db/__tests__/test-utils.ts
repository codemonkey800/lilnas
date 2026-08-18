import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { Db, DbService } from 'src/db/db.service'
import { runMigrations } from 'src/db/migrate'
import { applyPragmas } from 'src/db/pragmas'
import * as schema from 'src/db/schema'

export interface TestDb {
  db: Db
  sqlite: BetterSqlite3.Database
  close: () => void
}

/**
 * A raw in-memory sqlite + drizzle handle, migrated and pragma'd the same
 * way DbService sets up its real connection - for tests that need direct
 * access to the underlying `Db`/`sqlite` handle (e.g. schema/migration
 * tests). Extracted here so other test files can reuse it without
 * duplicating the setup (jest's testMatch excludes this file itself). The
 * explicit `TestDb` return type (rather than a bare inferred object) is
 * required, not decorative - tsc otherwise can't name `BetterSqlite3.Database`
 * for this exported function's inferred declaration.
 */
export function createTestDb(): TestDb {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
}

/**
 * A real, migrated DbService backed by an in-memory sqlite database - for
 * tests that need to provide a working DbService to a module under test
 * (e.g. DownloadStateService's persistJob()) without hand-rolling a mock of
 * drizzle's chained query builder API.
 */
export function createTestDbService(): DbService {
  const originalPath = process.env.DATABASE_PATH
  process.env.DATABASE_PATH = ':memory:'
  try {
    const dbService = new DbService()
    dbService.runMigrations()
    return dbService
  } finally {
    // A plain assignment would coerce `undefined` to the literal string
    // 'undefined' (Node stringifies every env assignment), which is not
    // nullish and would silently defeat env()'s `?? defaultValue` fallback
    // for every later DbService constructed in this Jest worker.
    if (originalPath === undefined) {
      delete process.env.DATABASE_PATH
    } else {
      process.env.DATABASE_PATH = originalPath
    }
  }
}
