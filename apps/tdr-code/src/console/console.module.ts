import { Module } from '@nestjs/common'

import { BotStatusService } from 'src/bot/bot-status.service'
import { SupervisorModule } from 'src/supervisor/supervisor.module'

import { ConfigController } from './config.controller'
import { ConfigService } from './config.service'
import { EventsController } from './events.controller'
import { GitIdentityController } from './git-identity.controller'
import { GitIdentityService } from './git-identity.service'
import { EventsService } from './events.service'
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
