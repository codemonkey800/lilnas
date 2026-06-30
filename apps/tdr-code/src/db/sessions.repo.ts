import { sql } from 'drizzle-orm'

import type { Db } from './database.module'
import {
  type ActiveSession,
  type SessionEndReason,
  type SessionRow,
  sessions,
} from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// sessions repo — bot-side writes; reader surface ships in B8.
// getActiveSession + closeSession are also consumed by the deferred
// boot-reconciliation sweep (U2 plan note).
// ──────────────────────────────────────────────────────────────────────────────

export function insertSession(
  db: Db,
  opts: {
    channelId: string
    generationId: number
    triggeringUserId: string
    acpSessionId: string | null
    cwd: string
    createdAt: Date
  },
): SessionRow {
  return db
    .insert(sessions)
    .values({
      channelId: opts.channelId,
      generationId: opts.generationId,
      triggeringUserId: opts.triggeringUserId,
      acpSessionId: opts.acpSessionId,
      cwd: opts.cwd,
      createdAt: opts.createdAt,
    })
    .returning()
    .get()!
}

// Blind guarded UPDATE — only closes an open row; idempotent on double-close.
// Returns rows changed (0 means already closed).
export function closeSession(
  db: Db,
  opts: { id: number; endedAt: Date; endReason: SessionEndReason },
): number {
  const result = db
    .update(sessions)
    .set({ endedAt: opts.endedAt, endReason: opts.endReason })
    .where(sql`${sessions.id} = ${opts.id} AND ${sessions.endedAt} IS NULL`)
    .run()
  return result.changes
}

// Newest open session for a channel via the partial index. Tolerates >1 open
// row (treats extras as a reconciliation signal) — returns the newest.
// NOT called on the hot path (Decision 3 / plan §U2).
export function getActiveSession(
  db: Db,
  channelId: string,
): ActiveSession | undefined {
  const row = db
    .select()
    .from(sessions)
    .where(
      sql`${sessions.channelId} = ${channelId} AND ${sessions.endedAt} IS NULL`,
    )
    .orderBy(sql`${sessions.createdAt} DESC, ${sessions.id} DESC`)
    .limit(1)
    .get()
  if (!row) return undefined
  if (row.endedAt !== null) return undefined
  return row as ActiveSession
}
