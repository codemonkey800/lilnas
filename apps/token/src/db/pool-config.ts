import type { PoolConfig } from 'pg'

/**
 * Builds a `pg` {@link PoolConfig} from environment variables.
 *
 * Prefers individual `POSTGRES_*` env vars when available
 * (host, port, user, password, database); otherwise falls back
 * to a single `DATABASE_URL` connection string.
 */
export function getPoolConfig(): PoolConfig {
  if (process.env['POSTGRES_USER']) {
    return {
      host: process.env['POSTGRES_HOST'] ?? 'localhost',
      port: parseInt(process.env['POSTGRES_PORT'] ?? '5432', 10),
      user: process.env['POSTGRES_USER'],
      password: process.env['POSTGRES_PASSWORD'],
      database: process.env['POSTGRES_DB'],
    }
  }
  return { connectionString: process.env['DATABASE_URL'] }
}
