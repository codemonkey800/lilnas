import 'server-only'

import { env } from '@lilnas/utils/env'
import BetterSqlite3 from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'

import { EnvKeys } from 'src/env'

import { applyPragmas } from './pragmas'
import * as schema from './schema'

// Exported only so client.spec.ts can build isolated instances without going
// through the singleton. Application code MUST import `db` from this module.
export function instantiate(): BetterSQLite3Database<typeof schema> {
  const dbPath = env(EnvKeys.DATABASE_PATH, './swole.db')
  let sqlite: BetterSqlite3.Database
  try {
    sqlite = new BetterSqlite3(dbPath)
  } catch (err) {
    if (err instanceof Error && /CANTOPEN|EACCES/.test(err.message)) {
      throw new Error(
        `swole: cannot open ${dbPath} — ` +
          `host directory must be owned by UID 1000 ` +
          `(run: chown 1000:1000 /storage/app-data/swole). Original: ${err.message}`,
      )
    }
    throw err
  }

  applyPragmas(sqlite)

  return drizzle(sqlite, { schema })
}

declare global {
  var __swoleDb: BetterSQLite3Database<typeof schema> | undefined
}

// In production, one-shot instantiate — no globalThis stash.
// In dev (and tests that happen to load this module), reuse a globalThis-cached
// instance so Next.js HMR reloads don't open a new file handle each time the
// module graph re-evaluates.
export const db: BetterSQLite3Database<typeof schema> =
  process.env.NODE_ENV === 'production'
    ? instantiate()
    : (globalThis.__swoleDb ??= instantiate())

// Close the cached SQLite handle. Used by tests (afterEach) and by the
// SIGTERM/SIGINT handlers registered in instrumentation.ts so the underlying
// file descriptor doesn't leak across HMR cycles or container shutdown.
type WithClient = { $client: BetterSqlite3.Database }
export function closeDb(): void {
  if (globalThis.__swoleDb) {
    ;(globalThis.__swoleDb as unknown as WithClient).$client.close()
    globalThis.__swoleDb = undefined
  }
}
