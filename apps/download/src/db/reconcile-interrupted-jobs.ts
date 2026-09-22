import {
  DownloadJobStatus,
  TERMINAL_DOWNLOAD_JOB_STATUSES,
} from '@lilnas/utils/download/types'
import { notInArray } from 'drizzle-orm'

import type { Db } from './db.service'
import { jobs } from './schema'

/**
 * Non-terminal statuses whose truth lives upstream, not in this process.
 *
 * A `needs_attention` job is finished downloading and stuck at Radarr/Sonarr's
 * import step: the bytes are on disk and the queue row saying so is still
 * there after this process restarts. Failing it would be a lie about upstream
 * state *and* would hand the user a Retry that re-grabs a file they already
 * have. The sweep below spares these rows; `DownloadStateService
 * .adoptSurvivingJobs()` then puts them back in the in-memory Map so the
 * poller picks them up on its first tick.
 */
export const RESTART_SURVIVING_STATUSES = [
  DownloadJobStatus.NeedsAttention,
] as const

// Most non-terminal statuses are process-lifetime state: `DownloadStateService`
// keeps the live progress in its in-memory Map, and this table is only a
// durable record of it. A restart empties that Map, but rows left at
// `downloading`/`converting`/etc. by the previous process stay frozen at
// whatever status they were last written with - nothing else notices they
// died. Run once at boot (see bootstrap.ts), right after checkIntegrity(),
// so `jobs` never reports a status for work that can no longer be running.
//
// The exception is `RESTART_SURVIVING_STATUSES` (see above): those rows
// describe state held by Radarr/Sonarr rather than by this process, so a
// restart tells us nothing new about them and failing them would be wrong.
export function reconcileInterruptedJobs(db: Db): number {
  const result = db
    .update(jobs)
    .set({
      error: 'Interrupted by a service restart',
      status: 'failed',
      updatedAt: new Date(),
    })
    .where(
      notInArray(jobs.status, [
        ...TERMINAL_DOWNLOAD_JOB_STATUSES,
        ...RESTART_SURVIVING_STATUSES,
      ]),
    )
    .run()

  return result.changes
}
