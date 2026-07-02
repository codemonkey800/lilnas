import { Module } from '@nestjs/common'

import { BotStatusService } from 'src/bot/bot-status.service'
import { SupervisorModule } from 'src/supervisor/supervisor.module'

import { AuthAdminController } from './auth-admin.controller'
import { ConfigController } from './config.controller'
import { ConfigService } from './config.service'
import { EventsController } from './events.controller'
import { EventsService } from './events.service'
import { GitIdentityController } from './git-identity.controller'
import { GitIdentityService } from './git-identity.service'
import { LifecycleController } from './lifecycle.controller'
import { LiveController } from './live.controller'
import { LiveService } from './live.service'
import { ReconcileController } from './reconcile.controller'
import { ReconcileService } from './reconcile.service'
import { SessionsController } from './sessions.controller'
import { SessionsService } from './sessions.service'

// ConsoleModule: read + lifecycle endpoints for the operator console.
// Imports SupervisorModule (NestJS deduplication keeps SupervisorService a
// singleton — do NOT add SupervisorService to providers here).
// DB is global (@Global DatabaseModule) — no DatabaseModule import needed.
@Module({
  imports: [SupervisorModule],
  controllers: [
    LiveController,
    LifecycleController,
    SessionsController,
    EventsController,
    ReconcileController,
    ConfigController,
    GitIdentityController,
    // U4: session-revocation break-glass (see auth-admin.controller.ts's
    // own header comment). Has no *Service — the controller reads/writes
    // through auth-session.repo.ts directly, mirroring health.controller
    // .ts's direct-DB-inject shape rather than the service-per-controller
    // pattern the rest of this module uses, since there is no read-side
    // response-shaping logic to warrant a service layer here.
    AuthAdminController,
  ],
  providers: [
    LiveService,
    SessionsService,
    EventsService,
    ReconcileService,
    BotStatusService,
    ConfigService,
    GitIdentityService,
  ],
})
export class ConsoleModule {}
