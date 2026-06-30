import { insertGeneration } from 'src/db/bot-generation.repo'
import {
  closeSession,
  getActiveSession,
  insertSession,
} from 'src/db/sessions.repo'
import { createTestDb } from 'src/db/test-db'

function seed(db: ReturnType<typeof createTestDb>['db']) {
  return insertGeneration(db, { startedAt: new Date() })
}

describe('sessions.repo', () => {
  it('insertSession creates an open row with correct fields', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seed(db)
      const row = insertSession(db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: 'acp-session-1',
        cwd: '/home/tdr',
        createdAt: new Date(),
      })
      expect(row.channelId).toBe('ch1')
      expect(row.generationId).toBe(gen.id)
      expect(row.triggeringUserId).toBe('u1')
      expect(row.acpSessionId).toBe('acp-session-1')
      expect(row.cwd).toBe('/home/tdr')
      expect(row.endedAt).toBeNull()
      expect(row.endReason).toBeNull()
    } finally {
      close()
    }
  })

  it('closeSession closes the row and returns 1 change', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seed(db)
      const row = insertSession(db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(),
      })
      const changes = closeSession(db, {
        id: row.id,
        endedAt: new Date(),
        endReason: 'teardown',
      })
      expect(changes).toBe(1)
      const active = getActiveSession(db, 'ch1')
      expect(active).toBeUndefined()
    } finally {
      close()
    }
  })

  it('closeSession is idempotent — double-close returns 0 on second call', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seed(db)
      const row = insertSession(db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(),
      })
      closeSession(db, {
        id: row.id,
        endedAt: new Date(),
        endReason: 'evicted',
      })
      const second = closeSession(db, {
        id: row.id,
        endedAt: new Date(),
        endReason: 'teardown',
      })
      expect(second).toBe(0)
    } finally {
      close()
    }
  })

  it('insertSession stores acpSessionId and cwd (R8 linkage columns)', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seed(db)
      const row = insertSession(db, {
        channelId: 'ch-linkage',
        generationId: gen.id,
        triggeringUserId: 'u2',
        acpSessionId: 'acp-123',
        cwd: '/code',
        createdAt: new Date(),
      })
      const active = getActiveSession(db, 'ch-linkage')
      expect(active?.acpSessionId).toBe('acp-123')
      expect(active?.cwd).toBe('/code')
      expect(active?.id).toBe(row.id)
    } finally {
      close()
    }
  })

  it('getActiveSession returns the newest open row when multiple exist', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seed(db)
      // Simulate a crash residue: two open rows for same channel.
      const older = insertSession(db, {
        channelId: 'ch-crash',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(Date.now() - 10_000),
      })
      const newer = insertSession(db, {
        channelId: 'ch-crash',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(),
      })
      const active = getActiveSession(db, 'ch-crash')
      expect(active?.id).toBe(newer.id)
      expect(active?.id).not.toBe(older.id)
    } finally {
      close()
    }
  })

  it('rejects insertSession with a non-existent generationId (FK violation)', () => {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        insertSession(db, {
          channelId: 'ch1',
          generationId: 9999,
          triggeringUserId: 'u1',
          acpSessionId: null,
          cwd: '/cwd',
          createdAt: new Date(),
        }),
      ).toThrow()
    } finally {
      close()
    }
  })
})
