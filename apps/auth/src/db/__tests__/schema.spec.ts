import { type HealthResponse } from '@lilnas/utils/health'
import { HttpException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { applyPragmas, DB, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { HealthController } from 'src/health/health.controller'

// Fresh in-memory Drizzle/better-sqlite3 instance with PRAGMAs set and
// migrations applied via the REAL exported runMigrations() (not a
// reimplementation of it) — see the "re-asserts foreign_keys" test below for
// why that distinction matters. Each call returns an independent DB.
function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
}

describe('schema + migrations', () => {
  it('applies migrations cleanly to an empty database and the expected tables exist', () => {
    const { sqlite, close } = createTestDb()
    try {
      const tableNames = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
        )
        .all()
        .map(row => (row as { name: string }).name)
        .sort()

      expect(tableNames).toEqual(
        [
          'access_request',
          'account',
          'discord_identity',
          'discord_link',
          'grant',
          'pre_authorized_grant',
          'session',
          'user',
          'verification',
        ].sort(),
      )
    } finally {
      close()
    }
  })

  it('re-asserts foreign_keys = ON after migrate(), proving the reassertion codepath actually runs (not just checking end-state)', () => {
    const sqlite = new BetterSqlite3(':memory:')
    applyPragmas(sqlite)
    const db = drizzle(sqlite, { schema })

    // Attach the spy AFTER applyPragmas() already made its own
    // 'foreign_keys = ON' call, so any invocation captured below can only
    // have come from runMigrations()'s post-migrate re-assertion — this is
    // what distinguishes this test from one that merely checks the final
    // pragma value (which would pass even if the re-assertion line were
    // deleted, as long as the migrator never happened to toggle it off).
    const pragmaSpy = jest.spyOn(sqlite, 'pragma')
    runMigrations(db)

    const reassertionCalls = pragmaSpy.mock.calls.filter(
      ([arg]) => arg === 'foreign_keys = ON',
    )
    expect(reassertionCalls.length).toBeGreaterThanOrEqual(1)

    const fkStatus = sqlite.pragma('foreign_keys') as Array<{
      foreign_keys: number
    }>
    expect(fkStatus[0]?.foreign_keys).toBe(1)

    sqlite.close()
  })

  it('enforces the user_id foreign key on grant (foreign_keys is not just reported ON, it is enforced)', () => {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        db
          .insert(schema.grant)
          .values({
            userId: 'no-such-user',
            serviceHost: 'swole.lilnas.io',
            createdAt: new Date(),
          })
          .run(),
      ).toThrow()
    } finally {
      close()
    }
  })
})

