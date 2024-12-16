import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { IntentsBitField } from 'discord.js'
import { NecordModule } from 'necord'
import { LoggerModule } from 'nestjs-pino'

import { ApiModule } from './api/api.module'
import { AppEventsService } from './app-events.service'
import { CommandsModule } from './commands/commands.module'
import { MessageHandlerModule } from './message-handler/message-handler.module'
import { SchedulesModule } from './schedules/schedules.module'
import { env } from './utils/env'

@Module({
  imports: [
    ApiModule,
    CommandsModule,
    EventEmitterModule.forRoot(),
    LoggerModule.forRoot(),
    MessageHandlerModule,
    NecordModule.forRoot({
      development: [env('DISCORD_DEV_GUILD_ID', '')],
      token: env('DISCORD_API_TOKEN'),
      intents: [
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.DirectMessages,
      ],
    }),
    // Sets up scheduling logic:
    // https://docs.nestjs.com/techniques/task-scheduling
    ScheduleModule.forRoot(),
    // Sets up scheduled functions
    SchedulesModule,
  ],

  providers: [AppEventsService],
})
export class AppModule {}
