import { env } from '@lilnas/utils/env'
import { NestFactory } from '@nestjs/core'
import { WsAdapter } from '@nestjs/platform-ws'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { DbService } from './db/db.service'
import { EnvKeys } from './env'

export async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, { bufferLogs: true })
    app.useWebSocketAdapter(new WsAdapter(app))
    app.useLogger(app.get(Logger))

    // Migrations run automatically at boot, hard-fail on a bad integrity
    // check — never serve traffic on a half-migrated schema. Explicit
    // method calls (not DbService.onModuleInit()) keep this sequence
    // linear and visible in one place.
    const dbService = app.get(DbService)
    dbService.runMigrations()
    dbService.checkIntegrity()

    const port = +env(EnvKeys.BACKEND_PORT)
    await app.listen(port)

    console.log(`Started backend server at http://localhost:${port}`)
  } catch (err) {
    // NestFactory.create() itself can throw here (e.g. DbService's
    // constructor opening the sqlite file eagerly, CANTOPEN/EACCES), not
    // just the explicit runMigrations()/checkIntegrity() calls above.
    // Plain console.error (not the pino Logger) deliberately — if
    // create() itself failed, `app` (and app.get(Logger)) may not exist.
    console.error(
      'download: fatal boot error (Nest init, migration, or integrity check failed); exiting',
      err,
    )
    process.exit(1)
  }
}
