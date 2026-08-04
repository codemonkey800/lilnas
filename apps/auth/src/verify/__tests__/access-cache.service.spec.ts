import { AuthService } from '@thallesp/nestjs-better-auth'
import BetterSqlite3 from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { PinoLogger } from 'nestjs-pino'

import { buildAuth } from 'src/auth/auth'
import { applyPragmas, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { AccessCacheService } from 'src/verify/access-cache.service'

import { signInAndGetSessionCookiePair } from './helpers/session-fixtures'

// Obviously-fake test values, scoped to this file only — mirrors
// src/auth/__tests__/auth-mount.spec.ts's own module-scope convention.
process.env.AUTH_HOST = 'http://login.localhost.test'
process.env.COOKIE_DOMAIN = '.localhost.test'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.REDIRECT_ALLOWED_SUFFIX = 'localhost.test'

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

// Builds a REAL AccessCacheService — real Db, real AuthService wrapping a
// real buildAuth() instance, a fake (jest.fn()-based) PinoLogger — via
// direct construction rather than a NestJS TestingModule. AccessCacheService
// is a plain class; direct `new` with hand-supplied collaborators is
// sufficient here and avoids standing up an HTTP server this file never
// needs (verify.service.spec.ts's own "Integration" describe block covers
// the full NestJS-module-level wiring instead).
function createHarness(testDb: ReturnType<typeof createTestDb>) {
  const auth = buildAuth(testDb.db)
  const authService = new AuthService({ auth })
  const logger = fakeLogger()
  const cache = new AccessCacheService(testDb.db, authService, logger)
  return { auth, authService, logger, cache }
}

describe('AccessCacheService', () => {
  let testDb: ReturnType<typeof createTestDb>

  afterEach(() => {
    testDb?.close()
  })

  describe('onModuleInit preload', () => {
    it('preloads existing grants and blocked users from the database', () => {
      testDb = createTestDb()
      const now = new Date()
      testDb.db
        .insert(schema.user)
        .values({
          id: 'user_preload',
          name: 'Preload User',
          email: 'preload@example.com',
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      testDb.db
        .insert(schema.user)
        .values({
          id: 'user_blocked_preload',
          name: 'Blocked Preload User',
          email: 'blocked-preload@example.com',
          emailVerified: false,
          blockedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      testDb.db
        .insert(schema.grant)
        .values({
          userId: 'user_preload',
          serviceHost: 'swole.lilnas.io',
          createdAt: now,
        })
        .run()

      const { cache } = createHarness(testDb)
      cache.onModuleInit()

      expect(cache.hasGrant('user_preload', 'swole.lilnas.io')).toBe(true)
      expect(cache.hasGrant('user_preload', 'other.lilnas.io')).toBe(false)
      expect(cache.isBlocked('user_blocked_preload')).toBe(true)
      expect(cache.isBlocked('user_preload')).toBe(false)
    })

    it('starts with empty maps when the database has no grants or blocked users', () => {
      testDb = createTestDb()
      const { cache } = createHarness(testDb)
      cache.onModuleInit()

      expect(cache.hasGrant('nobody', 'anywhere.lilnas.io')).toBe(false)
      expect(cache.isBlocked('nobody')).toBe(false)
    })
  })

  describe('grant write-through invalidation surface (for U7/U9 to call)', () => {
    beforeEach(() => {
      testDb = createTestDb()
    })

    it('addGrant takes effect immediately and is idempotent', () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()

      expect(cache.hasGrant('u1', 'a.lilnas.io')).toBe(false)
      cache.addGrant('u1', 'a.lilnas.io')
      expect(cache.hasGrant('u1', 'a.lilnas.io')).toBe(true)

      // Idempotent: granting an already-granted pair is a no-op, not an
      // error.
      expect(() => cache.addGrant('u1', 'a.lilnas.io')).not.toThrow()
      expect(cache.hasGrant('u1', 'a.lilnas.io')).toBe(true)
    })

    it('removeGrant takes effect immediately, no restart', () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()
      cache.addGrant('u1', 'a.lilnas.io')
      expect(cache.hasGrant('u1', 'a.lilnas.io')).toBe(true)

      cache.removeGrant('u1', 'a.lilnas.io')
      expect(cache.hasGrant('u1', 'a.lilnas.io')).toBe(false)

      // Removing a pair that was never granted is a no-op, not an error.
      expect(() =>
        cache.removeGrant('u1', 'never-granted.lilnas.io'),
      ).not.toThrow()
    })

    it('grants for one user do not leak onto another user with the same host', () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()
      cache.addGrant('u1', 'shared.lilnas.io')

      expect(cache.hasGrant('u1', 'shared.lilnas.io')).toBe(true)
      expect(cache.hasGrant('u2', 'shared.lilnas.io')).toBe(false)
    })
  })

  describe('blocked-status write-through invalidation surface (for U9 to call)', () => {
    beforeEach(() => {
      testDb = createTestDb()
    })

    it('blockUser and unblockUser take effect immediately, no restart', () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()

      expect(cache.isBlocked('u1')).toBe(false)
      cache.blockUser('u1')
      expect(cache.isBlocked('u1')).toBe(true)
      cache.unblockUser('u1')
      expect(cache.isBlocked('u1')).toBe(false)
    })
  })

  describe('pre-authorization (U9, R15)', () => {
    beforeEach(() => {
      testDb = createTestDb()
    })

    function seedUser(id: string, email: string) {
      const now = new Date()
      testDb.db
        .insert(schema.user)
        .values({
          id,
          name: 'Test User',
          email,
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }

    it('addPreAuthorization takes effect immediately and is idempotent', () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()

      expect(() =>
        cache.addPreAuthorization('new@example.com', 'swole.lilnas.io'),
      ).not.toThrow()
      expect(() =>
        cache.addPreAuthorization('new@example.com', 'swole.lilnas.io'),
      ).not.toThrow()
    })

    it('bindPreAuthorizedGrant returns false and writes nothing when no pre-authorization exists for this email', () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()
      seedUser('u1', 'nobody-preauthorized@example.com')

      const bound = cache.bindPreAuthorizedGrant(
        'u1',
        'nobody-preauthorized@example.com',
        'swole.lilnas.io',
      )

      expect(bound).toBe(false)
      expect(testDb.db.select().from(schema.grant).all()).toHaveLength(0)
    })

    it('covers R15: a pending pre-authorization binds into a real grant on first check, and the pre_authorized_grant row is consumed', () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()
      cache.addPreAuthorization('preauthorized@example.com', 'swole.lilnas.io')
      seedUser('u1', 'preauthorized@example.com')

      const bound = cache.bindPreAuthorizedGrant(
        'u1',
        'preauthorized@example.com',
        'swole.lilnas.io',
      )

      expect(bound).toBe(true)
      expect(cache.hasGrant('u1', 'swole.lilnas.io')).toBe(true)
      const grantRows = testDb.db.select().from(schema.grant).all()
      expect(grantRows).toHaveLength(1)
      expect(grantRows[0]).toMatchObject({
        userId: 'u1',
        serviceHost: 'swole.lilnas.io',
      })
      expect(
        testDb.db.select().from(schema.preAuthorizedGrant).all(),
      ).toHaveLength(0)
    })

    it('binds EVERY service pre-authorized for this email in one call, not just the one being checked', () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()
      cache.addPreAuthorization('multi@example.com', 'swole.lilnas.io')
      cache.addPreAuthorization('multi@example.com', 'yacht.lilnas.io')
      seedUser('u1', 'multi@example.com')

      const bound = cache.bindPreAuthorizedGrant(
        'u1',
        'multi@example.com',
        'swole.lilnas.io',
      )

      expect(bound).toBe(true)
      expect(cache.hasGrant('u1', 'swole.lilnas.io')).toBe(true)
      expect(cache.hasGrant('u1', 'yacht.lilnas.io')).toBe(true)
    })

    it('a second bindPreAuthorizedGrant call for the same email is a no-op (already consumed)', () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()
      cache.addPreAuthorization('once@example.com', 'swole.lilnas.io')
      seedUser('u1', 'once@example.com')
      cache.bindPreAuthorizedGrant('u1', 'once@example.com', 'swole.lilnas.io')

      const secondCall = cache.bindPreAuthorizedGrant(
        'u1',
        'once@example.com',
        'swole.lilnas.io',
      )

      expect(secondCall).toBe(false)
      expect(testDb.db.select().from(schema.grant).all()).toHaveLength(1)
    })

    it('onModuleInit preloads existing pre-authorizations from the database', () => {
      const now = new Date()
      testDb.db
        .insert(schema.preAuthorizedGrant)
        .values({
          email: 'preloaded@example.com',
          serviceHost: 'swole.lilnas.io',
          createdAt: now,
        })
        .run()
      seedUser('u1', 'preloaded@example.com')

      const { cache } = createHarness(testDb)
      cache.onModuleInit()
      const bound = cache.bindPreAuthorizedGrant(
        'u1',
        'preloaded@example.com',
        'swole.lilnas.io',
      )

      expect(bound).toBe(true)
    })
  })

  describe('resolveSession — cheap pre-check (never touches the cache or the database)', () => {
    beforeEach(() => {
      testDb = createTestDb()
    })

    it('returns null for an undefined Cookie header without any database read', async () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()
      const prepareSpy = jest.spyOn(testDb.sqlite, 'prepare')

      const result = await cache.resolveSession(undefined)

      expect(result).toBeNull()
      expect(prepareSpy).not.toHaveBeenCalled()
    })

    it('returns null for a Cookie header with no Better Auth session cookie in it, without any database read', async () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()
      const prepareSpy = jest.spyOn(testDb.sqlite, 'prepare')

      const result = await cache.resolveSession(
        'some_other_cookie=1; another=2',
      )

      expect(result).toBeNull()
      expect(prepareSpy).not.toHaveBeenCalled()
    })
  })

  describe('resolveSession — cold cache then warm cache (R2)', () => {
    beforeEach(() => {
      testDb = createTestDb()
    })

    it('the first resolution for a real session performs at least one database read; the second performs zero', async () => {
      const { auth, cache } = createHarness(testDb)
      cache.onModuleInit()
      const cookie = await signInAndGetSessionCookiePair(
        auth,
        process.env.AUTH_HOST as string,
        { sub: 'google-sub-1', email: 'cold-warm@example.com' },
      )

      // Spy attached AFTER the sign-in flow above (which itself performs
      // its own DB writes) so only resolveSession()'s own reads are
      // counted — same isolation technique as
      // src/db/__tests__/schema.spec.ts's "re-asserts foreign_keys" test.
      const prepareSpy = jest.spyOn(testDb.sqlite, 'prepare')

      const first = await cache.resolveSession(cookie)
      expect(first).toEqual({
        userId: expect.any(String),
        email: 'cold-warm@example.com',
      })
      const callsAfterFirst = prepareSpy.mock.calls.length
      // "The expected DB work" is verified empirically here, not assumed
      // to be a specific literal count: auth.api.getSession() falls
      // through to internalAdapter.findSession() (session.cookieCache is
      // not enabled in this app's buildAuth() config), which is a single
      // findOne({model: 'session', join: {user: true}}) call at the
      // better-auth level — but how many underlying SQL statements the
      // drizzle adapter issues for that one logical read is an
      // implementation detail of a dependency, not a contract this test
      // should pin to a specific number. What R2 actually requires is
      // "more than zero on the one expensive path, and zero thereafter" —
      // asserted below.
      expect(callsAfterFirst).toBeGreaterThan(0)

      const second = await cache.resolveSession(cookie)
      expect(second).toEqual({
        userId: first?.userId,
        email: 'cold-warm@example.com',
      })
      expect(prepareSpy.mock.calls.length).toBe(callsAfterFirst)
    })

    it('two different sessions for two different hosts are cached independently', async () => {
      const { auth, cache } = createHarness(testDb)
      cache.onModuleInit()
      const cookieA = await signInAndGetSessionCookiePair(
        auth,
        process.env.AUTH_HOST as string,
        { sub: 'google-sub-a', email: 'user-a@example.com' },
      )
      const cookieB = await signInAndGetSessionCookiePair(
        auth,
        process.env.AUTH_HOST as string,
        { sub: 'google-sub-b', email: 'user-b@example.com' },
      )

      const resultA = await cache.resolveSession(cookieA)
      const resultB = await cache.resolveSession(cookieB)

      expect(resultA?.email).toBe('user-a@example.com')
      expect(resultB?.email).toBe('user-b@example.com')
      expect(resultA?.userId).not.toBe(resultB?.userId)

      // Both now warm — zero further reads for either.
      const prepareSpy = jest.spyOn(testDb.sqlite, 'prepare')
      await cache.resolveSession(cookieA)
      await cache.resolveSession(cookieB)
      expect(prepareSpy).not.toHaveBeenCalled()
    })
  })

  describe('resolveSession — a cached session past its own clamped cache lifetime', () => {
    beforeEach(() => {
      testDb = createTestDb()
    })

    it('re-verifies against the database rather than trusting a stale local record, and a genuinely expired session resolves to null', async () => {
      const { auth, authService, cache } = createHarness(testDb)
      cache.onModuleInit()
      const cookie = await signInAndGetSessionCookiePair(
        auth,
        process.env.AUTH_HOST as string,
        { sub: 'google-sub-expiring', email: 'expiring@example.com' },
      )

      // Force the just-created session row to expire almost immediately,
      // rather than waiting out the real 30-day expiresIn or faking
      // timers around better-auth's own internals (which independently
      // use Date.now() during the sign-in flow above). This test's DB is
      // isolated per-test, so there is exactly one session row. 50ms is
      // well under MAX_SESSION_CACHE_MS, so the cached expiresAtMs below
      // is this real expiry, not the clamp — see the clamp-specific test
      // further down for the case where the clamp itself is the binding
      // constraint.
      const rows = testDb.db.select().from(schema.session).all()
      expect(rows).toHaveLength(1)
      const sessionRow = rows[0]
      if (!sessionRow) throw new Error('expected exactly one session row')
      testDb.db
        .update(schema.session)
        .set({ expiresAt: new Date(Date.now() + 50) })
        .where(eq(schema.session.id, sessionRow.id))
        .run()

      // First resolution: cache miss, one real DB read, resolves the
      // (still, barely) valid session and caches expiresAtMs accordingly.
      const first = await cache.resolveSession(cookie)
      expect(first?.email).toBe('expiring@example.com')

      // Let real wall-clock time pass the forced expiry with a healthy
      // margin — no fake timers, so nothing about better-auth's own
      // internals (already exercised above) is disturbed.
      await new Promise(resolve => setTimeout(resolve, 200))

      // Second lookup: the cached expiresAtMs has passed, so this
      // performs a REAL re-verification rather than a locally-known-
      // expired short-circuit — deliberately, not the behavior this cache
      // had before the revocation-convergence fix. See resolveSession()'s
      // own CACHE LIFETIME comment for why a passed expiresAtMs is no
      // longer synonymous with "definitely expired" once it is a clamp
      // rather than the session's raw expiry, and must not be trusted
      // without checking.
      const prepareSpy = jest.spyOn(testDb.sqlite, 'prepare')
      const second = await cache.resolveSession(cookie)
      expect(second).toBeNull()
      expect(prepareSpy).toHaveBeenCalled()

      // Confirms the re-verification's answer is correct, not invented:
      // getSession() itself independently agrees the session is gone.
      const directResult = await authService.api.getSession({
        headers: new Headers({ cookie }),
      })
      expect(directResult).toBeNull()
    })

    it('a still-valid session survives past the CLAMP window and gets re-cached, rather than being wrongly treated as expired', async () => {
      const { auth, cache } = createHarness(testDb)
      cache.onModuleInit()
      const cookie = await signInAndGetSessionCookiePair(
        auth,
        process.env.AUTH_HOST as string,
        { sub: 'google-sub-clamp', email: 'clamp@example.com' },
      )
      const realNow = Date.now()

      // The session's real expiresAt is buildAuth()'s default (~30 days
      // out) — if the cache trusted that raw value, jumping "now" forward
      // by just over MAX_SESSION_CACHE_MS would still be a cache hit.
      const first = await cache.resolveSession(cookie)
      expect(first?.email).toBe('clamp@example.com')

      const nowSpy = jest
        .spyOn(Date, 'now')
        .mockImplementation(() => realNow + 61_000)
      try {
        const prepareSpy = jest.spyOn(testDb.sqlite, 'prepare')
        const afterClampWindow = await cache.resolveSession(cookie)

        // Re-verified (proving the CACHED lifetime was bounded to
        // MAX_SESSION_CACHE_MS, not the session's real, much longer
        // expiry) and still resolves successfully, since the underlying
        // session genuinely is still valid — the clamp elapsing must
        // never itself be mistaken for a revoked/expired session.
        expect(prepareSpy).toHaveBeenCalled()
        expect(afterClampWindow?.email).toBe('clamp@example.com')
      } finally {
        nowSpy.mockRestore()
      }
    })
  })

  describe('resolveSession — revocation convergence (an out-of-band sign-out/revoke)', () => {
    beforeEach(() => {
      testDb = createTestDb()
    })

    it('a session deleted out-of-band keeps passing within the clamp window, then correctly stops once it elapses — bounding, not eliminating, the stale-credential window', async () => {
      const { auth, cache } = createHarness(testDb)
      cache.onModuleInit()
      const cookie = await signInAndGetSessionCookiePair(
        auth,
        process.env.AUTH_HOST as string,
        { sub: 'google-sub-revoke', email: 'revoke@example.com' },
      )

      const first = await cache.resolveSession(cookie)
      expect(first).not.toBeNull()

      // Simulates what /api/auth/sign-out, /revoke-session, and
      // /revoke-sessions all do — delete the underlying `session` row —
      // WITHOUT this cache ever being told, since nothing wires those
      // endpoints to sessionCache. This is the exact gap the clamp exists
      // to bound rather than leave unbounded for the session's full
      // (up to 30-day) expiresIn.
      testDb.db.delete(schema.session).run()

      // Still within the clamp window: the stale-but-cached positive
      // entry is trusted, exactly as it was before revocation — this is
      // the accepted cost of the fix (a bounded window, not immediate
      // invalidation).
      const stillCached = await cache.resolveSession(cookie)
      expect(stillCached).not.toBeNull()

      // Past the clamp window: forces the re-verification path, which now
      // independently confirms the session row is gone.
      const realNow = Date.now()
      const nowSpy = jest
        .spyOn(Date, 'now')
        .mockImplementation(() => realNow + 61_000)
      try {
        const afterClampWindow = await cache.resolveSession(cookie)
        expect(afterClampWindow).toBeNull()
      } finally {
        nowSpy.mockRestore()
      }
    })
  })

  describe('resolveSession — malformed or forged session cookie', () => {
    beforeEach(() => {
      testDb = createTestDb()
    })

    it('is treated as no session, never throws, and does not produce an error page', async () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()

      // Shape: `<marker>=<raw-token-like-value>.<44-char-base64-shaped-fake-signature>=`
      // — long enough and dot-separated so getSignedCookie's own length/
      // shape check (better-call's dist/context.mjs) doesn't short-circuit
      // before ever attempting HMAC verification; the signature is simply
      // wrong, so verification fails and resolves `false`, which
      // getSession() treats identically to "no cookie at all" (see
      // access-cache.service.ts's own citation of this).
      const forgedCookie = `better-auth.session_token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.${'A'.repeat(43)}=`

      await expect(cache.resolveSession(forgedCookie)).resolves.toBeNull()
    })

    it('a cookie with the marker but no dot at all (too malformed to even attempt verification) is also treated as no session', async () => {
      const { cache } = createHarness(testDb)
      cache.onModuleInit()

      const forgedCookie = 'better-auth.session_token=not-even-signature-shaped'

      await expect(cache.resolveSession(forgedCookie)).resolves.toBeNull()
    })
  })

  describe('resolveSession — a thrown session-lookup error', () => {
    beforeEach(() => {
      testDb = createTestDb()
    })

    it('is treated as no session for this request, logged distinctly, and NOT cached (a later call still resolves the real session)', async () => {
      const { auth, authService, cache, logger } = createHarness(testDb)
      cache.onModuleInit()
      const cookie = await signInAndGetSessionCookiePair(
        auth,
        process.env.AUTH_HOST as string,
        { sub: 'google-sub-transient-error', email: 'transient@example.com' },
      )

      const getSessionSpy = jest
        .spyOn(authService.api, 'getSession')
        .mockRejectedValueOnce(new Error('SQLITE_BUSY: simulated contention'))

      const duringFailure = await cache.resolveSession(cookie)
      expect(duringFailure).toBeNull()
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'verify-session-check-error' }),
        expect.any(String),
      )

      getSessionSpy.mockRestore()

      // Not cached as a negative outcome — the very next call re-attempts
      // resolution for real and succeeds, proving a transient failure
      // never permanently locks a legitimate session out.
      const afterRecovery = await cache.resolveSession(cookie)
      expect(afterRecovery?.email).toBe('transient@example.com')
    })
  })
})
