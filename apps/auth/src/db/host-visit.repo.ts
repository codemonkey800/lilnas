import { eq, gte, max, sql } from 'drizzle-orm'

import type { Db } from './database.module'
import { hostVisit } from './schema'

// host_visit table access — see schema.ts's own comment on `hostVisit` for
// what a row means. Placed in src/db/ (like gated-host.repo.ts) because its
// writer (/verify) and its reader (the /internal/host-activity route) are
// unrelated features.

export type HostActivitySummary = {
  // Distinct users whose last visit falls at or after `since`.
  activeUsers: number
  // The most recent visit by anyone, regardless of `since`; null if the host
  // has never recorded one.
  lastVisitAt: Date | null
}

// Insert-or-bump: one row per (host, user), `lastSeenAt` moves on every call.
export function upsertHostVisit(
  db: Db,
  host: string,
  userId: string,
  now: Date,
): void {
  db.insert(hostVisit)
    .values({ host, userId, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [hostVisit.host, hostVisit.userId],
      set: { lastSeenAt: now },
    })
    .run()
}

export function summarizeHostActivity(
  db: Db,
  host: string,
  since: Date,
): HostActivitySummary {
  const [row] = db
    .select({
      activeUsers: sql<number>`count(case when ${gte(hostVisit.lastSeenAt, since)} then 1 end)`,
      lastVisitAt: max(hostVisit.lastSeenAt),
    })
    .from(hostVisit)
    .where(eq(hostVisit.host, host))
    .all()

  return {
    activeUsers: row?.activeUsers ?? 0,
    lastVisitAt: row?.lastVisitAt ? new Date(row.lastVisitAt) : null,
  }
}
