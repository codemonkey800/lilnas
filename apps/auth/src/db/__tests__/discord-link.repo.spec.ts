import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { applyPragmas, type Db, runMigrations } from 'src/db/database.module'
import {
  deleteLinkForUser,
  findIdentity,
  findLinkByDiscordUserId,
  findLinkByEmail,
  findLinkByUserId,
  insertLink,
  listLinks,
  listUnlinkedIdentities,
  listUnlinkedUsers,
  upsertIdentity,
} from 'src/db/discord-link.repo'
import * as schema from 'src/db/schema'

// Same shape as db/__tests__/auth-session.repo.spec.ts and schema.spec.ts:
// an in-memory DB built by the REAL applyPragmas()/runMigrations() exports,
// never a hand-written CREATE TABLE. That matters here specifically because
// this file asserts ON DELETE CASCADE behavior, which only exists if the
// actual migration's foreign keys were applied AND foreign_keys = ON
// survived the migrate() call.
function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
}

function seedUser(
  db: Db,
  id: string,
  overrides: { email?: string; name?: string; blockedAt?: Date | null } = {},
): string {
  const now = new Date()
  db.insert(schema.user)
    .values({
      id,
      name: overrides.name ?? `Name ${id}`,
      email: overrides.email ?? `${id}@example.com`,
      emailVerified: false,
      blockedAt: overrides.blockedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return id
}

const T0 = new Date(1_700_000_000_000)
const T1 = new Date(1_700_000_060_000)
const T2 = new Date(1_700_000_120_000)

describe('upsertIdentity', () => {
  it("reports 'inserted' and stamps both timestamps the first time an account is seen", () => {
    const { db, close } = createTestDb()
    try {
      const outcome = upsertIdentity(
        db,
        {
          discordUserId: '111111111111111111',
          username: 'ada',
          displayName: 'Ada L',
        },
        T0,
      )

      expect(outcome).toBe('inserted')

      const row = findIdentity(db, '111111111111111111')
      expect(row).toEqual({
        discordUserId: '111111111111111111',
        username: 'ada',
        displayName: 'Ada L',
        firstSeenAt: T0,
        lastSeenAt: T0,
      })
    } finally {
      close()
    }
  })

  it("reports 'unchanged' on a re-observation with identical labels, bumping only lastSeenAt", () => {
    const { db, close } = createTestDb()
    try {
      upsertIdentity(
        db,
        { discordUserId: '222', username: 'ada', displayName: 'Ada L' },
        T0,
      )

      const outcome = upsertIdentity(
        db,
        { discordUserId: '222', username: 'ada', displayName: 'Ada L' },
        T1,
      )

      expect(outcome).toBe('unchanged')
      const row = findIdentity(db, '222')
      expect(row?.lastSeenAt).toEqual(T1)
      // firstSeenAt is written once at insert and never touched again.
      expect(row?.firstSeenAt).toEqual(T0)
    } finally {
      close()
    }
  })

  it("reports 'updated' and rewrites the cached handle when the username changes (rename detection)", () => {
    const { db, close } = createTestDb()
    try {
      upsertIdentity(
        db,
        { discordUserId: '333', username: 'ada', displayName: 'Ada L' },
        T0,
      )

      const outcome = upsertIdentity(
        db,
        {
          discordUserId: '333',
          username: 'ada.lovelace',
          displayName: 'Ada L',
        },
        T1,
      )

      expect(outcome).toBe('updated')
      const row = findIdentity(db, '333')
      expect(row?.username).toBe('ada.lovelace')
      expect(row?.firstSeenAt).toEqual(T0)
      expect(row?.lastSeenAt).toEqual(T1)
    } finally {
      close()
    }
  })

  it("reports 'updated' when only the display name changes, including a change to null", () => {
    const { db, close } = createTestDb()
    try {
      upsertIdentity(
        db,
        { discordUserId: '444', username: 'ada', displayName: 'Ada L' },
        T0,
      )

      expect(
        upsertIdentity(
          db,
          {
            discordUserId: '444',
            username: 'ada',
            displayName: 'Ada Lovelace',
          },
          T1,
        ),
      ).toBe('updated')

      // Discord genuinely returns null globalName for accounts that clear
      // it, so dropping a display name is a real rename, not a no-op.
      expect(
        upsertIdentity(
          db,
          { discordUserId: '444', username: 'ada', displayName: null },
          T2,
        ),
      ).toBe('updated')
      expect(findIdentity(db, '444')?.displayName).toBeNull()

      // ...and a subsequent omitted displayName collapses to the same null,
      // so it must NOT read as another rename.
      expect(
        upsertIdentity(db, { discordUserId: '444', username: 'ada' }, T2),
      ).toBe('unchanged')
    } finally {
      close()
    }
  })

  it('keeps the snowflake a string, never round-tripping it through a number', () => {
    const { db, close } = createTestDb()
    try {
      const snowflake = '1234567890123456789'
      expect(Number(snowflake)).toBeGreaterThan(Number.MAX_SAFE_INTEGER)

      upsertIdentity(db, { discordUserId: snowflake, username: 'ada' }, T0)

      expect(findIdentity(db, snowflake)?.discordUserId).toBe(snowflake)
    } finally {
      close()
    }
  })

  it('returns undefined from findIdentity for an account never seen', () => {
    const { db, close } = createTestDb()
    try {
      expect(findIdentity(db, '999')).toBeUndefined()
    } finally {
      close()
    }
  })
})

describe('link lookups', () => {
  it('resolves a Discord account to the lilnas person behind it', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'u1', { email: 'ada@example.com', name: 'Ada' })
      upsertIdentity(db, { discordUserId: '111', username: 'ada' }, T0)
      insertLink(db, { userId: 'u1', discordUserId: '111' }, T1)

      expect(findLinkByDiscordUserId(db, '111')).toEqual({
        userId: 'u1',
        email: 'ada@example.com',
        name: 'Ada',
      })
      expect(findLinkByDiscordUserId(db, '222')).toBeUndefined()
    } finally {
      close()
    }
  })

  it('resolves a lilnas user to their link row', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'u1')
      upsertIdentity(db, { discordUserId: '111', username: 'ada' }, T0)
      insertLink(db, { userId: 'u1', discordUserId: '111' }, T1)

      const row = findLinkByUserId(db, 'u1')
      expect(row).toMatchObject({
        userId: 'u1',
        discordUserId: '111',
        createdAt: T1,
      })
      expect(typeof row?.id).toBe('number')
      expect(findLinkByUserId(db, 'u2')).toBeUndefined()
    } finally {
      close()
    }
  })

  it('matches by email case-insensitively on both sides of the comparison', () => {
    const { db, close } = createTestDb()
    try {
      // Better Auth writes user.email straight from Google's userinfo, never
      // through normalizeEmail() — so the STORED address can carry uppercase
      // and the lookup still has to find it.
      seedUser(db, 'u1', { email: 'Ada.Lovelace@Example.COM' })
      upsertIdentity(db, { discordUserId: '111', username: 'ada' }, T0)
      insertLink(db, { userId: 'u1', discordUserId: '111' }, T1)

      const expected = { userId: 'u1', discordUserId: '111' }
      expect(findLinkByEmail(db, 'Ada.Lovelace@Example.COM')).toEqual(expected)
      expect(findLinkByEmail(db, 'ada.lovelace@example.com')).toEqual(expected)
      // normalizeEmail() trims as well as lowercases.
      expect(findLinkByEmail(db, '  ADA.LOVELACE@EXAMPLE.com  ')).toEqual(
        expected,
      )
      expect(findLinkByEmail(db, 'someone.else@example.com')).toBeUndefined()
    } finally {
      close()
    }
  })

  it('lists every link flattened with labels read live from both sides', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'u2', { email: 'zoe@example.com', name: 'Zoe' })
      seedUser(db, 'u1', { email: 'ada@example.com', name: 'Ada' })
      upsertIdentity(
        db,
        { discordUserId: '111', username: 'ada', displayName: 'Ada L' },
        T0,
      )
      upsertIdentity(db, { discordUserId: '222', username: 'zoe' }, T0)
      insertLink(db, { userId: 'u1', discordUserId: '111' }, T1)
      insertLink(db, { userId: 'u2', discordUserId: '222' }, T2)

      // A rename lands on discord_identity only; the link stores no labels,
      // so listLinks() must reflect it with nothing else updated.
      upsertIdentity(
        db,
        {
          discordUserId: '111',
          username: 'ada.lovelace',
          displayName: 'Ada L',
        },
        T2,
      )

      expect(listLinks(db)).toEqual([
        {
          userId: 'u1',
          email: 'ada@example.com',
          name: 'Ada',
          discordUserId: '111',
          username: 'ada.lovelace',
          displayName: 'Ada L',
          createdAt: T1,
        },
        {
          userId: 'u2',
          email: 'zoe@example.com',
          name: 'Zoe',
          discordUserId: '222',
          username: 'zoe',
          displayName: null,
          createdAt: T2,
        },
      ])
    } finally {
      close()
    }
  })
})

