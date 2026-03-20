import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { getPoolConfig } from './pool-config'
import * as schema from './schema'

/**
 * Manages a shared PostgreSQL connection pool and exposes
 * a type-safe Drizzle ORM database instance.
 *
 * The pool is created eagerly on construction and torn down
 * gracefully when the NestJS module is destroyed.
 */
@Injectable()
export class DrizzleService implements OnModuleDestroy {
  private readonly logger = new Logger(DrizzleService.name)
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

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing database pool')
    await this.pool.end()
    this.logger.log('Database pool closed')
  }
}
