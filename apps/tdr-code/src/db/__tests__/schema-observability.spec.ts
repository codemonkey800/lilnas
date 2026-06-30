import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { insertGeneration } from 'src/db/bot-generation.repo'
import { resolveMigrationsFolder } from 'src/db/database.module'
import {
  botGeneration,
  type EventContext,
  events,
  liveStatus,
  sessions,
} from 'src/db/schema'
import * as schema from 'src/db/schema'
import { createTestDb } from 'src/db/test-db'

type RawSqlite = InstanceType<typeof BetterSqlite3>
type WithRawClient = { $client: RawSqlite }

const raw = (db: ReturnType<typeof createTestDb>['db']): RawSqlite =>
  (db as unknown as WithRawClient).$client

// ── helpers ──────────────────────────────────────────────────────────────────

type DbHandle = ReturnType<typeof createTestDb>['db']

function seedSession(db: DbHandle, genId: number, channelId = 'ch-001') {
  return db
    .insert(sessions)
    .values({
      channelId,
      generationId: genId,
      triggeringUserId: 'u-111',
      cwd: '/home/bot',
      createdAt: new Date(),
      endedAt: null,
      endReason: null,
      acpSessionId: null,
    })
    .returning()
    .get()!
}

function seedEvent(
  db: DbHandle,
  genId: number,
  opts: {
    sessionId?: number | null
    channelId?: string | null
    type?: (typeof schema.EVENT_TYPES)[number]
    level?: (typeof schema.EVENT_LEVELS)[number]
    context?: EventContext
  } = {},
) {
  return db
    .insert(events)
    .values({
      generationId: genId,
      sessionId: opts.sessionId !== undefined ? opts.sessionId : null,
      channelId: opts.channelId !== undefined ? opts.channelId : 'ch-001',
      type: opts.type ?? 'session_created',
      level: opts.level ?? 'info',
      context: opts.context ?? {},
      createdAt: new Date(),
    })
    .returning()
    .get()!
}

