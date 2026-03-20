import { NestFactory } from '@nestjs/core'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { EnvKeys } from './env'

const DEFAULT_PORT = 8080

export async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.useWebSocketAdapter(new IoAdapter(app))
  app.enableShutdownHooks()

  const port = parseInt(process.env[EnvKeys.PORT] ?? String(DEFAULT_PORT), 10)
  await app.listen(port)

  console.log(`Started backend server at http://localhost:${port}`)
}
