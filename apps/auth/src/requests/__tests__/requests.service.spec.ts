import BetterSqlite3 from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { applyPragmas, type Db, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import * as requestsRepo from 'src/requests/requests.repo'
import { RequestsService } from 'src/requests/requests.service'
import { ADMIN_TOPIC, NotifyBusService } from 'src/sse/notify-bus.service'
import type { AccessCacheService } from 'src/verify/access-cache.service'

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
}

// A stand-in, not the real DI-wired AccessCacheService (which itself needs a
// real better-auth AuthService + PinoLogger this file has no reason to
// construct) — this suite only needs to observe that addGrant() was called
// with the right pair, the same "fake the collaborator, drive the real
// service under test" pattern src/sse/__tests__/sse.controller.spec.ts's
// own fakeAccessCache() already established.
function fakeAccessCache(): AccessCacheService & {
  addGrant: jest.Mock
  removeGrant: jest.Mock
} {
  return {
    addGrant: jest.fn(),
    removeGrant: jest.fn(),
    isBlocked: jest.fn().mockReturnValue(false),
    hasGrant: jest.fn().mockReturnValue(false),
    resolveSession: jest.fn(),
  } as unknown as AccessCacheService & {
    addGrant: jest.Mock
    removeGrant: jest.Mock
  }
}