function seedLiveStatus(db: DbHandle, genId: number, channelId = 'ch-001') {
  return db
    .insert(liveStatus)
    .values({
      channelId,
      generationId: genId,
      triggeringUserId: null,
      prompting: false,
      queueDepth: 0,
      lastActivityAt: new Date(),
      lastHeartbeatAt: new Date(),
    })
    .returning()
    .get()!
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('schema-observability (U2): events · live_status', () => {
  describe('happy path', () => {
    it('applies migrations; all event types and live_status round-trip', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })

        // Insert one event of each type and verify round-trip
        for (const type of schema.EVENT_TYPES) {
          const ev = db
            .insert(events)
            .values({
              generationId: gen.id,
              sessionId: null,
              channelId: null,
              type,
              level: 'info',
              context: { type },
              createdAt: new Date(),
            })
            .returning()
            .get()!
          expect(ev.type).toBe(type)
        }

        const ls = seedLiveStatus(db, gen.id)
        expect(ls.channelId).toBe('ch-001')
        expect(ls.queueDepth).toBe(0)
      } finally {
        close()
      }
    })

    it('error event: JSON context persists and reads back typed', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const ctx: EventContext = {
          message: 'Something went wrong',
          stack: 'Error: ...\n  at foo.ts:1',
          code: 42,
        }
        const ev = seedEvent(db, gen.id, {
          type: 'turn_errored',
          level: 'error',
          context: ctx,
        })

        const row = db.select().from(events).where(eq(events.id, ev.id)).get()!
        expect(row.level).toBe('error')
        expect((row.context as EventContext).message).toBe(
          'Something went wrong',
        )
        expect((row.context as EventContext).code).toBe(42)
      } finally {
        close()
      }
    })

    it('live_status.prompting round-trips as a boolean (true and false)', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })

        db.insert(liveStatus)
          .values({
            channelId: 'ch-prompt-true',
            generationId: gen.id,
            triggeringUserId: null,
            prompting: true,
            queueDepth: 1,
            lastActivityAt: new Date(),
            lastHeartbeatAt: new Date(),
          })
          .run()

        db.insert(liveStatus)
          .values({
            channelId: 'ch-prompt-false',
            generationId: gen.id,
            triggeringUserId: null,
            prompting: false,
            queueDepth: 0,
            lastActivityAt: new Date(),
            lastHeartbeatAt: new Date(),
          })
          .run()

        const trueRow = db
          .select()
          .from(liveStatus)
          .where(eq(liveStatus.channelId, 'ch-prompt-true'))
          .get()!
        expect(trueRow.prompting).toBe(true)
        expect(typeof trueRow.prompting).toBe('boolean')

        const falseRow = db
          .select()
          .from(liveStatus)
          .where(eq(liveStatus.channelId, 'ch-prompt-false'))
          .get()!
        expect(falseRow.prompting).toBe(false)
        expect(typeof falseRow.prompting).toBe('boolean')
      } finally {
        close()
      }
    })

    it('bot-global event (null session_id + null channel_id) is valid', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const ev = seedEvent(db, gen.id, {
          type: 'bot_restart',
          sessionId: null,
          channelId: null,
        })
        expect(ev.sessionId).toBeNull()
        expect(ev.channelId).toBeNull()
        expect(ev.type).toBe('bot_restart')
      } finally {
        close()
      }
    })
  })

  describe('CHECK constraints', () => {
    it('events.type out-of-domain is rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        expect(() =>
          db
            .insert(events)
            .values({
              generationId: gen.id,
              sessionId: null,
              channelId: null,
              type: 'not_a_real_event' as never,
              level: 'info',
              context: {},
              createdAt: new Date(),
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('events.level out-of-domain is rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        expect(() =>
          db
            .insert(events)
            .values({
              generationId: gen.id,
              sessionId: null,
              channelId: null,
              type: 'bot_restart',
              level: 'critical' as never,
              context: {},
              createdAt: new Date(),
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('live_status.prompting value of 2 is rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const sqlite = raw(db)
        expect(() =>
          sqlite
            .prepare(
              `INSERT INTO live_status (channel_id, generation_id, prompting, queue_depth, last_activity_at, last_heartbeat_at) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run('ch-bad', gen.id, 2, 0, Date.now(), Date.now()),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('live_status.queue_depth < 0 is rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        expect(() =>
          db
            .insert(liveStatus)
            .values({
              channelId: 'ch-neg',
              generationId: gen.id,
              triggeringUserId: null,
              prompting: false,
              queueDepth: -1,
              lastActivityAt: new Date(),
              lastHeartbeatAt: new Date(),
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })
  })

  describe('FK constraints', () => {
    it('event with non-existent generation_id is rejected', () => {
      const { db, close } = createTestDb()
      try {
        expect(() =>
          db
            .insert(events)
            .values({
              generationId: 999_999,
              sessionId: null,
              channelId: null,
              type: 'bot_restart',
              level: 'info',
              context: {},
              createdAt: new Date(),
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('live_status with non-existent generation_id is rejected', () => {
      const { db, close } = createTestDb()
      try {
        expect(() =>
          db
            .insert(liveStatus)
            .values({
              channelId: 'ch-fk',
              generationId: 999_999,
              triggeringUserId: null,
              prompting: false,
              queueDepth: 0,
              lastActivityAt: new Date(),
              lastHeartbeatAt: new Date(),
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })
  })

  describe('SET NULL / RESTRICT', () => {
    it('deleting a session nulls events.session_id while the event survives with channel_id', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        const ev = seedEvent(db, gen.id, {
          sessionId: session.id,
          channelId: 'ch-001',
          type: 'session_created',
        })

        db.delete(sessions).where(eq(sessions.id, session.id)).run()

        const row = db.select().from(events).where(eq(events.id, ev.id)).get()!
        expect(row.sessionId).toBeNull() // SET NULL applied
        expect(row.channelId).toBe('ch-001') // channel_id retained
        expect(row.type).toBe('session_created')
      } finally {
        close()
      }
    })

    it('deleting a bot_generation with events is rejected (RESTRICT)', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        seedEvent(db, gen.id, { type: 'bot_restart' })
        expect(() =>
          db.delete(botGeneration).where(eq(botGeneration.id, gen.id)).run(),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('deleting a bot_generation with live_status is rejected (RESTRICT)', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        seedLiveStatus(db, gen.id)
        expect(() =>
          db.delete(botGeneration).where(eq(botGeneration.id, gen.id)).run(),
        ).toThrow()
      } finally {
        close()
      }
    })
  })

  describe('integration', () => {
    it('live_status upsert resolves to one row on conflict (channel_id PK)', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        seedLiveStatus(db, gen.id)

        // Second insert on same channel_id with ON CONFLICT DO UPDATE
        db.insert(liveStatus)
          .values({
            channelId: 'ch-001',
            generationId: gen.id,
            triggeringUserId: 'u-222',
            prompting: true,
            queueDepth: 2,
            lastActivityAt: new Date(),
            lastHeartbeatAt: new Date(),
          })
          .onConflictDoUpdate({
            target: liveStatus.channelId,
            set: { queueDepth: 2, prompting: true, triggeringUserId: 'u-222' },
          })
          .run()

        const all = db.select().from(liveStatus).all()
        expect(all).toHaveLength(1) // still one row
        expect(all[0]!.queueDepth).toBe(2)
        expect(all[0]!.prompting).toBe(true)
      } finally {
        close()
      }
    })

    it('generation-guarded clear: stale rows affected, live rows safe', () => {
      const { db, close } = createTestDb()
      try {
        const gen1 = insertGeneration(db, { startedAt: new Date() })
        const gen2 = insertGeneration(db, { startedAt: new Date() })

        // Live channel on gen2
        db.insert(liveStatus)
          .values({
            channelId: 'ch-live',
            generationId: gen2.id,
            triggeringUserId: null,
            prompting: false,
            queueDepth: 0,
            lastActivityAt: new Date(),
            lastHeartbeatAt: new Date(),
          })
          .run()

        // Stale channel still on gen1
        db.insert(liveStatus)
          .values({
            channelId: 'ch-stale',
            generationId: gen1.id,
            triggeringUserId: null,
            prompting: false,
            queueDepth: 0,
            lastActivityAt: new Date(),
            lastHeartbeatAt: new Date(),
          })
          .run()

        // Generation-guarded clear: WHERE generation_id < gen2 → stale row deleted
        const cleared = db
          .delete(liveStatus)
          .where(sql`${liveStatus.generationId} < ${gen2.id}`)
          .run()
        expect(cleared.changes).toBe(1) // only ch-stale was cleared

        const remaining = db.select().from(liveStatus).all()
        expect(remaining).toHaveLength(1)
        expect(remaining[0]!.channelId).toBe('ch-live')

        // Running the clear again affects 0 rows (ch-live is gen2)
        const clearAgain = db
          .delete(liveStatus)
          .where(sql`${liveStatus.generationId} < ${gen2.id}`)
          .run()
        expect(clearAgain.changes).toBe(0)
      } finally {
        close()
      }
    })

    it('two-writer sanity: migrate:false connection sees events/live_status', () => {
      const tmpPath = path.join(
        os.tmpdir(),
        `tdr-code-two-writer-${Date.now()}.db`,
      )
      let sqlite1: RawSqlite | null = null
      let sqlite2: RawSqlite | null = null
      try {
        // Connection 1 (main server): migrates
        sqlite1 = new BetterSqlite3(tmpPath)
        sqlite1.pragma('journal_mode = WAL')
        sqlite1.pragma('synchronous = NORMAL')
        sqlite1.pragma('foreign_keys = ON')
        sqlite1.pragma('busy_timeout = 5000')
        const db1 = drizzle(sqlite1, { schema })
        migrate(db1, { migrationsFolder: resolveMigrationsFolder() })
        sqlite1.pragma('foreign_keys = ON')

        // Connection 2 (bot): no migration
        sqlite2 = new BetterSqlite3(tmpPath)
        sqlite2.pragma('foreign_keys = ON')
        const db2 = drizzle(sqlite2, { schema })

        // Both tables visible from connection 2
        expect(db2.select().from(events).all()).toHaveLength(0)
        expect(db2.select().from(liveStatus).all()).toHaveLength(0)
      } finally {
        sqlite1?.close()
        sqlite2?.close()
        for (const ext of ['', '-wal', '-shm']) {
          const p = tmpPath + ext
          if (fs.existsSync(p)) fs.unlinkSync(p)
        }
      }
    })
  })

  describe('verification', () => {
    it('migration journal has advanced to idx 2', () => {
      const journalPath = path.join(
        resolveMigrationsFolder(),
        'meta',
        '_journal.json',
      )
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
        entries: Array<{ idx: number; tag: string }>
      }
      expect(journal.entries.find(e => e.idx === 2)).toBeTruthy()
    })
  })
})
