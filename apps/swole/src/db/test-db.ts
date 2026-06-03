import BetterSqlite3 from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'

import { runMigrations } from './migrate'
import { applyPragmas } from './pragmas'
import * as schema from './schema'

export type TestDb = {
  db: BetterSQLite3Database<typeof schema>
  close: () => void
}

// Build a fresh in-memory Drizzle/better-sqlite3 instance with PRAGMAs set and
// migrations applied. Each call returns an independent DB.
//
// The wrapper-object shape (db + close) keeps the raw better-sqlite3 handle out
// of consumers' type signatures — `db` matches production's type exactly, so
// query/mutation functions don't need test-only branches. The only escape
// hatch is `close()` for teardown.
export function createTestDb(): TestDb {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)

  const db = drizzle(sqlite, { schema })
  runMigrations(db)

  return {
    db,
    close: () => sqlite.close(),
  }
}
