import { Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'

import { AuthModule } from './auth/auth.module'
import { BotStatusController } from './bot/bot-status.controller'
import { BotStatusService } from './bot/bot-status.service'
import { HealthController } from './bot/health.controller'
import { ConsoleModule } from './console/console.module'
import { DatabaseModule } from './db/database.module'
import { buildLoggerOptions } from './logger'
import { SupervisorModule } from './supervisor/supervisor.module'

// Main-server module: owns the DB (with migration), exposes HTTP controllers
// and the SupervisorModule. No Necord/Discord — those live in BotModule.
@Module({
  imports: [
    DatabaseModule.forRoot({ migrate: true }),
    LoggerModule.forRoot(buildLoggerOptions()),
    SupervisorModule,
    ConsoleModule,
    AuthModule,
  ],
  controllers: [BotStatusController, HealthController],
  providers: [BotStatusService],
})
export class AppModule {}
