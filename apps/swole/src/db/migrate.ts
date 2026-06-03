import 'server-only'

import path from 'node:path'

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

// Resolve the migrations folder at call time, not module-load time. Turbopack
// (Next.js 16 dev) replaces `__dirname` at compile time with a symbolic
// `/ROOT/...` placeholder that doesn't exist on disk, so the previous
// `path.join(__dirname, 'migrations')` blew up at boot with "Can't find
// meta/_journal.json file". `process.cwd()` is always a real path. The
// MIGRATIONS_FOLDER env var is an escape hatch for deployments whose runtime
// layout differs (e.g. a standalone build that copies migrations elsewhere).
function resolveMigrationsFolder(): string {
  return (
    process.env.MIGRATIONS_FOLDER ??
    path.resolve(process.cwd(), 'src/db/migrations')
  )
}

// Shape used to access the underlying better-sqlite3 handle for re-asserting
// PRAGMAs after migrate completes. Drizzle exposes the raw client as `$client`.
type WithSqliteClient = { $client: { pragma: (s: string) => void } }

export function runMigrations<TSchema extends Record<string, unknown>>(
  db: BetterSQLite3Database<TSchema>,
): void {
  migrate(db, { migrationsFolder: resolveMigrationsFolder() })

  // Re-assert foreign_keys = ON after migrate. Drizzle's migrator opens its
  // own transaction; some sequences of destructive migrations (the SQLite
  // recreate-table pattern) require disabling foreign_keys mid-flow. Re-
  // asserting here means the connection's post-migrate state is always
  // correct regardless of what individual migrations did.
  const sqlite = (db as unknown as WithSqliteClient).$client
  sqlite.pragma('foreign_keys = ON')
}
