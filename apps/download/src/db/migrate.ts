import path from 'node:path'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import type { Db } from './db.service'

// Drizzle exposes the raw better-sqlite3 handle as `$client`, not reflected
// in the public BetterSQLite3Database type — same cast shape as
// apps/auth/src/db/database.module.ts's WithSqliteClient.
type WithSqliteClient = {
  $client: {
    pragma: (source: string) => unknown
    prepare: (source: string) => { get: () => unknown }
  }
}

export function resolveMigrationsFolder(): string {
  return (
    process.env.MIGRATIONS_FOLDER ??
    path.resolve(process.cwd(), 'src/db/migrations')
  )
}

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: resolveMigrationsFolder() })
  // Re-assert foreign_keys after migrate — the migrator can toggle it off
  // mid-flow during recreate-table migrations (see
  // apps/auth/src/db/database.module.ts's identical comment).
  const sqlite = (db as unknown as WithSqliteClient).$client
  sqlite.pragma('foreign_keys = ON')
}

// Ported from apps/swole/src/instrumentation-node.ts's bootNode() — that
// version is Next.js-specific and inlined there; this is the
// framework-agnostic extraction so DbService can call it directly.
// apps/auth/src/db/database.module.ts has no equivalent check today — this
// closes that gap for download rather than reproducing it.
export function checkIntegrity(db: Db): void {
  const sqlite = (db as unknown as WithSqliteClient).$client
  const result = sqlite.prepare('PRAGMA integrity_check').get() as {
    integrity_check: string
  }
  if (result.integrity_check !== 'ok') {
    throw new Error(
      `download: PRAGMA integrity_check failed: ${result.integrity_check}`,
    )
  }
}
