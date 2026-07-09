import { eq, sql } from 'drizzle-orm'

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

// Keyset-paginated session list — ordered by id DESC (newest first).
// Optional channel filter uses sessions_channel_created_idx.
// Caller fetches limit+1 and passes to paginate() to compute nextCursor.
export function listSessions(
  db: Db,
  opts: { channelId?: string; cursor?: number; limit: number },
): SessionRow[] {
  const conditions = []
  if (opts.channelId !== undefined) {
    conditions.push(sql`${sessions.channelId} = ${opts.channelId}`)
  }
  if (opts.cursor !== undefined) {
    conditions.push(sql`${sessions.id} < ${opts.cursor}`)
  }
  const where =
    conditions.length > 0 ? sql.join(conditions, sql` AND `) : sql`1=1`

  return db
    .select()
    .from(sessions)
    .where(where)
    .orderBy(sql`${sessions.id} DESC`)
    .limit(opts.limit + 1)
    .all()
}

export function getSessionById(db: Db, id: number): SessionRow | undefined {
  return db.select().from(sessions).where(eq(sessions.id, id)).get()
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

// Newest session row for a channel regardless of endedAt — the reactivation
// lookup (U1/U4). Unlike getActiveSession this deliberately returns closed
// rows too, so the caller can read acpSessionId/cwd off a dormant session.
export function getLatestSessionForChannel(
  db: Db,
  channelId: string,
): SessionRow | undefined {
  return db
    .select()
    .from(sessions)
    .where(sql`${sessions.channelId} = ${channelId}`)
    .orderBy(sql`${sessions.createdAt} DESC, ${sessions.id} DESC`)
    .limit(1)
    .get()
}

// Blind guarded UPDATE — nulls acp_session_id on the channel's single latest
// row (by createdAt/id), live or dormant, so /clear severs resume regardless
// of whether a live session exists. Targets only the latest row via a
// subquery — every other row for the channel (and every row for other
// channels) is left untouched. No-op (0 changes) when the channel has no rows.
export function clearAcpSessionId(db: Db, channelId: string): number {
  const result = db
    .update(sessions)
    .set({ acpSessionId: null })
    .where(
      sql`${sessions.id} = (
        SELECT id FROM sessions
        WHERE channel_id = ${channelId}
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      )`,
    )
    .run()
  return result.changes
}
