import { Controller, Get, Logger } from '@nestjs/common'
import { sql } from 'drizzle-orm'

import { DrizzleService } from 'src/db/drizzle.service'

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name)

  constructor(private readonly drizzle: DrizzleService) {}

  @Get()
  async health() {
    const timestamp = new Date().toISOString()
    const uptime = Math.floor(process.uptime())

    let dbStatus = 'disconnected'
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Database health check timeout')),
          3000,
        ),
      )
      await Promise.race([this.drizzle.db.execute(sql`SELECT 1`), timeout])
      dbStatus = 'connected'
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Database health check failed',
      )
    }

    const response = {
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      timestamp,
      uptime,
      services: {
        database: dbStatus,
      },
    }

    this.logger.debug({ response }, 'Health check performed')

    return response
  }
}
