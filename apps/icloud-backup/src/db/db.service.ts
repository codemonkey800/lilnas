import path from 'node:path'

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

import { getPoolConfig } from './pool-config'
import * as schema from './schema'

export function resolveMigrationsFolder(): string {
  return path.resolve(process.cwd(), 'src/db/migrations')
}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name)
  readonly pool: Pool
  readonly db: NodePgDatabase<typeof schema>

  constructor() {
    this.pool = new Pool({
      ...getPoolConfig(),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    this.pool.on('error', err => {
      this.logger.error({ err }, 'Idle pg-pool client error')
    })
    this.db = drizzle(this.pool, { schema })
  }

  /** Applies pending migrations. A failure aborts boot so the process exits. */
  async onModuleInit(): Promise<void> {
    const migrationsFolder = resolveMigrationsFolder()
    try {
      await migrate(this.db, { migrationsFolder })
    } catch (err) {
      this.logger.error({ err, migrationsFolder }, 'Database migration failed')
      throw err
    }
    this.logger.log('Database migrations applied')
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}
