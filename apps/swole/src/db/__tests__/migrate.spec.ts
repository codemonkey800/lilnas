import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { runMigrations } from 'src/db/migrate'

// Underlying better-sqlite3 client exposed by drizzle for raw queries.
type WithSqliteClient = {
  $client: {
    prepare: (sql: string) => { get: (...args: unknown[]) => unknown }
    close: () => void
  }
}

describe('runMigrations path resolution', () => {
  // @types/node 24 marks env vars as readonly; cast through Record so tests
  // can flip MIGRATIONS_FOLDER per scenario.
  const mutableEnv = process.env as Record<string, string | undefined>
  const originalMigrationsFolder = mutableEnv.MIGRATIONS_FOLDER
  const originalCwd = process.cwd()

  afterEach(() => {
    // Use delete (not assignment to undefined) because Node coerces
    // `process.env.X = undefined` to the string "undefined", which would
    // poison subsequent tests by satisfying the `??` fallback in
    // resolveMigrationsFolder().
    if (originalMigrationsFolder === undefined) {
      delete mutableEnv.MIGRATIONS_FOLDER
    } else {
      mutableEnv.MIGRATIONS_FOLDER = originalMigrationsFolder
    }
    process.chdir(originalCwd)
  })

  it('resolves to a real filesystem path containing meta/_journal.json (Turbopack regression — #__dirname is not a real path under Turbopack)', () => {
    // The bug: Turbopack replaces __dirname at compile-time with a symbolic
    // /ROOT/... placeholder that doesn't exist on disk, so Drizzle's
    // readMigrationFiles throws "Can't find meta/_journal.json file" at boot.
    // The fix uses process.cwd()-relative resolution which always points to
    // a real filesystem location.
    const expectedJournal = path.join(
      process.cwd(),
      'src/db/migrations/meta/_journal.json',
    )
    expect(existsSync(expectedJournal)).toBe(true)
  })

  it('applies migrations against an in-memory database without errors', () => {
    // End-to-end: a fresh in-memory DB + the real migrations folder must
    // produce a populated __drizzle_migrations table. This would have caught
    // the original bug because the symbolic /ROOT path would have failed
    // readMigrationFiles before any DDL ran.
    const sqlite = new BetterSqlite3(':memory:')
    const db = drizzle(sqlite)
    runMigrations(db)
    const row = (db as unknown as WithSqliteClient).$client
      .prepare('SELECT count(*) as n FROM __drizzle_migrations')
      .get() as { n: number }
    expect(row.n).toBeGreaterThan(0)
    ;(db as unknown as WithSqliteClient).$client.close()
  })

  it('honors MIGRATIONS_FOLDER env var override', () => {
    // Escape hatch for deployments whose layout doesn't put migrations at
    // process.cwd()/src/db/migrations (e.g. a non-standard standalone copy).
    const dir = mkdtempSync(path.join(tmpdir(), 'swole-migrate-'))
    const metaDir = path.join(dir, 'meta')
    mkdirSync(metaDir, { recursive: true })
    // Minimal journal — one entry, idx 0, hash matches an empty SQL file.
    writeFileSync(
      path.join(metaDir, '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [
          {
            idx: 0,
            version: '6',
            when: Date.now(),
            tag: '0000_noop',
            breakpoints: true,
          },
        ],
      }),
    )
    writeFileSync(
      path.join(dir, '0000_noop.sql'),
      'CREATE TABLE noop (id integer primary key);',
    )

    mutableEnv.MIGRATIONS_FOLDER = dir
    try {
      const sqlite = new BetterSqlite3(':memory:')
      const db = drizzle(sqlite)
      runMigrations(db)
      const row = (db as unknown as WithSqliteClient).$client
        .prepare(
          "SELECT count(*) as n FROM sqlite_master WHERE type='table' AND name='noop'",
        )
        .get() as { n: number }
      expect(row.n).toBe(1)
      ;(db as unknown as WithSqliteClient).$client.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
