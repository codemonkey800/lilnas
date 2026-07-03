import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { LoggerModule } from 'nestjs-pino'

import { AuthGuard } from './auth/auth.guard'
import { AuthModule } from './auth/auth.module'
import { BotStatusController } from './bot/bot-status.controller'
import { BotStatusService } from './bot/bot-status.service'
import { HealthController } from './bot/health.controller'
import { ConsoleModule } from './console/console.module'
import { DatabaseModule } from './db/database.module'
import { buildLoggerOptions } from './logger'
import { LoggingModule } from './logging/logging.module'
import { SupervisorModule } from './supervisor/supervisor.module'

// Main-server module: owns the DB (with migration), exposes HTTP controllers
// and the SupervisorModule. No Necord/Discord — those live in BotModule.
//
// U4: AuthGuard (src/auth/auth.guard.ts) is registered here as the ONE
// global APP_GUARD — deny-by-default (R19) on every /api/* route except
// @Public()-annotated handlers (currently only HealthController.health()).
// This is the app's hand-rolled guard, NOT @thallesp/nestjs-better-auth's
// own AuthGuard — that library guard is explicitly disabled via
// disableGlobalAuthGuard: true in auth.module.ts specifically so this is the
// only guard in the pipeline (see auth.guard.ts's own header comment for
// why running both would be a self-inflicted health-probe outage).
@Module({
  imports: [
    DatabaseModule.forRoot({ migrate: true }),
    LoggerModule.forRoot(buildLoggerOptions('main')),
    SupervisorModule,
    ConsoleModule,
    AuthModule,
    LoggingModule,
  ],
  controllers: [BotStatusController, HealthController],
  providers: [BotStatusService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