describe('grant table', () => {
  it('basic insert and read round-trips', () => {
    const { db, close } = createTestDb()
    try {
      const now = new Date()
      db.insert(schema.user)
        .values({
          id: 'user_1',
          name: 'Test User',
          email: 'test@example.com',
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      db.insert(schema.grant)
        .values({
          userId: 'user_1',
          serviceHost: 'swole.lilnas.io',
          createdAt: now,
        })
        .run()

      const rows = db.select().from(schema.grant).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]!.userId).toBe('user_1')
      expect(rows[0]!.serviceHost).toBe('swole.lilnas.io')
    } finally {
      close()
    }
  })

  it('rejects a second grant row for an existing (userId, serviceHost) pair', () => {
    const { db, close } = createTestDb()
    try {
      const now = new Date()
      db.insert(schema.user)
        .values({
          id: 'user_1',
          name: 'Test User',
          email: 'test@example.com',
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      db.insert(schema.grant)
        .values({
          userId: 'user_1',
          serviceHost: 'swole.lilnas.io',
          createdAt: now,
        })
        .run()

      expect(() =>
        db
          .insert(schema.grant)
          .values({
            userId: 'user_1',
            serviceHost: 'swole.lilnas.io',
            createdAt: now,
          })
          .run(),
      ).toThrow()

      expect(db.select().from(schema.grant).all()).toHaveLength(1)
    } finally {
      close()
    }
  })
})

describe('access_request table', () => {
  function seedUser(db: ReturnType<typeof createTestDb>['db'], id: string) {
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
  }

  it('rejects a second PENDING row for an existing (userId, serviceHost) pair — the R6 guarantee, at the schema level', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'user_1')
      const now = new Date()

      db.insert(schema.accessRequest)
        .values({
          userId: 'user_1',
          serviceHost: 'swole.lilnas.io',
          status: 'pending',
          createdAt: now,
          lastSeenAt: now,
        })
        .run()

      expect(() =>
        db
          .insert(schema.accessRequest)
          .values({
            userId: 'user_1',
            serviceHost: 'swole.lilnas.io',
            status: 'pending',
            createdAt: now,
            lastSeenAt: now,
          })
          .run(),
      ).toThrow()

      expect(db.select().from(schema.accessRequest).all()).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('allows a new pending row to coexist with an older decided (rejected) row for the same pair — proves the unique index is partial (scoped to pending), not a blanket constraint, per the judgment call documented in schema.ts', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'user_1')
      const now = new Date()

      db.insert(schema.accessRequest)
        .values({
          userId: 'user_1',
          serviceHost: 'swole.lilnas.io',
          status: 'rejected',
          createdAt: now,
          lastSeenAt: now,
          decidedAt: now,
        })
        .run()

      expect(() =>
        db
          .insert(schema.accessRequest)
          .values({
            userId: 'user_1',
            serviceHost: 'swole.lilnas.io',
            status: 'pending',
            createdAt: now,
            lastSeenAt: now,
          })
          .run(),
      ).not.toThrow()

      const rows = db
        .select()
        .from(schema.accessRequest)
        .all()
        .filter(
          r => r.userId === 'user_1' && r.serviceHost === 'swole.lilnas.io',
        )
      expect(rows).toHaveLength(2)
      expect(rows.map(r => r.status).sort()).toEqual(['pending', 'rejected'])
    } finally {
      close()
    }
  })

  it('rejects an invalid status value via the CHECK constraint', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'user_1')
      const now = new Date()

      expect(() =>
        db
          .insert(schema.accessRequest)
          .values({
            userId: 'user_1',
            serviceHost: 'swole.lilnas.io',
            status: 'bogus' as never,
            createdAt: now,
            lastSeenAt: now,
          })
          .run(),
      ).toThrow()
    } finally {
      close()
    }
  })

  it('rejects a row where status and decided_at disagree — the pending/decided correlation CHECK', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'user_1')
      const now = new Date()

      // status='pending' but decided_at is set.
      expect(() =>
        db
          .insert(schema.accessRequest)
          .values({
            userId: 'user_1',
            serviceHost: 'swole.lilnas.io',
            status: 'pending',
            createdAt: now,
            lastSeenAt: now,
            decidedAt: now,
          })
          .run(),
      ).toThrow()

      // status='approved' but decided_at is null.
      expect(() =>
        db
          .insert(schema.accessRequest)
          .values({
            userId: 'user_1',
            serviceHost: 'tdr.lilnas.io',
            status: 'approved',
            createdAt: now,
            lastSeenAt: now,
          })
          .run(),
      ).toThrow()
    } finally {
      close()
    }
  })
})

