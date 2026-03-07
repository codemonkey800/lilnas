import { NestFactory } from '@nestjs/core'
import { IoAdapter } from '@nestjs/platform-socket.io'
import cookieParser from 'cookie-parser'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { EnvKeys } from './env'

/**
 * Initializes and starts the NestJS backend with Pino logging,
 * cookie parsing, and WebSocket support via Socket.IO.
 */
export async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.use(cookieParser())
  app.useWebSocketAdapter(new IoAdapter(app))

  const port = +(process.env[EnvKeys.BACKEND_PORT] ?? 8081)
  await app.listen(port)

  console.log(`Started backend server at http://localhost:${port}`)
}
