import { livePgids, markExited } from 'src/db/claude-process.repo'
import type { Db } from 'src/db/database.module'

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
  for (const row of rows) {
    const age = now.getTime() - row.spawnedAt.getTime()
    if (age > PGID_STALE_TTL_MS) {
      // Row is older than the recycle horizon — mark exited without killing.
      markExited(db, { pgid: row.pgid, generationId, exitedAt: now })
      continue
    }
    try {
      process.kill(-row.pgid, 'SIGKILL')
    } catch {
      // Already dead — swallowed (idempotent).
    }
    markExited(db, { pgid: row.pgid, generationId, exitedAt: now })
  }
}
