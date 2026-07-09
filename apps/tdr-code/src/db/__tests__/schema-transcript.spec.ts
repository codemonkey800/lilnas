import fs from 'node:fs'
import path from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import { eq, sql } from 'drizzle-orm'

import { insertGeneration } from 'src/db/bot-generation.repo'
import { resolveMigrationsFolder } from 'src/db/database.module'
import {
  botGeneration,
  isActiveSession,
  isEndedSession,
  isRunningTurn,
  isTerminalTurn,
  narrowTurnContentPayload,
  sessions,
  turnContent,
  type TurnContentPayload,
  turns,
} from 'src/db/schema'
import { createTestDb } from 'src/db/test-db'

type RawSqlite = InstanceType<typeof BetterSqlite3>
type WithRawClient = { $client: RawSqlite }

const raw = (db: ReturnType<typeof createTestDb>['db']): RawSqlite =>
  (db as unknown as WithRawClient).$client

// ── helpers ──────────────────────────────────────────────────────────────────

type DbHandle = ReturnType<typeof createTestDb>['db']

function seedSession(
  db: DbHandle,
  genId: number,
  opts: {
    channelId?: string
    endedAt?: Date
    endReason?: 'evicted' | 'teardown' | 'interrupted'
    acpSessionId?: string
  } = {},
) {
  return db
    .insert(sessions)
    .values({
      channelId: opts.channelId ?? 'ch-001',
      generationId: genId,
      triggeringUserId: 'u-111',
      cwd: '/home/bot',
      createdAt: new Date(),
      endedAt: opts.endedAt ?? null,
      endReason: opts.endReason ?? null,
      acpSessionId: opts.acpSessionId ?? null,
    })
    .returning()
    .get()!
}

function seedTurn(
  db: DbHandle,
  sessionId: number,
  genId: number,
  opts: {
    turnIndex?: number
    status?: 'running' | 'completed' | 'cancelled' | 'errored' | 'interrupted'
    endedAt?: Date | null
    userId?: string | null
  } = {},
) {
  const status = opts.status ?? 'running'
  const endedAt =
    opts.endedAt !== undefined
      ? opts.endedAt
      : status === 'running'
        ? null
        : new Date()
  return db
    .insert(turns)
    .values({
      sessionId,
      generationId: genId,
      turnIndex: opts.turnIndex ?? 1,
      startedAt: new Date(),
      endedAt,
      stopReason: null,
      status,
      userId: opts.userId !== undefined ? opts.userId : null,
    })
    .returning()
    .get()!
}

