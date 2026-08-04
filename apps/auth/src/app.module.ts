import { env } from '@lilnas/utils/env'
import { Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'

import { AdminController } from './admin/admin.controller'
import { AdminGuard } from './admin/admin.guard'
import { UsersService } from './admin/users.service'
import { AuthModule } from './auth/auth.module'
import { DatabaseModule } from './db/database.module'
import { EnvKeys } from './env'
import { HealthController } from './health/health.controller'
import { MeController } from './me/me.controller'
import { RequestsController } from './requests/requests.controller'
import { RequestsService } from './requests/requests.service'
import { ServiceRegistryService } from './services/service-registry.service'
import { SseModule } from './sse/sse.module'
import { AccessCacheModule } from './verify/access-cache.module'
import { VerifyController } from './verify/verify.controller'
import { VerifyService } from './verify/verify.service'

const isProduction = env(EnvKeys.NODE_ENV, 'development') === 'production'

@Module({
  imports: [
    DatabaseModule.forRoot({ migrate: true }),
    AuthModule,
    AccessCacheModule,
    SseModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: isProduction ? 'info' : 'debug',
        // lilnas-auth is a credential-bearing service from day one: pino's
        // default req/res serializers include raw headers, and /verify (U5)
        // will receive the session Cookie on every single migrated request.
        // Redacting the credential-shaped header slots now — before any
        // route actually reads a cookie — means the hot path never needs a
        // logging change later. Per
        // docs/solutions/conventions/tdr-code-structured-logging-convention-2026-07-03.md,
        // retrofitting redaction after routes exist is exactly the kind of
        // hot-path churn this plan wants to avoid. U3's OAuth callback will
        // likely need to extend this with a `req.url` censor (the callback
        // URL carries a `code`/`state` query string) — see
        // apps/tdr-code/src/logger.ts's redactAuthQueryString for the
        // precedent when that lands.
        redact: {
          paths: [
            'req.headers.cookie',
            'req.headers.authorization',
            'res.headers["set-cookie"]',
          ],
          censor: '[Redacted]',
        },
        // Traefik calls /verify once per proxied request to EVERY
        // protected host, so once any router migrates onto lilnas-auth
        // this becomes the highest-volume route in the app by a wide
        // margin — one completion line per static asset, image, and XHR on
        // every migrated page load. Left at pino-http's default
        // (autoLogging on for every route), that buries the one signal
        // this service actually defines on this path
        // (verify-session-check-error) in routine noise and puts a stdout
        // write on the path the plan describes as "a header read plus two
        // in-memory map lookups." /health is excluded for the same reason
        // at a smaller scale — a liveness probe polling continuously.
        // `autoLogging.ignore`, not `exclude`: this keeps pino-http's own
        // middleware running (so request-scoped context stays available to
        // that explicit error log line) and only suppresses the automatic
        // completion log, rather than skipping instrumentation entirely.
        autoLogging: {
          ignore: req => req.url === '/verify' || req.url === '/health',
        },
      },
    }),
  ],
  controllers: [
    HealthController,
    VerifyController,
    RequestsController,
    AdminController,
    MeController,
  ],
  providers: [
    VerifyService,
    RequestsService,
    AdminGuard,
    ServiceRegistryService,
    UsersService,
  ],
})
export class AppModule {}
