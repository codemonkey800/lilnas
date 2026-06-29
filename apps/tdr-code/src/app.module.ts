import { env } from '@lilnas/utils/env'
import { Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'

import { DatabaseModule } from './db/database.module'
import { EnvKeys } from './env'

function buildLoggerOptions() {
  const isProduction = env(EnvKeys.NODE_ENV, 'development') === 'production'
  if (isProduction) {
    return { pinoHttp: { level: 'info' } }
  }
  return {
    pinoHttp: {
      transport: { target: 'pino-pretty' },
      level: 'debug',
    },
  }
}

// Main-server module: owns the DB (with migration), exposes HTTP controllers
// and the SupervisorModule. No Necord/Discord — those live in BotModule.
@Module({
  imports: [
    DatabaseModule.forRoot({ migrate: true }),
    LoggerModule.forRoot(buildLoggerOptions()),
  ],
})
export class AppModule {}
