import {
  type HealthResponse,
  healthResponse,
  healthStatusCode,
} from '@lilnas/utils/health'
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common'

import { DB, type Db, type WithSqliteClient } from 'src/db/database.module'

// Liveness probe for Docker's healthcheck (deploy.yml) — deliberately probes
// Nest's own SQLite handle directly with SELECT 1 rather than trusting that
// the process is merely bound to its port. This is the FIRST NestJS
// consumer of @lilnas/utils/health in the repo (apps/swole's is a Next.js
// route handler) — same response shape and status-code convention, ported
// to a Nest controller. R20: ForwardAuth cannot fail open, so a wedged DB
// (permissions revoked, volume unmounted, disk full, WAL lock stuck) must
// flip this red even while the event loop is still answering other routes.
//
// 503 is signalled by throwing HttpException with the health payload as the
// response body, rather than a @Res()-driven manual res.status(...).json(...)
// call — this is the same pattern @nestjs/terminus itself uses for health
// checks, and keeps this controller on Nest's normal response pipeline
// (interceptors, serialization) instead of the escape hatch.
//
// S5: also deliberately NO @UseGuards(ThrottlerGuard) — a liveness probe
// polling continuously (autoLogging already excludes this route for the
// same reason) must never itself start failing under its own load. See
// app.module.ts's ThrottlerModule.forRoot() comment.
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const result = await healthResponse({
      service: 'lilnas-auth',
      deps: {
        sqlite: () => {
          const sqlite = (this.db as unknown as WithSqliteClient).$client
          sqlite.prepare('SELECT 1').get()
        },
      },
    })

    const statusCode = healthStatusCode(result)
    if (statusCode !== HttpStatus.OK) {
      throw new HttpException(result, statusCode)
    }

    return result
  }
}
