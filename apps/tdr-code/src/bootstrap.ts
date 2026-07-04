import { env } from '@lilnas/utils/env'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { loadMasterKey } from './crypto/master-key'
import { EnvKeys } from './env'
import { initBackendLogger } from './logging/backend-logger'
import { logFilePath } from './logging/log-paths'

export async function bootstrapApp() {
  // As early as possible — before any code path in this process might log
  // through getBackendLogger() (the 8 non-DI files, several of which sit on
  // the auth/crypto path exercised during module init below). See
  // backend-logger.ts's header comment for why this is a per-process root,
  // not a module-level singleton.
  initBackendLogger('main')

  // Restrict file creation permissions before opening the SQLite WAL — so the
  // DB files (data.db / -wal / -shm) are not world-readable on a shared host.
  // Phase C stores SSH key ciphertext in the same file.
  process.umask(0o077)

  // Fail fast if the master key is missing or misconfigured — never boot into
  // a silent fleet-wide decrypt_failed state (Decision #7).
  loadMasterKey()

  // bodyParser: false disables Nest's built-in body parser entirely.
  // @thallesp/nestjs-better-auth's SkipBodyParsingMiddleware (wired via
  // AuthModule in auth.module.ts) re-adds express.json()/urlencoded() for
  // every route except the Better Auth mount's basePath ('/auth' — see
  // auth.ts), so the console controllers' @Body() (PUT /config,
  // POST /git-identity, etc.) still receive parsed JSON — see
  // auth-mount.spec.ts for the regression guard. helmet()/cookieParser()
  // below run as raw app.use() middleware ahead of any router-level body
  // parsing either way, so this ordering is unaffected by the change: they
  // read headers/cookies, not the body, and never consume it.
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  })
  app.useLogger(app.get(Logger))
  app.use(helmet())
  app.use(cookieParser())
  app.enableShutdownHooks()

  const shutdown = () => {
    const forceExit = setTimeout(() => process.exit(1), 8_000)
    forceExit.unref()
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  const port = +env(EnvKeys.BACKEND_PORT, '8082')
  // Bind to loopback only: browser→Traefik→nginx→localhost:8082 is unchanged;
  // this removes the host's non-loopback interfaces from the attack surface now
  // that mutating endpoints (restart/teardown) and raw-transcript reads ship.
  await app.listen(port, '127.0.0.1')

  // Printed here (real process start), not inside buildLoggerOptions()/
  // logging.module.ts at import time, so a test importing those modules
  // never sees this — see logFilePath('backend')'s own header comment for
  // why main and bot share one file. This process hosts LoggingModule's
  // BrowserLogsController, so it also owns announcing the browser-log file.
  console.log(`[tdr-code] backend logs: ${logFilePath('backend')}`)
  console.log(
    `[tdr-code] frontend-browser logs: ${logFilePath('frontend-browser')}`,
  )
}
