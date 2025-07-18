import { env } from '@lilnas/utils/env'
import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { IntentsBitField } from 'discord.js'
import { NecordModule } from 'necord'
import { LoggerModule } from 'nestjs-pino'

import { AppEventsService } from './services/app-events.service'
import { SchedulesService } from './services/schedules.service'
import { StatusService } from './services/status.service'
import { EnvKey } from './utils/env'

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    LoggerModule.forRoot(),
    NecordModule.forRoot({
      development: [env<EnvKey>('DEV_GUILD_ID', '')],
      token: env<EnvKey>('API_TOKEN'),
      intents: [
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.Guilds,
      ],
    }),
    // Sets up scheduling logic:
    // https://docs.nestjs.com/techniques/task-scheduling
    ScheduleModule.forRoot(),
  ],

  providers: [AppEventsService, StatusService, SchedulesService],
})
export class AppModule {}
