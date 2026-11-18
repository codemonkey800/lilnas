import { Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'

import { AdminController } from './admin/admin.controller'
import { AdminGuard } from './admin/admin.guard'
import { AdminCheckController } from './admin/admin-check.controller'
import { UsersService } from './admin/users.service'
import { AuthModule } from './auth/auth.module'
import { DatabaseModule } from './db/database.module'
import { HealthController } from './health/health.controller'
import {
  DiscordIdentityController,
  DiscordLinkLookupController,
} from './internal/discord-internal.controller'
import { HostActivityController } from './internal/host-activity.controller'
import { pinoHttpOptions } from './logger.config'
import { MeController } from './me/me.controller'
import { OidcClientsService } from './oidc/oidc-clients.service'
import { RequestsController } from './requests/requests.controller'
import { RequestsService } from './requests/requests.service'
import { GatedHostsService } from './services/gated-hosts.service'
import { HostActivityService } from './services/host-activity.service'
import { ServiceRegistryService } from './services/service-registry.service'
import { SseModule } from './sse/sse.module'
import { AccessCacheModule } from './verify/access-cache.module'
import { StripCookieController } from './verify/strip-cookie.controller'
import { VerifyController } from './verify/verify.controller'
import { VerifyService } from './verify/verify.service'

@Module({
  imports: [
    DatabaseModule.forRoot({ migrate: true }),
    AuthModule,
    AccessCacheModule,
    SseModule,
    // No rate limiter. Port 8081 is never published — every caller is this
    // container's own Next server (Server Components/Actions, over
    // localhost) or Traefik/a sibling container, so a per-IP limit here
    // only ever sees 127.0.0.1 and ends up throttling the app itself: the
    // admin dashboard and every pending page shared one global bucket and
    // 429'd themselves within minutes. Abuse control belongs where the real
    // client IP is visible (Traefik), not behind the Next server.
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions }),
  ],
  controllers: [
    HealthController,
    VerifyController,
    StripCookieController,
    RequestsController,
    AdminController,
    AdminCheckController,
    MeController,
    DiscordLinkLookupController,
    DiscordIdentityController,
    HostActivityController,
  ],
  providers: [
    VerifyService,
    RequestsService,
    AdminGuard,
    ServiceRegistryService,
    GatedHostsService,
    HostActivityService,
    UsersService,
    OidcClientsService,
  ],
})
export class AppModule {}
