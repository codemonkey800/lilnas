import path from 'node:path'

import { env } from '@lilnas/utils/env'
import { DynamicModule, Global, Module } from '@nestjs/common'
import BetterSqlite3 from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { EnvKeys } from 'src/env'

import * as schema from './schema'

export const DB = 'DB' as const
export type Db = BetterSQLite3Database<typeof schema>

// Exported so test helpers (and health.controller.ts's SELECT 1 probe) can
// reuse the same Drizzle `$client` escape hatch instead of each re-typing it.
export type WithSqliteClient = {
  $client: {
    pragma: (source: string) => unknown
    prepare: (source: string) => { get: () => unknown }
  }
}

// PRAGMA order is load-bearing — see apps/swole/src/db/pragmas.ts.
// `journal_mode = WAL` has side effects on the file format and should be set
// first; `foreign_keys = ON` must be set after the connection opens but
// before any query runs (otherwise ON DELETE CASCADE/RESTRICT silently
// degrades to a no-op).
export function applyPragmas(sqlite: BetterSqlite3.Database): void {
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
}

export function resolveMigrationsFolder(): string {
  return (
    process.env.MIGRATIONS_FOLDER ??
    path.resolve(process.cwd(), 'src/db/migrations')
  )
}

// Exported (unlike apps/tdr-code/src/db/database.module.ts, which keeps the
// equivalent function private) so a test can spy on the underlying
// sqlite.pragma calls and prove the post-migrate re-assertion below actually
// runs, rather than only checking the end-state pragma value — see
// db/__tests__/schema.spec.ts's "re-asserts foreign_keys" test.
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: resolveMigrationsFolder() })
  // Re-assert foreign_keys after migrate — the migrator can toggle it off
  // mid-flow during recreate-table migrations.
  const sqlite = (db as unknown as WithSqliteClient).$client
  sqlite.pragma('foreign_keys = ON')
}

function openSqlite(dbPath: string): BetterSqlite3.Database {
  try {
    return new BetterSqlite3(dbPath)
  } catch (err) {
    if (err instanceof Error && /CANTOPEN|EACCES/.test(err.message)) {
      throw new Error(
        `lilnas-auth: cannot open ${dbPath} — host directory must be owned ` +
          `by UID 1000 (run: chown 1000:1000 /storage/app-data/lilnas-auth). ` +
          `Original: ${err.message}`,
      )
    }
    throw err
  }
}

export interface DatabaseModuleOptions {
  migrate: boolean
}

// Always use DatabaseModule.forRoot(options) to obtain the DB provider.
// A bare-class import produces no providers.
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(options: DatabaseModuleOptions): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DB,
          useFactory: (): Db => {
            const dbPath = env(EnvKeys.DATABASE_PATH, './lilnas-auth.db')
            const sqlite = openSqlite(dbPath)
            applyPragmas(sqlite)
            const db = drizzle(sqlite, { schema })
            if (options.migrate) {
              runMigrations(db)
            }
            return db
          },
        },
      ],
      exports: [DB],
    }
  }
}
