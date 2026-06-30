import type { Db } from './database.module'
import {
  type EventContext,
  type EventLevel,
  type EventRow,
  events,
  type EventType,
} from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// events repo — written from four sites: composite writer (transcript_write_failed),
// session-manager (session_created/evicted, turn events), supervisor (bot_restart),
// command-poller (command_anomaly).
// ──────────────────────────────────────────────────────────────────────────────

export function insertEvent(
  db: Db,
  opts: {
    generationId: number
    sessionId?: number | null
    channelId?: string | null
    type: EventType
    level: EventLevel
    context: EventContext
    createdAt: Date
  },
): EventRow {
  return db
    .insert(events)
    .values({
      generationId: opts.generationId,
      sessionId: opts.sessionId ?? null,
      channelId: opts.channelId ?? null,
      type: opts.type,
      level: opts.level,
      context: opts.context,
      createdAt: opts.createdAt,
    })
    .returning()
    .get()!
}
