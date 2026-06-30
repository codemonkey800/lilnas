import { sql } from 'drizzle-orm'

import type { Db } from './database.module'
import {
  turnContent,
  type TurnContentKind,
  type TurnContentPayload,
  type TurnContentRow,
} from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// turn-content repo — blind INSERTs for prompt/agent_text/diff; guarded UPDATE
// for tool_call status flip. Reader surface ships in B8.
// ──────────────────────────────────────────────────────────────────────────────

export function appendBlock(
  db: Db,
  opts: {
    turnId: number
    kind: Exclude<TurnContentKind, 'tool_call'>
    payload: TurnContentPayload
    createdAt: Date
  },
): TurnContentRow {
  return db
    .insert(turnContent)
    .values({
      turnId: opts.turnId,
      ref: null,
      kind: opts.kind,
      payload: opts.payload,
      createdAt: opts.createdAt,
    })
    .returning()
    .get()!
}

export function insertToolCall(
  db: Db,
  opts: {
    turnId: number
    ref: string
    payload: TurnContentPayload
    createdAt: Date
  },
): TurnContentRow {
  return db
    .insert(turnContent)
    .values({
      turnId: opts.turnId,
      ref: opts.ref,
      kind: 'tool_call',
      payload: opts.payload,
      createdAt: opts.createdAt,
    })
    .returning()
    .get()!
}

// Guarded status-only UPDATE via json_set — preserves title/kind from onToolCall.
// Returns rows changed (0 = late/cross-turn, log and skip).
// Indexed by the UNIQUE(turn_id, ref) partial index (WHERE ref IS NOT NULL).
export function updateToolCallStatus(
  db: Db,
  opts: {
    turnId: number
    ref: string
    status: string
  },
): number {
  const result = db
    .update(turnContent)
    .set({
      payload: sql`json_set(${turnContent.payload}, '$.status', ${opts.status})`,
    })
    .where(
      sql`${turnContent.turnId} = ${opts.turnId} AND ${turnContent.ref} = ${opts.ref}`,
    )
    .run()
  return result.changes
}

// Read all blocks for a turn ordered by insertion (id) — for tests only.
export function blocksByTurn(db: Db, turnId: number): TurnContentRow[] {
  return db
    .select()
    .from(turnContent)
    .where(sql`${turnContent.turnId} = ${turnId}`)
    .orderBy(sql`${turnContent.id}`)
    .all()
}
