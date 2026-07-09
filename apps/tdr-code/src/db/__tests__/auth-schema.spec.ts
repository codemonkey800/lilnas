import BetterSqlite3 from 'better-sqlite3'

import { account, session, user, verification } from 'src/db/schema'
import { createTestDb } from 'src/db/test-db'

type WithSqliteClient = { $client: InstanceType<typeof BetterSqlite3> }

describe('Better Auth schema (Phase D — U1)', () => {
  it('creates user/session/account/verification tables with expected columns after migrate()', () => {
    const { db, close } = createTestDb()
    try {
      const sqlite = (db as unknown as WithSqliteClient).$client

      const tableNames = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user','session','account','verification')`,
        )
        .all()
        .map(row => (row as { name: string }).name)
      expect(tableNames.sort()).toEqual([
        'account',
        'session',
        'user',
        'verification',
      ])

      const userColumns = sqlite
        .prepare(`PRAGMA table_info(user)`)
        .all()
        .map(c => (c as { name: string }).name)
      expect(userColumns).toEqual([
        'id',
        'name',
        'email',
        'email_verified',
        'image',
        'created_at',
        'updated_at',
      ])

      const sessionColumns = sqlite
        .prepare(`PRAGMA table_info(session)`)
        .all()
        .map(c => (c as { name: string }).name)
      expect(sessionColumns).toEqual([
        'id',
        'expires_at',
        'token',
        'created_at',
        'updated_at',
        'ip_address',
        'user_agent',
        'user_id',
      ])

      const accountColumns = sqlite
        .prepare(`PRAGMA table_info(account)`)
        .all()
        .map(c => (c as { name: string }).name)
      expect(accountColumns).toEqual([
        'id',
        'account_id',
        'provider_id',
        'user_id',
        'access_token',
        'refresh_token',
        'id_token',
        'access_token_expires_at',
        'refresh_token_expires_at',
        'scope',
        'password',
        'created_at',
        'updated_at',
      ])

      const verificationColumns = sqlite
        .prepare(`PRAGMA table_info(verification)`)
        .all()
        .map(c => (c as { name: string }).name)
      expect(verificationColumns).toEqual([
        'id',
        'identifier',
        'value',
        'expires_at',
        'created_at',
        'updated_at',
      ])
    } finally {
      close()
    }
  })

  it('can insert a user/account/session row and read it back via Drizzle', () => {
    const { db, close } = createTestDb()
    try {
      const now = new Date()
      db.insert(user)
        .values({
          id: 'user_1',
          name: 'Test User',
          email: 'test@example.com',
          emailVerified: false,
          image: null,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      db.insert(account)
        .values({
          id: 'account_1',
          accountId: '123456789012345678',
          providerId: 'discord',
          userId: 'user_1',
          createdAt: now,
          updatedAt: now,
        })
        .run()

      db.insert(session)
        .values({
          id: 'session_1',
          expiresAt: new Date(now.getTime() + 60_000),
          token: 'tok_1',
          createdAt: now,
          updatedAt: now,
          userId: 'user_1',
        })
        .run()

      const rows = db.select().from(user).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]!.email).toBe('test@example.com')

      const accountRows = db.select().from(account).all()
      expect(accountRows).toHaveLength(1)
      expect(accountRows[0]!.accountId).toBe('123456789012345678')
      expect(accountRows[0]!.providerId).toBe('discord')

      const sessionRows = db.select().from(session).all()
      expect(sessionRows).toHaveLength(1)
      expect(sessionRows[0]!.userId).toBe('user_1')
    } finally {
      close()
    }
  })

  it('rejects a second account row with the same (providerId, accountId) via the partial unique index', () => {
    const { db, close } = createTestDb()
    try {
      const now = new Date()
      db.insert(user)
        .values({
          id: 'user_1',
          name: 'Test User',
          email: 'test@example.com',
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      db.insert(user)
        .values({
          id: 'user_2',
          name: 'Other User',
          email: 'other@example.com',
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      db.insert(account)
        .values({
          id: 'account_1',
          accountId: '123456789012345678',
          providerId: 'discord',
          userId: 'user_1',
          createdAt: now,
          updatedAt: now,
        })
        .run()

      // Same (providerId, accountId) pair, different account row + different
      // owning user — the partial unique index (U3's paired defense) must
      // reject this rather than allow two accounts to alias one Discord
      // identity.
      expect(() =>
        db
          .insert(account)
          .values({
            id: 'account_2',
            accountId: '123456789012345678',
            providerId: 'discord',
            userId: 'user_2',
            createdAt: now,
            updatedAt: now,
          })
          .run(),
      ).toThrow()

      const accountRows = db.select().from(account).all()
      expect(accountRows).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('allows the same accountId under a different providerId (index is scoped, not global)', () => {
    const { db, close } = createTestDb()
    try {
      const now = new Date()
      db.insert(user)
        .values({
          id: 'user_1',
          name: 'Test User',
          email: 'test@example.com',
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      db.insert(account)
        .values({
          id: 'account_1',
          accountId: 'shared-id',
          providerId: 'discord',
          userId: 'user_1',
          createdAt: now,
          updatedAt: now,
        })
        .run()

      expect(() =>
        db
          .insert(account)
          .values({
            id: 'account_2',
            accountId: 'shared-id',
            providerId: 'some-other-provider',
            userId: 'user_1',
            createdAt: now,
            updatedAt: now,
          })
          .run(),
      ).not.toThrow()

      const accountRows = db.select().from(account).all()
      expect(accountRows).toHaveLength(2)
    } finally {
      close()
    }
  })

  it('applies migration 0007 cleanly on top of a db already at 0006, with foreign_keys ON', () => {
    // createTestDb() always runs migrate() against a fresh :memory: db, which
    // walks 0000..0007 in order — this exercises 0007 landing on top of a db
    // that already has all Phase A/B/C tables from 0000-0006, not merely a
    // blank db. Assert no FK/table collisions occurred and pragmas held.
    const { db, close } = createTestDb()
    try {
      const sqlite = (db as unknown as WithSqliteClient).$client

      const fkStatus = sqlite.pragma('foreign_keys') as Array<{
        foreign_keys: number
      }>
      expect(fkStatus[0]?.foreign_keys).toBe(1)

      const allTables = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
        )
        .all()
        .map(row => (row as { name: string }).name)

      // Pre-existing Phase A/B/C tables are still present alongside the new
      // Phase D tables — 0007 is additive, not a rebuild.
      expect(allTables).toEqual(
        expect.arrayContaining([
          'bot_generation',
          'commands',
          'claude_process',
          'sessions',
          'turns',
          'turn_content',
          'events',
          'live_status',
          'config',
          'git_identity',
          'user',
          'session',
          'account',
          'verification',
        ]),
      )

      const foreignKeyCheck = sqlite.pragma('foreign_key_check') as unknown[]
      expect(foreignKeyCheck).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('verification rows insert and read back (OAuth state storage shape)', () => {
    const { db, close } = createTestDb()
    try {
      const now = new Date()
      db.insert(verification)
        .values({
          id: 'verification_1',
          identifier: 'state-abc123',
          value: 'opaque-value',
          expiresAt: new Date(now.getTime() + 60_000),
          createdAt: now,
          updatedAt: now,
        })
        .run()

      const rows = db.select().from(verification).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]!.identifier).toBe('state-abc123')
    } finally {
      close()
    }
  })
})
