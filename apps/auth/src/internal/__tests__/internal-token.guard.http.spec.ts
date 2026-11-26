import http from 'node:http'
import { Writable } from 'node:stream'

import { Controller, Get, Global, Module, UseGuards } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { LoggerModule } from 'nestjs-pino'

import { AdminCheckController } from 'src/admin/admin-check.controller'
import { AuthModule } from 'src/auth/auth.module'
import {
  applyPragmas,
  DB,
  type Db,
  runMigrations,
} from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { HealthController } from 'src/health/health.controller'
import {
  DiscordIdentityController,
  DiscordLinkLookupController,
} from 'src/internal/discord-internal.controller'
import { HostActivityController } from 'src/internal/host-activity.controller'
import { INTERNAL_CALLERS } from 'src/internal/internal-callers'
import { InternalTokenGuard } from 'src/internal/internal-token.guard'
import { pinoHttpOptions } from 'src/logger.config'
import { GatedHostsService } from 'src/services/gated-hosts.service'
import { HostActivityService } from 'src/services/host-activity.service'
import { AccessCacheModule } from 'src/verify/access-cache.module'
import { StripCookieController } from 'src/verify/strip-cookie.controller'
import { VerifyController } from 'src/verify/verify.controller'
import { VerifyService } from 'src/verify/verify.service'

// Drives InternalTokenGuard through a real Nest app over real HTTP, with the
// app's real pino-http config writing to a captured stream, so the log
// assertions see exactly what would reach Loki.

// Obviously-fake values, test-only.
process.env.AUTH_HOST = 'http://auth.localhost.test'
process.env.COOKIE_DOMAIN = '.localhost.test'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.REDIRECT_ALLOWED_SUFFIX = 'localhost.test'
process.env.ADMIN_EMAILS = 'admin@example.com'

type CallerName = 'download' | 'icloud-backup' | 'dev' | 'dev-idle-reaper'

const TOKENS: Record<CallerName, string> = {
  download: 'test-token-download-aaaaaaaaaaaaaaaaaaaaaa',
  'icloud-backup': 'test-token-icloud-backup-bbbbbbbbbbbbbbbbb',
  dev: 'test-token-dev-cccccccccccccccccccccccccccc',
  'dev-idle-reaper': 'test-token-dev-idle-reaper-ddddddddddddddd',
}
const GARBAGE = 'test-token-garbage-eeeeeeeeeeeeeeeeeeeeeeee'

const TOKEN_ENVS = [
  'INTERNAL_TOKEN_DOWNLOAD',
  'INTERNAL_TOKEN_ICLOUD_BACKUP',
  'INTERNAL_TOKEN_DEV',
  'INTERNAL_TOKEN_DEV_IDLE_REAPER',
  'INTERNAL_TOKEN_ENFORCE',
] as const

function setTokens(): void {
  process.env.INTERNAL_TOKEN_DOWNLOAD = TOKENS.download
  process.env.INTERNAL_TOKEN_ICLOUD_BACKUP = TOKENS['icloud-backup']
  process.env.INTERNAL_TOKEN_DEV = TOKENS.dev
  process.env.INTERNAL_TOKEN_DEV_IDLE_REAPER = TOKENS['dev-idle-reaper']
}

const ORIGINAL_ENV = Object.fromEntries(
  TOKEN_ENVS.map(key => [key, process.env[key]]),
)

