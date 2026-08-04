import http from 'node:http'

import { Global, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { AuthService } from '@thallesp/nestjs-better-auth'
import BetterSqlite3 from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { PinoLogger } from 'nestjs-pino'

import { buildAuth } from 'src/auth/auth'
import { AuthModule } from 'src/auth/auth.module'
import {
  applyPragmas,
  DB,
  type Db,
  runMigrations,
} from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { AccessCacheService } from 'src/verify/access-cache.service'
import { VerifyController } from 'src/verify/verify.controller'
import { VerifyService } from 'src/verify/verify.service'

import { signInAndGetSessionCookiePair } from './helpers/session-fixtures'

// Obviously-fake test values, scoped to this file only — mirrors
// src/auth/__tests__/auth-mount.spec.ts's own module-scope convention.
process.env.AUTH_HOST = 'http://login.localhost.test'
process.env.COOKIE_DOMAIN = '.localhost.test'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.REDIRECT_ALLOWED_SUFFIX = 'localhost.test'
process.env.ADMIN_EMAILS = 'admin@example.com'

const AUTH_HOST = process.env.AUTH_HOST

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
}

function fakeLogger(): PinoLogger {
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

function getUserIdByEmail(db: Db, email: string): string {
  const row = db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .get()
  if (!row) throw new Error(`expected a user row for ${email}`)
  return row.id
}

function countAccessRequestRows(db: Db): number {
  return db.select().from(schema.accessRequest).all().length
}

// Direct construction (no NestJS TestingModule) for the decide()-level unit
// tests below — VerifyService and AccessCacheService are plain classes;
// this is the same pattern access-cache.service.spec.ts's own
// createHarness() uses, and is enough to exercise the REAL decision flow
// against a REAL DB and a REAL buildAuth() instance. The
// "VerifyController integration" describe block further down is what
// exercises the full NestJS + real-HTTP-server wiring this unit's
// "Integration" test scenario asks for.
function createHarness(testDb: ReturnType<typeof createTestDb>) {
  const auth = buildAuth(testDb.db)
  const authService = new AuthService({ auth })
  const logger = fakeLogger()
  const cache = new AccessCacheService(testDb.db, authService, logger)
  cache.onModuleInit()
  const verifyService = new VerifyService(cache)
  return { auth, authService, cache, verifyService }
}

describe('VerifyService.decide (direct construction, real DB, real buildAuth())', () => {
  let testDb: ReturnType<typeof createTestDb>

  afterEach(() => {
    testDb?.close()
  })

  it('covers F4/R4: a signed-in user with a grant for the requested host is allowed, with X-Forwarded-User set to their email', async () => {
    testDb = createTestDb()
    const { auth, cache, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-allow',
      email: 'allow@example.com',
    })
    const userId = getUserIdByEmail(testDb.db, 'allow@example.com')
    cache.addGrant(userId, 'swole.lilnas.io')

    const decision = await verifyService.decide({
      cookieHeader: cookie,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/dashboard',
    })

    expect(decision).toEqual({
      outcome: 'allow',
      email: 'allow@example.com',
      userId,
    })
  })

  it('covers R2: a warm-cache allow performs zero database reads on the second decide() call', async () => {
    testDb = createTestDb()
    const { auth, cache, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-warm',
      email: 'warm@example.com',
    })
    const userId = getUserIdByEmail(testDb.db, 'warm@example.com')
    cache.addGrant(userId, 'swole.lilnas.io')

    const input = {
      cookieHeader: cookie,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    }
    const first = await verifyService.decide(input)
    expect(first.outcome).toBe('allow')

    const prepareSpy = jest.spyOn(testDb.sqlite, 'prepare')
    const second = await verifyService.decide(input)

    expect(second).toEqual(first)
    expect(prepareSpy).not.toHaveBeenCalled()
  })

  it('a signed-out visitor is redirected to an absolute AUTH_HOST/login URL carrying the reconstructed original URL', async () => {
    testDb = createTestDb()
    const { verifyService } = createHarness(testDb)

    const decision = await verifyService.decide({
      cookieHeader: undefined,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/some/path?q=1',
    })

    expect(decision.outcome).toBe('redirect')
    const expected = new URL('/login', AUTH_HOST)
    expected.searchParams.set(
      'redirect',
      'https://swole.lilnas.io/some/path?q=1',
    )
    expect(decision).toEqual({
      outcome: 'redirect',
      location: expected.toString(),
    })
    // Absolute, not relative — the entire point of U1's proven finding.
    expect(
      decision.outcome === 'redirect' &&
        decision.location.startsWith(AUTH_HOST),
    ).toBe(true)
  })

  it('covers AE6: a blocked account with an existing grant for the host is denied, and no access_request row is created for any service', async () => {
    testDb = createTestDb()
    const { auth, cache, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-blocked',
      email: 'blocked@example.com',
    })
    const userId = getUserIdByEmail(testDb.db, 'blocked@example.com')
    cache.addGrant(userId, 'swole.lilnas.io')
    cache.blockUser(userId)

    const decision = await verifyService.decide({
      cookieHeader: cookie,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    })

    expect(decision.outcome).toBe('redirect')
    // Reversed post-launch (see verify.service.ts's own REDIRECT_PATHS.blocked
    // comment) — a blocked account now redirects to its own dedicated
    // page, not /pending. The rest of this test's assertions (denied
    // despite an existing grant, no access_request row created) are
    // unchanged by that reversal.
    expect(decision.outcome === 'redirect' && decision.location).toContain(
      '/blocked',
    )
    expect(countAccessRequestRows(testDb.db)).toBe(0)
  })

  it('edge case: cold cache performs at least one database read; the identical decide() call immediately after performs zero', async () => {
    testDb = createTestDb()
    const { auth, cache, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-cold',
      email: 'cold@example.com',
    })
    const userId = getUserIdByEmail(testDb.db, 'cold@example.com')
    cache.addGrant(userId, 'swole.lilnas.io')

    const input = {
      cookieHeader: cookie,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    }

    const prepareSpy = jest.spyOn(testDb.sqlite, 'prepare')
    const first = await verifyService.decide(input)
    expect(first.outcome).toBe('allow')
    const callsAfterFirst = prepareSpy.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)

    const second = await verifyService.decide(input)
    expect(second.outcome).toBe('allow')
    expect(prepareSpy.mock.calls.length).toBe(callsAfterFirst)
  })

  it('edge case: a grant revoked via the cache invalidation method stops allowing on the very next verify, no restart', async () => {
    testDb = createTestDb()
    const { auth, cache, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-revoked',
      email: 'revoked@example.com',
    })
    const userId = getUserIdByEmail(testDb.db, 'revoked@example.com')
    cache.addGrant(userId, 'swole.lilnas.io')

    const input = {
      cookieHeader: cookie,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    }
    const before = await verifyService.decide(input)
    expect(before.outcome).toBe('allow')

    // Simulates U7/U9's future admin endpoints calling this same
    // invalidation method after their own DB write — neither exists yet,
    // per this unit's scope boundary, so the method is called directly.
    cache.removeGrant(userId, 'swole.lilnas.io')

    const after = await verifyService.decide(input)
    expect(after.outcome).toBe('redirect')
    expect(after.outcome === 'redirect' && after.location).toContain('/pending')
  })

  it('edge case: a session past its cached (clamped) lifetime re-verifies against the database and is correctly redirected once genuinely expired', async () => {
    testDb = createTestDb()
    const { auth, cache, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-expiring-decide',
      email: 'expiring-decide@example.com',
    })
    const userId = getUserIdByEmail(testDb.db, 'expiring-decide@example.com')
    cache.addGrant(userId, 'swole.lilnas.io')

    const rows = testDb.db.select().from(schema.session).all()
    const sessionRow = rows[0]
    if (!sessionRow) throw new Error('expected exactly one session row')
    testDb.db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() + 50) })
      .where(eq(schema.session.id, sessionRow.id))
      .run()

    const input = {
      cookieHeader: cookie,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    }
    const before = await verifyService.decide(input)
    expect(before.outcome).toBe('allow')

    await new Promise(resolve => setTimeout(resolve, 200))

    // The cached expiresAtMs (clamped to at most MAX_SESSION_CACHE_MS, but
    // here equal to the session's own real 50ms expiry since that's
    // smaller) has passed, so this now performs a REAL re-verification
    // rather than a locally-known-expired short-circuit — deliberately,
    // not the behavior this cache had before the revocation-convergence
    // fix (see access-cache.service.ts's own resolveSession() CACHE
    // LIFETIME comment). The re-check independently confirms the session
    // is genuinely expired.
    const prepareSpy = jest.spyOn(testDb.sqlite, 'prepare')
    const after = await verifyService.decide(input)

    expect(after.outcome).toBe('redirect')
    expect(after.outcome === 'redirect' && after.location).toContain('/login')
    expect(prepareSpy).toHaveBeenCalled()
  })

  it('edge case: the same user is allowed for a granted host and redirected for an ungranted host', async () => {
    testDb = createTestDb()
    const { auth, cache, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-two-hosts',
      email: 'two-hosts@example.com',
    })
    const userId = getUserIdByEmail(testDb.db, 'two-hosts@example.com')
    cache.addGrant(userId, 'granted.lilnas.io')

    const grantedDecision = await verifyService.decide({
      cookieHeader: cookie,
      forwardedHost: 'granted.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    })
    const ungrantedDecision = await verifyService.decide({
      cookieHeader: cookie,
      forwardedHost: 'ungranted.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    })

    expect(grantedDecision).toEqual({
      outcome: 'allow',
      email: 'two-hosts@example.com',
      userId,
    })
    expect(ungrantedDecision.outcome).toBe('redirect')
    expect(
      ungrantedDecision.outcome === 'redirect' && ungrantedDecision.location,
    ).toContain('/pending')
  })

  it('error path: a missing X-Forwarded-Host fails closed, and no access_request row is created', async () => {
    testDb = createTestDb()
    const { verifyService } = createHarness(testDb)

    const decision = await verifyService.decide({
      cookieHeader: undefined,
      forwardedHost: undefined,
      forwardedProto: 'https',
      forwardedUri: '/',
    })

    expect(decision.outcome).toBe('fail-closed')
    expect(countAccessRequestRows(testDb.db)).toBe(0)
  })

  it('error path: a malformed/forged session cookie is treated as no session — a clean redirect to login, never a thrown error', async () => {
    testDb = createTestDb()
    const { verifyService } = createHarness(testDb)
    const forgedCookie = `better-auth.session_token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.${'A'.repeat(43)}=`

    await expect(
      verifyService.decide({
        cookieHeader: forgedCookie,
        forwardedHost: 'swole.lilnas.io',
        forwardedProto: 'https',
        forwardedUri: '/',
      }),
    ).resolves.toEqual({
      outcome: 'redirect',
      location: expect.stringContaining('/login'),
    })
  })

  it('covers the admin bypass: an ADMIN_EMAILS address is allowed unconditionally, with no grant ever added, and never reaches hasGrant/isBlocked/bindPreAuthorizedGrant', async () => {
    testDb = createTestDb()
    const { auth, cache, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-admin-bypass',
      email: 'admin@example.com',
    })
    const userId = getUserIdByEmail(testDb.db, 'admin@example.com')
    // Call-through spies (no .mockImplementation) — these assert the real
    // methods are never invoked, while leaving the real cache instance's
    // own behavior otherwise untouched.
    const hasGrantSpy = jest.spyOn(cache, 'hasGrant')
    const isBlockedSpy = jest.spyOn(cache, 'isBlocked')
    const bindSpy = jest.spyOn(cache, 'bindPreAuthorizedGrant')

    const decision = await verifyService.decide({
      cookieHeader: cookie,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    })

    expect(decision).toEqual({
      outcome: 'allow',
      email: 'admin@example.com',
      userId,
    })
    expect(hasGrantSpy).not.toHaveBeenCalled()
    expect(isBlockedSpy).not.toHaveBeenCalled()
    expect(bindSpy).not.toHaveBeenCalled()
  })

  it('covers R17 parity extended to /verify: a blocked ADMIN_EMAILS address still passes unconditionally', async () => {
    testDb = createTestDb()
    const { auth, cache, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-admin-blocked',
      email: 'admin@example.com',
    })
    const userId = getUserIdByEmail(testDb.db, 'admin@example.com')
    cache.blockUser(userId)

    const decision = await verifyService.decide({
      cookieHeader: cookie,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    })

    expect(decision).toEqual({
      outcome: 'allow',
      email: 'admin@example.com',
      userId,
    })
  })

  it('regression guard: a configured ADMIN_EMAILS does not over-match a non-admin email, which still redirects to pending with no grant', async () => {
    testDb = createTestDb()
    const { auth, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-not-admin',
      email: 'not-admin@example.com',
    })

    const decision = await verifyService.decide({
      cookieHeader: cookie,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    })

    expect(decision.outcome).toBe('redirect')
    expect(decision.outcome === 'redirect' && decision.location).toContain(
      '/pending',
    )
  })

  it('covers U9/R15: a pre-authorized email binds its grant on first sign-in and is allowed', async () => {
    testDb = createTestDb()
    const { auth, cache, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-preauth-bind',
      email: 'preauth-bind@example.com',
    })
    const userId = getUserIdByEmail(testDb.db, 'preauth-bind@example.com')
    cache.addPreAuthorization('preauth-bind@example.com', 'swole.lilnas.io')
    const bindSpy = jest.spyOn(cache, 'bindPreAuthorizedGrant')

    const decision = await verifyService.decide({
      cookieHeader: cookie,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    })

    expect(decision).toEqual({
      outcome: 'allow',
      email: 'preauth-bind@example.com',
      userId,
    })
    expect(bindSpy).toHaveBeenCalledWith(
      userId,
      'preauth-bind@example.com',
      'swole.lilnas.io',
    )
    expect(bindSpy.mock.results[0]?.value).toBe(true)
  })

  it('edge case: a stale pre-authorization for an admin email is left untouched while that email remains an admin', async () => {
    testDb = createTestDb()
    const { auth, cache, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-admin-preauth',
      email: 'admin@example.com',
    })
    const userId = getUserIdByEmail(testDb.db, 'admin@example.com')
    cache.addPreAuthorization('admin@example.com', 'swole.lilnas.io')
    const bindSpy = jest.spyOn(cache, 'bindPreAuthorizedGrant')

    const decision = await verifyService.decide({
      cookieHeader: cookie,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    })

    // The bypass fires first and returns 'allow' without ever asking
    // whether a pre-authorization exists — so it sits untouched. It would
    // only ever bind later, on this email's first REAL /verify call after
    // being removed from ADMIN_EMAILS — see
    // AccessCacheService.bindPreAuthorizedGrant()'s own "binds on first
    // sign-in through the normal path" contract. Not a bug.
    expect(decision).toEqual({
      outcome: 'allow',
      email: 'admin@example.com',
      userId,
    })
    expect(bindSpy).not.toHaveBeenCalled()
  })

  it('case-insensitivity: an admin email that differs only in case from the ADMIN_EMAILS entry still bypasses', async () => {
    testDb = createTestDb()
    const { auth, verifyService } = createHarness(testDb)
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-admin-case',
      email: 'Admin@Example.com',
    })

    const decision = await verifyService.decide({
      cookieHeader: cookie,
      forwardedHost: 'swole.lilnas.io',
      forwardedProto: 'https',
      forwardedUri: '/',
    })

    expect(decision.outcome).toBe('allow')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Integration: a real NestJS app (real VerifyController, real VerifyService,
// real AccessCacheService, real AuthModule/AuthService, real in-memory DB),
// driven over a real listening HTTP socket via node:http — only the
// Google/browser OAuth exchange is mocked (the network boundary this app
// doesn't own), exactly matching src/auth/__tests__/auth-mount.spec.ts's own
// precedent for what "real" means in this codebase's test suite.
//
// A live Traefik + this real controller (as the plan's own test scenario
// phrasing offers as the primary option) was judged out of proportion for
// this unit specifically: U1 already stood up that infrastructure and
// empirically proved the Traefik-side half of this contract (Cookie
// forwarding, X-Forwarded-* reconstruction, absolute-Location survival) —
// re-proving those SAME Traefik behaviors here would be duplicative, not
// additional coverage. What U5 actually adds beyond U1 is the DECISION
// LOGIC and its own HTTP contract, which this NestJS-testing-module-level
// integration exercises for real: a real Express request into a real
// VerifyController, through a real VerifyService, backed by a real
// AccessCacheService and a real SQLite database — the acceptable
// substitute this unit's own instructions name explicitly.
//
// The session cookie is obtained via signInAndGetSessionCookiePair() against
// a SEPARATE buildAuth(testDb.db) call (not the app's own DI-managed
// instance — extracting that back out through AuthService's own generic
// type parameter fights TypeScript for no real benefit here) sharing the
// SAME db handle and BETTER_AUTH_SECRET as the app the test HTTP requests
// actually hit. Session-cookie signing/verification depends only on the
// shared secret and the DB row, never on which buildAuth() call produced
// the value, so a cookie minted this way is equally valid when presented
// to the running app's /verify endpoint — and this sidesteps re-driving
// U3's own sign-in flow through a second set of real HTTP requests here
// too: U3's auth-mount.spec.ts already proves the sign-in HTTP contract;
// this file's job is to prove /verify's.
// ──────────────────────────────────────────────────────────────────────────────
describe('VerifyController integration (real NestJS app, real HTTP, real DB)', () => {
  function makeTestDatabaseModule(db: Db) {
    @Global()
    @Module({
      providers: [{ provide: DB, useValue: db }],
      exports: [DB],
    })
    class TestDatabaseModule {}
    return TestDatabaseModule
  }

  function httpRequest(
    port: number,
    options: {
      method: string
      path: string
      headers?: Record<string, string>
    },
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
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
          res.resume()
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, headers: res.headers })
          })
        },
      )
      req.on('error', reject)
      req.end()
    })
  }

  async function startTestApp(db: Db) {
    const TestDatabaseModule = makeTestDatabaseModule(db)

    @Module({
      imports: [TestDatabaseModule, AuthModule],
      controllers: [VerifyController],
      // A fake PinoLogger (this file's own module-scope helper, already
      // used by createHarness() above) rather than importing nestjs-pino's
      // real LoggerModule — AccessCacheService constructor-injects
      // PinoLogger directly (not via a request-scoped pino-http instance),
      // and this app's real AppModule only ever satisfies that dependency
      // because LoggerModule.forRoot() happens to also be imported there
      // for an unrelated reason (HTTP request logging). Pulling in the
      // whole pino-http HTTP-instrumentation module here would be
      // incidental coupling for a test that has nothing to do with request
      // logging; providing the token directly is the minimal fix for what
      // is otherwise a real "Nest can't resolve dependencies of
      // AccessCacheService... PinoLogger" failure in this describe block.
      providers: [
        VerifyService,
        AccessCacheService,
        { provide: PinoLogger, useValue: fakeLogger() },
      ],
    })
    class TestAppModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile()

    // bodyParser: false mirrors src/bootstrap.ts / auth-mount.spec.ts's own
    // setup — AuthModule's SkipBodyParsingMiddleware needs to see the raw
    // body for the '/api/auth' mount before Nest's global body parser would
    // otherwise consume it.
    const nestApp = moduleRef.createNestApplication({ bodyParser: false })
    await nestApp.init()
    await nestApp.listen(0, '127.0.0.1')

    const address = nestApp.getHttpServer().address()
    if (address === null || typeof address === 'string') {
      throw new Error('expected app to listen on a resolved TCP address')
    }

    return { moduleRef, app: nestApp, port: address.port }
  }

  it('a granted, signed-in user reaches /verify and gets 200 with X-Forwarded-User set to their email', async () => {
    const testDb = createTestDb()
    try {
      const { moduleRef, app, port } = await startTestApp(testDb.db)
      try {
        const accessCache = moduleRef.get(AccessCacheService)

        // A SEPARATE buildAuth() call sharing the same db + BETTER_AUTH_SECRET
        // as the one AuthModule constructs internally for the running app —
        // not the app's own instance (fetching that back out through
        // AuthService's own generic type parameter is more trouble than it's
        // worth; see this describe block's header comment). Session-cookie
        // signing/verification depends only on the shared secret and the DB
        // row, never on which buildAuth() call produced the value, so a
        // cookie minted here is equally valid when presented to the running
        // app's /verify endpoint.
        const mintingAuth = buildAuth(testDb.db)
        const cookie = await signInAndGetSessionCookiePair(
          mintingAuth,
          AUTH_HOST,
          {
            sub: 'integration-granted',
            email: 'integration-granted@example.com',
          },
        )
        const userId = getUserIdByEmail(
          testDb.db,
          'integration-granted@example.com',
        )
        accessCache.addGrant(userId, 'granted-service.localhost.test')

        const res = await httpRequest(port, {
          method: 'GET',
          path: '/verify',
          headers: {
            cookie,
            'x-forwarded-host': 'granted-service.localhost.test',
            'x-forwarded-proto': 'https',
            'x-forwarded-uri': '/dashboard',
          },
        })

        expect(res.status).toBe(200)
        expect(res.headers['x-forwarded-user']).toBe(
          'integration-granted@example.com',
        )
        expect(res.headers['x-forwarded-user-id']).toBe(userId)
        // R11/#11 (from REVIEW.md): /verify never originates a Set-Cookie on
        // any response shape — previously only asserted tautologically in
        // forwardauth-spike-record.spec.ts against literals, never against
        // this real HTTP response. Asserted here and on the other three
        // outcomes below (redirect-to-pending, redirect-to-login, 5xx
        // fail-closed) — the complete set of shapes /verify can return.
        expect(res.headers['set-cookie']).toBeUndefined()
      } finally {
        await app.close()
      }
    } finally {
      testDb.close()
    }
  })

  it('an ungranted, signed-in user is redirected to the pending page with the original URL preserved', async () => {
    const testDb = createTestDb()
    try {
      const { app, port } = await startTestApp(testDb.db)
      try {
        // See the previous test's comment on why a separate buildAuth()
        // call, sharing the same db + secret, is used to mint the cookie.
        const mintingAuth = buildAuth(testDb.db)
        const cookie = await signInAndGetSessionCookiePair(
          mintingAuth,
          AUTH_HOST,
          {
            sub: 'integration-ungranted',
            email: 'integration-ungranted@example.com',
          },
        )

        const res = await httpRequest(port, {
          method: 'GET',
          path: '/verify',
          headers: {
            cookie,
            'x-forwarded-host': 'ungranted-service.localhost.test',
            'x-forwarded-proto': 'https',
            'x-forwarded-uri': '/some/page',
          },
        })

        expect(res.status).toBe(302)
        const location = res.headers.location
        expect(location).toBeDefined()
        expect(location as string).toContain(`${AUTH_HOST}/pending`)
        const expectedRedirectParam = encodeURIComponent(
          'https://ungranted-service.localhost.test/some/page',
        )
        expect(location as string).toContain(
          `redirect=${expectedRedirectParam}`,
        )
        expect(res.headers['set-cookie']).toBeUndefined()
      } finally {
        await app.close()
      }
    } finally {
      testDb.close()
    }
  })

  it('a signed-out request to /verify is redirected to the login page, and the X-Forwarded-Host request method used by the client is irrelevant (POST is verified too)', async () => {
    const testDb = createTestDb()
    try {
      const { app, port } = await startTestApp(testDb.db)
      try {
        const res = await httpRequest(port, {
          method: 'POST',
          path: '/verify',
          headers: {
            'x-forwarded-host': 'swole.localhost.test',
            'x-forwarded-proto': 'https',
            'x-forwarded-uri': '/',
          },
        })

        expect(res.status).toBe(302)
        expect(res.headers.location as string).toContain(`${AUTH_HOST}/login`)
        expect(res.headers['set-cookie']).toBeUndefined()
      } finally {
        await app.close()
      }
    } finally {
      testDb.close()
    }
  })

  it('a missing X-Forwarded-Host fails closed with a 5xx', async () => {
    const testDb = createTestDb()
    try {
      const { app, port } = await startTestApp(testDb.db)
      try {
        const res = await httpRequest(port, {
          method: 'GET',
          path: '/verify',
        })

        expect(res.status).toBeGreaterThanOrEqual(500)
        expect(res.status).toBeLessThan(600)
        expect(res.headers['set-cookie']).toBeUndefined()
      } finally {
        await app.close()
      }
    } finally {
      testDb.close()
    }
  })
})
