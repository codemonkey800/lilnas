import { env } from '@lilnas/utils/env'
import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { EnvKeys } from './env'

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

  const port = +env(EnvKeys.BACKEND_PORT, '8082')
  await app.listen(port)

  console.log(`Started backend server at http://localhost:${port}`)
}
