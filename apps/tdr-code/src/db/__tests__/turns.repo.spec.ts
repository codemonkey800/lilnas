import { insertGeneration } from 'src/db/bot-generation.repo'
import { insertSession } from 'src/db/sessions.repo'
import { createTestDb } from 'src/db/test-db'
import {
  closeTurn,
  findDanglingTurns,
  insertTurn,
  maxTurnIndex,
} from 'src/db/turns.repo'

function seedGen(db: ReturnType<typeof createTestDb>['db']) {
  return insertGeneration(db, { startedAt: new Date() })
}

function seedSession(
  db: ReturnType<typeof createTestDb>['db'],
  genId: number,
  channelId = 'ch1',
) {
  return insertSession(db, {
    channelId,
    generationId: genId,
    triggeringUserId: 'u1',
    acpSessionId: null,
    cwd: '/cwd',
    createdAt: new Date(),
  })
}

describe('turns.repo', () => {
  it('insertTurn creates a running turn with turn_index', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seedGen(db)
      const session = seedSession(db, gen.id)
      const turn = insertTurn(db, {
        sessionId: session.id,
        generationId: gen.id,
        turnIndex: 1,
        userId: 'u1',
        startedAt: new Date(),
      })
      expect(turn.status).toBe('running')
      expect(turn.turnIndex).toBe(1)
      expect(turn.endedAt).toBeNull()
      expect(turn.sessionId).toBe(session.id)
    } finally {
      close()
    }
  })

  it('closeTurn updates status and endedAt, returns 1 change', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seedGen(db)
      const session = seedSession(db, gen.id)
      const turn = insertTurn(db, {
        sessionId: session.id,
        generationId: gen.id,
        turnIndex: 1,
        userId: 'u1',
        startedAt: new Date(),
      })
      const changes = closeTurn(db, {
        id: turn.id,
        status: 'completed',
        endedAt: new Date(),
      })
      expect(changes).toBe(1)
    } finally {
      close()
    }
  })

  it('closeTurn is idempotent — double-close returns 0 on second call', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seedGen(db)
      const session = seedSession(db, gen.id)
      const turn = insertTurn(db, {
        sessionId: session.id,
        generationId: gen.id,
        turnIndex: 1,
        userId: null,
        startedAt: new Date(),
      })
      closeTurn(db, { id: turn.id, status: 'cancelled', endedAt: new Date() })
      expect(
        closeTurn(db, {
          id: turn.id,
          status: 'completed',
          endedAt: new Date(),
        }),
      ).toBe(0)
    } finally {
      close()
    }
  })

  it('two turns in same session get distinct turn_index values 1 and 2', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seedGen(db)
      const session = seedSession(db, gen.id)
      const t1 = insertTurn(db, {
        sessionId: session.id,
        generationId: gen.id,
        turnIndex: 1,
        userId: null,
        startedAt: new Date(),
      })
      const t2 = insertTurn(db, {
        sessionId: session.id,
        generationId: gen.id,
        turnIndex: 2,
        userId: null,
        startedAt: new Date(),
      })
      expect(t1.turnIndex).toBe(1)
      expect(t2.turnIndex).toBe(2)
    } finally {
      close()
    }
  })

  it('turn in a different session restarts at turn_index 1', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seedGen(db)
      const s1 = seedSession(db, gen.id, 'ch1')
      const s2 = seedSession(db, gen.id, 'ch2')
      insertTurn(db, {
        sessionId: s1.id,
        generationId: gen.id,
        turnIndex: 1,
        userId: null,
        startedAt: new Date(),
      })
      const t2 = insertTurn(db, {
        sessionId: s2.id,
        generationId: gen.id,
        turnIndex: 1,
        userId: null,
        startedAt: new Date(),
      })
      expect(t2.turnIndex).toBe(1)
    } finally {
      close()
    }
  })

  it('maxTurnIndex returns 0 for a session with no turns', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seedGen(db)
      const session = seedSession(db, gen.id)
      expect(maxTurnIndex(db, session.id)).toBe(0)
    } finally {
      close()
    }
  })

  it('maxTurnIndex returns the highest turn_index for restart re-seeding', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seedGen(db)
      const session = seedSession(db, gen.id)
      insertTurn(db, {
        sessionId: session.id,
        generationId: gen.id,
        turnIndex: 1,
        userId: null,
        startedAt: new Date(),
      })
      insertTurn(db, {
        sessionId: session.id,
        generationId: gen.id,
        turnIndex: 2,
        userId: null,
        startedAt: new Date(),
      })
      insertTurn(db, {
        sessionId: session.id,
        generationId: gen.id,
        turnIndex: 3,
        userId: null,
        startedAt: new Date(),
      })
      expect(maxTurnIndex(db, session.id)).toBe(3)
    } finally {
      close()
    }
  })

  it('findDanglingTurns returns open turns from prior generations', () => {
    const { db, close } = createTestDb()
    try {
      const gen1 = seedGen(db)
      const gen2 = seedGen(db)
      const session = seedSession(db, gen1.id)
      const dangling = insertTurn(db, {
        sessionId: session.id,
        generationId: gen1.id,
        turnIndex: 1,
        userId: null,
        startedAt: new Date(),
      })
      // A closed turn from gen1 should NOT appear.
      const closed = insertTurn(db, {
        sessionId: session.id,
        generationId: gen1.id,
        turnIndex: 2,
        userId: null,
        startedAt: new Date(),
      })
      closeTurn(db, { id: closed.id, status: 'completed', endedAt: new Date() })

      const danglers = findDanglingTurns(db, gen2.id)
      expect(danglers.map(t => t.id)).toContain(dangling.id)
      expect(danglers.map(t => t.id)).not.toContain(closed.id)
    } finally {
      close()
    }
  })

  it('rejects duplicate (session_id, turn_index) by UNIQUE constraint', () => {
    const { db, close } = createTestDb()
    try {
      const gen = seedGen(db)
      const session = seedSession(db, gen.id)
      insertTurn(db, {
        sessionId: session.id,
        generationId: gen.id,
        turnIndex: 1,
        userId: null,
        startedAt: new Date(),
      })
      expect(() =>
        insertTurn(db, {
          sessionId: session.id,
          generationId: gen.id,
          turnIndex: 1,
          userId: null,
          startedAt: new Date(),
        }),
      ).toThrow()
    } finally {
      close()
    }
  })
})
