import type { JobView } from 'src/shared/contract'

/**
 * How far along a backup is, 0 to 100, or null while the total is not known.
 * Items already on the server count as done. Rounded down so a bar never says
 * 100 before the last file.
 */
export function progressPercent(
  job: Pick<JobView, 'totalItems' | 'downloadedItems' | 'skippedItems'>,
): number | null {
  if (job.totalItems === null) return null
  if (job.totalItems <= 0) return 0

  const done = Math.max(0, job.downloadedItems) + Math.max(0, job.skippedItems)
  return Math.min(100, Math.floor((done / job.totalItems) * 100))
}
