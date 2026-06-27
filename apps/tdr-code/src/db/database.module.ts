import path from 'node:path'

import { Global, Module } from '@nestjs/common'
import BetterSqlite3 from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

// eslint-disable-next-line import/namespace -- empty until first table is added
import * as schema from './schema'

export const DB = 'DB' as const
export type Db = BetterSQLite3Database<typeof schema>

function resolveMigrationsFolder(): string {
  return (
    process.env.MIGRATIONS_FOLDER ??
    path.resolve(process.cwd(), 'src/db/migrations')
  )
}

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db => {
        const dbPath = process.env.DATABASE_PATH ?? './data.db'
        const sqlite = new BetterSqlite3(dbPath)
        sqlite.pragma('journal_mode = WAL')
        sqlite.pragma('synchronous = NORMAL')
        sqlite.pragma('foreign_keys = ON')
        sqlite.pragma('busy_timeout = 5000')
        const db = drizzle(sqlite, { schema })
        migrate(db, { migrationsFolder: resolveMigrationsFolder() })
        return db
      },
    },
  ],
  exports: [DB],
})
export class DatabaseModule {}
