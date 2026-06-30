import { NotFoundException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { insertGeneration } from 'src/db/bot-generation.repo'
import { insertSession, closeSession } from 'src/db/sessions.repo'
import { insertTurn, closeTurn } from 'src/db/turns.repo'
import { appendBlock } from 'src/db/turn-content.repo'
import { createTestDb } from 'src/db/test-db'
import { SessionsService } from 'src/console/sessions.service'

function fakeLogger(): PinoLogger {
  return { warn: jest.fn(), error: jest.fn(), info: jest.fn() } as unknown as PinoLogger
}

function buildService(db: ReturnType<typeof createTestDb>['db']) {
  return new SessionsService(db, fakeLogger())
}

describe('SessionsService', () => {
  let testDb: ReturnType<typeof createTestDb>

  beforeEach(() => {
    testDb = createTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  describe('listSessions', () => {
    it('empty DB → empty items', () => {
      const svc = buildService(testDb.db)
      const result = svc.listSessions({ limit: 10 })
      expect(result.items).toHaveLength(0)
      expect(result.nextCursor).toBeNull()
    })

    it('returns newest first, respects limit, computes nextCursor', () => {
      const gen = insertGeneration(testDb.db, { startedAt: new Date() })
      for (let i = 0; i < 6; i++) {
        insertSession(testDb.db, {
          channelId: 'ch1',
          generationId: gen.id,
          triggeringUserId: 'u1',
          acpSessionId: null,
          cwd: '/cwd',
          createdAt: new Date(Date.now() + i * 1000),
        })
      }
      const svc = buildService(testDb.db)
      const result = svc.listSessions({ limit: 5 })
      expect(result.items).toHaveLength(5)
      expect(result.nextCursor).not.toBeNull()
      // IDs are descending (newest first).
      const ids = result.items.map(i => i.id)
      expect(ids).toEqual([...ids].sort((a, b) => b - a))
    })

    it('channel filter returns only matching sessions', () => {
      const gen = insertGeneration(testDb.db, { startedAt: new Date() })
      insertSession(testDb.db, { channelId: 'ch1', generationId: gen.id, triggeringUserId: 'u1', acpSessionId: null, cwd: '/cwd', createdAt: new Date() })
      insertSession(testDb.db, { channelId: 'ch2', generationId: gen.id, triggeringUserId: 'u1', acpSessionId: null, cwd: '/cwd', createdAt: new Date() })
      const svc = buildService(testDb.db)
      const result = svc.listSessions({ channelId: 'ch1', limit: 10 })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]!.channelId).toBe('ch1')
    })

    it('pagination boundary: two pages share no ids', () => {
      const gen = insertGeneration(testDb.db, { startedAt: new Date() })
      const ids: number[] = []
      for (let i = 0; i < 6; i++) {
        const row = insertSession(testDb.db, {
          channelId: 'ch1',
          generationId: gen.id,
          triggeringUserId: 'u1',
          acpSessionId: null,
          cwd: '/cwd',
          createdAt: new Date(Date.now() + i * 1000),
        })
        ids.push(row.id)
      }
      const svc = buildService(testDb.db)
      const page1 = svc.listSessions({ limit: 3 })
      expect(page1.items).toHaveLength(3)
      const cursor = page1.nextCursor!
      expect(cursor).not.toBeNull()
      const page2 = svc.listSessions({ cursor, limit: 3 })
      const page1Ids = new Set(page1.items.map(i => i.id))
      const page2Ids = page2.items.map(i => i.id)
      for (const id of page2Ids) {
        expect(page1Ids.has(id)).toBe(false)
      }
    })
  })

  describe('getSessionTranscript', () => {
    it('non-existent session → NotFoundException', () => {
      const svc = buildService(testDb.db)
      expect(() => svc.getSessionTranscript(999)).toThrow(NotFoundException)
    })

    it('happy path: session + 2 turns + blocks → correctly grouped', () => {
      const gen = insertGeneration(testDb.db, { startedAt: new Date() })
      const session = insertSession(testDb.db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(),
      })
      const turn1 = insertTurn(testDb.db, { sessionId: session.id, generationId: gen.id, turnIndex: 1, userId: 'u1', startedAt: new Date() })
      const turn2 = insertTurn(testDb.db, { sessionId: session.id, generationId: gen.id, turnIndex: 2, userId: 'u1', startedAt: new Date() })
      appendBlock(testDb.db, { turnId: turn1.id, kind: 'prompt', payload: { kind: 'prompt', text: 'hello' }, createdAt: new Date() })
      appendBlock(testDb.db, { turnId: turn2.id, kind: 'agent_text', payload: { kind: 'agent_text', text: 'hi' }, createdAt: new Date() })

      const svc = buildService(testDb.db)
      const result = svc.getSessionTranscript(session.id)
      expect(result.turns).toHaveLength(2)
      expect(result.turns[0]!.content).toHaveLength(1)
      expect(result.turns[0]!.content[0]!.kind).toBe('prompt')
      expect(result.turns[1]!.content[0]!.kind).toBe('agent_text')
      expect(result.droppedBlocks).toBe(0)
    })

    it('malformed block payload → dropped and counted', () => {
      const gen = insertGeneration(testDb.db, { startedAt: new Date() })
      const session = insertSession(testDb.db, { channelId: 'ch1', generationId: gen.id, triggeringUserId: 'u1', acpSessionId: null, cwd: '/cwd', createdAt: new Date() })
      const turn = insertTurn(testDb.db, { sessionId: session.id, generationId: gen.id, turnIndex: 1, userId: null, startedAt: new Date() })
      // Insert a block with a bad payload (missing 'text' field for prompt).
      appendBlock(testDb.db, { turnId: turn.id, kind: 'prompt', payload: { kind: 'prompt', text: '' }, createdAt: new Date() })
      // Insert another with correct payload.
      appendBlock(testDb.db, { turnId: turn.id, kind: 'agent_text', payload: { kind: 'agent_text', text: 'ok' }, createdAt: new Date() })
      // Manually corrupt one block via raw SQL to simulate a malformed row.
      testDb.db.$client.exec(
        `UPDATE turn_content SET payload = '{"kind":"unknown_kind"}' WHERE id = (SELECT MIN(id) FROM turn_content WHERE turn_id = ${turn.id})`
      )

      const svc = buildService(testDb.db)
      const result = svc.getSessionTranscript(session.id)
      expect(result.droppedBlocks).toBe(1)
      expect(result.turns[0]!.content).toHaveLength(1)
    })
  })
})
