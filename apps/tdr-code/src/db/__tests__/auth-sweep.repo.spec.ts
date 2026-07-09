import { sweepAccountlessUsers } from 'src/db/auth-sweep.repo'
import { account, user } from 'src/db/schema'
import { createTestDb } from 'src/db/test-db'

type TestDbHandle = ReturnType<typeof createTestDb>['db']

function insertUser(db: TestDbHandle, id: string) {
  const now = new Date()
  db.insert(user)
    .values({
      id,
      name: `name-${id}`,
      email: `${id}@example.com`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

function insertLinkedAccount(db: TestDbHandle, id: string, userId: string) {
  const now = new Date()
  db.insert(account)
    .values({
      id,
      accountId: `discord-${userId}`,
      providerId: 'discord',
      userId,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

// finding #6: sweepAccountlessUsers must be scoped to the one userId a
// guild-gate rejection actually orphaned — never a blanket sweep of every
// accountless row, which could delete a DIFFERENT, concurrently in-flight
// member's own not-yet-linked user row.
describe('auth-sweep.repo — sweepAccountlessUsers', () => {
  it('deletes the targeted accountless user row', () => {
    const { db, close } = createTestDb()
    try {
      insertUser(db, 'rejected-user')

      expect(sweepAccountlessUsers(db, 'rejected-user')).toBe(1)
      expect(db.select().from(user).all()).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('never touches a different accountless user row (scoped, not a blanket sweep)', () => {
    const { db, close } = createTestDb()
    try {
      insertUser(db, 'rejected-user')
      // Simulates another sign-in's user row, briefly accountless while its
      // own account INSERT hasn't run yet (see this repo's header comment).
      insertUser(db, 'concurrent-inflight-user')

      expect(sweepAccountlessUsers(db, 'rejected-user')).toBe(1)

      const remaining = db.select().from(user).all()
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.id).toBe('concurrent-inflight-user')
    } finally {
      close()
    }
  })

  it('never deletes a user row that already has a linked account', () => {
    const { db, close } = createTestDb()
    try {
      insertUser(db, 'member-user')
      insertLinkedAccount(db, 'acct-1', 'member-user')

      expect(sweepAccountlessUsers(db, 'member-user')).toBe(0)
      expect(db.select().from(user).all()).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('returns 0 when the targeted user id does not exist', () => {
    const { db, close } = createTestDb()
    try {
      expect(sweepAccountlessUsers(db, 'nonexistent-user')).toBe(0)
    } finally {
      close()
    }
  })
})
