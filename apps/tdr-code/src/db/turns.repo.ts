import { sql } from 'drizzle-orm'

import type { Db } from './database.module'
import { type TurnRow, turns, type TurnStatus } from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// turns repo — bot-side writes; reader surface ships in B8.
// findDanglingTurns is the reconciliation affordance for the deferred
// boot-sweep (U3 plan note).
// ──────────────────────────────────────────────────────────────────────────────

export function insertTurn(
  db: Db,
  opts: {
    sessionId: number
    generationId: number
    turnIndex: number
    userId: string | null
    startedAt: Date
  },
): TurnRow {
  return db
    .insert(turns)
    .values({
      sessionId: opts.sessionId,
      generationId: opts.generationId,
      turnIndex: opts.turnIndex,
      userId: opts.userId,
      startedAt: opts.startedAt,
      status: 'running',
    })
    .returning()
    .get()!
}

// Blind guarded UPDATE — only closes a running turn; idempotent on double-close.
// Returns rows changed (0 means already closed).
export function closeTurn(
  db: Db,
  opts: {
    id: number
    status: Exclude<TurnStatus, 'running'>
    endedAt: Date
    stopReason?: string | null
  },
): number {
  const result = db
    .update(turns)
    .set({
      status: opts.status,
      endedAt: opts.endedAt,
      stopReason: opts.stopReason ?? null,
    })
    .where(sql`${turns.id} = ${opts.id} AND ${turns.status} = 'running'`)
    .run()
  return result.changes
}

// Max turn_index for a session — used once per session-open to seed the
// in-memory counter (Decision 6 / U3). Returns 0 if the session has no turns.
export function maxTurnIndex(db: Db, sessionId: number): number {
  const row = db
    .select({ max: sql<number | null>`MAX(${turns.turnIndex})` })
    .from(turns)
    .where(sql`${turns.sessionId} = ${sessionId}`)
    .get()
  return row?.max ?? 0
}

// Open turns from a prior generation — used by the deferred boot-reconciliation
// sweep to mark them 'interrupted'. NOT called on the hot path.
export function findDanglingTurns(db: Db, liveGenerationId: number): TurnRow[] {
  return db
    .select()
    .from(turns)
    .where(
      sql`${turns.endedAt} IS NULL AND ${turns.generationId} != ${liveGenerationId}`,
    )
    .all()
}

// All turns for a session, ordered by turn_index (display order).
export function listTurnsBySession(db: Db, sessionId: number): TurnRow[] {
  return db
    .select()
    .from(turns)
    .where(sql`${turns.sessionId} = ${sessionId}`)
    .orderBy(sql`${turns.turnIndex} ASC`)
    .all()
}
