import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { insertGeneration } from 'src/db/bot-generation.repo'
import { resolveMigrationsFolder } from 'src/db/database.module'
import {
  allLiveStatus,
  clearStaleByGeneration,
  heartbeatLiveStatus,
  removeLiveStatus,
  upsertLiveStatus,
} from 'src/db/live-status.repo'
import * as schema from 'src/db/schema'
import { createTestDb } from 'src/db/test-db'

describe('live-status.repo', () => {
  it('upsertLiveStatus creates a row for a new channel', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      upsertLiveStatus(db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        prompting: true,
        queueDepth: 0,
        lastActivityAt: new Date(),
        lastHeartbeatAt: new Date(),
      })
      const rows = allLiveStatus(db)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.channelId).toBe('ch1')
      expect(rows[0]!.prompting).toBe(true)
    } finally {
      close()
    }
  })

  it('upsertLiveStatus updates an existing row and re-stamps generation_id (Decision 8)', () => {
    const { db, close } = createTestDb()
    try {
      const gen1 = insertGeneration(db, { startedAt: new Date() })
      const gen2 = insertGeneration(db, { startedAt: new Date() })

      upsertLiveStatus(db, {
        channelId: 'ch1',
        generationId: gen1.id,
        triggeringUserId: 'u1',
        prompting: false,
        queueDepth: 0,
        lastActivityAt: new Date(),
        lastHeartbeatAt: new Date(),
      })
      // Upsert from gen2 (newer) should stamp gen2.
      upsertLiveStatus(db, {
        channelId: 'ch1',
        generationId: gen2.id,
        triggeringUserId: 'u2',
        prompting: true,
        queueDepth: 1,
        lastActivityAt: new Date(),
        lastHeartbeatAt: new Date(),
      })
      const rows = allLiveStatus(db)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.generationId).toBe(gen2.id)
      expect(rows[0]!.queueDepth).toBe(1)
    } finally {
      close()
    }
  })

  it('generation guard prevents a stale generation from overwriting a live row', () => {
    const { db, close } = createTestDb()
    try {
      const gen1 = insertGeneration(db, { startedAt: new Date() })
      const gen2 = insertGeneration(db, { startedAt: new Date() })

      // Write with gen2 (live).
      upsertLiveStatus(db, {
        channelId: 'ch1',
        generationId: gen2.id,
        triggeringUserId: 'live',
        prompting: false,
        queueDepth: 0,
        lastActivityAt: new Date(),
        lastHeartbeatAt: new Date(),
      })
      // Try to overwrite with gen1 (stale — gen1.id < gen2.id, so WHERE fails).
      upsertLiveStatus(db, {
        channelId: 'ch1',
        generationId: gen1.id,
        triggeringUserId: 'stale',
        prompting: true,
        queueDepth: 5,
        lastActivityAt: new Date(),
        lastHeartbeatAt: new Date(),
      })
      const rows = allLiveStatus(db)
      expect(rows[0]!.triggeringUserId).toBe('live')
      expect(rows[0]!.generationId).toBe(gen2.id)
    } finally {
      close()
    }
  })

  it('heartbeatLiveStatus advances last_heartbeat_at for live rows', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const t1 = new Date(Date.now() - 5000)
      upsertLiveStatus(db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: null,
        prompting: false,
        queueDepth: 0,
        lastActivityAt: t1,
        lastHeartbeatAt: t1,
      })
      const t2 = new Date()
      const changes = heartbeatLiveStatus(db, gen.id, t2)
      expect(changes).toBe(1)
      const rows = allLiveStatus(db)
      expect(rows[0]!.lastHeartbeatAt.getTime()).toBeCloseTo(t2.getTime(), -2)
    } finally {
      close()
    }
  })

  it('heartbeatLiveStatus returns 0 when no rows exist for the generation', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const changes = heartbeatLiveStatus(db, gen.id, new Date())
      expect(changes).toBe(0)
    } finally {
      close()
    }
  })

  it('removeLiveStatus deletes the row for a channel', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      upsertLiveStatus(db, {
        channelId: 'ch-remove',
        generationId: gen.id,
        triggeringUserId: null,
        prompting: false,
        queueDepth: 0,
        lastActivityAt: new Date(),
        lastHeartbeatAt: new Date(),
      })
      removeLiveStatus(db, 'ch-remove', gen.id)
      expect(allLiveStatus(db)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('removeLiveStatus with stale generationId does NOT delete a newer generation row', () => {
    const { db, close } = createTestDb()
    try {
      const gen1 = insertGeneration(db, { startedAt: new Date() })
      const gen2 = insertGeneration(db, { startedAt: new Date() })
      // Live row owned by gen2.
      upsertLiveStatus(db, {
        channelId: 'ch-guard',
        generationId: gen2.id,
        triggeringUserId: null,
        prompting: false,
        queueDepth: 0,
        lastActivityAt: new Date(),
        lastHeartbeatAt: new Date(),
      })
      // Old gen1 tries to remove the row — should be a no-op (gen2 > gen1).
      removeLiveStatus(db, 'ch-guard', gen1.id)
      expect(allLiveStatus(db)).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('clearStaleByGeneration removes rows from prior generations, leaves live rows', () => {
    const { db, close } = createTestDb()
    try {
      const gen1 = insertGeneration(db, { startedAt: new Date() })
      const gen2 = insertGeneration(db, { startedAt: new Date() })
      upsertLiveStatus(db, {
        channelId: 'stale',
        generationId: gen1.id,
        triggeringUserId: null,
        prompting: false,
        queueDepth: 0,
        lastActivityAt: new Date(),
        lastHeartbeatAt: new Date(),
      })
      upsertLiveStatus(db, {
        channelId: 'live',
        generationId: gen2.id,
        triggeringUserId: null,
        prompting: false,
        queueDepth: 0,
        lastActivityAt: new Date(),
        lastHeartbeatAt: new Date(),
      })
      const removed = clearStaleByGeneration(db, gen2.id)
      expect(removed).toBe(1)
      const rows = allLiveStatus(db)
      expect(rows.map(r => r.channelId)).toEqual(['live'])
    } finally {
      close()
    }
  })

  it('rejects upsertLiveStatus with queue_depth < 0 (CHECK violation)', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      expect(() =>
        upsertLiveStatus(db, {
          channelId: 'ch-bad',
          generationId: gen.id,
          triggeringUserId: null,
          prompting: false,
          queueDepth: -1,
          lastActivityAt: new Date(),
          lastHeartbeatAt: new Date(),
        }),
      ).toThrow()
    } finally {
      close()
    }
  })

  it('two-writer sanity: second connection observes upserts from first (WAL)', () => {
    const migrationsFolder = resolveMigrationsFolder()
    const tmpFile = path.join(os.tmpdir(), `live-status-test-${Date.now()}.db`)
    try {
      const writerSqlite = new BetterSqlite3(tmpFile)
      writerSqlite.pragma('journal_mode = WAL')
      writerSqlite.pragma('foreign_keys = ON')
      writerSqlite.pragma('busy_timeout = 5000')
      const writerDb = drizzle(writerSqlite, { schema })
      migrate(writerDb, { migrationsFolder })
      writerSqlite.pragma('foreign_keys = ON')

      const gen = insertGeneration(writerDb, { startedAt: new Date() })
      upsertLiveStatus(writerDb, {
        channelId: 'ch-wal',
        generationId: gen.id,
        triggeringUserId: null,
        prompting: true,
        queueDepth: 2,
        lastActivityAt: new Date(),
        lastHeartbeatAt: new Date(),
      })

      const readerSqlite = new BetterSqlite3(tmpFile)
      readerSqlite.pragma('journal_mode = WAL')
      readerSqlite.pragma('foreign_keys = ON')
      readerSqlite.pragma('busy_timeout = 5000')
      const readerDb = drizzle(readerSqlite, { schema })

      const rows = allLiveStatus(readerDb)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.channelId).toBe('ch-wal')

      writerSqlite.close()
      readerSqlite.close()
    } finally {
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        /* ok */
      }
      try {
        fs.unlinkSync(tmpFile + '-wal')
      } catch {
        /* ok */
      }
      try {
        fs.unlinkSync(tmpFile + '-shm')
      } catch {
        /* ok */
      }
    }
  })
})
