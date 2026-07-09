import { eq, isNull, sql } from 'drizzle-orm'

import type { Db } from './database.module'
import {
  botGeneration,
  type BotGenerationRow,
  type BotGenerationStatus,
} from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// bot-generation repo — shared between main server and bot.
// All writes are guarded (WHERE clauses) so terminal rows cannot be mutated.
// ──────────────────────────────────────────────────────────────────────────────

export function insertGeneration(
  db: Db,
  opts: { startedAt: Date },
): BotGenerationRow {
  return db
    .insert(botGeneration)
    .values({ startedAt: opts.startedAt, status: 'starting' })
    .returning()
    .get()!
}

// Returns rows changed (0 means the row was already terminal / wrong status).
export function markRunning(
  db: Db,
  id: number,
  pid: number,
  heartbeatAt: Date,
): number {
  const result = db
    .update(botGeneration)
    .set({ status: 'running', pid, lastHeartbeatAt: heartbeatAt })
    .where(
      sql`${botGeneration.id} = ${id} AND ${botGeneration.status} = 'starting'`,
    )
    .run()
  return result.changes
}

// Returns rows changed (0 means already terminal or wrong status).
export function markStopping(db: Db, id: number): number {
  const result = db
    .update(botGeneration)
    .set({ status: 'stopping' })
    .where(
      sql`${botGeneration.id} = ${id} AND ${botGeneration.endedAt} IS NULL`,
    )
    .run()
  return result.changes
}

export function heartbeat(db: Db, id: number, now: Date): number {
  const result = db
    .update(botGeneration)
    .set({ lastHeartbeatAt: now })
    .where(
      sql`${botGeneration.id} = ${id} AND ${botGeneration.status} = 'running'`,
    )
    .run()
  return result.changes
}

// Terminal write-once: only applies when ended_at IS NULL.
export function finalize(
  db: Db,
  id: number,
  status: Extract<BotGenerationStatus, 'stopped' | 'crashed' | 'failed'>,
  exitCode: number | null,
  endedAt: Date,
): number {
  const result = db
    .update(botGeneration)
    .set({ status, exitCode, endedAt })
    .where(
      sql`${botGeneration.id} = ${id} AND ${botGeneration.endedAt} IS NULL`,
    )
    .run()
  return result.changes
}

export function latestGeneration(db: Db): BotGenerationRow | undefined {
  return db
    .select()
    .from(botGeneration)
    .orderBy(sql`${botGeneration.id} DESC`)
    .limit(1)
    .get()
}

export function generationById(
  db: Db,
  id: number,
): BotGenerationRow | undefined {
  return db.select().from(botGeneration).where(eq(botGeneration.id, id)).get()
}

// All non-ended (live) generations — used by reconciliation on boot.
export function liveGenerations(db: Db): BotGenerationRow[] {
  return db
    .select()
    .from(botGeneration)
    .where(isNull(botGeneration.endedAt))
    .all()
}
