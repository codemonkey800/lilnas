import { Controller, Get, Inject } from '@nestjs/common'
import { sql } from 'drizzle-orm'

import { Public } from 'src/auth/public.decorator'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'

// Intentionally unprotected — Docker healthcheck must reach this without
// auth. @Public() is the SOLE entry in AuthGuard's allowlist (R19: deny-by-
// default everywhere else) — this route sits in the Docker healthcheck's
// path (:8080 Next /api/health -> :8082 Nest @Get('health')), so a
// missing/mis-scoped @Public() here is a self-inflicted outage the moment
// U4 deploys, independent of anything U6's Next-side allowlist will add
// later. Returns only { ok: true }; no sensitive data is exposed.
@Controller()
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Public()
  @Get('health')
  health(): { ok: boolean } {
    this.db.get(sql`SELECT 1`)
    return { ok: true }
  }
}
