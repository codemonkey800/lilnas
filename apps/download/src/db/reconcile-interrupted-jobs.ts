import { TERMINAL_DOWNLOAD_JOB_STATUSES } from '@lilnas/utils/download/types'
import { notInArray } from 'drizzle-orm'

import type { Db } from './db.service'
import { jobs } from './schema'

// Every non-terminal status is process-lifetime state: `DownloadStateService`
// keeps the live progress in its in-memory Map, and this table is only a
// durable record of it. A restart empties that Map, but rows left at
// `downloading`/`converting`/etc. by the previous process stay frozen at
// whatever status they were last written with - nothing else notices they
// died. Run once at boot (see bootstrap.ts), right after checkIntegrity(),
// so `jobs` never reports a status for work that can no longer be running.
export function reconcileInterruptedJobs(db: Db): number {
  const result = db
    .update(jobs)
    .set({
      error: 'Interrupted by a service restart',
      status: 'failed',
      updatedAt: new Date(),
    })
    .where(notInArray(jobs.status, [...TERMINAL_DOWNLOAD_JOB_STATUSES]))
    .run()

  return result.changes
}
