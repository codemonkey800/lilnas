import { insertGeneration } from 'src/db/bot-generation.repo'
import { insertSession } from 'src/db/sessions.repo'
import { createTestDb } from 'src/db/test-db'
import {
  appendBlock,
  blocksByTurn,
  insertToolCall,
  updateToolCall,
} from 'src/db/turn-content.repo'
import { insertTurn } from 'src/db/turns.repo'

function seedTurn(db: ReturnType<typeof createTestDb>['db']) {
  const gen = insertGeneration(db, { startedAt: new Date() })
  const session = insertSession(db, {
    channelId: 'ch1',
    generationId: gen.id,
    triggeringUserId: 'u1',
    acpSessionId: null,
    cwd: '/cwd',
    createdAt: new Date(),
  })
  return insertTurn(db, {
    sessionId: session.id,
    generationId: gen.id,
    turnIndex: 1,
    userId: 'u1',
    startedAt: new Date(),
  })
}

describe('turn-content.repo', () => {
  it('appendBlock creates a prompt block (blind INSERT, no ref)', () => {
    const { db, close } = createTestDb()
    try {
      const turn = seedTurn(db)
      const row = appendBlock(db, {
        turnId: turn.id,
        kind: 'prompt',
        payload: { kind: 'prompt', text: 'hello world' },
        createdAt: new Date(),
      })
      expect(row.kind).toBe('prompt')
      expect(row.ref).toBeNull()
      expect(row.turnId).toBe(turn.id)
    } finally {
      close()
    }
  })

  it('insertToolCall creates a tool_call block with ref', () => {
    const { db, close } = createTestDb()
    try {
      const turn = seedTurn(db)
      const row = insertToolCall(db, {
        turnId: turn.id,
        ref: 'tool-1',
        payload: {
          kind: 'tool_call',
          title: 'write_file',
          toolKind: 'fs',
          status: 'pending',
        },
        createdAt: new Date(),
      })
      expect(row.kind).toBe('tool_call')
      expect(row.ref).toBe('tool-1')
    } finally {
      close()
    }
  })

  it('full round-trip: prompt + agent_text + tool_call + diff arrive in id order', () => {
    const { db, close } = createTestDb()
    try {
      const turn = seedTurn(db)
      appendBlock(db, {
        turnId: turn.id,
        kind: 'prompt',
        payload: { kind: 'prompt', text: 'q' },
        createdAt: new Date(),
      })
      appendBlock(db, {
        turnId: turn.id,
        kind: 'agent_text',
        payload: { kind: 'agent_text', text: 'a' },
        createdAt: new Date(),
      })
      insertToolCall(db, {
        turnId: turn.id,
        ref: 'ref1',
        payload: {
          kind: 'tool_call',
          title: 'tool',
          toolKind: 'fs',
          status: 'pending',
        },
        createdAt: new Date(),
      })
      appendBlock(db, {
        turnId: turn.id,
        kind: 'diff',
        payload: { kind: 'diff', path: 'foo.ts', newText: '...' },
        createdAt: new Date(),
      })

      const blocks = blocksByTurn(db, turn.id)
      expect(blocks.map(b => b.kind)).toEqual([
        'prompt',
        'agent_text',
        'tool_call',
        'diff',
      ])
    } finally {
      close()
    }
  })

  it('insertToolCall then updateToolCall resolves to one row with updated payload', () => {
    const { db, close } = createTestDb()
    try {
      const turn = seedTurn(db)
      insertToolCall(db, {
        turnId: turn.id,
        ref: 'tool-2',
        payload: {
          kind: 'tool_call',
          title: 'write',
          toolKind: 'fs',
          status: 'pending',
        },
        createdAt: new Date(),
      })
      const changes = updateToolCall(db, {
        turnId: turn.id,
        ref: 'tool-2',
        payload: {
          kind: 'tool_call',
          title: 'write',
          toolKind: 'fs',
          status: 'completed',
        },
      })
      expect(changes).toBe(1)
      const blocks = blocksByTurn(db, turn.id)
      expect(blocks).toHaveLength(1)
      expect((blocks[0]!.payload as { status: string }).status).toBe(
        'completed',
      )
    } finally {
      close()
    }
  })

  it('updateToolCall on non-existent (turn_id, ref) returns 0 (late/cross-turn guard)', () => {
    const { db, close } = createTestDb()
    try {
      const turn = seedTurn(db)
      const changes = updateToolCall(db, {
        turnId: turn.id,
        ref: 'no-such-ref',
        payload: {
          kind: 'tool_call',
          title: '',
          toolKind: '',
          status: 'completed',
        },
      })
      expect(changes).toBe(0)
    } finally {
      close()
    }
  })

  it('interrupted tool_call (pending, no update) stays readable after turn close', () => {
    const { db, close } = createTestDb()
    try {
      const turn = seedTurn(db)
      insertToolCall(db, {
        turnId: turn.id,
        ref: 'in-flight',
        payload: {
          kind: 'tool_call',
          title: 'cmd',
          toolKind: 'shell',
          status: 'pending',
        },
        createdAt: new Date(),
      })
      const blocks = blocksByTurn(db, turn.id)
      expect(blocks).toHaveLength(1)
      expect((blocks[0]!.payload as { status: string }).status).toBe('pending')
    } finally {
      close()
    }
  })

  it('partial/incremental blocks are readable before onPromptComplete (R6)', () => {
    const { db, close } = createTestDb()
    try {
      const turn = seedTurn(db)
      appendBlock(db, {
        turnId: turn.id,
        kind: 'prompt',
        payload: { kind: 'prompt', text: 'q' },
        createdAt: new Date(),
      })
      insertToolCall(db, {
        turnId: turn.id,
        ref: 'r1',
        payload: {
          kind: 'tool_call',
          title: 'cmd',
          toolKind: 'shell',
          status: 'in_progress',
        },
        createdAt: new Date(),
      })
      // Turn is still open (running). Read blocks — should have 2.
      const blocks = blocksByTurn(db, turn.id)
      expect(blocks).toHaveLength(2)
    } finally {
      close()
    }
  })

  it('two ref IS NOT NULL blocks with same ref in same turn are rejected (UNIQUE)', () => {
    const { db, close } = createTestDb()
    try {
      const turn = seedTurn(db)
      insertToolCall(db, {
        turnId: turn.id,
        ref: 'dup',
        payload: {
          kind: 'tool_call',
          title: 'cmd',
          toolKind: 'fs',
          status: 'pending',
        },
        createdAt: new Date(),
      })
      expect(() =>
        insertToolCall(db, {
          turnId: turn.id,
          ref: 'dup',
          payload: {
            kind: 'tool_call',
            title: 'cmd',
            toolKind: 'fs',
            status: 'pending',
          },
          createdAt: new Date(),
        }),
      ).toThrow()
    } finally {
      close()
    }
  })

  it('two ref IS NULL blocks in same turn are both allowed (no UNIQUE conflict)', () => {
    const { db, close } = createTestDb()
    try {
      const turn = seedTurn(db)
      appendBlock(db, {
        turnId: turn.id,
        kind: 'agent_text',
        payload: { kind: 'agent_text', text: 'a' },
        createdAt: new Date(),
      })
      appendBlock(db, {
        turnId: turn.id,
        kind: 'agent_text',
        payload: { kind: 'agent_text', text: 'b' },
        createdAt: new Date(),
      })
      const blocks = blocksByTurn(db, turn.id)
      expect(blocks).toHaveLength(2)
    } finally {
      close()
    }
  })
})
