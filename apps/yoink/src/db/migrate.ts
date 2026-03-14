import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

import { getPoolConfig } from './pool-config'

async function main() {
  const pool = new Pool(getPoolConfig())
  const db = drizzle(pool)

  console.log('Running database migrations...')
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('Migrations complete.')

  await pool.end()
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
