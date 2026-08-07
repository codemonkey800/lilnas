import type { ExecutionContext } from '@nestjs/common'
import { NotFoundException, UnauthorizedException } from '@nestjs/common'
import { AuthService } from '@thallesp/nestjs-better-auth'
import BetterSqlite3 from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { Request } from 'express'
import { PinoLogger } from 'nestjs-pino'

import { AdminController } from 'src/admin/admin.controller'
import { AdminGuard, isAdminEmail } from 'src/admin/admin.guard'
import { UsersService } from 'src/admin/users.service'
import { buildAuth } from 'src/auth/auth'
import { applyPragmas, type Db, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { listUsersWithGrantHistory } from 'src/grants/grants.repo'
import { RequestsService } from 'src/requests/requests.service'
import type {
  ServiceRegistryEntry,
  ServiceRegistryService,
} from 'src/services/service-registry.service'
import { ADMIN_TOPIC, NotifyBusService } from 'src/sse/notify-bus.service'
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
process.env.ADMIN_EMAILS = 'admin@example.com'

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

function fakeServiceRegistry(
  entries: ServiceRegistryEntry[],
): ServiceRegistryService {
  return {
    getServices: jest.fn().mockResolvedValue(entries),
  } as unknown as ServiceRegistryService
}

// ──────────────────────────────────────────────────────────────────────────────
// Full real stack per test — real Db, real buildAuth()/AuthService
// producing genuinely signed session cookies, ONE shared AccessCacheService
// instance driving both UsersService's admin writes and VerifyService's
// user-facing reads. Mirrors approve-verify-integration.spec.ts's own
// "share one cache instance between the write path and the read path"
// design, extended here to every U9 mutation (pre-authorize, edit
// services, remove, block, unblock) rather than just U7's approve.
//
// notifyBus is a real NotifyBusService (not a fake) and is returned
// alongside the rest of the harness so tests below can subscribe to its
// stream$ directly — same "fake the collaborator, drive the real service
// under test" posture requests.service.spec.ts already established for its
// own publish-signal assertions.
// ──────────────────────────────────────────────────────────────────────────────
function createHarness(testDb: ReturnType<typeof createTestDb>) {
  const auth = buildAuth(testDb.db)
  const authService = new AuthService({ auth })
  const accessCache = new AccessCacheService(
    testDb.db,
    authService,
    fakeLogger(),
  )
  accessCache.onModuleInit()
  const notifyBus = new NotifyBusService()
  const usersService = new UsersService(
    testDb.db,
    accessCache,
    notifyBus,
    fakeLogger(),
  )
  const verifyService = new VerifyService(accessCache)
  return { auth, accessCache, notifyBus, usersService, verifyService }
}

async function signIn(
  auth: ReturnType<typeof buildAuth>,
  profile: { sub: string; email: string },
): Promise<string> {
  return signInAndGetSessionCookiePair(
    auth,
    process.env.AUTH_HOST as string,
    profile,
  )
}

function verifyInputFor(cookie: string, host: string) {
  return {
    cookieHeader: cookie,
    forwardedHost: host,
    forwardedProto: 'https',
    forwardedUri: '/',
  }
}

function mustFindUser(db: Db, email: string): schema.UserRow {
  const row = db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .get()
  if (!row) throw new Error(`expected a user row for ${email}`)
  return row
}

describe('U9: user and grant management', () => {
  describe('R15: pre-authorize by email — the grant binds on first sign-in', () => {
    it('happy path: a pre-authorized email passes straight through on its very first verify anywhere, no pending page', async () => {
      const testDb = createTestDb()
      try {
        const { auth, usersService, verifyService } = createHarness(testDb)

        usersService.preAuthorize('waiting@example.com', 'swole.lilnas.io')
        const cookie = await signIn(auth, {
          sub: 'google-sub-preauth',
          email: 'waiting@example.com',
        })

        const decision = await verifyService.decide(
          verifyInputFor(cookie, 'swole.lilnas.io'),
        )

        expect(decision).toEqual({
          outcome: 'allow',
          email: 'waiting@example.com',
          userId: mustFindUser(testDb.db, 'waiting@example.com').id,
        })
      } finally {
        testDb.close()
      }
    })

    it('edge case: pre-authorizing an email that already has a user row attaches to the existing user rather than creating a duplicate pre_authorized_grant row', async () => {
      const testDb = createTestDb()
      try {
        const { auth, usersService, verifyService } = createHarness(testDb)
        const cookie = await signIn(auth, {
          sub: 'google-sub-existing',
          email: 'already-here@example.com',
        })
        // Signed in BEFORE being pre-authorized — a real user row already
        // exists by the time preAuthorize() runs.
        await verifyService.decide(verifyInputFor(cookie, 'swole.lilnas.io'))

        usersService.preAuthorize('already-here@example.com', 'swole.lilnas.io')

        expect(
          testDb.db.select().from(schema.preAuthorizedGrant).all(),
        ).toHaveLength(0)
        const decision = await verifyService.decide(
          verifyInputFor(cookie, 'swole.lilnas.io'),
        )
        expect(decision).toEqual({
          outcome: 'allow',
          email: 'already-here@example.com',
          userId: mustFindUser(testDb.db, 'already-here@example.com').id,
        })
      } finally {
        testDb.close()
      }
    })

    it('edge case: pre-authorizing the same email twice is idempotent (one pending row)', () => {
      const testDb = createTestDb()
      try {
        const { usersService } = createHarness(testDb)

        usersService.preAuthorize('twice@example.com', 'swole.lilnas.io')
        expect(() =>
          usersService.preAuthorize('twice@example.com', 'swole.lilnas.io'),
        ).not.toThrow()

        expect(
          testDb.db.select().from(schema.preAuthorizedGrant).all(),
        ).toHaveLength(1)
      } finally {
        testDb.close()
      }
    })
  })

  describe('R14: the user list shows only users with at least one grant, current or historical', () => {
    it('happy path: a user whose only history is unapproved requests does not appear in the user list', async () => {
      const testDb = createTestDb()
      try {
        const { auth } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-requester',
          email: 'requester@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'requester@example.com')
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

        const users = listUsersWithGrantHistory(testDb.db)

        expect(users.some(u => u.email === 'requester@example.com')).toBe(false)
      } finally {
        testDb.close()
      }
    })

    it('happy path: a user whose grants were all revoked still appears in the user list', async () => {
      const testDb = createTestDb()
      try {
        const { auth, usersService } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-revoked',
          email: 'revoked@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'revoked@example.com')
        usersService.setUserService(userRow.id, 'swole.lilnas.io', true)

        usersService.setUserService(userRow.id, 'swole.lilnas.io', false)

        expect(
          testDb.db
            .select()
            .from(schema.grant)
            .where(eq(schema.grant.userId, userRow.id))
            .all(),
        ).toHaveLength(0)
        const users = listUsersWithGrantHistory(testDb.db)
        expect(users.some(u => u.id === userRow.id)).toBe(true)
      } finally {
        testDb.close()
      }
    })
  })

  describe("editing a user's services", () => {
    it('happy path: adds and removes grants, both taking effect on the next verify with no restart', async () => {
      const testDb = createTestDb()
      try {
        const { auth, usersService, verifyService } = createHarness(testDb)
        const cookie = await signIn(auth, {
          sub: 'google-sub-edit',
          email: 'edit@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'edit@example.com')
        usersService.setUserService(userRow.id, 'swole.lilnas.io', true)

        const beforeYacht = await verifyService.decide(
          verifyInputFor(cookie, 'yacht.lilnas.io'),
        )
        expect(beforeYacht.outcome).toBe('redirect')
        const swoleAllowed = await verifyService.decide(
          verifyInputFor(cookie, 'swole.lilnas.io'),
        )
        expect(swoleAllowed.outcome).toBe('allow')

        // Swap swole for yacht — two atomic single-host actions now (revoke,
        // then grant), matching how the admin UI actually invokes this one
        // checkbox at a time (setUserService(), not a complete-desired-set
        // diff).
        usersService.setUserService(userRow.id, 'swole.lilnas.io', false)
        usersService.setUserService(userRow.id, 'yacht.lilnas.io', true)

        const afterSwole = await verifyService.decide(
          verifyInputFor(cookie, 'swole.lilnas.io'),
        )
        expect(afterSwole.outcome).toBe('redirect')
        const afterYacht = await verifyService.decide(
          verifyInputFor(cookie, 'yacht.lilnas.io'),
        )
        expect(afterYacht.outcome).toBe('allow')
      } finally {
        testDb.close()
      }
    })
  })

  describe('R15: remove a user', () => {
    it('edge case: removing a user with an active session immediately stops that session from passing verify, without deleting the user row or session', async () => {
      const testDb = createTestDb()
      try {
        const { auth, usersService, verifyService } = createHarness(testDb)
        const cookie = await signIn(auth, {
          sub: 'google-sub-remove',
          email: 'remove-me@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'remove-me@example.com')
        usersService.setUserService(userRow.id, 'swole.lilnas.io', true)
        const before = await verifyService.decide(
          verifyInputFor(cookie, 'swole.lilnas.io'),
        )
        expect(before.outcome).toBe('allow')

        usersService.removeUser(userRow.id)

        const after = await verifyService.decide(
          verifyInputFor(cookie, 'swole.lilnas.io'),
        )
        expect(after.outcome).toBe('redirect')
        // The SAME session still resolves (not deleted) — "remove" is
        // un-authorize, not a ban; a removed user falls back to the
        // normal no-grant flow, not an error.
        expect(
          testDb.db
            .select()
            .from(schema.session)
            .where(eq(schema.session.userId, userRow.id))
            .all(),
        ).toHaveLength(1)
        // The user row survives too (everGrantedAt marker intact, R14).
        expect(mustFindUser(testDb.db, 'remove-me@example.com')).toBeDefined()
      } finally {
        testDb.close()
      }
    })
  })

  describe('S2b: the standalone revokeSessions() action', () => {
    it('signs a user out immediately without blocking their future access — services and blockedAt stay untouched, but the existing cookie stops resolving to a session', async () => {
      const testDb = createTestDb()
      try {
        const { auth, usersService, verifyService } = createHarness(testDb)
        const cookie = await signIn(auth, {
          sub: 'google-sub-revoke-only',
          email: 'revokeonly@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'revokeonly@example.com')
        usersService.setUserService(userRow.id, 'swole.lilnas.io', true)
        expect(
          (
            await verifyService.decide(
              verifyInputFor(cookie, 'swole.lilnas.io'),
            )
          ).outcome,
        ).toBe('allow')

        const sessionsRevoked = usersService.revokeSessions(userRow.id)

        expect(sessionsRevoked).toBe(1)
        expect(testDb.db.select().from(schema.session).all()).toHaveLength(0)
        // Not blocked — a fresh sign-in is immediately allowed again, no
        // admin unblock action required, since revokeSessions() alone
        // never touches blockedAt or the grants table.
        const freshCookie = await signIn(auth, {
          sub: 'google-sub-revoke-only',
          email: 'revokeonly@example.com',
        })
        expect(
          (
            await verifyService.decide(
              verifyInputFor(freshCookie, 'swole.lilnas.io'),
            )
          ).outcome,
        ).toBe('allow')
      } finally {
        testDb.close()
      }
    })

    it('returns 0 for a user with no active sessions, rather than throwing', async () => {
      const testDb = createTestDb()
      try {
        const { auth, usersService } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-no-session',
          email: 'nosession@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'nosession@example.com')
        usersService.revokeSessions(userRow.id)

        expect(usersService.revokeSessions(userRow.id)).toBe(0)
      } finally {
        testDb.close()
      }
    })
  })

  describe('R16 / AE6: block and unblock, from the admin action entry point', () => {
    it('S2b: blocking revokes the existing session outright — the same cookie now hits the login redirect (no session), not /blocked, and no access_request row is created', async () => {
      const testDb = createTestDb()
      try {
        const { auth, usersService, verifyService } = createHarness(testDb)
        const cookie = await signIn(auth, {
          sub: 'google-sub-block',
          email: 'blockme@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'blockme@example.com')
        usersService.setUserService(userRow.id, 'swole.lilnas.io', true)
        const before = await verifyService.decide(
          verifyInputFor(cookie, 'swole.lilnas.io'),
        )
        expect(before.outcome).toBe('allow')

        usersService.blockUser(userRow.id)

        const after = await verifyService.decide(
          verifyInputFor(cookie, 'swole.lilnas.io'),
        )
        // S2b: blockUser() now also revokes every session (see
        // UsersService.revokeSessions()'s own comment) — the ORIGINAL
        // cookie no longer resolves to a session at all, so this redirects
        // to /login (the "no session" branch), never /blocked. See the
        // next test for a FRESH session on this same, still-blocked user.
        expect(after.outcome).toBe('redirect')
        expect(
          (after as { outcome: 'redirect'; location: string }).location,
        ).toContain('/login')
        expect(testDb.db.select().from(schema.session).all()).toHaveLength(0)
        expect(
          testDb.db.select().from(schema.accessRequest).all(),
        ).toHaveLength(0)
      } finally {
        testDb.close()
      }
    })

    it('S2b: a freshly re-signed-in session for a still-blocked user correctly redirects to /blocked', async () => {
      const testDb = createTestDb()
      try {
        const { auth, usersService, verifyService } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-block-fresh',
          email: 'blockmefresh@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'blockmefresh@example.com')
        usersService.blockUser(userRow.id)

        // A brand-new sign-in mints a brand-new session row/cookie —
        // unaffected by the earlier revocation, which only ever deletes
        // rows that existed at the time it ran.
        const freshCookie = await signIn(auth, {
          sub: 'google-sub-block-fresh',
          email: 'blockmefresh@example.com',
        })

        const decision = await verifyService.decide(
          verifyInputFor(freshCookie, 'swole.lilnas.io'),
        )
        expect(decision.outcome).toBe('redirect')
        expect(
          (decision as { outcome: 'redirect'; location: string }).location,
        ).toContain('/blocked')
      } finally {
        testDb.close()
      }
    })

    it('happy path: unblocking clears blockedAt, but does not resurrect the session S2b already revoked — a fresh sign-in is required, and THEN access is restored', async () => {
      const testDb = createTestDb()
      try {
        const { auth, usersService, verifyService } = createHarness(testDb)
        const cookie = await signIn(auth, {
          sub: 'google-sub-unblock',
          email: 'unblockme@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'unblockme@example.com')
        usersService.setUserService(userRow.id, 'swole.lilnas.io', true)
        usersService.blockUser(userRow.id)
        expect(
          (
            await verifyService.decide(
              verifyInputFor(cookie, 'swole.lilnas.io'),
            )
          ).outcome,
        ).toBe('redirect')

        usersService.unblockUser(userRow.id)

        // The ORIGINAL cookie's session was already revoked by blockUser()
        // (S2b) — unblocking clears blockedAt but does not, and should not,
        // reissue the deleted session. Still a redirect, now to /login
        // rather than /blocked, since there is genuinely no session left.
        const staleCookieResult = await verifyService.decide(
          verifyInputFor(cookie, 'swole.lilnas.io'),
        )
        expect(staleCookieResult.outcome).toBe('redirect')
        expect(
          (staleCookieResult as { outcome: 'redirect'; location: string })
            .location,
        ).toContain('/login')

        // A fresh sign-in, however, is fully restored.
        const freshCookie = await signIn(auth, {
          sub: 'google-sub-unblock',
          email: 'unblockme@example.com',
        })
        const after = await verifyService.decide(
          verifyInputFor(freshCookie, 'swole.lilnas.io'),
        )
        expect(after.outcome).toBe('allow')
      } finally {
        testDb.close()
      }
    })

    it('error path (R17): an admin blocking their own ADMIN_EMAILS address still retains admin access — the grants table cannot revoke admin', async () => {
      const testDb = createTestDb()
      try {
        const { auth, usersService } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-admin',
          email: 'admin@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'admin@example.com')

        usersService.blockUser(userRow.id)

        // AdminGuard reads ONLY the session + ADMIN_EMAILS — never
        // blockedAt or the grants table (proven exhaustively in
        // admin.guard.spec.ts). Re-checked here from THIS unit's own
        // action (an admin blocking themself), not a re-test of
        // admin.guard.spec.ts's own scenarios.
        expect(
          isAdminEmail('admin@example.com', process.env.ADMIN_EMAILS ?? ''),
        ).toBe(true)
      } finally {
        testDb.close()
      }
    })

    it('S2b closes the gap the test above leaves open: blocking a compromised ADMIN also revokes their session, so AdminGuard now denies (401) via resolveSession — before isAdminEmail is ever consulted', async () => {
      const testDb = createTestDb()
      try {
        const { auth, accessCache, usersService } = createHarness(testDb)
        const cookie = await signIn(auth, {
          sub: 'google-sub-compromised-admin',
          email: 'admin@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'admin@example.com')
        const guard = new AdminGuard(accessCache)
        const contextFor = (cookieHeader: string): ExecutionContext =>
          ({
            switchToHttp: () => ({
              getRequest: () =>
                ({ headers: { cookie: cookieHeader } }) as unknown as Request,
            }),
          }) as unknown as ExecutionContext

        await expect(guard.canActivate(contextFor(cookie))).resolves.toBe(true)

        usersService.blockUser(userRow.id)

        // isAdminEmail() itself is still true (the test above proves that
        // in isolation) — but the underlying SESSION is gone, so
        // AdminGuard's own resolveSession() call now finds nothing at all
        // and throws 401 before isAdminEmail is ever reached. This is what
        // actually closes the "no way to revoke a compromised admin" gap:
        // S2a alone only ever gated /verify, never /admin.
        await expect(guard.canActivate(contextFor(cookie))).rejects.toThrow(
          UnauthorizedException,
        )
      } finally {
        testDb.close()
      }
    })

    it('S6: blockUser() on a nonexistent userId throws NotFoundException rather than silently succeeding, and never marks the phantom id as blocked', async () => {
      const testDb = createTestDb()
      try {
        const { accessCache, usersService } = createHarness(testDb)

        expect(() => usersService.blockUser('no-such-user')).toThrow(
          NotFoundException,
        )
        // The actual bug this closes: a silent no-op UPDATE used to still
        // reach accessCache.blockUser(), permanently marking a userId with
        // no real user behind it — a phantom that onModuleInit() would
        // correctly omit on restart, but that nothing ever cleans up
        // in-process.
        expect(accessCache.isBlocked('no-such-user')).toBe(false)
      } finally {
        testDb.close()
      }
    })

    it('S6: unblockUser() on a nonexistent userId throws NotFoundException rather than silently succeeding', async () => {
      const testDb = createTestDb()
      try {
        const { usersService } = createHarness(testDb)

        expect(() => usersService.unblockUser('no-such-user')).toThrow(
          NotFoundException,
        )
      } finally {
        testDb.close()
      }
    })
  })

  describe('error path: granting a service not in the registry', () => {
    it('is rejected with a clear message, via AdminController (R13/U8 integration)', async () => {
      const testDb = createTestDb()
      try {
        const { usersService } = createHarness(testDb)
        // RequestsService is a required AdminController constructor
        // argument but irrelevant to this route — a bare stand-in, same
        // pattern admin.controller.spec.ts's own fakeAccessCache() uses.
        const requestsService = {
          approveRequest: jest.fn(),
          rejectRequest: jest.fn(),
          bulkReject: jest.fn(),
        } as unknown as RequestsService
        const controller = new AdminController(
          testDb.db,
          requestsService,
          fakeServiceRegistry([
            { host: 'swole.lilnas.io', gatedBy: 'forward-auth' },
          ]),
          usersService,
        )

        await expect(
          controller.preAuthorize({
            email: 'someone@example.com',
            serviceHost: 'not-a-real-service.lilnas.io',
          }),
        ).rejects.toThrow(/not a known service/)
      } finally {
        testDb.close()
      }
    })

    it('also rejects an unknown host on the edit-services route', async () => {
      const testDb = createTestDb()
      try {
        const { auth, usersService } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-edit-invalid',
          email: 'edit-invalid@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'edit-invalid@example.com')
        const requestsService = {
          approveRequest: jest.fn(),
          rejectRequest: jest.fn(),
          bulkReject: jest.fn(),
        } as unknown as RequestsService
        const controller = new AdminController(
          testDb.db,
          requestsService,
          fakeServiceRegistry([
            { host: 'swole.lilnas.io', gatedBy: 'forward-auth' },
          ]),
          usersService,
        )

        await expect(
          controller.setUserService(userRow.id, {
            serviceHost: 'not-a-real-service.lilnas.io',
            grant: true,
          }),
        ).rejects.toThrow(/not a known service/)
      } finally {
        testDb.close()
      }
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // Admin dashboard live updates: every mutation in this file also calls
  // NotifyBusService.publishAdminChange() (see users.service.ts's own
  // header comment) — the SAME bus and topic requests.service.ts's own
  // mutations publish to. Each test below drives ONE mutation through the
  // real harness (not a fake NotifyBusService) and subscribes to
  // notifyBus.stream$ directly, same pattern requests.service.spec.ts's
  // own admin-broadcast coverage already established.
  // ──────────────────────────────────────────────────────────────────────
  describe('admin dashboard live updates (publishAdminChange)', () => {
    it('preAuthorize() publishes when it attaches a real grant to an existing user', async () => {
      const testDb = createTestDb()
      try {
        const { auth, notifyBus, usersService } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-preauth-existing',
          email: 'preauth-existing@example.com',
        })
        const publishedTopics: string[] = []
        notifyBus.stream$.subscribe(signal =>
          publishedTopics.push(signal.topic),
        )

        usersService.preAuthorize(
          'preauth-existing@example.com',
          'swole.lilnas.io',
        )

        expect(publishedTopics).toEqual([ADMIN_TOPIC])
      } finally {
        testDb.close()
      }
    })

    it('preAuthorize() also publishes when it only writes a pending pre_authorized_grant row (no user yet)', () => {
      const testDb = createTestDb()
      try {
        const { notifyBus, usersService } = createHarness(testDb)
        const publishedTopics: string[] = []
        notifyBus.stream$.subscribe(signal =>
          publishedTopics.push(signal.topic),
        )

        usersService.preAuthorize(
          'not-signed-in-yet@example.com',
          'swole.lilnas.io',
        )

        expect(publishedTopics).toEqual([ADMIN_TOPIC])
      } finally {
        testDb.close()
      }
    })

    it('setUserService(grant: true) publishes when it actually grants', async () => {
      const testDb = createTestDb()
      try {
        const { auth, notifyBus, usersService } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-notify-grant',
          email: 'notify-grant@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'notify-grant@example.com')
        const publishedTopics: string[] = []
        notifyBus.stream$.subscribe(signal =>
          publishedTopics.push(signal.topic),
        )

        usersService.setUserService(userRow.id, 'swole.lilnas.io', true)

        expect(publishedTopics).toEqual([ADMIN_TOPIC])
      } finally {
        testDb.close()
      }
    })

    it('setUserService(grant: true) does NOT publish when the grant already exists (no-op)', async () => {
      const testDb = createTestDb()
      try {
        const { auth, notifyBus, usersService } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-notify-grant-noop',
          email: 'notify-grant-noop@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'notify-grant-noop@example.com')
        usersService.setUserService(userRow.id, 'swole.lilnas.io', true)
        const publishedTopics: string[] = []
        notifyBus.stream$.subscribe(signal =>
          publishedTopics.push(signal.topic),
        )

        usersService.setUserService(userRow.id, 'swole.lilnas.io', true)

        expect(publishedTopics).toEqual([])
      } finally {
        testDb.close()
      }
    })

    it('setUserService(grant: false) publishes on revoke', async () => {
      const testDb = createTestDb()
      try {
        const { auth, notifyBus, usersService } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-notify-revoke',
          email: 'notify-revoke@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'notify-revoke@example.com')
        usersService.setUserService(userRow.id, 'swole.lilnas.io', true)
        const publishedTopics: string[] = []
        notifyBus.stream$.subscribe(signal =>
          publishedTopics.push(signal.topic),
        )

        usersService.setUserService(userRow.id, 'swole.lilnas.io', false)

        expect(publishedTopics).toEqual([ADMIN_TOPIC])
      } finally {
        testDb.close()
      }
    })

    it('removeUser() publishes when the user had at least one grant', async () => {
      const testDb = createTestDb()
      try {
        const { auth, notifyBus, usersService } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-notify-remove',
          email: 'notify-remove@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'notify-remove@example.com')
        usersService.setUserService(userRow.id, 'swole.lilnas.io', true)
        const publishedTopics: string[] = []
        notifyBus.stream$.subscribe(signal =>
          publishedTopics.push(signal.topic),
        )

        usersService.removeUser(userRow.id)

        expect(publishedTopics).toEqual([ADMIN_TOPIC])
      } finally {
        testDb.close()
      }
    })

    it('removeUser() does NOT publish for a user with no current grants (nothing changed)', async () => {
      const testDb = createTestDb()
      try {
        const { auth, notifyBus, usersService } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-notify-remove-noop',
          email: 'notify-remove-noop@example.com',
        })
        const userRow = mustFindUser(
          testDb.db,
          'notify-remove-noop@example.com',
        )
        const publishedTopics: string[] = []
        notifyBus.stream$.subscribe(signal =>
          publishedTopics.push(signal.topic),
        )

        usersService.removeUser(userRow.id)

        expect(publishedTopics).toEqual([])
      } finally {
        testDb.close()
      }
    })

    it('blockUser() and unblockUser() each publish', async () => {
      const testDb = createTestDb()
      try {
        const { auth, notifyBus, usersService } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-notify-block',
          email: 'notify-block@example.com',
        })
        const userRow = mustFindUser(testDb.db, 'notify-block@example.com')
        const publishedTopics: string[] = []
        notifyBus.stream$.subscribe(signal =>
          publishedTopics.push(signal.topic),
        )

        usersService.blockUser(userRow.id)
        usersService.unblockUser(userRow.id)

        expect(publishedTopics).toEqual([ADMIN_TOPIC, ADMIN_TOPIC])
      } finally {
        testDb.close()
      }
    })
  })
})
