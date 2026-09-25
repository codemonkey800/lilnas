import {
  DownloadJobStatus,
  DownloadType,
  TERMINAL_DOWNLOAD_JOB_STATUSES,
} from '@lilnas/utils/download/types'
import { and, eq, notInArray } from 'drizzle-orm'

import type { Db } from './db.service'
import { jobs } from './schema'

// A video job is process-lifetime state: this process runs yt-dlp/ffmpeg
// itself, keeps the live progress in `DownloadStateService`'s in-memory Map,
// and writes the partial file under `/download/videos`, which has no volume
// behind it. A restart kills the process, empties the Map and destroys the
// bytes, but rows left at `downloading`/`converting`/`paused`/etc. by the
// previous process stay frozen at whatever status they were last written
// with - nothing else notices they died. Run once at boot (see bootstrap.ts),
// right after checkIntegrity(), so `jobs` never reports a status for a video
// that can no longer be running. `paused` is swept too: there is no partial
// file left to resume from.
//
// Movie and show rows are never touched. Their download runs in
// Radarr/Sonarr, which outlived this process, so a restart tells us nothing
// about them - failing one would be a lie about upstream (the file can still
// land). `DownloadStateService.adoptOpenJobs()` re-adopts them instead, and
// the poller settles them from the queue and the files on its next tick.
//
// A `needs_attention` row is spared whatever its type, for the same reason:
// it names Radarr/Sonarr's "Downloaded - Waiting to Import" queue row, which
// is still there after a restart, and failing it would hand the user a Retry
// that re-grabs a file they already have. Only the poller sets it, and only
// on movie/show jobs, so a `needs_attention` video should not exist - the
// exemption keeps the rule "needs_attention always survives" true regardless.
export function reconcileInterruptedJobs(db: Db): number {
  const result = db
    .update(jobs)
    .set({
      error: 'Interrupted by a service restart',
      status: 'failed',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.type, DownloadType.Video),
        notInArray(jobs.status, [
          ...TERMINAL_DOWNLOAD_JOB_STATUSES,
          DownloadJobStatus.NeedsAttention,
        ]),
      ),
    )
    .run()

  return result.changes
}
