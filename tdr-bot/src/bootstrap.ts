import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'

import { env } from 'src/utils/env'

import { AppModule } from './app.module'

export async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))

  const port = +env('BACKEND_PORT')
  await app.listen(port)

  console.log(`Started backend server at http://localhost:${port}`)
}
