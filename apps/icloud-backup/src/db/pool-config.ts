import type { PoolConfig } from 'pg'

import { EnvKeys } from 'src/env'

/** Builds a `pg` pool config from the `POSTGRES_*` environment variables. */
export function getPoolConfig(): PoolConfig {
  return {
    host: process.env[EnvKeys.POSTGRES_HOST] ?? 'localhost',
    port: parseInt(process.env[EnvKeys.POSTGRES_PORT] ?? '5432', 10),
    user: process.env[EnvKeys.POSTGRES_USER],
    password: process.env[EnvKeys.POSTGRES_PASSWORD],
    database: process.env[EnvKeys.POSTGRES_DB],
  }
}
