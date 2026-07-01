import { getConfig, getOrSeedConfig, updateConfig } from 'src/db/config.repo'
import { config } from 'src/db/schema'
import { createTestDb } from 'src/db/test-db'

describe('config.repo', () => {
  it('getOrSeedConfig inserts env-derived defaults on empty DB', () => {
    const { db, close } = createTestDb()
    try {
      const row = getOrSeedConfig(db)
      expect(row.id).toBe(1)
      expect(row.cwd).toBe('/tmp') // from setup.ts: CLAUDE_CWD=/tmp
      expect(row.claudeCommand).toBe('claude')
      expect(row.claudeArgs).toEqual(['--dangerously-skip-permissions'])
      expect(row.idleTimeoutSec).toBe(300)
      expect(row.maxConcurrentSessions).toBe(5)
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

  it('idempotent seed under concurrent in-process callers — exactly one row', () => {
    // BEGIN IMMEDIATE serializes the two attempts; the second re-reads the
    // already-seeded row and returns it without inserting a duplicate
    // (atomicity-tests learning: contend at the real write window).
    const { db, close } = createTestDb()
    try {
      // Call in the same synchronous stack — both enter the transaction, the
      // second sees the row already present and returns it.
      const r1 = getOrSeedConfig(db)
      const r2 = getOrSeedConfig(db)
      expect(r1.id).toBe(1)
      expect(r2.id).toBe(1)
      const all = db.select().from(config).all()
      expect(all).toHaveLength(1)
    } finally {
      close()
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
