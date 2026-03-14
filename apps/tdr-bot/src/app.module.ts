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
import { EnvKeys } from './env'
import { MediaModule } from './media/media.module'
import { MessageHandlerModule } from './message-handler/message-handler.module'
import { SchedulesModule } from './schedules/schedules.module'
import { ServicesModule } from './services/services.module'
import { StateModule } from './state/state.module'

@Module({
  imports: [
    ApiModule,
    CommandsModule,
    MediaModule,
    EventEmitterModule.forRoot(),
    LoggerModule.forRoot(
      (() => {
        const isProduction = env(EnvKeys.NODE_ENV) === 'production'
        const logFilePath = env(EnvKeys.LOG_FILE_PATH, '')

        // Production: always JSON to stdout for container logging
        if (isProduction) {
          return {
            pinoHttp: {
              level: 'info',
            },
          }
        }

        // Development with file logging: pretty to both console and file
        if (logFilePath) {
          return {
            pinoHttp: {
              transport: {
                targets: [
                  {
                    target: 'pino-pretty',
                    options: { destination: 1 }, // stdout
                  },
                  {
                    target: 'pino-pretty',
                    options: {
                      destination: logFilePath,
                      mkdir: true,
                    },
                  },
                ],
              },
              level: 'debug',
            },
          }
        }

        // Development without file: pino-pretty to stdout
        return {
          pinoHttp: {
            transport: {
              target: 'pino-pretty',
            },
            level: 'debug',
          },
        }
      })(),
    ),
    MessageHandlerModule,
    NestMinioModule.register({
      accessKey: env(EnvKeys.MINIO_ACCESS_KEY),
      endPoint: env(EnvKeys.MINIO_HOST),
      isGlobal: true,
      port: +env(EnvKeys.MINIO_PORT),
      secretKey: env(EnvKeys.MINIO_SECRET_KEY),
      useSSL: false,
    }),
    NecordModule.forRoot({
      development: [env(EnvKeys.DISCORD_GUILD_ID, '')],
      token: env(EnvKeys.DISCORD_API_TOKEN),
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
