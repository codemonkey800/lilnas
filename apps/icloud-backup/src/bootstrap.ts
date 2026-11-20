import { env } from '@lilnas/utils/env'
import { NestFactory } from '@nestjs/core'
import { WsAdapter } from '@nestjs/platform-ws'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { EnvKeys } from './env'

// Migrations and crash recovery are not run here: the modules that own that
// state do it in their own lifecycle hooks (OnModuleInit /
// OnApplicationBootstrap), so this stays a plain Nest boot.
export async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, { bufferLogs: true })
    app.useWebSocketAdapter(new WsAdapter(app))
    app.useLogger(app.get(Logger))
    app.enableShutdownHooks()

    const port = +env(EnvKeys.BACKEND_PORT, '8081')
    await app.listen(port)

    console.log(`Started backend server at http://localhost:${port}`)
  } catch (err) {
    // Plain console.error (not the pino Logger) deliberately: if create()
    // itself failed, `app` (and app.get(Logger)) may not exist.
    console.error('icloud-backup: fatal boot error; exiting', err)
    process.exit(1)
  }
}
