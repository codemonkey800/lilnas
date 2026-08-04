import { AuthService } from '@thallesp/nestjs-better-auth'
import BetterSqlite3 from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { PinoLogger } from 'nestjs-pino'

import { buildAuth } from 'src/auth/auth'
import { applyPragmas, type Db, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { parseWhitelist, seedWhitelist } from 'src/db/seed-whitelist'
import { RequestsService } from 'src/requests/requests.service'
import { NotifyBusService } from 'src/sse/notify-bus.service'
import { signInAndGetSessionCookiePair } from 'src/verify/__tests__/helpers/session-fixtures'
import { AccessCacheService } from 'src/verify/access-cache.service'
import { VerifyService } from 'src/verify/verify.service'

// Obviously-fake test values, scoped to this file only — mirrors every
// other verify/admin spec's module-scope convention.
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

// Mirrors src/admin/__tests__/approve-verify-integration.spec.ts's harness
// — one shared AccessCacheService instance driving VerifyService's read
// path and RequestsService's write path, matching how NestJS DI shares it
// in production. Deliberately constructed AFTER seedWhitelist() has
// already run in every test below: onModuleInit() preloads this cache's
// in-memory maps from whatever is in the DB AT THAT MOMENT, exactly
// mirroring the real deployment sequence this unit's own runbook
// documents (seed the DB, THEN boot/reboot the app) — constructing the
// harness first would preload an empty cache and never see rows seeded
// afterward, which is a real property of the write-through cache design
// (U5/U9), not a test artifact to work around.
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
  const requestsService = new RequestsService(testDb.db, accessCache, notifyBus)
  const verifyService = new VerifyService(accessCache)
  return { auth, accessCache, requestsService, verifyService }
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

describe('U10: seed script (R19)', () => {
  describe('parseWhitelist', () => {
    it('splits on comma, trims, and lowercases', () => {
      expect(parseWhitelist(' Foo@Example.com , bar@example.com')).toEqual([
        'foo@example.com',
        'bar@example.com',
      ])
    })

    it('dedupes case/whitespace variants of the same address', () => {
      expect(
        parseWhitelist('a@example.com, A@Example.com ,a@example.com'),
      ).toEqual(['a@example.com'])
    })

    it('edge case: empty or absent whitelist parses to an empty list', () => {
      expect(parseWhitelist('')).toEqual([])
      expect(parseWhitelist('   ')).toEqual([])
      expect(parseWhitelist(',,,')).toEqual([])
    })
  })

  describe('seedWhitelist: happy path', () => {
    it('creates one pre-authorization per member per protected host, for members who have never signed in', () => {
      const testDb = createTestDb()
      try {
        const summary = seedWhitelist(
          testDb.db,
          ['a@example.com', 'b@example.com'],
          ['swole.lilnas.io', 'yacht.lilnas.io'],
        )

        expect(summary).toEqual({
          emailCount: 2,
          hostCount: 2,
          grantsWritten: 4,
        })
        const rows = testDb.db.select().from(schema.preAuthorizedGrant).all()
        expect(rows).toHaveLength(4)
        const pairs = new Set(rows.map(r => `${r.email}|${r.serviceHost}`))
        expect(pairs).toEqual(
          new Set([
            'a@example.com|swole.lilnas.io',
            'a@example.com|yacht.lilnas.io',
            'b@example.com|swole.lilnas.io',
            'b@example.com|yacht.lilnas.io',
          ]),
        )
      } finally {
        testDb.close()
      }
    })

    it('writes a real grant (not a pre-authorization) for a member who already has a user row', async () => {
      const testDb = createTestDb()
      try {
        const { auth } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-already-signed-in',
          email: 'already@example.com',
        })

        const summary = seedWhitelist(
          testDb.db,
          ['already@example.com'],
          ['swole.lilnas.io'],
        )

        expect(summary.grantsWritten).toBe(1)
        expect(
          testDb.db.select().from(schema.preAuthorizedGrant).all(),
        ).toHaveLength(0)
        expect(testDb.db.select().from(schema.grant).all()).toHaveLength(1)
      } finally {
        testDb.close()
      }
    })
  })

  describe('seedWhitelist: idempotent', () => {
    it('running the same seed twice leaves the same row count', () => {
      const testDb = createTestDb()
      try {
        const emails = ['a@example.com', 'b@example.com']
        const hosts = ['swole.lilnas.io', 'yacht.lilnas.io', 'tdr.lilnas.io']

        const first = seedWhitelist(testDb.db, emails, hosts)
        expect(first.grantsWritten).toBe(6)

        const second = seedWhitelist(testDb.db, emails, hosts)

        expect(second.grantsWritten).toBe(0)
        expect(
          testDb.db.select().from(schema.preAuthorizedGrant).all(),
        ).toHaveLength(6)
      } finally {
        testDb.close()
      }
    })

    it('is idempotent for the already-signed-in branch too', async () => {
      const testDb = createTestDb()
      try {
        const { auth } = createHarness(testDb)
        await signIn(auth, {
          sub: 'google-sub-idempotent',
          email: 'idempotent@example.com',
        })

        seedWhitelist(
          testDb.db,
          ['idempotent@example.com'],
          ['swole.lilnas.io'],
        )
        const second = seedWhitelist(
          testDb.db,
          ['idempotent@example.com'],
          ['swole.lilnas.io'],
        )

        expect(second.grantsWritten).toBe(0)
        expect(testDb.db.select().from(schema.grant).all()).toHaveLength(1)
      } finally {
        testDb.close()
      }
    })
  })

  describe('seedWhitelist: edge cases', () => {
    it('an empty whitelist seeds nothing and does not throw', () => {
      const testDb = createTestDb()
      try {
        expect(() =>
          seedWhitelist(testDb.db, [], ['swole.lilnas.io']),
        ).not.toThrow()
        const summary = seedWhitelist(testDb.db, [], ['swole.lilnas.io'])

        expect(summary).toEqual({
          emailCount: 0,
          hostCount: 1,
          grantsWritten: 0,
        })
        expect(
          testDb.db.select().from(schema.preAuthorizedGrant).all(),
        ).toHaveLength(0)
      } finally {
        testDb.close()
      }
    })

    it('a whitelist entry with surrounding whitespace or differing case seeds correctly and matches at sign-in', async () => {
      const testDb = createTestDb()
      try {
        // The raw, hand-maintained-env-var form an operator might actually
        // have — normalized through parseWhitelist() exactly as the real
        // CLI entrypoint does, then seeded BEFORE the cache below preloads
        // (see createHarness()'s own comment on why ordering matters here).
        const emails = parseWhitelist('  Messy.Casing@Example.com  ')
        seedWhitelist(testDb.db, emails, ['swole.lilnas.io'])

        const { auth, verifyService } = createHarness(testDb)

        // A real Google sign-in presents the canonical (lowercase, no
        // whitespace) form — this is what bindPreAuthorizedGrant()'s exact
        // Map-key lookup must match against.
        const cookie = await signIn(auth, {
          sub: 'google-sub-messy-casing',
          email: 'messy.casing@example.com',
        })

        const decision = await verifyService.decide(
          verifyInputFor(cookie, 'swole.lilnas.io'),
        )

        expect(decision).toEqual({
          outcome: 'allow',
          email: 'messy.casing@example.com',
          userId: mustFindUser(testDb.db, 'messy.casing@example.com').id,
        })
      } finally {
        testDb.close()
      }
    })
  })

  describe('integration: the R19 promise', () => {
    it('a seeded user reaches every protected host with no interstitial, on their very first verify', async () => {
      const testDb = createTestDb()
      try {
        seedWhitelist(
          testDb.db,
          ['seeded@example.com'],
          ['swole.lilnas.io', 'yacht.lilnas.io'],
        )
        const { auth, verifyService } = createHarness(testDb)

        const cookie = await signIn(auth, {
          sub: 'google-sub-seeded',
          email: 'seeded@example.com',
        })
        const userId = mustFindUser(testDb.db, 'seeded@example.com').id

        expect(
          await verifyService.decide(verifyInputFor(cookie, 'swole.lilnas.io')),
        ).toEqual({ outcome: 'allow', email: 'seeded@example.com', userId })
        expect(
          await verifyService.decide(verifyInputFor(cookie, 'yacht.lilnas.io')),
        ).toEqual({ outcome: 'allow', email: 'seeded@example.com', userId })
      } finally {
        testDb.close()
      }
    })

    it("an unseeded signed-in user lands on the pending page, and requestAccess() (the pending page's own automatic call) queues the request", async () => {
      const testDb = createTestDb()
      try {
        seedWhitelist(testDb.db, ['seeded@example.com'], ['swole.lilnas.io'])
        const { auth, requestsService, verifyService } = createHarness(testDb)

        const cookie = await signIn(auth, {
          sub: 'google-sub-unseeded',
          email: 'unseeded@example.com',
        })

        const decision = await verifyService.decide(
          verifyInputFor(cookie, 'swole.lilnas.io'),
        )

        expect(decision.outcome).toBe('redirect')
        expect(
          (decision as { outcome: 'redirect'; location: string }).location,
        ).toContain('/pending')

        // VerifyService.decide() deliberately never writes an access_request
        // row itself (see that file's own header comment) — U6's
        // RequestsService owns the write, triggered by the pending page's
        // own load, which this simulates directly.
        const userRow = mustFindUser(testDb.db, 'unseeded@example.com')
        requestsService.requestAccess(userRow.id, 'swole.lilnas.io')

        const requests = testDb.db.select().from(schema.accessRequest).all()
        expect(requests).toHaveLength(1)
        expect(requests[0]?.status).toBe('pending')
        expect(requests[0]?.serviceHost).toBe('swole.lilnas.io')
      } finally {
        testDb.close()
      }
    })
  })
})
