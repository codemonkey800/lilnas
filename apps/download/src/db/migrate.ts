import path from 'node:path'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import type { Db } from './db.service'

// Drizzle exposes the raw better-sqlite3 handle as `$client`, not reflected
// in the public BetterSQLite3Database type — same cast shape as
// apps/auth/src/db/database.module.ts's WithSqliteClient.
type WithSqliteClient = {
  $client: {
    pragma: (source: string) => unknown
    exec: (source: string) => unknown
    prepare: (source: string) => {
      get: () => unknown
      all: () => unknown[]
      run: (...params: unknown[]) => unknown
    }
  }
}

const MIGRATIONS_TABLE = '__drizzle_migrations'

export function resolveMigrationsFolder(): string {
  return (
    process.env.MIGRATIONS_FOLDER ??
    path.resolve(process.cwd(), 'src/db/migrations')
  )
}

// A database written before a migration-history squash (see
// docs/context/download-backend-verification-status.md's "migration squash
// was a loaded gun") has every table the squashed migration creates, but no
// `__drizzle_migrations` row recording it as applied. drizzle's migrator
// decides what to (re-)apply purely by comparing the newest
// `__drizzle_migrations.created_at` to each migration's folderMillis — it
// never diffs schema — so left alone it replays the squashed CREATE TABLE
// statements against tables that already exist and dies with `table
// already exists`. For each migration that's about to be (re-)applied, if
// every table it would create already exists, record it as applied instead
// of running it. Stops at the first migration that isn't purely a
// re-creation of existing tables, so a genuinely new migration still runs
// through the real migrator.
function selfHealMigrationBookkeeping(sqlite: WithSqliteClient['$client']) {
  const migrations = readMigrationFiles({
    migrationsFolder: resolveMigrationsFolder(),
  })

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `)

  const existingTables = new Set(
    (
      sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[]
    ).map(row => row.name),
  )

  const lastRecorded = sqlite
    .prepare(
      `SELECT created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as { created_at: number } | undefined

  let lastRecordedAt = lastRecorded?.created_at ?? -Infinity

  const insert = sqlite.prepare(
    `INSERT INTO ${MIGRATIONS_TABLE} ("hash", "created_at") VALUES (?, ?)`,
  )

  for (const migration of migrations) {
    if (lastRecordedAt >= migration.folderMillis) continue

    const tablesCreated: string[] = migration.sql.flatMap(statement =>
      [...statement.matchAll(/CREATE TABLE `(\w+)`/g)]
        .map(match => match[1])
        .filter((table): table is string => table !== undefined),
    )

    const schemaAlreadyMatches =
      tablesCreated.length > 0 &&
      tablesCreated.every(table => existingTables.has(table))

    if (!schemaAlreadyMatches) break

    insert.run(migration.hash, migration.folderMillis)
    lastRecordedAt = migration.folderMillis
  }
}

export function runMigrations(db: Db): void {
  const sqlite = (db as unknown as WithSqliteClient).$client
  selfHealMigrationBookkeeping(sqlite)
  migrate(db, { migrationsFolder: resolveMigrationsFolder() })
  // Re-assert foreign_keys after migrate — the migrator can toggle it off
  // mid-flow during recreate-table migrations (see
  // apps/auth/src/db/database.module.ts's identical comment).
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
