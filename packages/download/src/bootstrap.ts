import { env } from '@lilnas/utils/env'
import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { EnvKey } from './utils/env'

export async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))

  const port = +env<EnvKey>('BACKEND_PORT')
  await app.listen(port)

  console.log(`Started backend server at http://localhost:${port}`)
}
