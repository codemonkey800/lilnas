import path from 'node:path'

import { DynamicModule, Global, Module } from '@nestjs/common'
import BetterSqlite3 from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { getOrSeedConfig } from './config.repo'
import * as schema from './schema'

export const DB = 'DB' as const
export type Db = BetterSQLite3Database<typeof schema>

// Exported for use in test helpers — centralises the Drizzle $client escape hatch.
export type WithSqliteClient = { $client: { pragma: (s: string) => void } }

function applyPragmas(sqlite: BetterSqlite3.Database): void {
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

function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: resolveMigrationsFolder() })
  // Re-assert foreign_keys after migrate — the migrator can toggle it off
  // mid-flow during recreate-table migrations.
  const sqlite = (db as unknown as WithSqliteClient).$client
  sqlite.pragma('foreign_keys = ON')
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
            const dbPath = process.env.DATABASE_PATH ?? './data.db'
            const sqlite = new BetterSqlite3(dbPath)
            applyPragmas(sqlite)
            const db = drizzle(sqlite, { schema })
            if (options.migrate) {
              runMigrations(db)
              // Seed config row from env defaults — main-only, runs before any
              // onModuleInit so it completes before SupervisorService spawns the
              // bot (Decision #1). The bot's getConfig treats a missing row as a
              // hard boot error; main must always seed first.
              getOrSeedConfig(db)
            }
            return db
          },
        },
      ],
      exports: [DB],
    }
  }
}