function seedContent(
  db: DbHandle,
  turnId: number,
  payload: TurnContentPayload,
  ref: string | null = null,
) {
  return db
    .insert(turnContent)
    .values({
      turnId,
      ref,
      kind: payload.kind,
      payload,
      createdAt: new Date(),
    })
    .returning()
    .get()!
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('schema-transcript (U1): sessions · turns · turn_content', () => {
  describe('happy path', () => {
    it('applies migrations; all four turn_content kinds insert and read back', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        expect(session.id).toBeGreaterThan(0)
        expect(session.channelId).toBe('ch-001')
        expect(session.endedAt).toBeNull()
        expect(session.endReason).toBeNull()

        const turn = seedTurn(db, session.id, gen.id)
        expect(turn.id).toBeGreaterThan(0)
        expect(turn.status).toBe('running')

        const now = new Date()
        const kinds: TurnContentPayload[] = [
          { kind: 'prompt', text: 'hello' },
          { kind: 'agent_text', text: 'world' },
          {
            kind: 'tool_call',
            title: 'Read file',
            toolKind: 'fs',
            status: 'pending',
          },
          { kind: 'diff', path: 'foo.ts', newText: '+line' },
        ]
        for (const p of kinds) {
          const tc = db
            .insert(turnContent)
            .values({
              turnId: turn.id,
              ref: p.kind === 'tool_call' ? 'tc-1' : null,
              kind: p.kind,
              payload: p,
              createdAt: now,
            })
            .returning()
            .get()!
          expect(tc.kind).toBe(p.kind)
        }

        // foreign_keys is ON after migrate (non-vacuous: turn with bad session_id fails)
        expect(() => seedTurn(db, 999_999, gen.id, { turnIndex: 10 })).toThrow()
      } finally {
        close()
      }
    })

    it('tool_call payload persists and reads back via validating narrower', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        const turn = seedTurn(db, session.id, gen.id)

        const tc = seedContent(
          db,
          turn.id,
          {
            kind: 'tool_call',
            title: 'Bash',
            toolKind: 'exec',
            status: 'pending',
          },
          'ref-1',
        )

        const row = db
          .select()
          .from(turnContent)
          .where(eq(turnContent.id, tc.id))
          .get()!
        expect(row.kind).toBe('tool_call')

        const p = narrowTurnContentPayload(row.payload)
        expect(p).not.toBeNull()
        expect(p?.kind).toBe('tool_call')
        if (p?.kind === 'tool_call') {
          expect(p.title).toBe('Bash')
          expect(p.toolKind).toBe('exec')
          expect(p.status).toBe('pending')
        }

        // prompt round-trip
        const prompt = seedContent(db, turn.id, { kind: 'prompt', text: 'hi' })
        const pRow = db
          .select()
          .from(turnContent)
          .where(eq(turnContent.id, prompt.id))
          .get()!
        const pp = narrowTurnContentPayload(pRow.payload)
        expect(pp?.kind).toBe('prompt')
        if (pp?.kind === 'prompt') expect(pp.text).toBe('hi')
      } finally {
        close()
      }
    })

    it('tool-call create-then-update resolves to one row via (turn_id, ref)', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        const turn = seedTurn(db, session.id, gen.id)

        // onToolCall: insert with status 'pending'
        seedContent(
          db,
          turn.id,
          {
            kind: 'tool_call',
            title: 'Bash',
            toolKind: 'exec',
            status: 'pending',
          },
          'tc-abc',
        )

        // onToolCallUpdate: update status to 'completed' via (turn_id, ref)
        const changed = db
          .update(turnContent)
          .set({
            payload: {
              kind: 'tool_call',
              title: 'Bash',
              toolKind: 'exec',
              status: 'completed',
            },
          })
          .where(
            sql`${turnContent.turnId} = ${turn.id} AND ${turnContent.ref} = 'tc-abc'`,
          )
          .run()
        expect(changed.changes).toBe(1)

        // Exactly one row for this (turn_id, ref)
        const rows = db
          .select()
          .from(turnContent)
          .where(
            sql`${turnContent.turnId} = ${turn.id} AND ${turnContent.ref} = 'tc-abc'`,
          )
          .all()
        expect(rows).toHaveLength(1)
        expect((rows[0]!.payload as { status: string }).status).toBe(
          'completed',
        )
      } finally {
        close()
      }
    })
  })

  describe('guards', () => {
    it('isActiveSession / isEndedSession narrow correctly', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })

        const active = seedSession(db, gen.id)
        expect(isActiveSession(active)).toBe(true)
        expect(isEndedSession(active)).toBe(false)
        if (isActiveSession(active)) {
          // TypeScript: endedAt and endReason are null
          expect(active.endedAt).toBeNull()
          expect(active.endReason).toBeNull()
        }

        const ended = seedSession(db, gen.id, {
          channelId: 'ch-002',
          endedAt: new Date(),
          endReason: 'evicted',
        })
        expect(isActiveSession(ended)).toBe(false)
        expect(isEndedSession(ended)).toBe(true)
        if (isEndedSession(ended)) {
          expect(ended.endedAt).toBeInstanceOf(Date)
          expect(ended.endReason).toBe('evicted')
        }
      } finally {
        close()
      }
    })

    it('isRunningTurn / isTerminalTurn narrow correctly', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)

        const running = seedTurn(db, session.id, gen.id)
        expect(isRunningTurn(running)).toBe(true)
        expect(isTerminalTurn(running)).toBe(false)
        if (isRunningTurn(running)) {
          expect(running.status).toBe('running')
          expect(running.endedAt).toBeNull()
        }

        const done = seedTurn(db, session.id, gen.id, {
          turnIndex: 2,
          status: 'completed',
        })
        expect(isRunningTurn(done)).toBe(false)
        expect(isTerminalTurn(done)).toBe(true)
        if (isTerminalTurn(done)) {
          expect(done.endedAt).toBeInstanceOf(Date)
        }
      } finally {
        close()
      }
    })
  })

  describe('CHECK constraints', () => {
    it('sessions: ended_at set but end_reason null is rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        expect(() =>
          db
            .insert(sessions)
            .values({
              channelId: 'ch-x',
              generationId: gen.id,
              triggeringUserId: 'u-1',
              cwd: '/tmp',
              createdAt: new Date(),
              endedAt: new Date(),
              endReason: null, // violates correlation CHECK
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('sessions: end_reason set but ended_at null is rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        expect(() =>
          db
            .insert(sessions)
            .values({
              channelId: 'ch-x',
              generationId: gen.id,
              triggeringUserId: 'u-1',
              cwd: '/tmp',
              createdAt: new Date(),
              endedAt: null,
              endReason: 'evicted', // violates correlation CHECK
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('turns: status=running with non-null ended_at is rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        expect(() =>
          db
            .insert(turns)
            .values({
              sessionId: session.id,
              generationId: gen.id,
              turnIndex: 1,
              startedAt: new Date(),
              endedAt: new Date(), // violates correlation CHECK (status='running' means ended_at IS NULL)
              status: 'running',
              stopReason: null,
              userId: null,
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('turns: terminal status with null ended_at is rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        expect(() =>
          db
            .insert(turns)
            .values({
              sessionId: session.id,
              generationId: gen.id,
              turnIndex: 1,
              startedAt: new Date(),
              endedAt: null, // violates correlation CHECK (completed means ended_at IS NOT NULL)
              status: 'completed',
              stopReason: null,
              userId: null,
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('turn_index < 1 is rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        expect(() =>
          db
            .insert(turns)
            .values({
              sessionId: session.id,
              generationId: gen.id,
              turnIndex: 0, // violates >= 1
              startedAt: new Date(),
              endedAt: null,
              status: 'running',
              stopReason: null,
              userId: null,
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('invalid status/kind/end_reason are rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        const turn = seedTurn(db, session.id, gen.id)

        // Invalid turns.status
        expect(() =>
          db
            .insert(turns)
            .values({
              sessionId: session.id,
              generationId: gen.id,
              turnIndex: 2,
              startedAt: new Date(),
              endedAt: null,
              status: 'invalid_status' as never,
              stopReason: null,
              userId: null,
            })
            .run(),
        ).toThrow()

        // Invalid turn_content.kind
        expect(() =>
          db
            .insert(turnContent)
            .values({
              turnId: turn.id,
              ref: null,
              kind: 'invalid_kind' as never,
              payload: { kind: 'prompt', text: 'hi' },
              createdAt: new Date(),
            })
            .run(),
        ).toThrow()

        // Invalid sessions.end_reason
        expect(() =>
          db
            .insert(sessions)
            .values({
              channelId: 'ch-bad',
              generationId: gen.id,
              triggeringUserId: 'u-1',
              cwd: '/tmp',
              createdAt: new Date(),
              endedAt: new Date(),
              endReason: 'bad_reason' as never,
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })
  })

  describe('UNIQUE constraints', () => {
    it('duplicate (session_id, turn_index) is rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        seedTurn(db, session.id, gen.id, { turnIndex: 1 })
        expect(() =>
          seedTurn(db, session.id, gen.id, { turnIndex: 1 }),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('duplicate (turn_id, ref) is rejected when ref is non-null', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        const turn = seedTurn(db, session.id, gen.id)
        seedContent(
          db,
          turn.id,
          { kind: 'tool_call', title: 'A', toolKind: 'x', status: 'pending' },
          'ref-dup',
        )
        expect(() =>
          seedContent(
            db,
            turn.id,
            { kind: 'tool_call', title: 'B', toolKind: 'y', status: 'pending' },
            'ref-dup',
          ),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('multiple null refs in same turn are allowed (partial unique index scope)', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        const turn = seedTurn(db, session.id, gen.id)
        // Two null-ref blocks (prompt + agent_text) should both be insertable
        seedContent(db, turn.id, { kind: 'prompt', text: 'user input' })
        seedContent(db, turn.id, { kind: 'agent_text', text: 'response' })
        const rows = db
          .select()
          .from(turnContent)
          .where(eq(turnContent.turnId, turn.id))
          .all()
        expect(rows).toHaveLength(2)
      } finally {
        close()
      }
    })
  })

  describe('FK constraints', () => {
    it('turn with non-existent session_id is rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        expect(() => seedTurn(db, 999_999, gen.id)).toThrow()
      } finally {
        close()
      }
    })

    it('turn with non-existent generation_id is rejected', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        expect(() =>
          db
            .insert(turns)
            .values({
              sessionId: session.id,
              generationId: 999_999,
              turnIndex: 1,
              startedAt: new Date(),
              endedAt: null,
              status: 'running',
              stopReason: null,
              userId: null,
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('turn_content with non-existent turn_id is rejected', () => {
      const { db, close } = createTestDb()
      try {
        expect(() =>
          db
            .insert(turnContent)
            .values({
              turnId: 999_999,
              ref: null,
              kind: 'prompt',
              payload: { kind: 'prompt', text: 'hi' },
              createdAt: new Date(),
            })
            .run(),
        ).toThrow()
      } finally {
        close()
      }
    })
  })

  describe('CASCADE / RESTRICT', () => {
    it('deleting a session cascades to turns and transitively to turn_content', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        const turn = seedTurn(db, session.id, gen.id)
        seedContent(db, turn.id, { kind: 'prompt', text: 'hi' })

        db.delete(sessions).where(eq(sessions.id, session.id)).run()

        expect(db.select().from(turns).all()).toHaveLength(0)
        expect(db.select().from(turnContent).all()).toHaveLength(0)
      } finally {
        close()
      }
    })

    it('deleting a turn cascades to its turn_content', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        const turn = seedTurn(db, session.id, gen.id)
        seedContent(db, turn.id, { kind: 'agent_text', text: 'response' })

        db.delete(turns).where(eq(turns.id, turn.id)).run()

        expect(db.select().from(turnContent).all()).toHaveLength(0)
        // Session should still exist
        expect(db.select().from(sessions).all()).toHaveLength(1)
      } finally {
        close()
      }
    })

    it('deleting a bot_generation with sessions is rejected (RESTRICT)', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        seedSession(db, gen.id)
        expect(() =>
          db.delete(botGeneration).where(eq(botGeneration.id, gen.id)).run(),
        ).toThrow()
      } finally {
        close()
      }
    })

    it('deleting a bot_generation with turns is rejected (RESTRICT)', () => {
      const { db, close } = createTestDb()
      try {
        // Two generations so we can delete the session's gen without the turn's gen
        const gen1 = insertGeneration(db, { startedAt: new Date() })
        const gen2 = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen1.id)
        // Turn references gen2 (different from the session's gen1)
        db.insert(turns)
          .values({
            sessionId: session.id,
            generationId: gen2.id,
            turnIndex: 1,
            startedAt: new Date(),
            endedAt: null,
            status: 'running',
            stopReason: null,
            userId: null,
          })
          .run()
        // Deleting gen2 is blocked because turns.generation_id RESTRICT
        expect(() =>
          db.delete(botGeneration).where(eq(botGeneration.id, gen2.id)).run(),
        ).toThrow()
      } finally {
        close()
      }
    })
  })

  describe('integration', () => {
    it('interrupted tool call stays readable with non-terminal status', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        const turn = seedTurn(db, session.id, gen.id)

        // Insert a tool_call as 'pending'
        seedContent(
          db,
          turn.id,
          {
            kind: 'tool_call',
            title: 'Bash',
            toolKind: 'exec',
            status: 'pending',
          },
          'ref-interrupted',
        )

        // Turn is closed as 'interrupted' — no onToolCallUpdate arrives
        db.update(turns)
          .set({ status: 'interrupted', endedAt: new Date() })
          .where(eq(turns.id, turn.id))
          .run()

        // The tool_call row is still readable with its non-terminal 'pending' status
        const tc = db
          .select()
          .from(turnContent)
          .where(
            sql`${turnContent.turnId} = ${turn.id} AND ${turnContent.ref} = 'ref-interrupted'`,
          )
          .get()!
        expect((tc.payload as { status: string }).status).toBe('pending')
        expect(tc.ref).toBe('ref-interrupted')
      } finally {
        close()
      }
    })

    it('dangling-turn reconciliation: running turns from old generation found by indexed predicate', () => {
      const { db, close } = createTestDb()
      try {
        const gen1 = insertGeneration(db, { startedAt: new Date() })
        const gen2 = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen1.id)
        seedTurn(db, session.id, gen1.id, { turnIndex: 1 }) // dangling in gen1

        // The sweep: find running turns from a prior generation
        const dangling = db
          .select()
          .from(turns)
          .where(
            sql`${turns.status} = 'running' AND ${turns.generationId} != ${gen2.id}`,
          )
          .all()
        expect(dangling).toHaveLength(1)
        expect(dangling[0]!.generationId).toBe(gen1.id)

        // Close as interrupted — satisfies the correlation CHECK
        db.update(turns)
          .set({ status: 'interrupted', endedAt: new Date() })
          .where(eq(turns.id, dangling[0]!.id))
          .run()

        const closed = db
          .select()
          .from(turns)
          .where(eq(turns.id, dangling[0]!.id))
          .get()!
        expect(closed.status).toBe('interrupted')
        expect(closed.endedAt).toBeInstanceOf(Date)
      } finally {
        close()
      }
    })

    it('R8 linkage: acp_session_id + cwd persisted and read back', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id, {
          acpSessionId: 'acp-session-abc123',
        })

        const row = db
          .select()
          .from(sessions)
          .where(eq(sessions.id, session.id))
          .get()!
        expect(row.acpSessionId).toBe('acp-session-abc123')
        expect(row.cwd).toBe('/home/bot')
      } finally {
        close()
      }
    })

    it('nullable user_id on turn is accepted (reconciliation-closed turn)', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        const turn = seedTurn(db, session.id, gen.id, { userId: null })
        expect(turn.userId).toBeNull()
      } finally {
        close()
      }
    })

    it('active-lookup partial index exists in sqlite_master with WHERE clause', () => {
      const { db, close } = createTestDb()
      try {
        const sqlite = raw(db)
        const idx = sqlite
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type='index' AND name='sessions_active_lookup_idx'",
          )
          .get() as { sql: string } | undefined
        expect(idx).toBeTruthy()
        expect(idx!.sql.toUpperCase()).toContain('WHERE')
      } finally {
        close()
      }
    })

    it('unknown payload kind reads as null via validating narrower (forward-compat)', () => {
      const { db, close } = createTestDb()
      try {
        const gen = insertGeneration(db, { startedAt: new Date() })
        const session = seedSession(db, gen.id)
        const turn = seedTurn(db, session.id, gen.id)

        // Insert a valid row, then overwrite payload JSON with a future unknown kind
        const tc = seedContent(db, turn.id, { kind: 'agent_text', text: 'hi' })
        raw(db)
          .prepare('UPDATE turn_content SET payload = ? WHERE id = ?')
          .run(
            JSON.stringify({ kind: 'future_kind_unknown', text: 'hi' }),
            tc.id,
          )

        const row = db
          .select()
          .from(turnContent)
          .where(eq(turnContent.id, tc.id))
          .get()!
        // kind column is still 'agent_text' (valid) but payload.kind is unknown
        const narrowed = narrowTurnContentPayload(row.payload)
        // payload.kind === 'future_kind_unknown' is not in TURN_CONTENT_KINDS → null
        expect(narrowed).toBeNull()
      } finally {
        close()
      }
    })

    it('narrowTurnContentPayload: non-object / null / missing kind → null', () => {
      expect(narrowTurnContentPayload(null)).toBeNull()
      expect(narrowTurnContentPayload(42)).toBeNull()
      expect(narrowTurnContentPayload('agent_text')).toBeNull()
      expect(narrowTurnContentPayload({})).toBeNull()
      expect(narrowTurnContentPayload({ kind: undefined })).toBeNull()
    })

    it('narrowTurnContentPayload: known kind with missing required field → null', () => {
      expect(narrowTurnContentPayload({ kind: 'prompt' })).toBeNull()
      expect(narrowTurnContentPayload({ kind: 'agent_text' })).toBeNull()
      expect(
        narrowTurnContentPayload({ kind: 'tool_call', title: 't' }),
      ).toBeNull()
      expect(
        narrowTurnContentPayload({ kind: 'diff', path: 'a.ts' }),
      ).toBeNull()
    })

    it('narrowTurnContentPayload: column-vs-payload kind divergence → null', () => {
      const payload = { kind: 'prompt', text: 'hi' }
      // payload.kind is 'prompt' but column says 'agent_text'
      expect(narrowTurnContentPayload(payload, 'agent_text')).toBeNull()
    })

    it('narrowTurnContentPayload: valid payloads pass per-kind validation', () => {
      expect(
        narrowTurnContentPayload({ kind: 'prompt', text: 'hi' }),
      ).not.toBeNull()
      expect(
        narrowTurnContentPayload({ kind: 'agent_text', text: 'hi' }),
      ).not.toBeNull()
      expect(
        narrowTurnContentPayload({
          kind: 'tool_call',
          title: 'T',
          toolKind: 'bash',
          status: 'running',
        }),
      ).not.toBeNull()
      expect(
        narrowTurnContentPayload({ kind: 'diff', path: 'a.ts', newText: '+1' }),
      ).not.toBeNull()
    })
  })

  describe('verification', () => {
    it('migration journal has advanced to idx 1', () => {
      const journalPath = path.join(
        resolveMigrationsFolder(),
        'meta',
        '_journal.json',
      )
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
        entries: Array<{ idx: number; tag: string }>
      }
      expect(journal.entries.find(e => e.idx === 1)).toBeTruthy()
    })
  })
})
