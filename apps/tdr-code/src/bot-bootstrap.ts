import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'

import { BotModule } from './bot.module'

export async function bootstrapBot() {
  // Bot has no HTTP server — createApplicationContext gives full DI + lifecycle
  // hooks (onModuleInit, onApplicationShutdown) without binding a port.
  // If Necord requires a full HTTP app, fall back to NestFactory.create(BotModule)
  // without app.listen() (deferred check in U3 per the plan).
  const app = await NestFactory.createApplicationContext(BotModule, {
    bufferLogs: true,
  })
  app.useLogger(app.get(Logger))
  app.enableShutdownHooks()

  const shutdown = () => {
    const forceExit = setTimeout(() => process.exit(1), 8_000)
    forceExit.unref()
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
