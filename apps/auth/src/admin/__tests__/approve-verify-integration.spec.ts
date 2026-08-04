import { AuthService } from '@thallesp/nestjs-better-auth'
import BetterSqlite3 from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { PinoLogger } from 'nestjs-pino'

import { buildAuth } from 'src/auth/auth'
import { applyPragmas, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { RequestsService } from 'src/requests/requests.service'
import { NotifyBusService } from 'src/sse/notify-bus.service'
import { signInAndGetSessionCookiePair } from 'src/verify/__tests__/helpers/session-fixtures'
import { AccessCacheService } from 'src/verify/access-cache.service'
import { VerifyService } from 'src/verify/verify.service'

// Obviously-fake test values, scoped to this file only — mirrors
// access-cache.service.spec.ts's own module-scope convention.
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

// ──────────────────────────────────────────────────────────────────────────────
// U7's own "Integration" test scenario, verbatim from the plan: "approve ->
// cache invalidated -> the waiting user's next verify returns 200 (the
// write-order property above, proven end to end)." Every collaborator here
// is real — real sqlite-backed Db, real buildAuth()/AuthService producing a
// genuinely signed session cookie (never fabricated, per U5's own
// established convention), real AccessCacheService, real RequestsService,
// real VerifyService. The only thing this test does NOT drive through real
// HTTP is the Nest routing layer itself (VerifyController/AdminController) —
// already covered by RequestsController/VerifyController's OWN unit tests;
// what's unique here is that a single AccessCacheService instance is shared
// between the admin write path and the user-facing read path, exactly as
// NestJS DI would share it in production, so a stale-cache bug (approving
// through one instance while /verify reads a different, unwritten one)
// cannot hide behind two separately-constructed fakes.
// ──────────────────────────────────────────────────────────────────────────────
describe("U7 integration: admin approve unblocks a waiting user's /verify without restart", () => {
  it('a session that was redirected to pending reaches outcome allow immediately after approval, with no further DB read on the grant check', async () => {
    const testDb = createTestDb()
    try {
      const auth = buildAuth(testDb.db)
      const authService = new AuthService({ auth })
      const accessCache = new AccessCacheService(
        testDb.db,
        authService,
        fakeLogger(),
      )
      accessCache.onModuleInit()
      const notifyBus = new NotifyBusService()
      const requestsService = new RequestsService(
        testDb.db,
        accessCache,
        notifyBus,
      )
      const verifyService = new VerifyService(accessCache)

      const cookie = await signInAndGetSessionCookiePair(
        auth,
        process.env.AUTH_HOST as string,
        { sub: 'google-sub-waiting', email: 'waiting@example.com' },
      )
      const userRow = testDb.db
        .select()
        .from(schema.user)
        .where(eq(schema.user.email, 'waiting@example.com'))
        .get()
      if (!userRow) throw new Error('expected sign-in to create a user row')

      const verifyInput = {
        cookieHeader: cookie,
        forwardedHost: 'swole.lilnas.io',
        forwardedProto: 'https',
        forwardedUri: '/',
      }

      // Before any request/approval exists: signed in, but no grant — /verify
      // redirects to the pending page, never allows.
      const before = await verifyService.decide(verifyInput)
      expect(before.outcome).toBe('redirect')

      // Seed the pending access_request row an admin would see in the queue
      // (bypassing RequestsController/RequestsService.requestAccess() here
      // deliberately — that absorb/create path is requests.service.spec.ts's
      // own concern; this test's only job is approve -> cache -> verify).
      const now = new Date()
      testDb.db
        .insert(schema.accessRequest)
        .values({
          userId: userRow.id,
          serviceHost: 'swole.lilnas.io',
          status: 'pending',
          createdAt: now,
          lastSeenAt: now,
        })
        .run()
      const pendingRow = testDb.db
        .select()
        .from(schema.accessRequest)
        .where(eq(schema.accessRequest.userId, userRow.id))
        .get()
      if (!pendingRow) throw new Error('expected the seeded pending row')

      // The admin action — writes the grant, invalidates AccessCacheService
      // (the SAME instance verifyService reads from), and publishes SSE.
      requestsService.approveRequest(pendingRow.id)

      // No restart, no re-sign-in, no new cookie: the SAME session, read
      // through the SAME AccessCacheService instance, now allows — proving
      // the write-then-invalidate ordering actually closes the gap between
      // an admin's click and this user's very next request.
      const prepareSpy = jest.spyOn(testDb.sqlite, 'prepare')
      const after = await verifyService.decide(verifyInput)
      expect(after).toEqual({
        outcome: 'allow',
        email: 'waiting@example.com',
        userId: userRow.id,
      })
      // The session itself was already warm from the `before` call above,
      // and the grant check (hasGrant) is an in-memory Set lookup — this
      // second decide() call performs ZERO further database reads,
      // confirming the grant became visible via the in-memory write-through
      // (addGrant), not by this call quietly re-reading the database.
      expect(prepareSpy).not.toHaveBeenCalled()
    } finally {
      testDb.close()
    }
  })
})
