import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import type { Db } from 'src/db/db.service'
import { runMigrations } from 'src/db/migrate'
import { applyPragmas } from 'src/db/pragmas'
import * as schema from 'src/db/schema'

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations')

interface Journal {
  entries: Array<{ tag: string }>
}

/**
 * A migrations folder containing only the entries up to and including `tag` -
 * drizzle's `readMigrationFiles` reads `meta/_journal.json` for the ordered
 * tag list and each `<tag>.sql` beside it, and ignores everything else in
 * `meta/`, so trimming the journal and copying the matching `.sql` files is
 * the whole of it.
 */
function materializePartialMigrations(dir: string, throughTag: string): void {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
  ) as Journal

  const cutoff = journal.entries.findIndex(entry => entry.tag === throughTag)
  if (cutoff === -1) {
    throw new Error(`migration tag '${throughTag}' is not in the journal`)
  }

  const kept = journal.entries.slice(0, cutoff + 1)

  fs.mkdirSync(path.join(dir, 'meta'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: kept }),
  )

  for (const entry of kept) {
    fs.copyFileSync(
      path.join(MIGRATIONS_DIR, `${entry.tag}.sql`),
      path.join(dir, `${entry.tag}.sql`),
    )
  }
}

/** Runs `fn` with `MIGRATIONS_FOLDER` pointed at `folder`, then restores it. */
function withMigrationsFolder(folder: string, fn: () => void): void {
  const original = process.env.MIGRATIONS_FOLDER
  process.env.MIGRATIONS_FOLDER = folder
  try {
    fn()
  } finally {
    // Never a plain assignment of `undefined` - Node stringifies it to the
    // literal 'undefined', which is not nullish and would defeat
    // `resolveMigrationsFolder()`'s `??` fallback for the rest of the worker.
    if (original === undefined) {
      delete process.env.MIGRATIONS_FOLDER
    } else {
      process.env.MIGRATIONS_FOLDER = original
    }
  }
}

export interface PartiallyMigratedDb {
  db: Db
  sqlite: BetterSqlite3.Database
  /** The production `runMigrations()` over the real, full folder. */
  migrateRest: () => void
  close: () => void
}

/**
 * A real file-backed database migrated up to and including `throughTag`
 * **only** - the shape an existing `/data/download.db` has before a deploy.
 * Seed it with raw SQL against that older column list, then `migrateRest()`
 * to do exactly what boot (`DbService`) does the first time new code meets
 * it.
 */
export function openPartiallyMigratedDb(
  throughTag: string,
): PartiallyMigratedDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-migrate-'))
  const partial = path.join(dir, `migrations-${throughTag}`)
  materializePartialMigrations(partial, throughTag)

  const sqlite = new BetterSqlite3(path.join(dir, 'download.db'))
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })

  withMigrationsFolder(partial, () => runMigrations(db))

  return {
    close: () => {
      sqlite.close()
      fs.rmSync(dir, { force: true, recursive: true })
    },
    db,
    migrateRest: () => runMigrations(db),
    sqlite,
  }
}
