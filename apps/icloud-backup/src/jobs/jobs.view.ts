import { and, eq } from 'drizzle-orm'

import type { Database } from 'src/db/database'
import {
  type Account,
  type Job,
  jobEvents,
  jobs as jobsTable,
} from 'src/db/schema'
import type {
  BackupState,
  BackupView,
  ErrorCode,
  JobView,
} from 'src/shared/contract'

import { INDEXING_LADDER_MS } from './jobs.config'

/** Event type that marks the first download of an account. */
export const DOWNLOAD_STARTED_EVENT = 'download_started'

/**
 * The Apple ID is locked once a download has started for the account. There
 * is no column for it: the event the orchestrator appends when a download
 * starts is the record, and it outlives the job that wrote it.
 */
export async function hasStartedDownload(
  db: Database,
  accountId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: jobEvents.id })
    .from(jobEvents)
    .innerJoin(jobsTable, eq(jobEvents.jobId, jobsTable.id))
    .where(
      and(
        eq(jobsTable.accountId, accountId),
        eq(jobEvents.type, DOWNLOAD_STARTED_EVENT),
      ),
    )
    .limit(1)
  return row !== undefined
}

export function toJobView(job: Job, queuePosition: number | null): JobView {
  return {
    id: job.id,
    kind: job.kind === 'sync' ? 'sync' : 'first_backup',
    state: job.state as BackupState,
    authError:
      job.authError === 'wrong_password' || job.authError === 'wrong_code'
        ? job.authError
        : null,
    queuePosition: job.state === 'queued_login' ? queuePosition : null,
    totalItems: job.totalItems,
    downloadedItems: job.downloadedItems,
    skippedItems: job.skippedItems,
    downloadedBytes: job.downloadedBytes,
    currentFile: job.currentFile,
    attempt: job.attempt,
    maxAttempts: INDEXING_LADDER_MS.length,
    retryAt:
      job.state === 'indexing_wait' && job.retryAt
        ? job.retryAt.toISOString()
        : null,
    errorCode: (job.errorCode as ErrorCode | null) ?? null,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  }
}

export function toBackupView(input: {
  email: string
  isAdmin: boolean
  lowDiskSpace: boolean
  account: Account | null
  appleIdLocked: boolean
  immichUrl: string
  job: JobView | null
}): BackupView {
  const { account } = input
  return {
    email: input.email,
    isAdmin: input.isAdmin,
    lowDiskSpace: input.lowDiskSpace,
    account: account
      ? {
          appleId: account.appleId ?? '',
          appleIdLocked: input.appleIdLocked,
          lastBackupAt: account.lastBackupAt
            ? account.lastBackupAt.toISOString()
            : null,
          totalItems: account.totalItems,
          totalBytes: account.totalBytes,
          immich:
            account.immichUserId &&
            account.immichLibraryId &&
            account.immichEmail
              ? {
                  email: account.immichEmail,
                  createdByUs: account.immichCreatedByUs,
                  url: input.immichUrl,
                }
              : null,
        }
      : null,
    job: input.job,
  }
}
