import type { BackupState, BackupView, JobView } from 'src/shared/contract'

export function makeJob(
  state: BackupState,
  over: Partial<JobView> = {},
): JobView {
  return {
    id: 'job-1',
    kind: 'first_backup',
    state,
    authError: null,
    queuePosition: null,
    totalItems: null,
    downloadedItems: 0,
    skippedItems: 0,
    downloadedBytes: 0,
    currentFile: null,
    attempt: 0,
    maxAttempts: 5,
    retryAt: null,
    errorCode: null,
    startedAt: '2026-11-19T10:00:00.000Z',
    finishedAt: null,
    ...over,
  }
}

export function makeView(
  state: BackupState | null,
  over: Partial<BackupView> = {},
  lastBackupAt: string | null = null,
): BackupView {
  return {
    email: 'sam@example.com',
    isAdmin: false,
    lowDiskSpace: false,
    account: {
      appleId: 'nobody@example.invalid',
      appleIdLocked: false,
      lastBackupAt,
      totalItems: 0,
      totalBytes: 0,
      immich: null,
    },
    job: state ? makeJob(state) : null,
    ...over,
  }
}
