import http from 'node:http'

import { Controller, Get, Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { eq } from 'drizzle-orm'
import { PinoLogger } from 'nestjs-pino'

import { AuthGuard } from 'src/auth/auth.guard'
import { AuthModule } from 'src/auth/auth.module'
import { isDevLoginEnabled, SYNTHETIC_USER } from 'src/auth/dev-login.plugin'
import { DB } from 'src/db/database.module'
import { account, session, user } from 'src/db/schema'
import type { TestDb } from 'src/db/test-db'
import { createTestDb } from 'src/db/test-db'
import { EnvKeys } from 'src/env'
import * as backendLoggerModule from 'src/logging/backend-logger'
import { LOG_EVENTS } from 'src/logging/log-events'

// Same test-env scoping convention as auth-mount.spec.ts / guild-gate.spec.ts
// / auth.guard.spec.ts / auth-e2e.spec.ts — obviously-fake test values,
// scoped to this file only (not the shared src/__tests__/setup.ts).
process.env.BETTER_AUTH_URL = 'https://tdr-code.lilnas.io'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.DISCORD_CLIENT_ID = 'test-discord-client-id'
process.env.DISCORD_CLIENT_SECRET = 'test-discord-client-secret'
// setup.ts does NOT set TDR_CODE_DEV_LOGIN / TDR_CODE_DEV_LOGIN_SECRET — both
// are absent by default, matching production's real default posture. Each
// describe block below sets/clears them explicitly for its own scenario.

const ALLOWED_ORIGIN =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'
const DEV_LOGIN_SECRET = 'test-dev-login-secret-not-a-real-secret'

// Same minimal http.request wrapper as every other Phase D auth spec (no
// supertest dependency in this workspace).
type JsonResponse = {
  status: number
  headers: http.IncomingHttpHeaders
  body: unknown
  rawBody: string
}

function request(
  port: number,
  options: {
    method: string
    path: string
    headers?: Record<string, string>
    body?: string
  },
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk as Buffer))
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8')
          let body: unknown = undefined
          try {
            body = rawBody.length > 0 ? JSON.parse(rawBody) : undefined
          } catch {
            body = rawBody
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            rawBody,
          })
        })
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

// Mirrors auth-mount.spec.ts / guild-gate.spec.ts's own makeTestDatabaseModule
// — AuthModule's forRootAsync({ inject: [DB], ... }) factory resolves DB from
// this module without needing the real DatabaseModule (which opens a real
// file).
function makeTestDatabaseModule(db: TestDb['db']) {
  @Global()
  @Module({
    providers: [{ provide: DB, useValue: db }],
    exports: [DB],
  })
  class TestDatabaseModule {}
  return TestDatabaseModule
}

// Same fakeLogger() shape as auth-e2e.spec.ts's own PinoLogger stand-in —
// AuthGuard (registered as APP_GUARD below) needs a PinoLogger injectable,
// and nestjs-pino's real LoggerModule is out of scope for this suite.
function fakePinoLogger(): PinoLogger {
  return {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    setContext: jest.fn(),
  } as unknown as PinoLogger
}

// A minimal throwaway protected route (no @Public()) for the guard-
// acceptance scenario below — proves a dev-login-minted cookie satisfies
// AuthGuard's real auth.api.getSession() check, without needing to import
// the app's full controller surface (protected-routes.ts's own PROTECTED_
// ROUTES sweep already covers that separately in auth.guard.spec.ts /
// auth-e2e.spec.ts).
@Controller()
class PingController {
  @Get('ping')
  ping() {
    return { ok: true }
  }
}

// Same Object.defineProperty technique as auth-mount.spec.ts's setNodeEnv —
// @types/node's ProcessEnv.NODE_ENV is typed readonly via Next.js's global
// augmentation, so plain assignment is a TS error here.
function setNodeEnv(value: string) {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value,
    writable: true,
  })
}

describe('isDevLoginEnabled() — pure function, no DB/HTTP', () => {
  const ORIGINAL_FLAG = process.env[EnvKeys.TDR_CODE_DEV_LOGIN]
  const ORIGINAL_SECRET = process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET]

  afterEach(() => {
    setNodeEnv('test')
    if (ORIGINAL_FLAG === undefined)
      delete process.env[EnvKeys.TDR_CODE_DEV_LOGIN]
    else process.env[EnvKeys.TDR_CODE_DEV_LOGIN] = ORIGINAL_FLAG
    if (ORIGINAL_SECRET === undefined) {
      delete process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET]
    } else {
      process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET] = ORIGINAL_SECRET
    }
  })

  it('throws when the flag is set AND NODE_ENV=production (prod fail-fast)', () => {
    process.env[EnvKeys.TDR_CODE_DEV_LOGIN] = '1'
    process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET] = DEV_LOGIN_SECRET
    setNodeEnv('production')

    expect(() => isDevLoginEnabled()).toThrow(
      'TDR_CODE_DEV_LOGIN must never be set in production',
    )
  })

  it('returns false when the flag is unset, regardless of NODE_ENV or secret', () => {
    delete process.env[EnvKeys.TDR_CODE_DEV_LOGIN]
    process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET] = DEV_LOGIN_SECRET
    setNodeEnv('development')

    expect(isDevLoginEnabled()).toBe(false)
  })

  it('returns false when the flag is set but is not the exact literal "1"', () => {
    process.env[EnvKeys.TDR_CODE_DEV_LOGIN] = 'true'
    process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET] = DEV_LOGIN_SECRET
    setNodeEnv('development')

    expect(isDevLoginEnabled()).toBe(false)
  })

  it('returns false when the flag is set and NODE_ENV is not production, but no secret is configured', () => {
    process.env[EnvKeys.TDR_CODE_DEV_LOGIN] = '1'
    delete process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET]
    setNodeEnv('development')

    expect(isDevLoginEnabled()).toBe(false)
  })

  it('returns true when all three gates hold (flag=1, not production, secret set)', () => {
    process.env[EnvKeys.TDR_CODE_DEV_LOGIN] = '1'
    process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET] = DEV_LOGIN_SECRET
    setNodeEnv('development')

    expect(isDevLoginEnabled()).toBe(true)
  })
})

