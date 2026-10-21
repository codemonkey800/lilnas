import { env } from '@lilnas/utils/env'
import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { EnvKeys } from './env'

export async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, { bufferLogs: true })
    app.useLogger(app.get(Logger))

    const port = +env(EnvKeys.BACKEND_PORT, '8081')
    await app.listen(port)

    console.log(`Started backend server at http://localhost:${port}`)
  } catch (err) {
    // Plain console.error (not the pino Logger) deliberately — if
    // create() itself failed, `app` (and app.get(Logger)) may not exist.
    console.error('dev: fatal boot error; exiting', err)
    process.exit(1)
  }
}
