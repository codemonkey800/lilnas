import { livePgids, markExited } from 'src/db/claude-process.repo'
import type { Db } from 'src/db/database.module'
import { getBackendLogger } from 'src/logging/backend-logger'
import { LOG_EVENTS } from 'src/logging/log-events'

// Non-DI (plain exported function, no class) — uses getBackendLogger()
// (src/logging/backend-logger.ts), fetched AT LOG TIME inside the function
// body below, never at module-eval time.

// Age beyond which an un-exited claude_process row is assumed stale (the OS
// may have recycled the PGID onto an unrelated group). Set well under the
// realistic PID-recycle horizon on the host (~minutes).
const PGID_STALE_TTL_MS = 30 * 60 * 1000 // 30 minutes

// One reaper per generation — called from every termination path in the
// supervisor. Reads live PGIDs from the DB, guards against PGID reuse via a
// TTL check, and kills only fresh groups.
export function reapGeneration(
  db: Db,
  generationId: number,
  now: Date = new Date(),
): void {
  const rows = livePgids(db, generationId)
  let killed = 0
  let staleSkipped = 0
  for (const row of rows) {
    const age = now.getTime() - row.spawnedAt.getTime()
    if (age > PGID_STALE_TTL_MS) {
      // Row is older than the recycle horizon — mark exited without killing.
      staleSkipped++
      markExited(db, { pgid: row.pgid, generationId, exitedAt: now })
      continue
    }
    try {
      process.kill(-row.pgid, 'SIGKILL')
      killed++
    } catch {
      // Already dead — swallowed (idempotent).
    }
    markExited(db, { pgid: row.pgid, generationId, exitedAt: now })
  }
  getBackendLogger().info(
    {
      event: LOG_EVENTS.reaperPassComplete,
      generationId,
      killed,
      staleSkipped,
    },
    'Reaper pass complete',
  )
}
