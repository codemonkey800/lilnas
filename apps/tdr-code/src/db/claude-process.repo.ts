import { sql } from 'drizzle-orm'

import type { Db } from './database.module'
import { claudeProcess, type ClaudeProcessRow } from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// claude-process repo — shared between bot (spawn/exit) and supervisor (reap).
// All writes are blind INSERT/UPDATE — no read-modify-write.
// ──────────────────────────────────────────────────────────────────────────────

export function recordSpawn(
  db: Db,
  opts: {
    generationId: number
    pgid: number
    channelId: string | null
    spawnedAt: Date
  },
): ClaudeProcessRow {
  return db
    .insert(claudeProcess)
    .values({
      generationId: opts.generationId,
      pgid: opts.pgid,
      channelId: opts.channelId,
      spawnedAt: opts.spawnedAt,
    })
    .returning()
    .get()!
}

export function markExited(
  db: Db,
  opts: { pgid: number; generationId: number; exitedAt: Date },
): number {
  const result = db
    .update(claudeProcess)
    .set({ exitedAt: opts.exitedAt })
    .where(
      sql`${claudeProcess.pgid} = ${opts.pgid}
        AND ${claudeProcess.generationId} = ${opts.generationId}
        AND ${claudeProcess.exitedAt} IS NULL`,
    )
    .run()
  return result.changes
}

// Returns live (not yet exited) PGID rows for this generation.
export function livePgids(db: Db, generationId: number): ClaudeProcessRow[] {
  return db
    .select()
    .from(claudeProcess)
    .where(
      sql`${claudeProcess.generationId} = ${generationId}
        AND ${claudeProcess.exitedAt} IS NULL`,
    )
    .all()
}
