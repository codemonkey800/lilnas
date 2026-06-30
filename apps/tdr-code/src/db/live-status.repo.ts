import { sql } from 'drizzle-orm'

import type { Db } from './database.module'
import { liveStatus, type LiveStatusRow } from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// live-status repo — generation-guarded upsert/heartbeat so two-process writes
// cannot produce a lost update on the single channel_id PK row.
//
// Key invariant: the SET clause re-stamps generation_id so a channel surviving
// a bot restart is re-stamped to the live generation (Decision 8). Without it
// the stamp drifts and the B8 offline-derivation mis-classifies the row.
//
// listLive is NOT here — its only consumer is the deferred B8 reader (plan §U5).
// ──────────────────────────────────────────────────────────────────────────────

export function upsertLiveStatus(
  db: Db,
  opts: {
    channelId: string
    generationId: number
    triggeringUserId: string | null
    prompting: boolean
    queueDepth: number
    lastActivityAt: Date
    lastHeartbeatAt: Date
  },
): void {
  db.insert(liveStatus)
    .values({
      channelId: opts.channelId,
      generationId: opts.generationId,
      triggeringUserId: opts.triggeringUserId,
      prompting: opts.prompting,
      queueDepth: opts.queueDepth,
      lastActivityAt: opts.lastActivityAt,
      lastHeartbeatAt: opts.lastHeartbeatAt,
    })
    .onConflictDoUpdate({
      target: liveStatus.channelId,
      set: {
        generationId: opts.generationId,
        triggeringUserId: opts.triggeringUserId,
        prompting: opts.prompting,
        queueDepth: opts.queueDepth,
        lastActivityAt: opts.lastActivityAt,
        lastHeartbeatAt: opts.lastHeartbeatAt,
      },
      setWhere: sql`${liveStatus.generationId} <= ${opts.generationId}`,
    })
    .run()
}

// Heartbeat: update last_heartbeat_at for all live-generation rows.
// Returns rows changed (0 = no active rows → caller stops the timer).
export function heartbeatLiveStatus(
  db: Db,
  generationId: number,
  at: Date,
): number {
  const result = db
    .update(liveStatus)
    .set({ lastHeartbeatAt: at })
    .where(sql`${liveStatus.generationId} = ${generationId}`)
    .run()
  return result.changes
}

export function removeLiveStatus(db: Db, channelId: string): void {
  db.delete(liveStatus)
    .where(sql`${liveStatus.channelId} = ${channelId}`)
    .run()
}

// Clear stale prior-generation rows — used by the deferred boot-reconciliation
// sweep. NOT called on the hot path.
export function clearStaleByGeneration(
  db: Db,
  liveGenerationId: number,
): number {
  const result = db
    .delete(liveStatus)
    .where(sql`${liveStatus.generationId} != ${liveGenerationId}`)
    .run()
  return result.changes
}

// Read all rows — for tests only.
export function allLiveStatus(db: Db): LiveStatusRow[] {
  return db.select().from(liveStatus).all()
}
