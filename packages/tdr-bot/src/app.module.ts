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
import { MediaModule } from './media/media.module'
import { MessageHandlerModule } from './message-handler/message-handler.module'
import { SchedulesModule } from './schedules/schedules.module'
import { ServicesModule } from './services/services.module'
import { StateModule } from './state/state.module'
import { EnvKey } from './utils/env'

@Module({
  imports: [
    ApiModule,
    CommandsModule,
    MediaModule,
    EventEmitterModule.forRoot(),
    LoggerModule.forRoot(
      (() => {
        const targets = []
        const isProduction = env<EnvKey>('NODE_ENV') === 'production'
        const logFilePath = env<EnvKey>('LOG_FILE_PATH', '')

        // Add console pretty printing in development
        if (!isProduction) {
          targets.push({
            level: 'debug',
            target: 'pino-pretty',
          })
        }

        // Add file logging if path specified
        if (logFilePath) {
          targets.push({
            level: isProduction ? 'info' : 'debug',
            target: 'pino/file',
            options: {
              destination: logFilePath,
              mkdir: true,
            },
          })
        }

        // Use transport with targets if any, otherwise use default
        return targets.length > 0
          ? {
              pinoHttp: {
                transport: { targets },
              },
            }
          : {
              pinoHttp: {
                level: isProduction ? 'info' : 'debug',
              },
            }
      })(),
    ),
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
