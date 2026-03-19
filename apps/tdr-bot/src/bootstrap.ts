import { env } from '@lilnas/utils/env'
import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { EnvKeys } from './env'
import { GraphTestModule } from './graph-test.module'

/**
 * Creates and starts the main NestJS application, sets up
 * graceful shutdown handlers (SIGTERM / SIGINT), and begins
 * listening on the configured backend port.
 */
export async function bootstrapApp() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))

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

  const port = +env(EnvKeys.BACKEND_PORT)
  await app.listen(port)

  console.log(`Started backend server at http://localhost:${port}`)
}

/**
 * Boots a headless NestJS context (no HTTP server) for
 * interactive LLM graph testing via the CLI.
 */
export async function bootstrapGraphTest() {
  const app = await NestFactory.createApplicationContext(GraphTestModule, {
    bufferLogs: true,
  })
  app.useLogger(app.get(Logger))
  app.get(GraphTestModule).test()
}
