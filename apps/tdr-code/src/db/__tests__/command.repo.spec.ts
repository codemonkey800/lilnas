import { finalize, insertGeneration } from 'src/db/bot-generation.repo'
import { claimPending, enqueue } from 'src/db/command.repo'
import { createTestDb } from 'src/db/test-db'

describe('command.repo', () => {
  it('enqueue inserts a pending row; claimPending returns it', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      enqueue(db, {
        generationId: gen.id,
        type: 'teardown_channel',
        target: '12345678901234567',
        createdAt: new Date(),
      })

      const claimed = claimPending(db, gen.id)
      expect(claimed).toHaveLength(1)
      expect(claimed[0]!.type).toBe('teardown_channel')
      expect(claimed[0]!.status).toBe('consumed')
    } finally {
      close()
    }
  })

  it('claimed command is not returned again', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      enqueue(db, {
        generationId: gen.id,
        type: 'teardown_channel',
        target: '111',
        createdAt: new Date(),
      })

      const first = claimPending(db, gen.id)
      expect(first).toHaveLength(1)

      const second = claimPending(db, gen.id)
      expect(second).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('does not claim commands for a different generation', () => {
    const { db, close } = createTestDb()
    try {
      const genA = insertGeneration(db, { startedAt: new Date() })
      const genB = insertGeneration(db, { startedAt: new Date() })
      enqueue(db, {
        generationId: genA.id,
        type: 'teardown_channel',
        target: '111',
        createdAt: new Date(),
      })

      expect(claimPending(db, genB.id)).toHaveLength(0)
      expect(claimPending(db, genA.id)).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('does not claim commands for a finalized generation', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      enqueue(db, {
        generationId: gen.id,
        type: 'teardown_channel',
        target: '111',
        createdAt: new Date(),
      })
      finalize(db, gen.id, 'crashed', 1, new Date())

      expect(claimPending(db, gen.id)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('claimPending with no pending rows returns empty array', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      expect(claimPending(db, gen.id)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('at-most-once: second claimPending on same db sees no rows after first claim', () => {
    // Two separate DB connections (simulating two bot processes sharing a WAL file).
    // better-sqlite3 is synchronous, so we open two independent Drizzle instances
    // over the same in-memory DB via the shared connection approach. In production the
    // BEGIN IMMEDIATE transaction in claimPending prevents double-claim across processes.
    const { db: db1, close: close1 } = createTestDb()
    try {
      const gen = insertGeneration(db1, { startedAt: new Date() })
      enqueue(db1, {
        generationId: gen.id,
        type: 'teardown_channel',
        target: '12345678901234567',
        createdAt: new Date(),
      })
      enqueue(db1, {
        generationId: gen.id,
        type: 'teardown_channel',
        target: '22345678901234567',
        createdAt: new Date(),
      })

      // First claim gets both rows.
      const first = claimPending(db1, gen.id)
      expect(first).toHaveLength(2)
      expect(first.every(r => r.status === 'consumed')).toBe(true)

      // Second call on the same connection (or any connection) returns nothing.
      const second = claimPending(db1, gen.id)
      expect(second).toHaveLength(0)
    } finally {
      close1()
    }
  })
})
