import { env } from '@lilnas/utils/env'
import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { IntentsBitField } from 'discord.js'
import { NecordModule } from 'necord'
import { LoggerModule } from 'nestjs-pino'

import { DatabaseModule } from './db/database.module'
import { DiscordModule } from './discord/discord.module'
import { EnvKeys } from './env'

@Module({
  imports: [
    DatabaseModule,
    LoggerModule.forRoot(
      (() => {
        const isProduction =
          env(EnvKeys.NODE_ENV, 'development') === 'production'

        if (isProduction) {
          return { pinoHttp: { level: 'info' } }
        }

        return {
          pinoHttp: {
            transport: { target: 'pino-pretty' },
            level: 'debug',
          },
        }
      })(),
    ),
    NecordModule.forRoot({
      development: [env(EnvKeys.DISCORD_GUILD_ID, '')],
      token: env(EnvKeys.DISCORD_API_TOKEN, ''),
      intents: [
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.DirectMessages,
      ],
    }),
    ScheduleModule.forRoot(),
    DiscordModule,
  ],
})
export class AppModule {}
