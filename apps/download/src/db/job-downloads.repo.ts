import {
  DownloadJobStatus,
  TERMINAL_DOWNLOAD_JOB_STATUSES,
} from '@lilnas/utils/download/types'
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm'

import type { Db } from './db.service'
import { type ArrApp, type JobDownloadRow, jobDownloads, jobs } from './schema'

export interface LinkDownloadInput {
  app: ArrApp
  downloadId: string
  /**
   * The grab event's `date`, or `null` when the download is linked from its
   * queue item before that event has been read.
   */
  grabbedAt: string | null
  /** The grab event's `releaseSource === 'InteractiveSearch'`, when known. */
  interactive?: boolean
  jobId: string
}

/**
 * Links a download to a job. Idempotent on the `(job_id, download_id)` key:
 * linking the same pair again never duplicates the row and never overwrites
 * what the first link recorded. The one thing a repeat link *can* do is fill
 * a gap - a download linked from the queue first (no grab date, no
 * `interactive`) picks both up when the grab event arrives - which is why
 * this is `COALESCE(existing, incoming)` rather than a bare insert-or-ignore.
 *
 * Returns the row as it stands after the write.
 */
export function linkDownload(db: Db, input: LinkDownloadInput): JobDownloadRow {
  return db
    .insert(jobDownloads)
    .values({
      app: input.app,
      downloadId: input.downloadId,
      grabbedAt: input.grabbedAt,
      interactive: input.interactive ?? null,
      jobId: input.jobId,
    })
    .onConflictDoUpdate({
      set: {
        grabbedAt: sql`coalesce(${jobDownloads.grabbedAt}, excluded.grabbed_at)`,
        interactive: sql`coalesce(${jobDownloads.interactive}, excluded.interactive)`,
      },
      target: [jobDownloads.jobId, jobDownloads.downloadId],
    })
    .returning()
    .get()
}

/**
 * Marks a download imported on every job it is linked to - one download can
 * cover several jobs (a season pack satisfies both a season job and an
 * episode job). Idempotent: a row that already has an `imported_at` keeps
 * it, so replaying the same history event changes nothing.
 *
 * Returns only the rows this call actually changed, so a caller replaying
 * history can tell a new outcome from one it has already applied.
 */
export function markImported(
  db: Db,
  app: ArrApp,
  downloadId: string,
  at: string,
): JobDownloadRow[] {
  return db
    .update(jobDownloads)
    .set({ importedAt: at })
    .where(
      and(
        eq(jobDownloads.app, app),
        eq(jobDownloads.downloadId, downloadId),
        isNull(jobDownloads.importedAt),
      ),
    )
    .returning()
    .all()
}

/**
 * Marks a download failed on every job it is linked to, with upstream's
 * reason. The same idempotency and return shape as `markImported`: the first
 * failure's time and reason stick. Independent of `imported_at` - the two
 * are separate history events and this layer records whichever arrive;
 * deciding what a download that has both means is the caller's job.
 */
export function markFailed(
  db: Db,
  app: ArrApp,
  downloadId: string,
  at: string,
  reason: string | null,
): JobDownloadRow[] {
  return db
    .update(jobDownloads)
    .set({ failReason: reason, failedAt: at })
    .where(
      and(
        eq(jobDownloads.app, app),
        eq(jobDownloads.downloadId, downloadId),
        isNull(jobDownloads.failedAt),
      ),
    )
    .returning()
    .all()
}

/** Every download linked to one job, in the order they were linked. */
export function listForJob(db: Db, jobId: string): JobDownloadRow[] {
  return db
    .select()
    .from(jobDownloads)
    .where(eq(jobDownloads.jobId, jobId))
    .orderBy(sql`rowid`)
    .all()
}

/**
 * Every link for one download - one row per job it belongs to, whatever
 * state those jobs are in. The history path's entry point: an event names an
 * app and a download id, never a job.
 */
export function findJobsByDownloadId(
  db: Db,
  app: ArrApp,
  downloadId: string,
): JobDownloadRow[] {
  return db
    .select()
    .from(jobDownloads)
    .where(
      and(eq(jobDownloads.app, app), eq(jobDownloads.downloadId, downloadId)),
    )
    .orderBy(sql`rowid`)
    .all()
}

/**
 * Every download id of `app` linked to a job that is still in flight - the
 * adoption dedupe: a queued download in this set already belongs to a job,
 * so the poller must not mint an `upstream` job for it.
 *
 * Non-terminal jobs only, matching the in-memory set this replaces: the
 * poller dropped a job's download ids on the first tick after it settled
 * (`forgetUntrackedJobs`), so a finished job never kept its downloads
 * claimed. That is also what lets a download that outlives its job - one
 * someone re-queued by hand in Radarr's UI after a cancel - be adopted
 * rather than silently ignored forever.
 */
export function claimedDownloadIds(db: Db, app: ArrApp): Set<string> {
  const rows = db
    .selectDistinct({ downloadId: jobDownloads.downloadId })
    .from(jobDownloads)
    .innerJoin(jobs, eq(jobs.id, jobDownloads.jobId))
    .where(
      and(
        eq(jobDownloads.app, app),
        notInArray(jobs.status, [...TERMINAL_DOWNLOAD_JOB_STATUSES]),
      ),
    )
    .all()

  return new Set(rows.map(row => row.downloadId))
}

/**
 * Every download of `app` linked to a job that ended cancelled with
 * `statusNote` - a cancel that left the download running on purpose (a
 * season pack that also carries other episodes). Such a download is still
 * that job's: adoption must not mint an `upstream` job for it, nor reopen
 * the job it was just cancelled out of.
 *
 * A link whose download failed is left out - a failed download is no longer
 * running. One that recorded an import is kept: Sonarr records the first
 * episode's import while the rest of the pack is still queued.
 */
export function keptDownloadIds(
  db: Db,
  app: ArrApp,
  statusNote: string,
): Set<string> {
  const rows = db
    .selectDistinct({ downloadId: jobDownloads.downloadId })
    .from(jobDownloads)
    .innerJoin(jobs, eq(jobs.id, jobDownloads.jobId))
    .where(
      and(
        eq(jobDownloads.app, app),
        isNull(jobDownloads.failedAt),
        eq(jobs.status, DownloadJobStatus.Cancelled),
        eq(jobs.statusNote, statusNote),
      ),
    )
    .all()

  return new Set(rows.map(row => row.downloadId))
}
