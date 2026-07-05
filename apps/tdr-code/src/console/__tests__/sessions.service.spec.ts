import { NotFoundException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { SessionsService } from 'src/console/sessions.service'
import { insertGeneration } from 'src/db/bot-generation.repo'
import { insertSession } from 'src/db/sessions.repo'
import { createTestDb } from 'src/db/test-db'
import { appendBlock } from 'src/db/turn-content.repo'
import { insertTurn } from 'src/db/turns.repo'

function fakeLogger(): PinoLogger {
  return {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  } as unknown as PinoLogger
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
      insertSession(testDb.db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(),
      })
      insertSession(testDb.db, {
        channelId: 'ch2',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(),
      })
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
      const turn1 = insertTurn(testDb.db, {
        sessionId: session.id,
        generationId: gen.id,
        turnIndex: 1,
        userId: 'u1',
        startedAt: new Date(),
      })
      const turn2 = insertTurn(testDb.db, {
        sessionId: session.id,
        generationId: gen.id,
        turnIndex: 2,
        userId: 'u1',
        startedAt: new Date(),
      })
      appendBlock(testDb.db, {
        turnId: turn1.id,
        kind: 'prompt',
        payload: { kind: 'prompt', text: 'hello' },
        createdAt: new Date(),
      })
      appendBlock(testDb.db, {
        turnId: turn2.id,
        kind: 'agent_text',
        payload: { kind: 'agent_text', text: 'hi' },
        createdAt: new Date(),
      })

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
      const session = insertSession(testDb.db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: null,
        cwd: '/cwd',
        createdAt: new Date(),
      })
      const turn = insertTurn(testDb.db, {
        sessionId: session.id,
        generationId: gen.id,
        turnIndex: 1,
        userId: null,
        startedAt: new Date(),
      })
      // prompt with empty text — valid, narrowTurnContentPayload accepts empty strings.
      appendBlock(testDb.db, {
        turnId: turn.id,
        kind: 'prompt',
        payload: { kind: 'prompt', text: '' },
        createdAt: new Date(),
      })
      // agent_text with real text — valid.
      appendBlock(testDb.db, {
        turnId: turn.id,
        kind: 'agent_text',
        payload: { kind: 'agent_text', text: 'ok' },
        createdAt: new Date(),
      })
      // Corrupt the first block via raw SQL to an unknown kind — this is the one that gets dropped.
      const client = (
        testDb.db as unknown as { $client: { exec: (sql: string) => void } }
      ).$client
      client.exec(
        `UPDATE turn_content SET payload = '{"kind":"unknown_kind"}' WHERE id = (SELECT MIN(id) FROM turn_content WHERE turn_id = ${turn.id})`,
      )

      const svc = buildService(testDb.db)
      const result = svc.getSessionTranscript(session.id)
      // The corrupted block is dropped; the agent_text block survives.
      expect(result.droppedBlocks).toBe(1)
      expect(result.turns[0]!.content).toHaveLength(1)
      expect(result.turns[0]!.content[0]!.kind).toBe('agent_text')
    })

    // U7: diff.newText/oldText are truncated to a bounded preview in the
    // transcript DTO (docs/plans/2026-07-05-002-feat-tdr-code-sse-push-plan.md,
    // U7) — see sessions.service.ts's DIFF_PREVIEW_MAX_CHARS and its own
    // header comment for why this is the single biggest per-refetch byte-
    // cost cut available under snapshot-refetch (Decision 2A), without
    // building the deferred `?since` delta machinery.
    describe('diff truncation (U7)', () => {
      // Mirrors sessions.service.ts's own DIFF_PREVIEW_MAX_CHARS constant.
      // Not imported directly (it's a private module constant, not
      // exported) — duplicated here so a future change to the bound shows
      // up as a single obvious assertion failure in this file, not a silent
      // pass.
      const DIFF_PREVIEW_MAX_CHARS = 4000

      function seedDiffBlock(
        db: ReturnType<typeof createTestDb>['db'],
        opts: { newText: string; oldText?: string | null },
      ) {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = insertSession(db, {
          channelId: 'ch1',
          generationId: gen.id,
          triggeringUserId: 'u1',
          acpSessionId: null,
          cwd: '/cwd',
          createdAt: new Date(),
        })
        const turn = insertTurn(db, {
          sessionId: session.id,
          generationId: gen.id,
          turnIndex: 1,
          userId: 'u1',
          startedAt: new Date(),
        })
        appendBlock(db, {
          turnId: turn.id,
          kind: 'diff',
          payload: {
            kind: 'diff',
            path: 'src/foo.ts',
            newText: opts.newText,
            ...(opts.oldText !== undefined ? { oldText: opts.oldText } : {}),
          },
          createdAt: new Date(),
        })
        return session
      }

      it('truncates a newText longer than the bound to exactly the bound length and marks truncated:true', () => {
        const longText = 'x'.repeat(DIFF_PREVIEW_MAX_CHARS + 500)
        const session = seedDiffBlock(testDb.db, { newText: longText })

        const svc = buildService(testDb.db)
        const result = svc.getSessionTranscript(session.id)
        const block = result.turns[0]!.content[0]!
        if (block.kind !== 'diff') throw new Error('expected a diff block')

        expect(block.newText).toHaveLength(DIFF_PREVIEW_MAX_CHARS)
        expect(block.newText).toBe(longText.slice(0, DIFF_PREVIEW_MAX_CHARS))
        expect(block.truncated).toBe(true)
      })

      it('does not truncate newText/oldText at or under the bound, and marks truncated:false', () => {
        const exactText = 'y'.repeat(DIFF_PREVIEW_MAX_CHARS)
        const shortOld = 'old content'
        const session = seedDiffBlock(testDb.db, {
          newText: exactText,
          oldText: shortOld,
        })

        const svc = buildService(testDb.db)
        const result = svc.getSessionTranscript(session.id)
        const block = result.turns[0]!.content[0]!
        if (block.kind !== 'diff') throw new Error('expected a diff block')

        expect(block.newText).toBe(exactText)
        expect(block.newText).toHaveLength(DIFF_PREVIEW_MAX_CHARS)
        expect(block.oldText).toBe(shortOld)
        expect(block.truncated).toBe(false)
      })

      it('keeps oldText: null for a new-file-creation diff (absent oldText never becomes a truncated empty string)', () => {
        const session = seedDiffBlock(testDb.db, {
          newText: 'created file contents',
          // oldText omitted entirely — new-file creation.
        })

        const svc = buildService(testDb.db)
        const result = svc.getSessionTranscript(session.id)
        const block = result.turns[0]!.content[0]!
        if (block.kind !== 'diff') throw new Error('expected a diff block')

        expect(block.oldText).toBeNull()
        expect(block.truncated).toBe(false)
      })

      it('marks truncated:true when only oldText exceeds the bound, even if newText does not', () => {
        const longOld = 'z'.repeat(DIFF_PREVIEW_MAX_CHARS + 200)
        const session = seedDiffBlock(testDb.db, {
          newText: 'short new text',
          oldText: longOld,
        })

        const svc = buildService(testDb.db)
        const result = svc.getSessionTranscript(session.id)
        const block = result.turns[0]!.content[0]!
        if (block.kind !== 'diff') throw new Error('expected a diff block')

        expect(block.newText).toBe('short new text')
        expect(block.oldText).toHaveLength(DIFF_PREVIEW_MAX_CHARS)
        expect(block.truncated).toBe(true)
      })
    })
  })
})
