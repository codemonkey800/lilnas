import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { PinoLogger } from 'nestjs-pino'

import { applyPragmas, type Db, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { HostActivityService } from 'src/services/host-activity.service'

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

function seedUser(db: Db, id: string): void {
  const now = new Date()
  db.insert(schema.user)
    .values({
      id,
      name: `Name ${id}`,
      email: `${id}@example.com`,
      emailVerified: false,
      blockedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

function readRows(db: Db) {
  return db.select().from(schema.hostVisit).all()
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const NOW = Date.UTC(2026, 9, 18, 12, 0, 0)
const HOST = 'theater.dev.lilnas.io'

describe('HostActivityService', () => {
  let testDb: ReturnType<typeof createTestDb>
  let logger: PinoLogger
  let service: HostActivityService

  beforeEach(() => {
    testDb = createTestDb()
    logger = fakeLogger()
    service = new HostActivityService(testDb.db, logger)
    seedUser(testDb.db, 'u1')
    seedUser(testDb.db, 'u2')
  })

  afterEach(() => {
    testDb.close()
  })

  describe('recordVisit', () => {
    it('records a visit the first time a user is seen on a host', () => {
      service.recordVisit(HOST, 'u1', NOW)

      expect(readRows(testDb.db)).toEqual([
        { host: HOST, userId: 'u1', lastSeenAt: new Date(NOW) },
      ])
    })

    it('ignores hosts outside lilnas.io, including look-alike suffixes', () => {
      service.recordVisit('example.com', 'u1', NOW)
      service.recordVisit('evil-lilnas.io', 'u1', NOW)
      service.recordVisit('lilnas.io.evil.com', 'u1', NOW)
      service.recordVisit('lilnas.io', 'u1', NOW)

      expect(readRows(testDb.db)).toEqual([])
    })

    it('does not touch the DB again for the same user and host within a minute', () => {
      service.recordVisit(HOST, 'u1', NOW)
      service.recordVisit(HOST, 'u1', NOW + MINUTE_MS - 1)

      expect(readRows(testDb.db)[0]?.lastSeenAt).toEqual(new Date(NOW))
    })

    it('bumps lastSeenAt once the minute has passed', () => {
      service.recordVisit(HOST, 'u1', NOW)
      service.recordVisit(HOST, 'u1', NOW + MINUTE_MS)

      expect(readRows(testDb.db)).toEqual([
        { host: HOST, userId: 'u1', lastSeenAt: new Date(NOW + MINUTE_MS) },
      ])
    })

    it('throttles per user and per host, not globally', () => {
      service.recordVisit(HOST, 'u1', NOW)
      service.recordVisit(HOST, 'u2', NOW)
      service.recordVisit('download.dev.lilnas.io', 'u1', NOW)

      expect(readRows(testDb.db)).toHaveLength(3)
    })

    it('swallows and logs a failed write instead of throwing', () => {
      // 'ghost' has no user row, so the foreign key rejects the insert.
      expect(() => service.recordVisit(HOST, 'ghost', NOW)).not.toThrow()

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'host-activity-record-failed',
          host: HOST,
        }),
        expect.any(String),
      )
    })
  })

  describe('summarize', () => {
    it('reports zero users and no last visit for a host never seen', () => {
      expect(service.summarize(HOST, 6, NOW)).toEqual({
        activeUsers: 0,
        lastVisitAt: null,
      })
    })

    it('counts distinct users whose last visit is inside the window', () => {
      service.recordVisit(HOST, 'u1', NOW - HOUR_MS)
      service.recordVisit(HOST, 'u2', NOW - 2 * HOUR_MS)

      expect(service.summarize(HOST, 6, NOW).activeUsers).toBe(2)
    })

    it('counts one user once however many times they visit', () => {
      service.recordVisit(HOST, 'u1', NOW - 2 * HOUR_MS)
      service.recordVisit(HOST, 'u1', NOW - HOUR_MS)

      expect(service.summarize(HOST, 6, NOW).activeUsers).toBe(1)
    })

    it('excludes users whose last visit is older than the window but still reports lastVisitAt', () => {
      service.recordVisit(HOST, 'u1', NOW - 7 * HOUR_MS)

      expect(service.summarize(HOST, 6, NOW)).toEqual({
        activeUsers: 0,
        lastVisitAt: new Date(NOW - 7 * HOUR_MS),
      })
    })

    it('includes a visit exactly at the window edge', () => {
      service.recordVisit(HOST, 'u1', NOW - 6 * HOUR_MS)

      expect(service.summarize(HOST, 6, NOW).activeUsers).toBe(1)
    })

    it('does not count other hosts', () => {
      service.recordVisit('download.dev.lilnas.io', 'u1', NOW)

      expect(service.summarize(HOST, 6, NOW).activeUsers).toBe(0)
    })

    it('reports the most recent visit across users as lastVisitAt', () => {
      service.recordVisit(HOST, 'u1', NOW - 3 * HOUR_MS)
      service.recordVisit(HOST, 'u2', NOW - HOUR_MS)

      expect(service.summarize(HOST, 6, NOW).lastVisitAt).toEqual(
        new Date(NOW - HOUR_MS),
      )
    })
  })
})
