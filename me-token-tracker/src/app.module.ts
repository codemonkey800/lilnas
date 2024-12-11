import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { IntentsBitField } from 'discord.js'
import { NecordModule } from 'necord'
import { LoggerModule } from 'nestjs-pino'

import { CommandsModule } from './commands/commands.module'
import { SchedulesModule } from './schedules/schedules.module'
import { env } from './utils/env'

@Module({
  imports: [
    CommandsModule,
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
})
export class AppModule {}
