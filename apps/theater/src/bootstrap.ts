import { env } from '@lilnas/utils/env'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { EnvKeys } from './env'

export async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.use(cookieParser(env(EnvKeys.THEATER_SESSION_SECRET)))

  const port = +env(EnvKeys.BACKEND_PORT)
  await app.listen(port)

  console.log(`Started backend server at http://localhost:${port}`)
}
