import BetterSqlite3 from 'better-sqlite3'

import {
  finalize,
  heartbeat,
  insertGeneration,
  markRunning,
} from 'src/db/bot-generation.repo'
import { livePgids, recordSpawn } from 'src/db/claude-process.repo'
import { enqueue } from 'src/db/command.repo'
import {
  botGeneration,
  isEndedGeneration,
  isRunningGeneration,
} from 'src/db/schema'
import { createTestDb } from 'src/db/test-db'

type WithSqliteClient = { $client: InstanceType<typeof BetterSqlite3> }

describe('schema + createTestDb', () => {
  it('applies migrations and foreign_keys is ON', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertGeneration(db, { startedAt: new Date() })
      expect(row.id).toBeGreaterThan(0)
      expect(row.status).toBe('starting')

      // FK test: inserting a command with a non-existent generation_id fails
      expect(() =>
        enqueue(db, {
          generationId: 999_999,
          type: 'teardown_channel',
          target: '123456789',
          createdAt: new Date(),
        }),
      ).toThrow()
    } finally {
      close()
    }
  })

  it('isRunningGeneration narrows correctly', () => {
    const { db, close } = createTestDb()
    try {
      const started = insertGeneration(db, { startedAt: new Date() })
      const now = new Date()
      markRunning(db, started.id, 1234, now)

      const rows = db.select().from(botGeneration).all()
      const row = rows[0]!
      expect(isRunningGeneration(row)).toBe(true)
      if (isRunningGeneration(row)) {
        expect(row.pid).toBe(1234)
        expect(row.lastHeartbeatAt).toEqual(now)
      }
    } finally {
      close()
    }
  })

  it('isEndedGeneration narrows correctly after finalize', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      finalize(db, gen.id, 'crashed', 1, new Date())
      const rows = db.select().from(botGeneration).all()
      const row = rows[0]!
      expect(isEndedGeneration(row)).toBe(true)
    } finally {
      close()
    }
  })

  it('CHECK constraint rejects invalid status', () => {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        db
          .insert(botGeneration)
          .values({
            startedAt: new Date(),
            status: 'invalid_status' as never,
          })
          .run(),
      ).toThrow()
    } finally {
      close()
    }
  })

  it('CASCADE deletes commands/claude_process when generation is deleted', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      enqueue(db, {
        generationId: gen.id,
        type: 'teardown_channel',
        target: '123',
        createdAt: new Date(),
      })
      recordSpawn(db, {
        generationId: gen.id,
        pgid: 42,
        channelId: null,
        spawnedAt: new Date(),
      })

      expect(livePgids(db, gen.id)).toHaveLength(1)

      const sqlite = (db as unknown as WithSqliteClient).$client
      sqlite.prepare('DELETE FROM bot_generation WHERE id = ?').run(gen.id)

      expect(livePgids(db, gen.id)).toHaveLength(0)
    } finally {
      close()
    }
  })
})

describe('write-once terminal latch', () => {
  it('heartbeat after finalize affects 0 rows', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      markRunning(db, gen.id, 1234, new Date())
      finalize(db, gen.id, 'stopped', 0, new Date())

      const changes = heartbeat(db, gen.id, new Date())
      expect(changes).toBe(0)

      const rows = db.select().from(botGeneration).all()
      expect(rows[0]!.status).toBe('stopped')
    } finally {
      close()
    }
  })

  it('finalize twice only applies once (write-once latch)', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      finalize(db, gen.id, 'crashed', 1, new Date())
      const changes = finalize(db, gen.id, 'stopped', 0, new Date())
      expect(changes).toBe(0)

      const rows = db.select().from(botGeneration).all()
      expect(rows[0]!.status).toBe('crashed')
    } finally {
      close()
    }
  })

  it('markRunning guard: status must be starting', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      finalize(db, gen.id, 'crashed', 1, new Date())
      const changes = markRunning(db, gen.id, 1234, new Date())
      expect(changes).toBe(0)
    } finally {
      close()
    }
  })
})
