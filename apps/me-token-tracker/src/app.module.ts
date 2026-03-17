import { env } from '@lilnas/utils/env'
import { MetricsInterceptor } from '@lilnas/utils/metrics-interceptor'
import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { PrometheusModule } from '@willsoto/nestjs-prometheus'
import { IntentsBitField } from 'discord.js'
import { NecordModule } from 'necord'
import { LoggerModule } from 'nestjs-pino'

import { EnvKeys } from './env'
import { AppEventsService } from './services/app-events.service'
import { SchedulesService } from './services/schedules.service'
import { StatusService } from './services/status.service'

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    LoggerModule.forRoot(),
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
    NecordModule.forRoot({
      development: [env(EnvKeys.DEV_GUILD_ID, '')],
      token: env(EnvKeys.API_TOKEN),
      intents: [
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.Guilds,
      ],
    }),
    // Sets up scheduling logic:
    // https://docs.nestjs.com/techniques/task-scheduling
    ScheduleModule.forRoot(),
  ],

  providers: [
    AppEventsService,
    StatusService,
    SchedulesService,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule {}
