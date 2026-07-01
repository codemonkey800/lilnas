import { env } from '@lilnas/utils/env'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { loadMasterKey } from './crypto/master-key'
import { EnvKeys } from './env'

export async function bootstrapApp() {
  // Restrict file creation permissions before opening the SQLite WAL — so the
  // DB files (data.db / -wal / -shm) are not world-readable on a shared host.
  // Phase C stores SSH key ciphertext in the same file.
  process.umask(0o077)

  // Fail fast if the master key is missing or misconfigured — never boot into
  // a silent fleet-wide decrypt_failed state (Decision #7).
  loadMasterKey()

  const app = await NestFactory.create(AppModule, { bufferLogs: true })
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
}
