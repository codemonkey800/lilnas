import BetterSqlite3 from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import {
  resolveMigrationsFolder,
  type WithSqliteClient,
} from './database.module'
import * as schema from './schema'

export type TestDb = {
  db: BetterSQLite3Database<typeof schema>
  close: () => void
}

// Build a fresh in-memory Drizzle/better-sqlite3 instance with PRAGMAs set
// and migrations applied. Each call returns an independent DB.
export function createTestDb(): TestDb {
  const sqlite = new BetterSqlite3(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: resolveMigrationsFolder() })

  // Re-assert foreign_keys = ON after migrate — the migrator can toggle it
  // off mid-flow during recreate-table migrations.
  const sqlite2 = (db as unknown as WithSqliteClient).$client
  sqlite2.pragma('foreign_keys = ON')

  return {
    db,
    close: () => sqlite.close(),
  }
}
