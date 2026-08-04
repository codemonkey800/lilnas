import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { Request } from 'express'

import { applyPragmas, type Db, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { MeController } from 'src/me/me.controller'
import type { AccessCacheService } from 'src/verify/access-cache.service'

process.env.ADMIN_EMAILS = 'admin@example.com'

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
}

function fakeAccessCache(
  session: { userId: string; email: string } | null,
): AccessCacheService {
  return {
    resolveSession: jest.fn().mockResolvedValue(session),
  } as unknown as AccessCacheService
}

function fakeRequest(cookie?: string): Request {
  return { headers: { cookie } } as unknown as Request
}

let uidCounter = 0
function seedUser(
  db: Db,
  overrides: { email?: string; blockedAt?: Date | null } = {},
): { id: string; createdAt: Date } {
  const id = `user_${uidCounter++}`
  const now = new Date()
  db.insert(schema.user)
    .values({
      id,
      name: 'Test User',
      email: overrides.email ?? `${id}@example.com`,
      emailVerified: false,
      blockedAt: overrides.blockedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return { id, createdAt: now }
}

function seedGrant(db: Db, userId: string, serviceHost: string): void {
  db.insert(schema.grant)
    .values({ userId, serviceHost, createdAt: new Date() })
    .run()
}

function seedPendingRequest(db: Db, userId: string, serviceHost: string): Date {
  const now = new Date()
  db.insert(schema.accessRequest)
    .values({
      userId,
      serviceHost,
      status: 'pending',
      createdAt: now,
      lastSeenAt: now,
    })
    .run()
  return now
}

// The self-service /me endpoint's own suite — mirrors
// admin.controller.spec.ts's own "real DB, direct construction, no HTTP
// layer" convention (a guard, if any, is Nest routing-layer wiring invisible
// to a directly-constructed controller instance, so testing it here would
// either be redundant or require a full TestingModule for no benefit). This
// controller has no guard at all — only resolveSession()'s own 401 branch —
// so that convention applies just as directly.
describe('MeController', () => {
  let testDb: ReturnType<typeof createTestDb>

  afterEach(() => {
    testDb.close()
  })

  it('throws Unauthorized when there is no session', async () => {
    testDb = createTestDb()
    const controller = new MeController(testDb.db, fakeAccessCache(null))

    await expect(controller.me(fakeRequest(undefined))).rejects.toThrow()
  })

  it('returns the full profile shape for a signed-in user with no grants or pending requests', async () => {
    testDb = createTestDb()
    const { id, createdAt } = seedUser(testDb.db, {
      email: 'member@example.com',
    })
    const controller = new MeController(
      testDb.db,
      fakeAccessCache({ userId: id, email: 'member@example.com' }),
    )

    const result = await controller.me(fakeRequest('cookie=x'))

    expect(result).toEqual({
      name: 'Test User',
      email: 'member@example.com',
      image: null,
      isAdmin: false,
      blockedAt: null,
      createdAt: createdAt.toISOString(),
      grants: [],
      pendingRequests: [],
    })
  })

  it('reports isAdmin: true for an ADMIN_EMAILS address, and false for anyone else', async () => {
    testDb = createTestDb()
    const admin = seedUser(testDb.db, { email: 'admin@example.com' })
    const member = seedUser(testDb.db, { email: 'someone-else@example.com' })

    const adminController = new MeController(
      testDb.db,
      fakeAccessCache({ userId: admin.id, email: 'admin@example.com' }),
    )
    const memberController = new MeController(
      testDb.db,
      fakeAccessCache({ userId: member.id, email: 'someone-else@example.com' }),
    )

    await expect(
      adminController.me(fakeRequest('cookie=x')),
    ).resolves.toMatchObject({ isAdmin: true })
    await expect(
      memberController.me(fakeRequest('cookie=x')),
    ).resolves.toMatchObject({ isAdmin: false })
  })

  it('reports blockedAt as an ISO string once set', async () => {
    testDb = createTestDb()
    const blockedAt = new Date('2026-01-01T00:00:00.000Z')
    const { id } = seedUser(testDb.db, { blockedAt })
    const controller = new MeController(
      testDb.db,
      fakeAccessCache({ userId: id, email: 'blocked@example.com' }),
    )

    const result = await controller.me(fakeRequest('cookie=x'))

    expect(result.blockedAt).toBe(blockedAt.toISOString())
  })

  it('populates grants from every current grant this user holds', async () => {
    testDb = createTestDb()
    const { id } = seedUser(testDb.db)
    seedGrant(testDb.db, id, 'swole.lilnas.io')
    seedGrant(testDb.db, id, 'files.lilnas.io')
    const controller = new MeController(
      testDb.db,
      fakeAccessCache({ userId: id, email: 'member@example.com' }),
    )

    const result = await controller.me(fakeRequest('cookie=x'))

    expect(result.grants.sort()).toEqual(['files.lilnas.io', 'swole.lilnas.io'])
  })

  it('populates pendingRequests from every currently-pending request this user has, excluding decided ones', async () => {
    testDb = createTestDb()
    const { id } = seedUser(testDb.db)
    const requestedAt = seedPendingRequest(testDb.db, id, 'swole.lilnas.io')
    const controller = new MeController(
      testDb.db,
      fakeAccessCache({ userId: id, email: 'member@example.com' }),
    )

    const result = await controller.me(fakeRequest('cookie=x'))

    expect(result.pendingRequests).toEqual([
      { serviceHost: 'swole.lilnas.io', createdAt: requestedAt.toISOString() },
    ])
  })

  it('does not include another user in this response — grants and requests are scoped by userId', async () => {
    testDb = createTestDb()
    const { id } = seedUser(testDb.db, { email: 'self@example.com' })
    const other = seedUser(testDb.db, { email: 'other@example.com' })
    seedGrant(testDb.db, other.id, 'swole.lilnas.io')
    seedPendingRequest(testDb.db, other.id, 'files.lilnas.io')
    const controller = new MeController(
      testDb.db,
      fakeAccessCache({ userId: id, email: 'self@example.com' }),
    )

    const result = await controller.me(fakeRequest('cookie=x'))

    expect(result.grants).toEqual([])
    expect(result.pendingRequests).toEqual([])
  })
})
