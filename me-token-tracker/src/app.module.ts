import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { IntentsBitField } from 'discord.js'
import { NecordModule } from 'necord'
import { LoggerModule } from 'nestjs-pino'

import { AppEventsService } from './app-events.service'
import { SchedulesModule } from './schedules/schedules.module'
import { StatusService } from './status.service'
import { env } from './utils/env'

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    LoggerModule.forRoot(),
    NecordModule.forRoot({
      development: [env('DEV_GUILD_ID', '')],
      token: env('API_TOKEN'),
      intents: [
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.Guilds,
      ],
    }),
    // Sets up scheduling logic:
    // https://docs.nestjs.com/techniques/task-scheduling
    ScheduleModule.forRoot(),
    // Sets up scheduled functions
    SchedulesModule,
  ],

  providers: [AppEventsService, StatusService],
})
export class AppModule {}
