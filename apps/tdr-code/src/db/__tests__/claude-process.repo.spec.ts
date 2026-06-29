import { insertGeneration } from 'src/db/bot-generation.repo'
import { livePgids, markExited, recordSpawn } from 'src/db/claude-process.repo'
import { createTestDb } from 'src/db/test-db'

describe('claude-process.repo', () => {
  it('recordSpawn inserts a live row; livePgids returns it', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      recordSpawn(db, {
        generationId: gen.id,
        pgid: 42,
        channelId: 'ch1',
        spawnedAt: new Date(),
      })
      const live = livePgids(db, gen.id)
      expect(live).toHaveLength(1)
      expect(live[0]!.pgid).toBe(42)
    } finally {
      close()
    }
  })

  it('markExited removes row from livePgids', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      recordSpawn(db, {
        generationId: gen.id,
        pgid: 42,
        channelId: null,
        spawnedAt: new Date(),
      })
      markExited(db, { pgid: 42, generationId: gen.id, exitedAt: new Date() })
      expect(livePgids(db, gen.id)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('two concurrent spawns both persist (no lost INSERT)', () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      recordSpawn(db, {
        generationId: gen.id,
        pgid: 1,
        channelId: null,
        spawnedAt: new Date(),
      })
      recordSpawn(db, {
        generationId: gen.id,
        pgid: 2,
        channelId: null,
        spawnedAt: new Date(),
      })
      expect(livePgids(db, gen.id)).toHaveLength(2)
    } finally {
      close()
    }
  })

  it('livePgids for different generations are isolated', () => {
    const { db, close } = createTestDb()
    try {
      const genA = insertGeneration(db, { startedAt: new Date() })
      const genB = insertGeneration(db, { startedAt: new Date() })
      recordSpawn(db, {
        generationId: genA.id,
        pgid: 10,
        channelId: null,
        spawnedAt: new Date(),
      })
      recordSpawn(db, {
        generationId: genB.id,
        pgid: 20,
        channelId: null,
        spawnedAt: new Date(),
      })

      expect(livePgids(db, genA.id).map(r => r.pgid)).toEqual([10])
      expect(livePgids(db, genB.id).map(r => r.pgid)).toEqual([20])
    } finally {
      close()
    }
  })

  it('FK constraint prevents recording for non-existent generation', () => {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        recordSpawn(db, {
          generationId: 99999,
          pgid: 1,
          channelId: null,
          spawnedAt: new Date(),
        }),
      ).toThrow()
    } finally {
      close()
    }
  })
})