function restoreEnv(): void {
  for (const key of TOKEN_ENVS) {
    const value = ORIGINAL_ENV[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

type Route = {
  name: string
  method: 'GET' | 'POST'
  path: string
  body?: string
  okStatus: number
  // A request the route itself rejects (a bad query or body), if any.
  bad?: { path: string; body?: string; status: number }
}

const IDENTITY_BODY = JSON.stringify({
  discordUserId: '111111111111111111',
  username: 'ada',
  displayName: 'Ada',
})

const ROUTES: Record<string, Route> = {
  'admin-check': {
    name: 'GET /admin/check',
    method: 'GET',
    path: '/admin/check?email=admin%40example.com',
    okStatus: 200,
  },
  'discord-link:read': {
    name: 'GET /internal/discord-link',
    method: 'GET',
    path: '/internal/discord-link?discordUserId=999999999999999999',
    okStatus: 200,
    bad: { path: '/internal/discord-link', status: 400 },
  },
  'discord-identity:write': {
    name: 'POST /internal/discord-identity',
    method: 'POST',
    path: '/internal/discord-identity',
    body: IDENTITY_BODY,
    okStatus: 201,
    bad: {
      path: '/internal/discord-identity',
      body: JSON.stringify({ discordUserId: 'nope' }),
      status: 400,
    },
  },
  'host-activity:read': {
    name: 'GET /internal/host-activity',
    method: 'GET',
    path: '/internal/host-activity?host=theater.dev.lilnas.io&hours=6',
    okStatus: 200,
    bad: { path: '/internal/host-activity?host=x.lilnas.io', status: 400 },
  },
}

// The contract table: which caller holds which route's scope.
const ALLOWED: Record<CallerName, string[]> = {
  download: ['admin-check', 'discord-link:read', 'discord-identity:write'],
  'icloud-backup': ['admin-check'],
  dev: ['host-activity:read'],
  'dev-idle-reaper': ['host-activity:read'],
}
const CALLERS = Object.keys(TOKENS) as CallerName[]
const PAIRS = CALLERS.flatMap(caller =>
  Object.keys(ROUTES).map(scope => ({
    caller,
    scope,
    allowed: ALLOWED[caller].includes(scope),
  })),
)

type HttpResult = { status: number; body: string }

function request(
  port: number,
  options: {
    method: string
    path: string
    headers?: Record<string, string>
    body?: string
  },
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...options.headers }
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
    }
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers,
      },
      res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

// A guarded handler someone forgot to give a scope: forbidden for everyone.
@UseGuards(InternalTokenGuard)
@Controller('internal')
class NoScopeController {
  @Get('no-scope')
  noScope(): { ok: true } {
    return { ok: true }
  }
}

function makeTestDatabaseModule(db: Db) {
  @Global()
  @Module({ providers: [{ provide: DB, useValue: db }], exports: [DB] })
  class TestDatabaseModule {}
  return TestDatabaseModule
}

type AuthLine = {
  event: string
  outcome: string
  caller: string | null
  scope: string | null
  enforced: boolean
  remoteAddress: string | null
  level: number
}

describe('InternalTokenGuard (real NestJS app, real HTTP)', () => {
  const lines: string[] = []
  let app: Awaited<ReturnType<typeof startApp>>['app']
  let port: number
  let sqlite: BetterSqlite3.Database

  async function startApp() {
    sqlite = new BetterSqlite3(':memory:')
    applyPragmas(sqlite)
    const db = drizzle(sqlite, { schema })
    runMigrations(db)

    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString('utf8'))
        cb()
      },
    })

    const moduleRef = await Test.createTestingModule({
      imports: [
        makeTestDatabaseModule(db),
        AuthModule,
        AccessCacheModule,
        LoggerModule.forRoot({ pinoHttp: [pinoHttpOptions, stream] }),
      ],
      controllers: [
        HealthController,
        VerifyController,
        StripCookieController,
        AdminCheckController,
        DiscordLinkLookupController,
        DiscordIdentityController,
        HostActivityController,
        NoScopeController,
      ],
      providers: [
        VerifyService,
        GatedHostsService,
        HostActivityService,
        InternalTokenGuard,
      ],
    }).compile()
    const nestApp = moduleRef.createNestApplication({ bodyParser: false })
    await nestApp.init()
    await nestApp.listen(0, '127.0.0.1')
    const address = nestApp.getHttpServer().address()
    if (address === null || typeof address === 'string') {
      throw new Error('expected app to listen on a resolved TCP address')
    }
    return { app: nestApp, port: address.port }
  }

  // pino-http writes its completion line when the response finishes, which
  // can land just after the client has read the response.
  async function settledLines(): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 20))
    return lines.join('')
  }

  function authLines(): AuthLine[] {
    return lines
      .join('')
      .split('\n')
      .filter(line => line.includes('"internal-auth"'))
      .map(line => JSON.parse(line) as AuthLine)
  }

  beforeAll(async () => {
    ;({ app, port } = await startApp())
  })

  afterAll(async () => {
    await app.close()
    sqlite.close()
    restoreEnv()
  })

  beforeEach(() => {
    lines.length = 0
    restoreEnv()
    setTokens()
  })

  describe('enforcing (INTERNAL_TOKEN_ENFORCE=true)', () => {
    beforeEach(() => {
      process.env.INTERNAL_TOKEN_ENFORCE = 'true'
    })

    it.each(PAIRS)(
      '$caller on $scope: allowed=$allowed',
      async ({ caller, scope, allowed }) => {
        const route = ROUTES[scope]!
        const res = await request(port, {
          method: route.method,
          path: route.path,
          body: route.body,
          headers: bearer(TOKENS[caller]),
        })

        expect(res.status).toBe(allowed ? route.okStatus : 403)
        const [line] = authLines()
        expect(line).toMatchObject({
          outcome: allowed ? 'ok' : 'forbidden',
          caller,
          scope,
          enforced: true,
        })
      },
    )

    it.each(Object.values(ROUTES).filter(route => route.bad))(
      "$name keeps its own 400 for the right caller's bad request",
      async route => {
        const scope = Object.keys(ROUTES).find(key => ROUTES[key] === route)!
        const caller = CALLERS.find(name => ALLOWED[name].includes(scope))!
        const res = await request(port, {
          method: route.method,
          path: route.bad!.path,
          body: route.bad!.body,
          headers: bearer(TOKENS[caller]),
        })

        expect(res.status).toBe(route.bad!.status)
      },
    )

    it.each(Object.values(ROUTES))(
      '$name is 401 with no header and with a garbage token',
      async route => {
        const missing = await request(port, {
          method: route.method,
          path: route.path,
          body: route.body,
        })
        const garbage = await request(port, {
          method: route.method,
          path: route.path,
          body: route.body,
          headers: bearer(GARBAGE),
        })

        expect(missing.status).toBe(401)
        expect(garbage.status).toBe(401)
        expect(authLines().map(line => line.outcome)).toEqual([
          'missing',
          'invalid',
        ])
      },
    )

    it.each(CALLERS)(
      'a guarded handler with no scope is 403 for %s',
      async caller => {
        const res = await request(port, {
          method: 'GET',
          path: '/internal/no-scope',
          headers: bearer(TOKENS[caller]),
        })

        expect(res.status).toBe(403)
        expect(authLines()).toEqual([
          expect.objectContaining({
            outcome: 'forbidden',
            caller,
            scope: null,
          }),
        ])
      },
    )

    it('does not write a roster row when the write is rejected', async () => {
      const res = await request(port, {
        method: 'POST',
        path: '/internal/discord-identity',
        body: JSON.stringify({
          discordUserId: '333333333333333333',
          username: 'rogue',
        }),
        headers: bearer(TOKENS.dev),
      })

      expect(res.status).toBe(403)
      const row = sqlite
        .prepare('SELECT 1 FROM discord_identity WHERE discord_user_id = ?')
        .get('333333333333333333')
      expect(row).toBeUndefined()
    })

    it.each([
      ['/health', 200],
      ['/strip-cookie', 200],
    ])('%s answers %d without a token', async (path, status) => {
      const res = await request(port, { method: 'GET', path })

      expect(res.status).toBe(status)
      expect(authLines()).toEqual([])
    })

    it('/verify answers without a token and never runs the token guard', async () => {
      const res = await request(port, {
        method: 'GET',
        path: '/verify',
        headers: {
          'x-forwarded-host': 'sonarr.lilnas.io',
          'x-forwarded-proto': 'https',
          'x-forwarded-uri': '/',
        },
      })

      // Its own answer for no session: a redirect to sign-in, not the
      // guard's 401.
      expect(res.status).toBe(302)
      expect(authLines()).toEqual([])
    })
  })

  describe('not enforcing', () => {
    it.each(PAIRS)(
      '$caller on $scope answers as before and logs the outcome',
      async ({ caller, scope, allowed }) => {
        const route = ROUTES[scope]!
        const res = await request(port, {
          method: route.method,
          path: route.path,
          body: route.body,
          headers: bearer(TOKENS[caller]),
        })

        expect(res.status).toBe(route.okStatus)
        expect(authLines()).toEqual([
          expect.objectContaining({
            event: 'internal-auth',
            outcome: allowed ? 'ok' : 'forbidden',
            caller,
            scope,
            enforced: false,
            remoteAddress: expect.stringContaining('127.0.0.1'),
            // pino levels: 30 info, 40 warn
            level: allowed ? 30 : 40,
          }),
        ])
      },
    )

    it.each(Object.values(ROUTES))(
      '$name answers as before with no header and with a garbage token',
      async route => {
        const missing = await request(port, {
          method: route.method,
          path: route.path,
          body: route.body,
        })
        const garbage = await request(port, {
          method: route.method,
          path: route.path,
          body: route.body,
          headers: bearer(GARBAGE),
        })

        expect(missing.status).toBe(route.okStatus)
        expect(garbage.status).toBe(route.okStatus)
        expect(
          authLines().map(({ outcome, caller }) => ({ outcome, caller })),
        ).toEqual([
          { outcome: 'missing', caller: null },
          { outcome: 'invalid', caller: null },
        ])
      },
    )

    it('keeps the 200 for an unknown Discord link', async () => {
      const res = await request(port, {
        method: 'GET',
        path: '/internal/discord-link?discordUserId=999999999999999999',
      })

      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ identity: null, user: null })
    })

    it.each(Object.values(ROUTES).filter(route => route.bad))(
      '$name keeps its own 400 with no token',
      async route => {
        const res = await request(port, {
          method: route.method,
          path: route.bad!.path,
          body: route.bad!.body,
        })

        expect(res.status).toBe(route.bad!.status)
      },
    )

    it.each(['1', 'TRUE', '', 'True', 'yes'])(
      'INTERNAL_TOKEN_ENFORCE=%j does not enforce',
      async value => {
        process.env.INTERNAL_TOKEN_ENFORCE = value
        const res = await request(port, {
          method: 'GET',
          path: '/admin/check',
        })

        expect(res.status).toBe(200)
        expect(authLines()).toEqual([
          expect.objectContaining({ outcome: 'missing', enforced: false }),
        ])
      },
    )
  })

  describe('token configuration', () => {
    beforeEach(() => {
      process.env.INTERNAL_TOKEN_ENFORCE = 'true'
    })

    async function checkAs(token: string): Promise<number> {
      const res = await request(port, {
        method: 'GET',
        path: '/admin/check',
        headers: bearer(token),
      })
      return res.status
    }

    it('an unset token matches nothing', async () => {
      delete process.env.INTERNAL_TOKEN_ICLOUD_BACKUP

      expect(await checkAs(TOKENS['icloud-backup'])).toBe(401)
      expect(await checkAs('')).toBe(401)
    })

    it('a 31-character token matches nothing; 32 characters does', async () => {
      const short = 'x'.repeat(31)
      process.env.INTERNAL_TOKEN_ICLOUD_BACKUP = short
      expect(await checkAs(short)).toBe(401)

      const exact = 'y'.repeat(32)
      process.env.INTERNAL_TOKEN_ICLOUD_BACKUP = exact
      expect(await checkAs(exact)).toBe(200)
    })

    it('two callers sharing one value both match nothing', async () => {
      process.env.INTERNAL_TOKEN_ICLOUD_BACKUP = TOKENS.download

      expect(await checkAs(TOKENS.download)).toBe(401)
      // The other callers are unaffected.
      const res = await request(port, {
        method: 'GET',
        path: ROUTES['host-activity:read']!.path,
        headers: bearer(TOKENS.dev),
      })
      expect(res.status).toBe(200)
    })
  })

  describe('Authorization header shape', () => {
    beforeEach(() => {
      process.env.INTERNAL_TOKEN_ENFORCE = 'true'
    })

    it.each(['bearer', 'BEARER', 'BeArEr'])(
      'accepts the %s scheme',
      async scheme => {
        const res = await request(port, {
          method: 'GET',
          path: '/admin/check',
          headers: { authorization: `${scheme} ${TOKENS.download}` },
        })

        expect(res.status).toBe(200)
      },
    )

    it.each([
      ['Basic', `Basic ${TOKENS.download}`],
      ['a bare token', TOKENS.download],
      ['an empty bearer', 'Bearer '],
      ['a bare scheme', 'Bearer'],
      ['two spaces', `Bearer  ${TOKENS.download}`],
      ['a trailing word', `Bearer ${TOKENS.download} extra`],
    ])('%s is invalid', async (_label, authorization) => {
      const res = await request(port, {
        method: 'GET',
        path: '/admin/check',
        headers: { authorization },
      })

      expect(res.status).toBe(401)
      expect(authLines()).toEqual([
        expect.objectContaining({ outcome: 'invalid', caller: null }),
      ])
    })
  })

  it('never logs a token, in observe or enforce mode', async () => {
    for (const enforce of ['true', undefined]) {
      if (enforce === undefined) {
        delete process.env.INTERNAL_TOKEN_ENFORCE
      } else {
        process.env.INTERNAL_TOKEN_ENFORCE = enforce
      }
      for (const { caller, scope } of PAIRS) {
        const route = ROUTES[scope]!
        await request(port, {
          method: route.method,
          path: route.path,
          body: route.body,
          headers: bearer(TOKENS[caller]),
        })
      }
      await request(port, {
        method: 'GET',
        path: '/admin/check',
        headers: bearer(GARBAGE),
      })
      await request(port, {
        method: 'GET',
        path: '/admin/check',
        headers: { authorization: `Basic ${TOKENS.download}` },
      })
    }

    const output = await settledLines()
    expect(authLines().length).toBeGreaterThan(0)
    // The completion lines were written too, so this covers pino-http's own
    // request serializer as well as the guard's line.
    expect(output).toContain('request completed')
    for (const token of [...Object.values(TOKENS), GARBAGE]) {
      expect(output).not.toContain(token)
    }
    expect(output).not.toMatch(/Bearer /i)
  })

  it('the contract callers are exactly the ones this spec exercises', () => {
    expect(Object.keys(INTERNAL_CALLERS).sort()).toEqual([...CALLERS].sort())
  })
})
