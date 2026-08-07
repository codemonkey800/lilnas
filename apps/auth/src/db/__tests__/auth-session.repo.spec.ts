import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { revokeSessionsForUser } from 'src/db/auth-session.repo'
import { applyPragmas, type Db, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
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

let sessionCounter = 0
function seedSession(db: Db, userId: string): string {
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
  return id
}

describe('revokeSessionsForUser (S2b)', () => {
  it('deletes every session row for the given user and reports the count', () => {
    const testDb = createTestDb()
    try {
      const userId = seedUser(testDb.db)
      seedSession(testDb.db, userId)
      seedSession(testDb.db, userId)

      const deleted = revokeSessionsForUser(testDb.db, userId)

      expect(deleted).toBe(2)
      expect(
        testDb.db
          .select()
          .from(schema.session)
          .all()
          .filter(row => row.userId === userId),
      ).toHaveLength(0)
    } finally {
      testDb.close()
    }
  })

  it("leaves another user's sessions untouched", () => {
    const testDb = createTestDb()
    try {
      const targetId = seedUser(testDb.db)
      const otherId = seedUser(testDb.db)
      seedSession(testDb.db, targetId)
      seedSession(testDb.db, otherId)

      revokeSessionsForUser(testDb.db, targetId)

      const remaining = testDb.db.select().from(schema.session).all()
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.userId).toBe(otherId)
    } finally {
      testDb.close()
    }
  })

  it('returns 0 for a user with no active sessions — a normal outcome, not an error', () => {
    const testDb = createTestDb()
    try {
      const userId = seedUser(testDb.db)

      expect(revokeSessionsForUser(testDb.db, userId)).toBe(0)
    } finally {
      testDb.close()
    }
  })

  it('returns 0 for a userId with no matching user row at all, rather than throwing', () => {
    const testDb = createTestDb()
    try {
      expect(revokeSessionsForUser(testDb.db, 'no-such-user')).toBe(0)
    } finally {
      testDb.close()
    }
  })
})
