import { env } from '@lilnas/utils/env'
import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { IntentsBitField } from 'discord.js'
import { NecordModule } from 'necord'
import { NestMinioModule } from 'nestjs-minio'
import { LoggerModule } from 'nestjs-pino'

import { ApiModule } from './api/api.module'
import { AppEventsService } from './app-events.service'
import { CommandsModule } from './commands/commands.module'
import { MessageHandlerModule } from './message-handler/message-handler.module'
import { SchedulesModule } from './schedules/schedules.module'
import { ServicesModule } from './services/services.module'
import { StateModule } from './state/state.module'
import { EnvKey } from './utils/env'

@Module({
  imports: [
    ApiModule,
    CommandsModule,
    EventEmitterModule.forRoot(),
    LoggerModule.forRoot(),
    MessageHandlerModule,
    NestMinioModule.register({
      accessKey: env<EnvKey>('MINIO_ACCESS_KEY'),
      endPoint: env<EnvKey>('MINIO_HOST'),
      isGlobal: true,
      port: +env<EnvKey>('MINIO_PORT'),
      secretKey: env<EnvKey>('MINIO_SECRET_KEY'),
      useSSL: false,
    }),
    NecordModule.forRoot({
      development: [env<EnvKey>('DISCORD_DEV_GUILD_ID', '')],
      token: env<EnvKey>('DISCORD_API_TOKEN'),
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
    ServicesModule,
    StateModule,
    // Sets up scheduled functions
    SchedulesModule,
  ],

  providers: [AppEventsService],
})
export class AppModule {}
