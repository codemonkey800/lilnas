import { env } from '@lilnas/utils/env'
import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { IntentsBitField } from 'discord.js'
import { NecordModule } from 'necord'
import { LoggerModule } from 'nestjs-pino'

import { DatabaseModule } from './db/database.module'
import { DiscordModule } from './discord/discord.module'
import { EnvKeys } from './env'
import { buildLoggerOptions } from './logger'

// Bot process module: Discord gateway, session manager, claude agents.
// Does NOT run migrations (main server migrates before spawning the bot).
// ScheduleModule lives here because the bot owns heartbeat + command poller.
@Module({
  imports: [
    DatabaseModule.forRoot({ migrate: false }),
    LoggerModule.forRoot(buildLoggerOptions('bot')),
    ScheduleModule.forRoot(),
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
    DiscordModule,
  ],
})
export class BotModule {}