describe('dev-login mount — gate OFF (default posture)', () => {
  // Deliberately NOT typed as @nestjs/common's INestApplication — see
  // auth-mount.spec.ts's identical comment for why (a cross-package nominal
  // type mismatch from @nestjs/testing resolving to a different copy of
  // @nestjs/common than this app depends on directly).
  let app: { close: () => Promise<void> }
  let port: number
  let testDb: TestDb

  beforeAll(async () => {
    delete process.env[EnvKeys.TDR_CODE_DEV_LOGIN]
    delete process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET]

    testDb = createTestDb()
    const TestDatabaseModule = makeTestDatabaseModule(testDb.db)

    @Module({ imports: [TestDatabaseModule, AuthModule] })
    class TestAppModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile()

    const nestApp = moduleRef.createNestApplication({ bodyParser: false })
    await nestApp.init()
    await nestApp.listen(0, '127.0.0.1')

    const address = nestApp.getHttpServer().address()
    if (address === null || typeof address === 'string') {
      throw new Error('expected app to listen on a resolved TCP address')
    }
    port = address.port
    app = nestApp
  })

  afterAll(async () => {
    await app.close()
    testDb.close()
  })

  it('POST /auth/dev-login 404s — the endpoint is structurally absent, not merely rejecting', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/auth/dev-login',
      headers: {
        origin: ALLOWED_ORIGIN,
        'x-dev-login-secret': DEV_LOGIN_SECRET,
      },
    })

    expect(res.status).toBe(404)
  })
})

