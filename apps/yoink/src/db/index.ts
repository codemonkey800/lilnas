import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { getPoolConfig } from './pool-config'
import * as schema from './schema'

export const pool = new Pool({
  ...getPoolConfig(),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', err => {
  console.error('Idle pg-pool client error:', err.message)
})

export const db = drizzle(pool, { schema })
