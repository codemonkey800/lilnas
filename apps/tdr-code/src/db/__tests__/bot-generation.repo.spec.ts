import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import {
  finalize,
  generationById,
  insertGeneration,
  latestGeneration,
  liveGenerations,
  markRunning,
  markStopping,
} from 'src/db/bot-generation.repo'
import * as schema from 'src/db/schema'
import { createTestDb } from 'src/db/test-db'

describe('bot-generation.repo', () => {
  it('insertGeneration creates a starting row', () => {
    const { db, close } = createTestDb()
    try {
      const now = new Date()
      const row = insertGeneration(db, { startedAt: now })
      expect(row.status).toBe('starting')
      expect(row.pid).toBeNull()
      expect(row.endedAt).toBeNull()
    } finally {
      close()
    }
  })

  it('markRunning sets pid and lastHeartbeatAt', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const changes = markRunning(db, gen.id, 9999, new Date())
      expect(changes).toBe(1)
      const row = generationById(db, gen.id)!
      expect(row.status).toBe('running')
      expect(row.pid).toBe(9999)
    } finally {
      close()
    }
  })

  it('markStopping transitions from any non-ended status', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      markRunning(db, gen.id, 100, new Date())
      const changes = markStopping(db, gen.id)
      expect(changes).toBe(1)
      expect(generationById(db, gen.id)!.status).toBe('stopping')
    } finally {
      close()
    }
  })

  it('markStopping on ended row returns 0', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      finalize(db, gen.id, 'crashed', 1, new Date())
      expect(markStopping(db, gen.id)).toBe(0)
    } finally {
      close()
    }
  })

  it('latestGeneration returns the highest-id row', () => {
    const { db, close } = createTestDb()
    try {
      const a = insertGeneration(db, { startedAt: new Date() })
      const b = insertGeneration(db, { startedAt: new Date() })
      expect(latestGeneration(db)!.id).toBe(b.id)
      expect(b.id).toBeGreaterThan(a.id)
    } finally {
      close()
    }
  })

  it('latestGeneration returns undefined with no rows', () => {
    const { db, close } = createTestDb()
    try {
      expect(latestGeneration(db)).toBeUndefined()
    } finally {
      close()
    }
  })

  it('liveGenerations excludes ended rows', () => {
    const { db, close } = createTestDb()
    try {
      const a = insertGeneration(db, { startedAt: new Date() })
      const b = insertGeneration(db, { startedAt: new Date() })
      finalize(db, a.id, 'crashed', 1, new Date())

      const live = liveGenerations(db)
      expect(live.map(r => r.id)).toEqual([b.id])
    } finally {
      close()
    }
  })

  it('two-writer sanity: migrate:true connection sees tables from migrate:false connection', () => {
    const migrationsFolder = path.resolve(process.cwd(), 'src/db/migrations')
    const tmpFile = path.join(os.tmpdir(), `tdr-code-test-${Date.now()}.db`)
    try {
      // Writer connection (migrates)
      const writerSqlite = new BetterSqlite3(tmpFile)
      writerSqlite.pragma('journal_mode = WAL')
      writerSqlite.pragma('foreign_keys = ON')
      writerSqlite.pragma('busy_timeout = 5000')
      const writerDb = drizzle(writerSqlite, { schema })
      migrate(writerDb, { migrationsFolder })
      writerSqlite.pragma('foreign_keys = ON')

      const row = insertGeneration(writerDb, { startedAt: new Date() })

      // Reader connection (no migrate)
      const readerSqlite = new BetterSqlite3(tmpFile)
      readerSqlite.pragma('journal_mode = WAL')
      readerSqlite.pragma('foreign_keys = ON')
      readerSqlite.pragma('busy_timeout = 5000')
      const readerDb = drizzle(readerSqlite, { schema })

      const found = generationById(readerDb, row.id)
      expect(found?.id).toBe(row.id)

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
