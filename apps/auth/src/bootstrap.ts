import { env } from '@lilnas/utils/env'
import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { EnvKeys } from './env'

export async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // U3: required for @thallesp/nestjs-better-auth's mount to work AT ALL,
    // not an optional hardening. Nest enables Express's own json()/
    // urlencoded() body parser globally by default — confirmed against the
    // installed @nestjs/core@11.1.6 source (nest-application.js's init():
    // `useBodyParser = appOptions.bodyParser !== false`, called BEFORE
    // registerModules() ever runs a module's own configure()-registered
    // middleware). Left at its default here, that global parser would
    // consume the raw request body ahead of AuthModule's own
    // SkipBodyParsingMiddleware (registered later, during module
    // bootstrap), leaving nothing for Better Auth's own handler — which
    // parses the raw body itself — to read on every POST-based route,
    // including the very first step of sign-in (`POST
    // /api/auth/sign-in/social`). This is the exact same fix, for the exact
    // same reason, as apps/tdr-code/src/bootstrap.ts's identical
    // `bodyParser: false` (see that file's comment). AuthModule re-adds
    // json()/urlencoded() for every route OUTSIDE its own '/api/auth'
    // mount, so this does not regress `GET /health` or any future
    // JSON-bodied route — see src/auth/auth.module.ts and
    // src/auth/__tests__/auth-mount.spec.ts's body-parser regression guard.
    bodyParser: false,
  })
  app.useLogger(app.get(Logger))

  const port = +env(EnvKeys.BACKEND_PORT)
  await app.listen(port)

  console.log(`Started backend server at http://localhost:${port}`)
}
