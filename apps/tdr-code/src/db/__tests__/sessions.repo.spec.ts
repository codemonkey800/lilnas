import { insertGeneration } from 'src/db/bot-generation.repo'
import {
  clearAcpSessionId,
  closeSession,
  getActiveSession,
  getLatestSessionForChannel,
  getSessionById,
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

  describe('getLatestSessionForChannel', () => {
    it('returns the newest row even when its endedAt is set (no endedAt filter)', () => {
      const { db, close } = createTestDb()
      try {
        const gen = seed(db)
        const row = insertSession(db, {
          channelId: 'ch-dormant',
          generationId: gen.id,
          triggeringUserId: 'u1',
          acpSessionId: 'acp-dormant',
          cwd: '/cwd',
          createdAt: new Date(),
        })
        closeSession(db, {
          id: row.id,
          endedAt: new Date(),
          endReason: 'teardown',
        })

        const latest = getLatestSessionForChannel(db, 'ch-dormant')
        expect(latest?.id).toBe(row.id)
        expect(latest?.endedAt).not.toBeNull()
        expect(latest?.acpSessionId).toBe('acp-dormant')
      } finally {
        close()
      }
    })

    it('returns the row with the greatest createdAt/id among two closed rows + one open row', () => {
      const { db, close } = createTestDb()
      try {
        const gen = seed(db)
        const oldest = insertSession(db, {
          channelId: 'ch-multi',
          generationId: gen.id,
          triggeringUserId: 'u1',
          acpSessionId: 'acp-1',
          cwd: '/cwd',
          createdAt: new Date(Date.now() - 20_000),
        })
        closeSession(db, {
          id: oldest.id,
          endedAt: new Date(),
          endReason: 'evicted',
        })
        const middle = insertSession(db, {
          channelId: 'ch-multi',
          generationId: gen.id,
          triggeringUserId: 'u1',
          acpSessionId: 'acp-2',
          cwd: '/cwd',
          createdAt: new Date(Date.now() - 10_000),
        })
        closeSession(db, {
          id: middle.id,
          endedAt: new Date(),
          endReason: 'evicted',
        })
        const newest = insertSession(db, {
          channelId: 'ch-multi',
          generationId: gen.id,
          triggeringUserId: 'u1',
          acpSessionId: 'acp-3',
          cwd: '/cwd',
          createdAt: new Date(),
        })

        const latest = getLatestSessionForChannel(db, 'ch-multi')
        expect(latest?.id).toBe(newest.id)
        expect(latest?.endedAt).toBeNull()
      } finally {
        close()
      }
    })

    it('returns undefined when no session row exists for the channel', () => {
      const { db, close } = createTestDb()
      try {
        expect(getLatestSessionForChannel(db, 'ch-nonexistent')).toBeUndefined()
      } finally {
        close()
      }
    })
  })

  describe('clearAcpSessionId', () => {
    it('nulls acp_session_id on the channel latest row (visible via getLatestSessionForChannel)', () => {
      const { db, close } = createTestDb()
      try {
        const gen = seed(db)
        insertSession(db, {
          channelId: 'ch-live',
          generationId: gen.id,
          triggeringUserId: 'u1',
          acpSessionId: 'acp-live',
          cwd: '/cwd',
          createdAt: new Date(),
        })

        const changes = clearAcpSessionId(db, 'ch-live')

        expect(changes).toBe(1)
        const latest = getLatestSessionForChannel(db, 'ch-live')
        expect(latest?.acpSessionId).toBeNull()
      } finally {
        close()
      }
    })

    it('nulls acpSessionId on a dormant (ended) latest row', () => {
      const { db, close } = createTestDb()
      try {
        const gen = seed(db)
        const row = insertSession(db, {
          channelId: 'ch-dormant-clear',
          generationId: gen.id,
          triggeringUserId: 'u1',
          acpSessionId: 'acp-dormant-clear',
          cwd: '/cwd',
          createdAt: new Date(),
        })
        closeSession(db, {
          id: row.id,
          endedAt: new Date(),
          endReason: 'teardown',
        })

        const changes = clearAcpSessionId(db, 'ch-dormant-clear')

        expect(changes).toBe(1)
        const latest = getLatestSessionForChannel(db, 'ch-dormant-clear')
        expect(latest?.acpSessionId).toBeNull()
        expect(latest?.endedAt).not.toBeNull()
      } finally {
        close()
      }
    })

    it('is a no-op (0 changes, no throw) when the channel has no session row', () => {
      const { db, close } = createTestDb()
      try {
        let changes = -1
        expect(() => {
          changes = clearAcpSessionId(db, 'ch-never-existed')
        }).not.toThrow()
        expect(changes).toBe(0)
      } finally {
        close()
      }
    })

    it('only nulls the latest row for the target channel, leaving other channels untouched', () => {
      const { db, close } = createTestDb()
      try {
        const gen = seed(db)
        const older = insertSession(db, {
          channelId: 'ch-a',
          generationId: gen.id,
          triggeringUserId: 'u1',
          acpSessionId: 'acp-a-old',
          cwd: '/cwd',
          createdAt: new Date(Date.now() - 10_000),
        })
        closeSession(db, {
          id: older.id,
          endedAt: new Date(),
          endReason: 'evicted',
        })
        const newer = insertSession(db, {
          channelId: 'ch-a',
          generationId: gen.id,
          triggeringUserId: 'u1',
          acpSessionId: 'acp-a-new',
          cwd: '/cwd',
          createdAt: new Date(),
        })
        const other = insertSession(db, {
          channelId: 'ch-b',
          generationId: gen.id,
          triggeringUserId: 'u1',
          acpSessionId: 'acp-b',
          cwd: '/cwd',
          createdAt: new Date(),
        })

        const changes = clearAcpSessionId(db, 'ch-a')

        expect(changes).toBe(1)
        // Only the latest ch-a row (newer) is nulled — the older closed row
        // for ch-a keeps its acpSessionId, and channel ch-b is untouched.
        const latestA = getLatestSessionForChannel(db, 'ch-a')
        expect(latestA?.id).toBe(newer.id)
        expect(latestA?.acpSessionId).toBeNull()

        const olderRow = getSessionById(db, older.id)
        expect(olderRow?.acpSessionId).toBe('acp-a-old')

        const latestB = getLatestSessionForChannel(db, 'ch-b')
        expect(latestB?.id).toBe(other.id)
        expect(latestB?.acpSessionId).toBe('acp-b')
      } finally {
        close()
      }
    })
  })
})