describe('the admin UI pick-from-a-list columns', () => {
  it('drops a user and an identity out of their unlinked lists once a link lands', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'u1', { email: 'ada@example.com' })
      seedUser(db, 'u2', { email: 'zoe@example.com' })
      upsertIdentity(db, { discordUserId: '111', username: 'ada' }, T0)
      upsertIdentity(db, { discordUserId: '222', username: 'zoe' }, T1)

      expect(listUnlinkedUsers(db).map(row => row.userId)).toEqual(['u1', 'u2'])
      expect(listUnlinkedIdentities(db).map(row => row.discordUserId)).toEqual([
        // Most-recently-seen first.
        '222',
        '111',
      ])

      insertLink(db, { userId: 'u1', discordUserId: '111' }, T2)

      expect(listUnlinkedUsers(db).map(row => row.userId)).toEqual(['u2'])
      expect(listUnlinkedIdentities(db).map(row => row.discordUserId)).toEqual([
        '222',
      ])
    } finally {
      close()
    }
  })

  it('returns the columns the picker renders, not raw join rows', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'u1', { email: 'ada@example.com', name: 'Ada' })
      upsertIdentity(
        db,
        { discordUserId: '111', username: 'ada', displayName: 'Ada L' },
        T0,
      )

      expect(listUnlinkedUsers(db)).toEqual([
        { userId: 'u1', email: 'ada@example.com', name: 'Ada' },
      ])
      expect(listUnlinkedIdentities(db)).toEqual([
        {
          discordUserId: '111',
          username: 'ada',
          displayName: 'Ada L',
          firstSeenAt: T0,
          lastSeenAt: T0,
        },
      ])
    } finally {
      close()
    }
  })

  it('excludes blocked users from the link picker', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'u1', { email: 'ada@example.com' })
      seedUser(db, 'u2', { email: 'zoe@example.com', blockedAt: T0 })

      expect(listUnlinkedUsers(db).map(row => row.userId)).toEqual(['u1'])
    } finally {
      close()
    }
  })
})

