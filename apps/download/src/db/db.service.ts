import { env } from '@lilnas/utils/env'
import { Injectable, OnModuleDestroy } from '@nestjs/common'
import BetterSqlite3 from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'

import { EnvKeys } from 'src/env'

import {
  checkIntegrity as checkDbIntegrity,
  runMigrations as runDbMigrations,
} from './migrate'
import { applyPragmas } from './pragmas'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

function openSqlite(dbPath: string): BetterSqlite3.Database {
  try {
    return new BetterSqlite3(dbPath)
  } catch (err) {
    if (err instanceof Error && /CANTOPEN|EACCES/.test(err.message)) {
      throw new Error(
        `download: cannot open ${dbPath} — host directory must be owned ` +
          `by UID 1000 (run: chown 1000:1000 /storage/app-data/download). ` +
          `Original: ${err.message}`,
      )
    }
    throw err
  }
}

// A real @Injectable() class (not apps/auth's DatabaseModule.forRoot()
// string-token + useFactory pattern) — required so
// `Test.createTestingModule().overrideProvider(DbService)` has an actual
// class/token to override. Opens the sqlite connection and applies pragmas
// EAGERLY in the constructor — this runs synchronously during Nest's DI
// instantiation phase (inside NestFactory.create()), so a CANTOPEN/EACCES
// failure surfaces as a rejected create() promise, not a later error.
// Running migrations and the integrity check are separate, explicit
// methods (not onModuleInit()) — see bootstrap.ts for why that ordering
// matters.
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly db: Db
  private readonly sqlite: BetterSqlite3.Database

  constructor() {
    const dbPath = env(EnvKeys.DATABASE_PATH, './download.db')
    this.sqlite = openSqlite(dbPath)
    applyPragmas(this.sqlite)
    this.db = drizzle(this.sqlite, { schema })
  }

  runMigrations(): void {
    runDbMigrations(this.db)
  }

  checkIntegrity(): void {
    checkDbIntegrity(this.db)
  }

  onModuleDestroy(): void {
    this.sqlite.close()
  }
}
