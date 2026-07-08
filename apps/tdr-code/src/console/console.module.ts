import { Module } from '@nestjs/common'

import { BotStatusService } from 'src/bot/bot-status.service'
import { SupervisorModule } from 'src/supervisor/supervisor.module'

import { AuthAdminController } from './auth-admin.controller'
import { ConfigController } from './config.controller'
import { ConfigService } from './config.service'
import { DiscordDirectoryService } from './discord-directory.service'
import { EventsController } from './events.controller'
import { EventsService } from './events.service'
import { GitIdentityController } from './git-identity.controller'
import { GitIdentityService } from './git-identity.service'
import { GitRosterController } from './git-roster.controller'
import { GitRosterService } from './git-roster.service'
import { GithubLinkController } from './github-link.controller'
import { GithubLinkService } from './github-link.service'
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
    // GitHub-linking plan (U3): self-unlink + break-glass clear (R13), and
    // the shared GitHub+SSH roster (R3). GitRosterController reuses the
    // already-registered DiscordDirectoryService below rather than a second
    // instance. GitIdentityController no longer injects DiscordDirectoryService
    // itself (U5 removed its discord-members dropdown route — R2), but the
    // service stays registered here for GitRosterService.
    GithubLinkController,
    GitRosterController,
  ],
  providers: [
    LiveService,
    SessionsService,
    EventsService,
    ReconcileService,
    BotStatusService,
    ConfigService,
    GitIdentityService,
    DiscordDirectoryService,
    GithubLinkService,
    GitRosterService,
  ],
})
export class ConsoleModule {}
