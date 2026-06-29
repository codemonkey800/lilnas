import { Controller, Get, Inject } from '@nestjs/common'
import { sql } from 'drizzle-orm'

import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'

// Intentionally unprotected — Docker healthcheck must reach this without auth.
// Returns only { ok: true }; no sensitive data is exposed.
@Controller()
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('health')
  health(): { ok: boolean } {
    this.db.get(sql`SELECT 1`)
    return { ok: true }
  }
}