let uidCounter = 0
function seedUser(db: Db): string {
  const id = `user_${uidCounter++}`
  const now = new Date()
  db.insert(schema.user)
    .values({
      id,
      name: 'Test User',
      email: `${id}@example.com`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return id
}

function countRequestsFor(db: Db, userId: string, serviceHost: string) {
  return db
    .select()
    .from(schema.accessRequest)
    .where(
      and(
        eq(schema.accessRequest.userId, userId),
        eq(schema.accessRequest.serviceHost, serviceHost),
      ),
    )
    .all()
}

function seedRejectedRow(
  db: Db,
  userId: string,
  serviceHost: string,
  decidedAt: Date,
) {
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

describe('RequestsService.requestAccess (the automatic, on-load/reconnect path)', () => {
  let testDb: ReturnType<typeof createTestDb>
  let notifyBus: NotifyBusService
  let service: RequestsService

  beforeEach(() => {
    testDb = createTestDb()
    notifyBus = new NotifyBusService()
    service = new RequestsService(testDb.db, fakeAccessCache(), notifyBus)
  })

  afterEach(() => {
    testDb.close()
  })

  it('covers R5: a first-ever request creates exactly one pending row', () => {
    const userId = seedUser(testDb.db)

    const result = service.requestAccess(userId, 'swole.lilnas.io')

    expect(result).toEqual({ outcome: 'pending' })
    const rows = countRequestsFor(testDb.db, userId, 'swole.lilnas.io')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('pending')
  })

  it('a genuinely new row publishes on the admin-broadcast topic', () => {
    const userId = seedUser(testDb.db)
    const publishedTopics: string[] = []
    notifyBus.stream$.subscribe(signal => publishedTopics.push(signal.topic))

    service.requestAccess(userId, 'swole.lilnas.io')

    expect(publishedTopics).toEqual([ADMIN_TOPIC])
  })

  it('an absorbed (touch-lastSeen) repeat visit does NOT publish — nothing new for the dashboard to show', () => {
    const userId = seedUser(testDb.db)
    service.requestAccess(userId, 'swole.lilnas.io')
    const publishedTopics: string[] = []
    notifyBus.stream$.subscribe(signal => publishedTopics.push(signal.topic))

    service.requestAccess(userId, 'swole.lilnas.io')

    expect(publishedTopics).toEqual([])
  })

  it('discovering an already-decided rejection does NOT publish — no new row is created', () => {
    const userId = seedUser(testDb.db)
    seedRejectedRow(testDb.db, userId, 'swole.lilnas.io', new Date())
    const publishedTopics: string[] = []
    notifyBus.stream$.subscribe(signal => publishedTopics.push(signal.topic))

    const result = service.requestAccess(userId, 'swole.lilnas.io')

    expect(result).toEqual({ outcome: 'rejected' })
    expect(publishedTopics).toEqual([])
  })

  it('covers R6/AE1: a second call on an existing pending row bumps lastSeenAt and leaves exactly one row', () => {
    const userId = seedUser(testDb.db)
    const first = service.requestAccess(userId, 'swole.lilnas.io')
    const firstRows = countRequestsFor(testDb.db, userId, 'swole.lilnas.io')
    const firstLastSeen = firstRows[0]?.lastSeenAt.getTime()

    // Force a real clock difference so a bumped lastSeenAt is observable.
    const laterDecided = new Date((firstLastSeen ?? 0) + 5000)
    jest.useFakeTimers().setSystemTime(laterDecided)
    try {
      const second = service.requestAccess(userId, 'swole.lilnas.io')

      expect(second).toEqual({ outcome: 'pending' })
      const rows = countRequestsFor(testDb.db, userId, 'swole.lilnas.io')
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('pending')
      expect(rows[0]?.lastSeenAt.getTime()).toBe(laterDecided.getTime())
      expect(rows[0]?.createdAt.getTime()).toBe(
        firstRows[0]?.createdAt.getTime(),
      )
    } finally {
      jest.useRealTimers()
    }
    expect(first).toEqual({ outcome: 'pending' })
  })

  it('a rejected row (zero elapsed time since decision — there is no cooldown) reports outcome: rejected and creates no new row', () => {
    const userId = seedUser(testDb.db)
    seedRejectedRow(testDb.db, userId, 'swole.lilnas.io', new Date())

    const result = service.requestAccess(userId, 'swole.lilnas.io')

    expect(result).toEqual({ outcome: 'rejected' })
    const rows = countRequestsFor(testDb.db, userId, 'swole.lilnas.io')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('rejected')
  })

  it('an approved row (defensive case — should not be reachable via /verify in practice) does not crash and creates no new row', () => {
    const userId = seedUser(testDb.db)
    const now = new Date()
    testDb.db
      .insert(schema.accessRequest)
      .values({
        userId,
        serviceHost: 'swole.lilnas.io',
        status: 'approved',
        createdAt: now,
        lastSeenAt: now,
        decidedAt: now,
      })
      .run()

    const result = service.requestAccess(userId, 'swole.lilnas.io')

    expect(result).toEqual({ outcome: 'pending' })
    expect(countRequestsFor(testDb.db, userId, 'swole.lilnas.io')).toHaveLength(
      1,
    )
  })

  it('two different users requesting the same host do not collide', () => {
    const userA = seedUser(testDb.db)
    const userB = seedUser(testDb.db)

    service.requestAccess(userA, 'swole.lilnas.io')
    service.requestAccess(userB, 'swole.lilnas.io')

    expect(countRequestsFor(testDb.db, userA, 'swole.lilnas.io')).toHaveLength(
      1,
    )
    expect(countRequestsFor(testDb.db, userB, 'swole.lilnas.io')).toHaveLength(
      1,
    )
  })

  // Atomicity (BEGIN IMMEDIATE), per
  // docs/archive/solutions/conventions/atomicity-tests-must-reach-the-write-phase-2026-06-03.md:
  // this reaches the write phase twice (not a vacuous guard-refusal test)
  // and proves the SECOND call observes the FIRST's committed row rather
  // than attempting a duplicate insert. Note on what this test can and
  // cannot prove, honestly: better-sqlite3 is synchronous and this service
  // holds exactly ONE connection (shared via NestJS DI in production), and
  // neither requestAccess() method has an await anywhere between its read
  // and its write — so two calls on THIS shared connection can never
  // literally interleave at the SQL level regardless of BEGIN IMMEDIATE vs
  // DEFERRED; Node's single-threaded event loop already serializes them.
  // What BEGIN IMMEDIATE actually buys here is defense-in-depth against a
  // future architecture change (a connection pool, worker threads, a
  // different driver) reintroducing genuine interleaving — see that
  // convention doc's own "Forward driver portability" rationale. This test
  // proves the property that DOES matter today: sequential calls for a
  // brand-new pair never produce two rows, i.e. the read-then-branch logic
  // is correct, not merely "usually correct because nothing raced it."
  it('sequential requestAccess() calls for a brand-new pair produce exactly one row (the write phase is reached both times)', () => {
    const userId = seedUser(testDb.db)

    const insertSpy = jest.spyOn(requestsRepo, 'insertPendingRequest')
    try {
      const first = service.requestAccess(userId, 'swole.lilnas.io')
      const second = service.requestAccess(userId, 'swole.lilnas.io')

      expect(first).toEqual({ outcome: 'pending' })
      expect(second).toEqual({ outcome: 'pending' })
      // Proves the SECOND call reached its own write phase (touchLastSeen)
      // rather than short-circuiting on a guard — insertPendingRequest was
      // called exactly once, for the first call only.
      expect(insertSpy).toHaveBeenCalledTimes(1)
      expect(
        countRequestsFor(testDb.db, userId, 'swole.lilnas.io'),
      ).toHaveLength(1)
    } finally {
      insertSpy.mockRestore()
    }
  })
})

describe('RequestsService.reRequestAccess (the explicit, user-initiated path)', () => {
  let testDb: ReturnType<typeof createTestDb>
  let notifyBus: NotifyBusService
  let service: RequestsService

  beforeEach(() => {
    testDb = createTestDb()
    notifyBus = new NotifyBusService()
    service = new RequestsService(testDb.db, fakeAccessCache(), notifyBus)
  })

  afterEach(() => {
    testDb.close()
  })

  it('covers R12: a rejected row creates a FRESH row immediately (no cooldown) while the prior rejected row remains as history', () => {
    const userId = seedUser(testDb.db)
    seedRejectedRow(testDb.db, userId, 'swole.lilnas.io', new Date())

    service.reRequestAccess(userId, 'swole.lilnas.io')

    const rows = countRequestsFor(testDb.db, userId, 'swole.lilnas.io')
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.status).sort()).toEqual(['pending', 'rejected'])
  })

  it('covers R12: the fresh row it creates publishes on the admin-broadcast topic', () => {
    const userId = seedUser(testDb.db)
    seedRejectedRow(testDb.db, userId, 'swole.lilnas.io', new Date())
    const publishedTopics: string[] = []
    notifyBus.stream$.subscribe(signal => publishedTopics.push(signal.topic))

    service.reRequestAccess(userId, 'swole.lilnas.io')

    expect(publishedTopics).toEqual([ADMIN_TOPIC])
  })

  it('the SECOND of two consecutive calls (touch-lastSeen, no new row) does NOT publish again', () => {
    const userId = seedUser(testDb.db)
    seedRejectedRow(testDb.db, userId, 'swole.lilnas.io', new Date())
    service.reRequestAccess(userId, 'swole.lilnas.io')
    const publishedTopics: string[] = []
    notifyBus.stream$.subscribe(signal => publishedTopics.push(signal.topic))

    service.reRequestAccess(userId, 'swole.lilnas.io')

    expect(publishedTopics).toEqual([])
  })

  // The successor to a since-removed cooldown-window test: with no
  // time-based gate left, the only thing standing between this call and a
  // self-service spam vector is the duplicate-row guard below. Two calls
  // with no intervening admin decision must still produce only one fresh
  // pending row — growth stays bounded by admin cadence (an admin has to
  // reject the fresh row again before a THIRD one can be minted), not by
  // how fast the user clicks.
  it('two consecutive reRequestAccess() calls with no intervening admin decision produce only one fresh row', () => {
    const userId = seedUser(testDb.db)
    seedRejectedRow(testDb.db, userId, 'swole.lilnas.io', new Date())

    service.reRequestAccess(userId, 'swole.lilnas.io')
    service.reRequestAccess(userId, 'swole.lilnas.io')

    const rows = countRequestsFor(testDb.db, userId, 'swole.lilnas.io')
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.status).sort()).toEqual(['pending', 'rejected'])
  })

  it('no prior row at all: creates a fresh pending row (same as requestAccess would)', () => {
    const userId = seedUser(testDb.db)

    service.reRequestAccess(userId, 'swole.lilnas.io')

    const rows = countRequestsFor(testDb.db, userId, 'swole.lilnas.io')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('pending')
  })

  it('an already-pending row (lost race with the automatic absorb path) is touched, not duplicated', () => {
    const userId = seedUser(testDb.db)
    service.requestAccess(userId, 'swole.lilnas.io')

    service.reRequestAccess(userId, 'swole.lilnas.io')

    expect(countRequestsFor(testDb.db, userId, 'swole.lilnas.io')).toHaveLength(
      1,
    )
  })
})

