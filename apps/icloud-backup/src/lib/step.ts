import type { BackupView } from 'src/shared/contract'

export type StepName =
  | 'preflight'
  | 'sign_in'
  | 'waiting_turn'
  | 'code'
  | 'checking'
  | 'queued'
  | 'indexing'
  | 'downloading'
  | 'finishing'
  | 'done'
  | 'sign_in_again'
  | 'paused'
  | 'failed'

/**
 * Which screen a view belongs on. Pure. `sign_in` is also what the pre-flight
 * page leads into by itself (local UI state, no backend state exists for it).
 */
export function stepFor(view: BackupView): StepName {
  const { account, job } = view
  if (!account || !job) return 'preflight'

  switch (job.state) {
    case 'need_password':
      return 'sign_in'
    case 'queued_login':
      return 'waiting_turn'
    case 'need_code':
      return 'code'
    case 'checking_password':
    case 'checking_code':
      return 'checking'
    case 'queued_download':
      return 'queued'
    case 'indexing_wait':
      return 'indexing'
    case 'downloading':
      return 'downloading'
    case 'provisioning':
      return 'finishing'
    case 'done':
      return 'done'
    case 'needs_login':
      return 'sign_in_again'
    case 'paused_low_disk':
      return 'paused'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return account.lastBackupAt ? 'failed' : 'preflight'
  }
}
