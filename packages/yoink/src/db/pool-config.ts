import type { PoolConfig } from 'pg'

export function getPoolConfig(): PoolConfig {
  if (process.env.POSTGRES_USER) {
    return {
      host: process.env.POSTGRES_HOST ?? 'yoink-db',
      port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    }
  }
  return { connectionString: process.env.DATABASE_URL }
}
