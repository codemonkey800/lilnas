import { asc, gte } from 'drizzle-orm'

import type { Db } from './database.module'
import { gatedHost, type GatedHostRow } from './schema'

// gated_host table access — see schema.ts's own comment on `gatedHost` for
// what a row means. Placed in src/db/ (like discord-link.repo.ts) rather
// than a feature folder because its writer (/verify) and its reader (the
// service registry) are unrelated features.

// Insert-or-bump: `firstSeenAt` is written once, `lastSeenAt` on every call.
export function upsertGatedHost(db: Db, host: string, now: Date): void {
  db.insert(gatedHost)
    .values({ host, firstSeenAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: gatedHost.host,
      set: { lastSeenAt: now },
    })
    .run()
}

export function listGatedHostsSeenSince(db: Db, since: Date): GatedHostRow[] {
  return db
    .select()
    .from(gatedHost)
    .where(gte(gatedHost.lastSeenAt, since))
    .orderBy(asc(gatedHost.host))
    .all()
}
