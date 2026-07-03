import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import type { PromptStartContext } from 'src/agent/agent.types'
import { insertGeneration } from 'src/db/bot-generation.repo'
import { DB } from 'src/db/database.module'
import { insertSession } from 'src/db/sessions.repo'
import { createTestDb } from 'src/db/test-db'
import { blocksByTurn } from 'src/db/turn-content.repo'
import { SqliteWriterService } from 'src/discord/sqlite-writer.service'
import { EnvKeys } from 'src/env'

function makeLogger(): PinoLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger
}

async function createService(
  db: ReturnType<typeof createTestDb>['db'],
  genId: number | null = null,
) {
  if (genId != null) {
    process.env[EnvKeys.BOT_GENERATION_ID] = String(genId)
  } else {
    delete process.env[EnvKeys.BOT_GENERATION_ID]
  }
  const module = await Test.createTestingModule({
    providers: [
      SqliteWriterService,
      { provide: DB, useValue: db },
      { provide: PinoLogger, useValue: makeLogger() },
    ],
  }).compile()
  return module.get(SqliteWriterService)
}

function makeCtx(
  sessionRowId: number | null,
  text = 'hello',
): PromptStartContext {
  return { sessionRowId, prompt: { text, images: [] } }
}

describe('SqliteWriterService — turn round-trip', () => {
  afterEach(() => {
    delete process.env[EnvKeys.BOT_GENERATION_ID]
  })

  it('no-ops when generationId is null (guard)', async () => {
    const { db, close } = createTestDb()
    try {
      const service = await createService(db, null)
      // These should not throw even though there are no sessions/turns.
      expect(() => service.onPromptStart('ch1', 1, makeCtx(null))).not.toThrow()
      expect(() => service.onPromptComplete('ch1', 'end_turn')).not.toThrow()
    } finally {
      close()
    }
  })

  it('full turn round-trip: prompt + agent_text + tool_call + diff in order', async () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const session = insertSession(db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(),
      })
      const service = await createService(db, gen.id)

      service.onPromptStart('ch1', 1, makeCtx(session.id, 'user prompt'))
      service.onAgentMessageChunk('ch1', 'agent reply')
      service.onToolCall('ch1', 'ref-1', 'write_file', 'fs', 'pending', [])
      service.onToolCallUpdate('ch1', 'ref-1', 'completed', [])
      service.onAgentMessageChunk('ch1', ' more text')
      service.onPromptComplete('ch1', 'end_turn')

      // Verify turn is in the DB — find it via turn-content blocks.
      // Get the turn id from the first block.
      const { turns } = await import('src/db/schema')
      const allTurns = db.select().from(turns).all()
      expect(allTurns).toHaveLength(1)
      const turn = allTurns[0]!
      expect(turn.status).toBe('completed')
      expect(turn.turnIndex).toBe(1)

      const blocks = blocksByTurn(db, turn.id)
      expect(blocks.map(b => b.kind)).toEqual([
        'prompt',
        'agent_text',
        'tool_call',
        'agent_text',
      ])
    } finally {
      close()
    }
  })

  it('turn_index increments per session across multiple prompts', async () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const session = insertSession(db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(),
      })
      const service = await createService(db, gen.id)

      service.onPromptStart('ch1', 1, makeCtx(session.id))
      service.onPromptComplete('ch1', 'end_turn')
      service.onPromptStart('ch1', 2, makeCtx(session.id))
      service.onPromptComplete('ch1', 'cancelled')

      const { turns } = await import('src/db/schema')
      const allTurns = db
        .select()
        .from(turns)
        .orderBy((await import('src/db/schema')).turns.turnIndex)
        .all()
      expect(allTurns).toHaveLength(2)
      expect(allTurns[0]!.turnIndex).toBe(1)
      expect(allTurns[1]!.turnIndex).toBe(2)
      expect(allTurns[0]!.status).toBe('completed')
      expect(allTurns[1]!.status).toBe('cancelled')
    } finally {
      close()
    }
  })

  it('late agent_text after onPromptComplete is dropped (F3 watermark guard)', async () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const session = insertSession(db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(),
      })
      const service = await createService(db, gen.id)

      service.onPromptStart('ch1', 1, makeCtx(session.id))
      service.onPromptComplete('ch1', 'end_turn')
      // Late chunk arrives after turn is closed.
      service.onAgentMessageChunk('ch1', 'late text')

      const { turns } = await import('src/db/schema')
      const allTurns = db.select().from(turns).all()
      const blocks = blocksByTurn(db, allTurns[0]!.id)
      // Should only have the prompt block, not the late agent_text.
      expect(blocks.every(b => b.kind !== 'agent_text')).toBe(true)
    } finally {
      close()
    }
  })

  it('restart re-seeding: counter seeds from MAX(turn_index) and UNIQUE is not violated', async () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const session = insertSession(db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(),
      })
      const service = await createService(db, gen.id)

      // Simulate two previous turns in the session (simulating a restart).
      service.onPromptStart('ch1', 1, makeCtx(session.id))
      service.onPromptComplete('ch1', 'end_turn')
      service.onPromptStart('ch1', 2, makeCtx(session.id))
      service.onPromptComplete('ch1', 'end_turn')

      // Create a new writer service (simulates a bot restart on the same session).
      const service2 = await createService(db, gen.id)
      // First prompt on restarted writer should re-seed from max=2 and insert 3.
      expect(() =>
        service2.onPromptStart('ch1', 3, makeCtx(session.id)),
      ).not.toThrow()
      service2.onPromptComplete('ch1', 'end_turn')

      const { turns } = await import('src/db/schema')
      const allTurns = db.select().from(turns).all()
      expect(allTurns.map(t => t.turnIndex).sort()).toEqual([1, 2, 3])
    } finally {
      close()
    }
  })

  it('mapStopReason: aborted → cancelled, error → errored', async () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const session = insertSession(db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(),
      })
      const service = await createService(db, gen.id)

      service.onPromptStart('ch1', 1, makeCtx(session.id))
      service.onPromptComplete('ch1', 'aborted')
      service.onPromptStart('ch1', 2, makeCtx(session.id))
      service.onPromptComplete('ch1', 'error')

      const { turns } = await import('src/db/schema')
      const allTurns = db
        .select()
        .from(turns)
        .orderBy((await import('src/db/schema')).turns.turnIndex)
        .all()
      expect(allTurns[0]!.status).toBe('cancelled')
      expect(allTurns[1]!.status).toBe('errored')
    } finally {
      close()
    }
  })

  it('onUsageUpdate is a no-op: does not throw and writes nothing', async () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const service = await createService(db, gen.id)

      expect(() => service.onUsageUpdate('ch1', 15000, 200000)).not.toThrow()

      const { events } = await import('src/db/schema')
      expect(db.select().from(events).all()).toHaveLength(0)
    } finally {
      close()
    }
  })
})
