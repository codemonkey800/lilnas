import { NestFactory } from '@nestjs/core'
import { IoAdapter } from '@nestjs/platform-socket.io'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { pool } from './db'
import { EnvKeys, validateEnv } from './env'

/**
 * Initializes and starts the NestJS backend with Pino logging,
 * cookie parsing, and WebSocket support via Socket.IO.
 */
export async function bootstrap() {
  validateEnv()

  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.use(helmet())
  app.use(cookieParser())
  app.useWebSocketAdapter(new IoAdapter(app))
  app.enableShutdownHooks()

  const logger = app.get(Logger)

  process.on('SIGTERM', () => {
    void pool.end().catch((err: unknown) => {
      logger.error(
        'Error closing DB pool',
        err instanceof Error ? err.stack : String(err),
        'bootstrap',
      )
    })
  })

  const port = +(process.env[EnvKeys.BACKEND_PORT] ?? 8081)
  await app.listen(port)

  logger.log(`Started backend server at http://localhost:${port}`, 'bootstrap')
}
