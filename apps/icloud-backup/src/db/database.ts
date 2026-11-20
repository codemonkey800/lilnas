import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type * as schema from './schema'

/** Injection token for the drizzle database the repositories use. */
export const DB = 'ICLOUD_BACKUP_DB' as const

/**
 * Any drizzle Postgres database over this schema: `node-postgres` in the app,
 * `pglite` in tests.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>