describe('link mutations', () => {
  it('deletes the link for a user and reports the row count', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'u1')
      upsertIdentity(db, { discordUserId: '111', username: 'ada' }, T0)
      insertLink(db, { userId: 'u1', discordUserId: '111' }, T1)

      expect(deleteLinkForUser(db, 'u1')).toBe(1)
      expect(findLinkByUserId(db, 'u1')).toBeUndefined()
      // Unlinking asserts "not that person", never "never seen" — the
      // roster entry survives and becomes available to link again.
      expect(findIdentity(db, '111')).toBeDefined()
      expect(listUnlinkedIdentities(db).map(row => row.discordUserId)).toEqual([
        '111',
      ])
    } finally {
      close()
    }
  })

  it('reports 0 (not an error) when there was nothing to unlink', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'u1')

      expect(deleteLinkForUser(db, 'u1')).toBe(0)
      expect(deleteLinkForUser(db, 'no-such-user')).toBe(0)
    } finally {
      close()
    }
  })

  it('throws rather than silently absorbing a second link for the same user', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'u1')
      upsertIdentity(db, { discordUserId: '111', username: 'ada' }, T0)
      upsertIdentity(db, { discordUserId: '222', username: 'zoe' }, T0)
      insertLink(db, { userId: 'u1', discordUserId: '111' }, T1)

      expect(() =>
        insertLink(db, { userId: 'u1', discordUserId: '222' }, T2),
      ).toThrow()
    } finally {
      close()
    }
  })

  it('throws rather than linking a snowflake that was never observed', () => {
    const { db, close } = createTestDb()
    try {
      seedUser(db, 'u1')

      // The DB-level expression of "pick from a list, never type a handle":
      // a mistyped snowflake has no discord_identity row, so the FK fails.
      expect(() =>
        insertLink(db, { userId: 'u1', discordUserId: '999' }, T1),
      ).toThrow()
    } finally {
      close()
    }
  })
})

describe('cascade behavior', () => {
  it('drops the link when the lilnas user is deleted, leaving the roster entry behind', () => {
    const { db, sqlite, close } = createTestDb()
    try {
      seedUser(db, 'u1')
      upsertIdentity(db, { discordUserId: '111', username: 'ada' }, T0)
      insertLink(db, { userId: 'u1', discordUserId: '111' }, T1)

      sqlite.prepare(`DELETE FROM user WHERE id = 'u1'`).run()

      expect(findLinkByDiscordUserId(db, '111')).toBeUndefined()
      // The roster is an observation log, not a consequence of the link —
      // deleting the person must not un-see the Discord account.
      expect(findIdentity(db, '111')).toBeDefined()
      expect(listUnlinkedIdentities(db).map(row => row.discordUserId)).toEqual([
        '111',
      ])
    } finally {
      close()
    }
  })

  it('drops the link when the Discord identity is deleted, leaving the user behind', () => {
    const { db, sqlite, close } = createTestDb()
    try {
      seedUser(db, 'u1', { email: 'ada@example.com' })
      upsertIdentity(db, { discordUserId: '111', username: 'ada' }, T0)
      insertLink(db, { userId: 'u1', discordUserId: '111' }, T1)

      sqlite
        .prepare(`DELETE FROM discord_identity WHERE discord_user_id = '111'`)
        .run()

      expect(findLinkByUserId(db, 'u1')).toBeUndefined()
      expect(listUnlinkedUsers(db).map(row => row.userId)).toEqual(['u1'])
    } finally {
      close()
    }
  })
})
