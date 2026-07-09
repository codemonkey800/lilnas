import { sql } from 'drizzle-orm'

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

// Keyset-paginated event feed — ordered by id DESC (newest first).
// Optional filters: type, level, channelId.
// Caller fetches limit+1 and passes to paginate() to compute nextCursor.
export function listEvents(
  db: Db,
  opts: {
    type?: EventType
    level?: EventLevel
    channelId?: string
    cursor?: number
    limit: number
  },
): EventRow[] {
  const conditions = []
  if (opts.type !== undefined) {
    conditions.push(sql`${events.type} = ${opts.type}`)
  }
  if (opts.level !== undefined) {
    conditions.push(sql`${events.level} = ${opts.level}`)
  }
  if (opts.channelId !== undefined) {
    conditions.push(sql`${events.channelId} = ${opts.channelId}`)
  }
  if (opts.cursor !== undefined) {
    conditions.push(sql`${events.id} < ${opts.cursor}`)
  }
  const where =
    conditions.length > 0 ? sql.join(conditions, sql` AND `) : sql`1=1`

  return db
    .select()
    .from(events)
    .where(where)
    .orderBy(sql`${events.id} DESC`)
    .limit(opts.limit + 1)
    .all()
}