describe('discord_identity + discord_link tables', () => {
  function seedUser(db: ReturnType<typeof createTestDb>['db'], id: string) {
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
  }

  function seedIdentity(
    db: ReturnType<typeof createTestDb>['db'],
    discordUserId: string,
  ) {
    const now = new Date()
    db.insert(schema.discordIdentity)
      .values({
        discordUserId,
        username: `user.${discordUserId}`,
        displayName: null,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .run()
  }

  function seedLink(
    db: ReturnType<typeof createTestDb>['db'],
    userId: string,
    discordUserId: string,
  ) {
    db.insert(schema.discordLink)
      .values({ userId, discordUserId, createdAt: new Date() })
      .run()
  }

  it('round-trips a discord_identity row, keeping the snowflake a string (it exceeds MAX_SAFE_INTEGER)', () => {
    const { db, close } = createTestDb()
    try {
      const firstSeen = new Date(1_700_000_000_000)
      const lastSeen = new Date(1_700_000_999_000)
      // Deliberately larger than Number.MAX_SAFE_INTEGER — a numeric
      // round-trip would corrupt the low digits.
      const snowflake = '1234567890123456789'
      expect(Number(snowflake)).toBeGreaterThan(Number.MAX_SAFE_INTEGER)

      db.insert(schema.discordIdentity)
        .values({
          discordUserId: snowflake,
          username: 'somebody',
          displayName: 'Some Body',
          firstSeenAt: firstSeen,
          lastSeenAt: lastSeen,
        })
        .run()

      const rows = db.select().from(schema.discordIdentity).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]!.discordUserId).toBe(snowflake)
      expect(rows[0]!.username).toBe('somebody')
      expect(rows[0]!.displayName).toBe('Some Body')
      expect(rows[0]!.firstSeenAt).toEqual(firstSeen)
      expect(rows[0]!.lastSeenAt).toEqual(lastSeen)
    } finally {
      close()
    }
  })

  it('allows a null display_name (Discord returns null globalName for accounts that never set one)', () => {
    const { db, close } = createTestDb()
    try {
      seedIdentity(db, '111111111111111111')
      const rows = db.select().from(schema.discordIdentity).all()
      expect(rows[0]!.displayName).toBeNull()
    } finally {
      close()
    }
  })

  it('rejects a link to a snowflake that was never observed — the DB-level expression of the pick-from-a-list UI', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'user_1')

      expect(() => seedLink(db, 'user_1', '999999999999999999')).toThrow()
      expect(db.select().from(schema.discordLink).all()).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('rejects a link to a user that does not exist', () => {
    const { db, close } = createTestDb()
    try {
      seedIdentity(db, '111111111111111111')

      expect(() => seedLink(db, 'no-such-user', '111111111111111111')).toThrow()
      expect(db.select().from(schema.discordLink).all()).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('rejects a second link row for a user that already has one (one Discord account per lilnas user)', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'user_1')
      seedIdentity(db, '111111111111111111')
      seedIdentity(db, '222222222222222222')
      seedLink(db, 'user_1', '111111111111111111')

      expect(() => seedLink(db, 'user_1', '222222222222222222')).toThrow()
      expect(db.select().from(schema.discordLink).all()).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('rejects a second link row for a Discord account that already has one (one lilnas user per Discord account)', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'user_1')
      seedUser(db, 'user_2')
      seedIdentity(db, '111111111111111111')
      seedLink(db, 'user_1', '111111111111111111')

      expect(() => seedLink(db, 'user_2', '111111111111111111')).toThrow()
      expect(db.select().from(schema.discordLink).all()).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('allows two distinct pairs to coexist — proves neither unique index is broader than one column', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'user_1')
      seedUser(db, 'user_2')
      seedIdentity(db, '111111111111111111')
      seedIdentity(db, '222222222222222222')

      seedLink(db, 'user_1', '111111111111111111')
      expect(() => seedLink(db, 'user_2', '222222222222222222')).not.toThrow()
      expect(db.select().from(schema.discordLink).all()).toHaveLength(2)
    } finally {
      close()
    }
  })

  it('cascades the link away when the user is deleted, leaving the observed identity behind', () => {
    const { db, sqlite, close } = createTestDb()
    try {
      seedUser(db, 'user_1')
      seedIdentity(db, '111111111111111111')
      seedLink(db, 'user_1', '111111111111111111')

      sqlite.prepare(`DELETE FROM user WHERE id = 'user_1'`).run()

      expect(db.select().from(schema.discordLink).all()).toHaveLength(0)
      // The roster is an observation log, not a consequence of the link —
      // deleting the lilnas user must not un-see the Discord account.
      expect(db.select().from(schema.discordIdentity).all()).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('cascades the link away when the discord_identity is deleted, leaving the user behind', () => {
    const { db, sqlite, close } = createTestDb()
    try {
      seedUser(db, 'user_1')
      seedIdentity(db, '111111111111111111')
      seedLink(db, 'user_1', '111111111111111111')

      sqlite
        .prepare(
          `DELETE FROM discord_identity WHERE discord_user_id = '111111111111111111'`,
        )
        .run()

      expect(db.select().from(schema.discordLink).all()).toHaveLength(0)
      expect(db.select().from(schema.user).all()).toHaveLength(1)
    } finally {
      close()
    }
  })
})

describe('GET /health (HealthController via NestJS testing module)', () => {
  it('returns 200 with the shared @lilnas/utils/health shape and actually exercises the sqlite probe', async () => {
    const { db, sqlite, close } = createTestDb()
    try {
      const prepareSpy = jest.spyOn(sqlite, 'prepare')

      const moduleRef = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [{ provide: DB, useValue: db }],
      }).compile()
      const controller = moduleRef.get(HealthController)

      const result = await controller.check()

      expect(result.status).toBe('ok')
      expect(result.service).toBe('lilnas-auth')
      expect(result.deps).toEqual({ sqlite: 'ok' })
      expect(typeof result.timestamp).toBe('string')
      // Proves the probe ran a real query against the real handle rather
      // than the controller just returning a hardcoded 'ok'.
      expect(prepareSpy).toHaveBeenCalledWith('SELECT 1')
    } finally {
      close()
    }
  })

  it('returns 503 with deps.sqlite = degraded when the sqlite handle is unusable', async () => {
    const { db, sqlite } = createTestDb()
    // Make the handle unusable before probing — better-sqlite3 throws
    // "The database connection is not open" on any statement against a
    // closed handle.
    sqlite.close()

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DB, useValue: db }],
    }).compile()
    const controller = moduleRef.get(HealthController)

    let caught: unknown
    try {
      await controller.check()
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(HttpException)
    const httpErr = caught as HttpException
    expect(httpErr.getStatus()).toBe(503)

    const body = httpErr.getResponse() as HealthResponse
    expect(body.status).toBe('degraded')
    expect(body.deps?.sqlite).toBe('degraded')
  })
})