describe('dev-login mount — gate ON', () => {
  let app: { close: () => Promise<void> }
  let port: number
  let testDb: TestDb
  let pinoLogger: PinoLogger

  beforeAll(async () => {
    process.env[EnvKeys.TDR_CODE_DEV_LOGIN] = '1'
    process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET] = DEV_LOGIN_SECRET

    testDb = createTestDb()
    pinoLogger = fakePinoLogger()
    const TestDatabaseModule = makeTestDatabaseModule(testDb.db)

    @Module({
      imports: [TestDatabaseModule, AuthModule],
      controllers: [PingController],
      providers: [
        { provide: PinoLogger, useValue: pinoLogger },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    })
    class TestAppModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile()

    const nestApp = moduleRef.createNestApplication({ bodyParser: false })
    await nestApp.init()
    await nestApp.listen(0, '127.0.0.1')

    const address = nestApp.getHttpServer().address()
    if (address === null || typeof address === 'string') {
      throw new Error('expected app to listen on a resolved TCP address')
    }
    port = address.port
    app = nestApp
  })

  afterAll(async () => {
    await app.close()
    testDb.close()
  })

  // Runs FIRST (Jest executes describes/its in file order within one file) —
  // load-bearing for its own "no rows created" assertions, which only mean
  // something before the happy-path describe below has minted anything.
  describe('1. secret required', () => {
    it('missing secret header -> 403, no session/user row created, devLoginRejected logged', async () => {
      const getBackendLoggerSpy = jest
        .spyOn(backendLoggerModule, 'getBackendLogger')
        .mockReturnValue(
          pinoLogger as unknown as ReturnType<
            typeof backendLoggerModule.getBackendLogger
          >,
        )

      try {
        const res = await request(port, {
          method: 'POST',
          path: '/auth/dev-login',
          headers: { origin: ALLOWED_ORIGIN },
        })

        expect(res.status).toBe(403)
        expect(res.body).toMatchObject({ message: 'forbidden' })
        expect(pinoLogger.warn).toHaveBeenCalledWith(
          { event: LOG_EVENTS.devLoginRejected },
          expect.any(String),
        )

        const rows = testDb.db
          .select()
          .from(user)
          .where(eq(user.email, SYNTHETIC_USER.email))
          .all()
        expect(rows).toHaveLength(0)
      } finally {
        getBackendLoggerSpy.mockRestore()
      }
    })

    it('wrong secret header -> 403, no session/user row created', async () => {
      const res = await request(port, {
        method: 'POST',
        path: '/auth/dev-login',
        headers: {
          origin: ALLOWED_ORIGIN,
          'x-dev-login-secret': 'not-the-right-secret',
        },
      })

      expect(res.status).toBe(403)
      expect(res.body).toMatchObject({ message: 'forbidden' })

      const rows = testDb.db
        .select()
        .from(user)
        .where(eq(user.email, SYNTHETIC_USER.email))
        .all()
      expect(rows).toHaveLength(0)
    })
  })

  describe('2. happy path', () => {
    it('correct secret -> 200, a session row exists for the synthetic user, Set-Cookie carries the session token, devLoginMinted logged', async () => {
      const getBackendLoggerSpy = jest
        .spyOn(backendLoggerModule, 'getBackendLogger')
        .mockReturnValue(
          pinoLogger as unknown as ReturnType<
            typeof backendLoggerModule.getBackendLogger
          >,
        )

      try {
        const res = await request(port, {
          method: 'POST',
          path: '/auth/dev-login',
          headers: {
            origin: ALLOWED_ORIGIN,
            'x-dev-login-secret': DEV_LOGIN_SECRET,
          },
        })

        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({ ok: true })

        // BETTER_AUTH_URL is https:// in this suite (matching every sibling
        // Phase D spec's own fixture), so the session cookie is
        // __Secure-prefixed — see middleware.ts's getSessionCookieName for
        // the same derivation this app's own page gate relies on.
        const setCookieHeaders = res.headers['set-cookie'] ?? []
        expect(
          setCookieHeaders.some(entry =>
            entry.startsWith('__Secure-better-auth.session_token='),
          ),
        ).toBe(true)

        const userRows = testDb.db
          .select()
          .from(user)
          .where(eq(user.email, SYNTHETIC_USER.email))
          .all()
        expect(userRows).toHaveLength(1)

        const sessionRows = testDb.db
          .select()
          .from(session)
          .where(eq(session.userId, userRows[0]!.id))
          .all()
        expect(sessionRows).toHaveLength(1)

        expect(pinoLogger.warn).toHaveBeenCalledWith(
          {
            event: LOG_EVENTS.devLoginMinted,
            userId: userRows[0]!.id,
          },
          expect.any(String),
        )
      } finally {
        getBackendLoggerSpy.mockRestore()
      }
    })

    it('the synthetic user has no `account` row — the guild gate is never touched', async () => {
      const userRows = testDb.db
        .select()
        .from(user)
        .where(eq(user.email, SYNTHETIC_USER.email))
        .all()
      expect(userRows).toHaveLength(1)

      const accountRows = testDb.db
        .select()
        .from(account)
        .where(eq(account.userId, userRows[0]!.id))
        .all()
      expect(accountRows).toHaveLength(0)
    })
  })

  describe('3. idempotent find-or-create on repeat login', () => {
    it('logging in again reuses the same user row instead of creating a second one', async () => {
      const before = testDb.db
        .select()
        .from(user)
        .where(eq(user.email, SYNTHETIC_USER.email))
        .all()
      expect(before).toHaveLength(1)
      const existingUserId = before[0]!.id

      const res = await request(port, {
        method: 'POST',
        path: '/auth/dev-login',
        headers: {
          origin: ALLOWED_ORIGIN,
          'x-dev-login-secret': DEV_LOGIN_SECRET,
        },
      })
      expect(res.status).toBe(200)

      const after = testDb.db
        .select()
        .from(user)
        .where(eq(user.email, SYNTHETIC_USER.email))
        .all()
      expect(after).toHaveLength(1)
      expect(after[0]!.id).toBe(existingUserId)

      // A second call also mints its OWN session row (createSession is
      // unconditional on every call) — only the USER row is find-or-create.
      const sessionRows = testDb.db
        .select()
        .from(session)
        .where(eq(session.userId, existingUserId))
        .all()
      expect(sessionRows.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('4. guard acceptance — the minted cookie is indistinguishable from a real session to AuthGuard', () => {
    it('GET /ping -> 401 with no cookie (the guard is genuinely wired, not a no-op)', async () => {
      const res = await request(port, { method: 'GET', path: '/ping' })
      expect(res.status).toBe(401)
    })

    it('GET /ping -> 200 with the dev-login-minted cookie (AuthGuard.getSession() accepts it)', async () => {
      const mintRes = await request(port, {
        method: 'POST',
        path: '/auth/dev-login',
        headers: {
          origin: ALLOWED_ORIGIN,
          'x-dev-login-secret': DEV_LOGIN_SECRET,
        },
      })
      expect(mintRes.status).toBe(200)
      const setCookieHeaders = mintRes.headers['set-cookie']
      if (!setCookieHeaders) throw new Error('dev-login did not set a cookie')
      const cookieHeader = setCookieHeaders
        .map(entry => entry.split(';')[0])
        .join('; ')

      const res = await request(port, {
        method: 'GET',
        path: '/ping',
        headers: { cookie: cookieHeader },
      })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ ok: true })
    })
  })
})
