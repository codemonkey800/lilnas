// Node-runtime boot for swole. Loaded via dynamic import from
// src/instrumentation.ts. Splitting the Node-only logic into its own file
// keeps better-sqlite3 + `process.exit`/`process.once` out of the Edge
// bundle's static-analysis graph — Next.js auto-bundles instrumentation.ts
// for both runtimes and a top-level runtime guard does not strip the AST.

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import { closeDb, db } from 'src/db/client'
import { runMigrations } from 'src/db/migrate'
import type * as schema from 'src/db/schema'
import { logger } from 'src/lib/logger'

type DrizzleDb = BetterSQLite3Database<typeof schema>

// The underlying better-sqlite3 handle is exposed at `db.$client` in
// drizzle-orm's runtime but isn't reflected in the public `BetterSQLite3Database`
// type. Cast once at the boundary so the rest of this module uses a typed
// `sqlite` handle (#21).
type WithSqliteClient = {
  $client: {
    prepare: (sql: string) => { get: (...args: unknown[]) => unknown }
  }
}
function sqliteOf(db: DrizzleDb): WithSqliteClient['$client'] {
  return (db as unknown as WithSqliteClient).$client
}

function readMigrationCount(db: DrizzleDb): number {
  const sqlite = sqliteOf(db)
  const hasTable = sqlite
    .prepare(
      "SELECT count(*) as n FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get() as { n: number }
  if (hasTable.n === 0) return 0
  const row = sqlite
    .prepare('SELECT count(*) as n FROM __drizzle_migrations')
    .get() as { n: number }
  return row.n
}

// Migrations apply once per process at boot. Partial-migration drift is the
// worse failure mode — we wrap the whole body in try/catch, run PRAGMA
// integrity_check after migrate, and `process.exit(1)` on any error so the
// HTTP listener never serves traffic on a half-built schema (#7).
export async function bootNode(): Promise<void> {
  try {
    // Read the migration count before and after so partial-migration drift is
    // visible from container logs. On first boot `applied` equals the total
    // number of migrations; on subsequent boots `applied: 0` confirms no drift.
    const beforeCount = readMigrationCount(db)
    runMigrations(db)
    const afterCount = readMigrationCount(db)

    // Defense in depth — catch partial-migration corruption before serving.
    // A torn write or SIGKILL mid-migration can leave the schema partially
    // applied while `__drizzle_migrations` may or may not record the file
    // as done. PRAGMA integrity_check returns 'ok' or a list of issues.
    const integrity = sqliteOf(db).prepare('PRAGMA integrity_check').get() as {
      integrity_check: string
    }
    if (integrity.integrity_check !== 'ok') {
      throw new Error(`integrity_check failed: ${integrity.integrity_check}`)
    }

    logger.info(
      { applied: afterCount - beforeCount, total: afterCount },
      'swole migrations applied',
    )

    // Graceful shutdown — close the SQLite handle on SIGTERM (docker-compose
    // down, rolling restart) and SIGINT (Ctrl-C in dev) so an in-progress
    // checkpoint completes cleanly. `stop_grace_period: 30s` in deploy.yml
    // grants enough time for this to run before SIGKILL (#27).
    const shutdown = (signal: NodeJS.Signals) => {
      logger.info({ signal }, 'swole received shutdown signal; closing DB')
      try {
        closeDb()
      } catch (err) {
        logger.error({ err }, 'swole error closing DB during shutdown')
      }
      process.exit(0)
    }
    process.once('SIGTERM', () => shutdown('SIGTERM'))
    process.once('SIGINT', () => shutdown('SIGINT'))
  } catch (err) {
    logger.error({ err }, 'swole boot failed; exiting')
    // Explicit process.exit so Next.js standalone never serves traffic on a
    // half-built schema. Docker's restart-on-failure picks up the non-zero
    // exit and the operator sees a clear log line.
    process.exit(1)
  }
}
