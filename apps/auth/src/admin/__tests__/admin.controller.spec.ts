import { BadRequestException } from '@nestjs/common'
import BetterSqlite3 from 'better-sqlite3'
import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { PinoLogger } from 'nestjs-pino'

import { AdminController } from 'src/admin/admin.controller'
import { UsersService } from 'src/admin/users.service'
import { applyPragmas, type Db, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { RequestsService } from 'src/requests/requests.service'
import type {
  ServiceRegistryEntry,
  ServiceRegistryService,
} from 'src/services/service-registry.service'
import { NotifyBusService } from 'src/sse/notify-bus.service'
import type { AccessCacheService } from 'src/verify/access-cache.service'

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
}

// UsersService's own S2b session-revocation audit trail is not this suite's
// concern (this file only proves AdminController's own route wiring — see
// its header comment) — a bare stand-in is enough to satisfy the
// constructor.
function fakeLogger(): PinoLogger {
  return { warn: jest.fn() } as unknown as PinoLogger
}

// Same stand-in pattern as requests.service.spec.ts/sse.controller.spec.ts —
// AdminController's own routes never call any of these (they only exist so
// RequestsService's constructor is satisfiable), which is itself part of
// what this suite proves for the queue() route below.
function fakeAccessCache(): AccessCacheService {
  return {
    addGrant: jest.fn(),
    removeGrant: jest.fn(),
    isBlocked: jest.fn().mockReturnValue(false),
    hasGrant: jest.fn().mockReturnValue(false),
    resolveSession: jest.fn(),
    invalidateSessionsForUser: jest.fn(),
  } as unknown as AccessCacheService
}

// U8: AdminController.services() is a one-line delegation — the actual
// scanning/correlation logic is service-registry.service.spec.ts's own
// concern (real fixture directories, no mocking). This stub only proves
// the route wiring: that the controller calls getServices() and returns
// whatever it resolves to, unmodified.
function fakeServiceRegistry(
  entries: ServiceRegistryEntry[] = [],
): ServiceRegistryService {
  return {
    getServices: jest.fn().mockResolvedValue(entries),
  } as unknown as ServiceRegistryService
}

