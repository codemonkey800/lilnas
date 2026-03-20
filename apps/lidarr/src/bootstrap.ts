import { NestFactory } from '@nestjs/core'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'

const PORT = 8080

export async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.useWebSocketAdapter(new IoAdapter(app))
  app.enableShutdownHooks()

  await app.listen(PORT)

  console.log(`Started backend server at http://localhost:${PORT}`)
}
