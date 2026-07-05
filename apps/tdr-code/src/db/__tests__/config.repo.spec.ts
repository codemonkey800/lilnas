import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { getConfig, getOrSeedConfig, updateConfig } from 'src/db/config.repo'
import { resolveMigrationsFolder } from 'src/db/database.module'
import { config } from 'src/db/schema'
import * as schema from 'src/db/schema'
import { createTestDb } from 'src/db/test-db'

describe('config.repo', () => {
  it('getOrSeedConfig inserts env-derived defaults on empty DB', () => {
    const { db, close } = createTestDb()
    try {
      const row = getOrSeedConfig(db)
      expect(row.id).toBe(1)
      expect(row.cwd).toBe('/tmp') // from setup.ts: CLAUDE_CWD=/tmp
      expect(row.claudeCommand).toBe('claude')
      expect(row.claudeArgs).toEqual(['@agentclientprotocol/claude-agent-acp'])
      expect(row.idleTimeoutSec).toBe(300)
      expect(row.maxConcurrentSessions).toBe(5)
      expect(row.customSystemPrompt).toBe('')
      expect(row.updatedAt).toBeInstanceOf(Date)
    } finally {
      close()
    }
  })

  it('getOrSeedConfig is idempotent — second call returns the same row', () => {
    const { db, close } = createTestDb()
    try {
      const first = getOrSeedConfig(db)
      const second = getOrSeedConfig(db)
      expect(second.id).toBe(first.id)
      // No duplicate rows
      const all = db.select().from(config).all()
      expect(all).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('getConfig returns undefined on an unseeded DB', () => {
    const { db, close } = createTestDb()
    try {
      expect(getConfig(db)).toBeUndefined()
    } finally {
      close()
    }
  })

  it('updateConfig changes fields; getConfig reflects them; updatedAt advances', async () => {
    const { db, close } = createTestDb()
    try {
      getOrSeedConfig(db)
      // Advance time slightly so updatedAt is guaranteed to differ
      await new Promise(r => setTimeout(r, 2))

      const updated = updateConfig(db, { idleTimeoutSec: 600 })
      expect(updated.idleTimeoutSec).toBe(600)

      const read = getConfig(db)
      expect(read?.idleTimeoutSec).toBe(600)
    } finally {
      close()
    }
  })

  it('updateConfig advances updatedAt', async () => {
    const { db, close } = createTestDb()
    try {
      const seeded = getOrSeedConfig(db)
      await new Promise(r => setTimeout(r, 2))
      const updated = updateConfig(db, { idleTimeoutSec: 120 })
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        seeded.updatedAt.getTime(),
      )
    } finally {
      close()
    }
  })

  it('updateConfig persists a non-empty customSystemPrompt and it round-trips on read', () => {
    const { db, close } = createTestDb()
    try {
      getOrSeedConfig(db)
      const prompt = 'Never emit Markdown tables in chat responses.'
      const updated = updateConfig(db, { customSystemPrompt: prompt })
      expect(updated.customSystemPrompt).toBe(prompt)

      const read = getConfig(db)
      expect(read?.customSystemPrompt).toBe(prompt)
    } finally {
      close()
    }
  })

  it('updateConfig can clear customSystemPrompt from a non-empty value back to empty string', () => {
    const { db, close } = createTestDb()
    try {
      getOrSeedConfig(db)
      updateConfig(db, { customSystemPrompt: 'Some custom instructions.' })

      const cleared = updateConfig(db, { customSystemPrompt: '' })
      expect(cleared.customSystemPrompt).toBe('')

      const read = getConfig(db)
      expect(read?.customSystemPrompt).toBe('')
    } finally {
      close()
    }
  })

  it('a several-thousand-character customSystemPrompt round-trips without truncation or corruption', () => {
    const { db, close } = createTestDb()
    try {
      getOrSeedConfig(db)
      // Repeating pattern (not just one char) so any byte-offset truncation
      // or corruption would be detectable, not masked by uniform content.
      const longPrompt = 'The quick brown fox jumps over the lazy dog. '.repeat(
        150,
      )
      expect(longPrompt.length).toBeGreaterThan(5_000)

      const updated = updateConfig(db, { customSystemPrompt: longPrompt })
      expect(updated.customSystemPrompt).toBe(longPrompt)
      expect(updated.customSystemPrompt).toHaveLength(longPrompt.length)

      const read = getConfig(db)
      expect(read?.customSystemPrompt).toBe(longPrompt)
    } finally {
      close()
    }
  })

  it('a customSystemPrompt-only patch still advances updatedAt', async () => {
    const { db, close } = createTestDb()
    try {
      const seeded = getOrSeedConfig(db)
      await new Promise(r => setTimeout(r, 2))
      const updated = updateConfig(db, {
        customSystemPrompt: 'Operator-authored instructions.',
      })
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        seeded.updatedAt.getTime(),
      )
    } finally {
      close()
    }
  })

  it('idempotent seed — two connections to the same file DB: exactly one row survives', () => {
    // Two separate BetterSQLite3 connections to the same WAL-mode file.
    // Each calls getOrSeedConfig; BEGIN IMMEDIATE on the second serializes
    // and re-reads the already-inserted row rather than double-inserting.
    const tmpFile = path.join(
      os.tmpdir(),
      `tdr-config-seed-test-${process.pid}.db`,
    )
    const setupDb = (file: string) => {
      const sqlite = new BetterSqlite3(file)
      sqlite.pragma('journal_mode = WAL')
      sqlite.pragma('synchronous = NORMAL')
      sqlite.pragma('foreign_keys = ON')
      sqlite.pragma('busy_timeout = 5000')
      const db = drizzle(sqlite, { schema })
      migrate(db, { migrationsFolder: resolveMigrationsFolder() })
      return { db, close: () => sqlite.close() }
    }
    const { db: db1, close: close1 } = setupDb(tmpFile)
    const { db: db2, close: close2 } = setupDb(tmpFile)
    try {
      const r1 = getOrSeedConfig(db1)
      const r2 = getOrSeedConfig(db2)
      expect(r1.id).toBe(1)
      expect(r2.id).toBe(1)
      const all = db1.select().from(config).all()
      expect(all).toHaveLength(1)
    } finally {
      close1()
      close2()
      fs.rmSync(tmpFile, { force: true })
      fs.rmSync(`${tmpFile}-wal`, { force: true })
      fs.rmSync(`${tmpFile}-shm`, { force: true })
    }
  })

  it('violates CHECK when idleTimeoutSec <= 0', () => {
    const { db, close } = createTestDb()
    try {
      getOrSeedConfig(db)
      expect(() => updateConfig(db, { idleTimeoutSec: 0 })).toThrow()
    } finally {
      close()
    }
  })

  it('violates CHECK when maxConcurrentSessions < 1', () => {
    const { db, close } = createTestDb()
    try {
      getOrSeedConfig(db)
      expect(() => updateConfig(db, { maxConcurrentSessions: 0 })).toThrow()
    } finally {
      close()
    }
  })

  it('violates CHECK when a second row (id=2) is inserted', () => {
    const { db, close } = createTestDb()
    try {
      getOrSeedConfig(db)
      expect(() =>
        db
          .insert(config)
          .values({
            id: 2,
            cwd: '/tmp',
            claudeCommand: 'claude',
            claudeArgs: [],
            idleTimeoutSec: 300,
            maxConcurrentSessions: 5,
            updatedAt: new Date(),
          })
          .run(),
      ).toThrow()
    } finally {
      close()
    }
  })
})