let uidCounter = 0
function seedUser(db: Db, email?: string): string {
  const id = `user_${uidCounter++}`
  const now = new Date()
  db.insert(schema.user)
    .values({
      id,
      name: 'Test User',
      email: email ?? `${id}@example.com`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return id
}

let sessionCounter = 0
function seedSession(db: Db, userId: string): void {
  const id = `session_${sessionCounter++}`
  const now = new Date()
  db.insert(schema.session)
    .values({
      id,
      userId,
      token: `token_${id}`,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

function seedPendingRow(db: Db, userId: string, serviceHost: string): number {
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
  // Ordered by id desc (mirrors requests.repo.ts's findLatestRequest) since a
  // caller may seed prior rows for the same (userId, serviceHost) pair
  // first — an unordered .get() would otherwise nondeterministically return
  // any matching row, not the one just inserted.
  const row = db
    .select()
    .from(schema.accessRequest)
    .where(
      and(
        eq(schema.accessRequest.userId, userId),
        eq(schema.accessRequest.serviceHost, serviceHost),
      ),
    )
    .orderBy(desc(schema.accessRequest.id))
    .limit(1)
    .get()
  if (!row) throw new Error('expected the row just inserted')
  return row.id
}

function seedRejectedRow(
  db: Db,
  userId: string,
  serviceHost: string,
  decidedAt: Date,
): void {
  db.insert(schema.accessRequest)
    .values({
      userId,
      serviceHost,
      status: 'rejected',
      createdAt: decidedAt,
      lastSeenAt: decidedAt,
      decidedAt,
    })
    .run()
}

// AdminController itself performs no authorization check — that's
// AdminGuard's entire job (@UseGuards(AdminGuard), tested exhaustively in
// admin.guard.spec.ts, including the 401-vs-403 split). Re-asserting guard
// behavior here would either be redundant (Nest applies @UseGuards at the
// routing layer, invisible to a directly-constructed controller instance)
// or require bootstrapping a full HTTP-level Nest TestingModule purely to
// prove something already proven — see this app's established convention
// (sse.controller.spec.ts, requests.service.spec.ts) of testing a
// controller/service's OWN logic via direct construction. What this suite
// covers is AdminController's own logic: the queue shape and the
// approve/reject/bulk-reject route wiring.
describe('AdminController', () => {
  let testDb: ReturnType<typeof createTestDb>
  let requestsService: RequestsService
  let controller: AdminController

  beforeEach(() => {
    testDb = createTestDb()
    requestsService = new RequestsService(
      testDb.db,
      fakeAccessCache(),
      new NotifyBusService(),
    )
    controller = new AdminController(
      testDb.db,
      requestsService,
      fakeServiceRegistry(),
      new UsersService(
        testDb.db,
        fakeAccessCache(),
        new NotifyBusService(),
        fakeLogger(),
      ),
    )
  })

  afterEach(() => {
    testDb.close()
  })

  describe('queue (R10, R12)', () => {
    it('lists only pending requests, joined with the requester email', () => {
      const userId = seedUser(testDb.db, 'alice@example.com')
      seedPendingRow(testDb.db, userId, 'swole.lilnas.io')

      const otherId = seedUser(testDb.db, 'bob@example.com')
      const decidedId = seedPendingRow(testDb.db, otherId, 'other.lilnas.io')
      requestsService.approveRequest(decidedId)

      const queue = controller.queue()

      expect(queue).toHaveLength(1)
      expect(queue[0]).toMatchObject({
        userId,
        email: 'alice@example.com',
        serviceHost: 'swole.lilnas.io',
        priorDecisions: 0,
      })
    })

    it('covers R12: reports the count of prior DECIDED rows for the same (userId, serviceHost) pair', () => {
      const userId = seedUser(testDb.db)
      seedRejectedRow(
        testDb.db,
        userId,
        'swole.lilnas.io',
        new Date(Date.now() - 48 * 60 * 60 * 1000),
      )
      seedRejectedRow(
        testDb.db,
        userId,
        'swole.lilnas.io',
        new Date(Date.now() - 30 * 60 * 60 * 1000),
      )
      const pendingId = seedPendingRow(testDb.db, userId, 'swole.lilnas.io')

      const queue = controller.queue()

      expect(queue).toHaveLength(1)
      expect(queue[0]).toMatchObject({ id: pendingId, priorDecisions: 2 })
    })

    it('returns dates as ISO strings', () => {
      const userId = seedUser(testDb.db)
      seedPendingRow(testDb.db, userId, 'swole.lilnas.io')

      const [entry] = controller.queue()

      expect(entry?.createdAt).toBe(
        new Date(entry?.createdAt ?? '').toISOString(),
      )
      expect(entry?.lastSeenAt).toBe(
        new Date(entry?.lastSeenAt ?? '').toISOString(),
      )
    })

    it('covers AE5: with the grant table completely empty, the queue still loads (queue() never reads the grants table)', () => {
      const userId = seedUser(testDb.db)
      seedPendingRow(testDb.db, userId, 'swole.lilnas.io')
      expect(testDb.db.select().from(schema.grant).all()).toHaveLength(0)

      expect(() => controller.queue()).not.toThrow()
      expect(controller.queue()).toHaveLength(1)
    })

    it('an empty queue returns an empty array, not an error', () => {
      expect(controller.queue()).toEqual([])
    })
  })

  describe('services (U8, R13)', () => {
    it('delegates to ServiceRegistryService.getServices() and returns its result unmodified', async () => {
      const entries: ServiceRegistryEntry[] = [
        { host: 'swole.lilnas.io', gatedBy: 'forward-auth' },
        { host: 'yacht.lilnas.io', gatedBy: 'lilnas-auth' },
      ]
      const registryController = new AdminController(
        testDb.db,
        requestsService,
        fakeServiceRegistry(entries),
        new UsersService(
          testDb.db,
          fakeAccessCache(),
          new NotifyBusService(),
          fakeLogger(),
        ),
      )

      await expect(registryController.services()).resolves.toEqual(entries)
    })
  })

  describe('approve / reject / bulk-reject route wiring', () => {
    it('approve() delegates to RequestsService and actually writes a grant (real DB, not a mock)', () => {
      const userId = seedUser(testDb.db)
      const id = seedPendingRow(testDb.db, userId, 'swole.lilnas.io')

      const result = controller.approve(id)

      expect(result).toEqual({ ok: true })
      const row = testDb.db
        .select()
        .from(schema.accessRequest)
        .where(eq(schema.accessRequest.id, id))
        .get()
      expect(row?.status).toBe('approved')
      const grantRow = testDb.db
        .select()
        .from(schema.grant)
        .where(
          and(
            eq(schema.grant.userId, userId),
            eq(schema.grant.serviceHost, 'swole.lilnas.io'),
          ),
        )
        .get()
      expect(grantRow).toBeDefined()
    })

    it('approve() on a nonexistent id propagates NotFoundException rather than swallowing it', () => {
      expect(() => controller.approve(999999)).toThrow()
    })

    it('reject() delegates to RequestsService and marks the row rejected without writing a grant', () => {
      const userId = seedUser(testDb.db)
      const id = seedPendingRow(testDb.db, userId, 'swole.lilnas.io')

      const result = controller.reject(id)

      expect(result).toEqual({ ok: true, decided: true })
      const row = testDb.db
        .select()
        .from(schema.accessRequest)
        .where(eq(schema.accessRequest.id, id))
        .get()
      expect(row?.status).toBe('rejected')
      expect(testDb.db.select().from(schema.grant).all()).toHaveLength(0)
    })

    // #24 (from REVIEW.md): reject() used to report `{ ok: true }`
    // regardless of whether anything actually changed, making a genuine
    // rejection indistinguishable from a no-op on an already-decided row
    // (e.g. a second admin acting on a stale queue view). `decided: false`
    // is what lets the caller (queue-client.tsx, via actions.ts) tell them
    // apart.
    it('covers #24: reject() on an already-decided row reports decided: false and leaves it unchanged', () => {
      const userId = seedUser(testDb.db)
      const id = seedPendingRow(testDb.db, userId, 'swole.lilnas.io')
      const first = controller.reject(id)
      expect(first).toEqual({ ok: true, decided: true })

      const second = controller.reject(id)

      expect(second).toEqual({ ok: true, decided: false })
      const row = testDb.db
        .select()
        .from(schema.accessRequest)
        .where(eq(schema.accessRequest.id, id))
        .get()
      expect(row?.status).toBe('rejected')
    })

    it('covers R10: bulkReject() dismisses every id in the batch in one call, leaving the queue empty', () => {
      const userId = seedUser(testDb.db)
      const idA = seedPendingRow(testDb.db, userId, 'a.lilnas.io')
      const idB = seedPendingRow(testDb.db, userId, 'b.lilnas.io')

      const result = controller.bulkReject({ ids: [idA, idB] })

      expect(result).toEqual({ ok: true, decided: [idA, idB] })
      expect(controller.queue()).toEqual([])
    })

    // #24 (from REVIEW.md): mirrors reject()'s own decided:false coverage
    // above, for the batch route — an id already decided (or nonexistent)
    // is silently skipped by RequestsService.bulkReject() itself (existing
    // behavior), but before this fix the caller had no way to tell which
    // ids from the batch that applied to.
    it('covers #24: bulkReject() reports only the ids it actually decided, omitting an already-decided one', () => {
      const userId = seedUser(testDb.db)
      const idA = seedPendingRow(testDb.db, userId, 'a.lilnas.io')
      const idB = seedPendingRow(testDb.db, userId, 'b.lilnas.io')
      controller.reject(idB)

      const result = controller.bulkReject({ ids: [idA, idB] })

      expect(result).toEqual({ ok: true, decided: [idA] })
    })
  })

  describe('revoke-sessions route wiring (S2b)', () => {
    it('revokeSessions() delegates to UsersService and actually deletes the session rows (real DB, not a mock)', () => {
      const userId = seedUser(testDb.db)
      seedSession(testDb.db, userId)
      seedSession(testDb.db, userId)

      const result = controller.revokeSessions(userId)

      expect(result).toEqual({ ok: true, sessionsRevoked: 2 })
      expect(
        testDb.db
          .select()
          .from(schema.session)
          .all()
          .filter(row => row.userId === userId),
      ).toHaveLength(0)
    })

    it('reports 0 for a user with no active sessions, rather than throwing', () => {
      const userId = seedUser(testDb.db)

      expect(controller.revokeSessions(userId)).toEqual({
        ok: true,
        sessionsRevoked: 0,
      })
    })
  })

  describe('request-body validation (S3)', () => {
    it('bulkReject() rejects an invalid body with BadRequestException and never reaches RequestsService', () => {
      expect(() => controller.bulkReject({ ids: [] })).toThrow(
        BadRequestException,
      )
      expect(() => controller.queue()).not.toThrow()
      expect(controller.queue()).toEqual([])
    })

    it('preAuthorize() rejects a malformed email with BadRequestException', async () => {
      await expect(
        controller.preAuthorize({
          email: 'not-an-email',
          serviceHosts: ['swole.lilnas.io'],
        }),
      ).rejects.toThrow(BadRequestException)
    })

    // The actual bug this closes: setUserServices() used to do
    // `if (body.grant)`, and a JSON body of {"grant": "false"} deserializes
    // to the STRING "false" — a non-empty string, so the old truthy check
    // silently granted when the caller meant to revoke. This now fails
    // validation outright instead of being misinterpreted.
    it('covers the S3 fix: setUserServices() rejects grant: "false" (a string) rather than treating it as truthy', async () => {
      const userId = seedUser(testDb.db)

      await expect(
        controller.setUserServices(userId, {
          changes: [{ serviceHost: 'swole.lilnas.io', grant: 'false' }],
        }),
      ).rejects.toThrow(BadRequestException)

      // Confirms the old bug's actual consequence never happens: no grant
      // was written for the mis-typed "revoke" request.
      expect(
        testDb.db
          .select()
          .from(schema.grant)
          .where(eq(schema.grant.userId, userId))
          .all(),
      ).toHaveLength(0)
    })

    it('setUserServices() still accepts a real boolean grant and writes the grant', async () => {
      const registryController = new AdminController(
        testDb.db,
        requestsService,
        fakeServiceRegistry([
          { host: 'swole.lilnas.io', gatedBy: 'lilnas-auth' },
        ]),
        new UsersService(
          testDb.db,
          fakeAccessCache(),
          new NotifyBusService(),
          fakeLogger(),
        ),
      )
      const userId = seedUser(testDb.db)

      await expect(
        registryController.setUserServices(userId, {
          changes: [{ serviceHost: 'swole.lilnas.io', grant: true }],
        }),
      ).resolves.toEqual({ ok: true })
      expect(
        testDb.db
          .select()
          .from(schema.grant)
          .where(eq(schema.grant.userId, userId))
          .all(),
      ).toHaveLength(1)
    })

    // M3: the whole point of the batched shape — one call carries every
    // change the admin made, not one call per checkbox.
    it('setUserServices() with multiple changes writes every one of them in a single call', async () => {
      const registryController = new AdminController(
        testDb.db,
        requestsService,
        fakeServiceRegistry([
          { host: 'swole.lilnas.io', gatedBy: 'lilnas-auth' },
          { host: 'tdr.lilnas.io', gatedBy: 'lilnas-auth' },
        ]),
        new UsersService(
          testDb.db,
          fakeAccessCache(),
          new NotifyBusService(),
          fakeLogger(),
        ),
      )
      const userId = seedUser(testDb.db)

      await expect(
        registryController.setUserServices(userId, {
          changes: [
            { serviceHost: 'swole.lilnas.io', grant: true },
            { serviceHost: 'tdr.lilnas.io', grant: true },
          ],
        }),
      ).resolves.toEqual({ ok: true })
      expect(
        testDb.db
          .select()
          .from(schema.grant)
          .where(eq(schema.grant.userId, userId))
          .all(),
      ).toHaveLength(2)
    })

    // M3: registry validation runs on EVERY grant:true entry before any of
    // them are written — an unknown host anywhere in the batch fails the
    // whole request, even alongside an otherwise-valid, known host, rather
    // than partially applying the known ones first.
    it('setUserServices() rejects the whole batch if any grant:true entry names an unknown host, writing nothing — not even the known one', async () => {
      const registryController = new AdminController(
        testDb.db,
        requestsService,
        fakeServiceRegistry([
          { host: 'swole.lilnas.io', gatedBy: 'lilnas-auth' },
        ]),
        new UsersService(
          testDb.db,
          fakeAccessCache(),
          new NotifyBusService(),
          fakeLogger(),
        ),
      )
      const userId = seedUser(testDb.db)

      await expect(
        registryController.setUserServices(userId, {
          changes: [
            { serviceHost: 'swole.lilnas.io', grant: true },
            { serviceHost: 'not-a-real-service.lilnas.io', grant: true },
          ],
        }),
      ).rejects.toThrow(/not a known service/)
      expect(
        testDb.db
          .select()
          .from(schema.grant)
          .where(eq(schema.grant.userId, userId))
          .all(),
      ).toHaveLength(0)
    })
  })
})