describe('RequestsService.approveRequest / rejectRequest / bulkReject (U7)', () => {
  let testDb: ReturnType<typeof createTestDb>
  let accessCache: ReturnType<typeof fakeAccessCache>
  let notifyBus: NotifyBusService
  let service: RequestsService

  beforeEach(() => {
    testDb = createTestDb()
    accessCache = fakeAccessCache()
    notifyBus = new NotifyBusService()
    service = new RequestsService(testDb.db, accessCache, notifyBus)
  })

  afterEach(() => {
    testDb.close()
  })

  function seedPendingRow(userId: string, serviceHost: string): number {
    const now = new Date()
    testDb.db
      .insert(schema.accessRequest)
      .values({
        userId,
        serviceHost,
        status: 'pending',
        createdAt: now,
        lastSeenAt: now,
      })
      .run()
    const row = testDb.db
      .select()
      .from(schema.accessRequest)
      .where(
        and(
          eq(schema.accessRequest.userId, userId),
          eq(schema.accessRequest.serviceHost, serviceHost),
        ),
      )
      .get()
    if (!row) throw new Error('expected the row just inserted')
    return row.id
  }

  function rowById(id: number) {
    const row = testDb.db
      .select()
      .from(schema.accessRequest)
      .where(eq(schema.accessRequest.id, id))
      .get()
    if (!row) throw new Error(`expected a row for id ${id}`)
    return row
  }

  it('approve writes a grant, marks the row approved, invalidates the cache, and publishes on both the per-user AND the admin-broadcast topic', () => {
    const userId = seedUser(testDb.db)
    const id = seedPendingRow(userId, 'swole.lilnas.io')
    const publishedTopics: string[] = []
    notifyBus.stream$.subscribe(signal => publishedTopics.push(signal.topic))

    service.approveRequest(id)

    const row = rowById(id)
    expect(row.status).toBe('approved')
    expect(row.decidedAt).not.toBeNull()

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

    expect(accessCache.addGrant).toHaveBeenCalledWith(userId, 'swole.lilnas.io')
    // Two publishes now, not one — the pre-existing per-user topic
    // (unchanged) PLUS the admin dashboard's own broadcast topic (see
    // this file's own header comment on the admin-dashboard-live-updates
    // addition). Order matters: the per-user signal fires first, matching
    // approveRequest()'s own publishStatusChange()-then-publishAdminChange()
    // call order.
    expect(publishedTopics).toEqual([`${userId}:swole.lilnas.io`, ADMIN_TOPIC])
  })

  // Flipped from this suite's original "reject writes the decision and
  // publishes nothing (R7)" assertion — rejection is now a visible, live
  // outcome (see requests.service.ts's own header comment on this
  // post-launch revision). This is the single most important test change
  // in this file: the ASSERTION'S MEANING INVERTED, not just its wording —
  // a naive diff-skim comparing old vs. new test names alone could miss
  // that "publishes nothing" became "publishes the signal".
  it('reject writes the decision and publishes on both the per-user AND the admin-broadcast topic (rejection is now visible, live)', () => {
    const userId = seedUser(testDb.db)
    const id = seedPendingRow(userId, 'swole.lilnas.io')
    const publishedTopics: string[] = []
    notifyBus.stream$.subscribe(signal => publishedTopics.push(signal.topic))

    service.rejectRequest(id)

    const row = rowById(id)
    expect(row.status).toBe('rejected')
    expect(row.decidedAt).not.toBeNull()
    expect(accessCache.addGrant).not.toHaveBeenCalled()
    expect(publishedTopics).toEqual([`${userId}:swole.lilnas.io`, ADMIN_TOPIC])
  })

  it('reject on an already-decided row is a no-op and publishes nothing', () => {
    const userId = seedUser(testDb.db)
    const id = seedPendingRow(userId, 'swole.lilnas.io')
    service.approveRequest(id)
    const publishedTopics: string[] = []
    notifyBus.stream$.subscribe(signal => publishedTopics.push(signal.topic))

    const decided = service.rejectRequest(id)

    expect(decided).toBe(false)
    expect(publishedTopics).toEqual([])
  })

  it('approve is idempotent: approving an already-approved row does not throw and does not duplicate the grant', () => {
    const userId = seedUser(testDb.db)
    const id = seedPendingRow(userId, 'swole.lilnas.io')

    service.approveRequest(id)
    expect(() => service.approveRequest(id)).not.toThrow()

    const grantRows = testDb.db
      .select()
      .from(schema.grant)
      .where(
        and(
          eq(schema.grant.userId, userId),
          eq(schema.grant.serviceHost, 'swole.lilnas.io'),
        ),
      )
      .all()
    expect(grantRows).toHaveLength(1)
  })

  it('reject is a no-op on an already-decided row (approved or rejected), never an error', () => {
    const userId = seedUser(testDb.db)
    const id = seedPendingRow(userId, 'swole.lilnas.io')
    service.approveRequest(id)

    expect(() => service.rejectRequest(id)).not.toThrow()
    // The approval stands — reject never overturns an already-approved row.
    expect(rowById(id).status).toBe('approved')
  })

  it('approving a nonexistent id throws NotFoundException rather than silently no-opping', () => {
    expect(() => service.approveRequest(999999)).toThrow()
  })

  it('bulk-reject decides every pending id in the batch and skips ones that are missing or already decided', () => {
    const userId = seedUser(testDb.db)
    const idA = seedPendingRow(userId, 'a.lilnas.io')
    const idB = seedPendingRow(userId, 'b.lilnas.io')
    const idC = seedPendingRow(userId, 'c.lilnas.io')
    service.approveRequest(idC) // already decided — bulk-reject must skip it

    service.bulkReject([idA, idB, idC, 999999])

    expect(rowById(idA).status).toBe('rejected')
    expect(rowById(idB).status).toBe('rejected')
    expect(rowById(idC).status).toBe('approved')
  })

  it('bulk-reject publishes the status-changed signal once per actually-decided row, plus the admin-broadcast topic ONCE for the whole batch, skipping no-ops', () => {
    const userId = seedUser(testDb.db)
    const idA = seedPendingRow(userId, 'a.lilnas.io')
    const idB = seedPendingRow(userId, 'b.lilnas.io')
    const idC = seedPendingRow(userId, 'c.lilnas.io')
    service.approveRequest(idC) // already decided — must not publish for it
    const publishedTopics: string[] = []
    notifyBus.stream$.subscribe(signal => publishedTopics.push(signal.topic))

    const decided = service.bulkReject([idA, idB, idC, 999999])

    expect(decided.slice().sort()).toEqual([idA, idB].sort())
    // ADMIN_TOPIC appears exactly ONCE despite two rows being decided — see
    // bulkReject()'s own comment on why the admin broadcast is a single
    // per-batch publish, unlike the per-row publishStatusChange() calls.
    expect(publishedTopics.filter(topic => topic === ADMIN_TOPIC)).toHaveLength(
      1,
    )
    expect(
      publishedTopics.filter(topic => topic !== ADMIN_TOPIC).sort(),
    ).toEqual([`${userId}:a.lilnas.io`, `${userId}:b.lilnas.io`].sort())
  })

  it('bulk-reject with nothing actually decided (every id already decided or missing) publishes neither topic', () => {
    const userId = seedUser(testDb.db)
    const idA = seedPendingRow(userId, 'a.lilnas.io')
    service.approveRequest(idA)
    const publishedTopics: string[] = []
    notifyBus.stream$.subscribe(signal => publishedTopics.push(signal.topic))

    const decided = service.bulkReject([idA, 999999])

    expect(decided).toEqual([])
    expect(publishedTopics).toEqual([])
  })

  it('R12: prior decisions for a pair are visible via countPriorDecisions after a reject followed by a fresh request', () => {
    const userId = seedUser(testDb.db)
    const id = seedPendingRow(userId, 'swole.lilnas.io')
    service.rejectRequest(id)

    expect(
      requestsRepo.countPriorDecisions(testDb.db, userId, 'swole.lilnas.io'),
    ).toBe(1)
  })
})
