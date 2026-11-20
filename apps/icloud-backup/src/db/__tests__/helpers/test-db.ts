import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import * as schema from 'src/db/schema'

/** An in-memory Postgres with the real migration files applied. */
export async function createTestDb() {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, '../../migrations'),
  })
  return { db, client, close: () => client.close() }
}
