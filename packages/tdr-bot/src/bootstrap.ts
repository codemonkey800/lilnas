import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'

import { env } from 'src/utils/env'

import { AppModule } from './app.module'
import { GraphTestModule } from './graph-test.module'

export async function bootstrapApp() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))

  const port = +env('BACKEND_PORT')
  await app.listen(port)

  console.log(`Started backend server at http://localhost:${port}`)
}

export async function bootstrapGraphTest() {
  const app = await NestFactory.createApplicationContext(GraphTestModule, {
    bufferLogs: true,
  })
  app.useLogger(app.get(Logger))
  app.get(GraphTestModule).test()
}
