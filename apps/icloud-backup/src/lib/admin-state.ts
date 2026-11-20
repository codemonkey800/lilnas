import type { BadgeTone } from '@lilnas/ui'

import type { BackupState } from 'src/shared/contract'

export type StateBadge = { tone: BadgeTone; label: string; live: boolean }

/**
 * How a job state reads in the admin table. Running work is the accent,
 * finished work is ok, anything held up (queued, waiting on the person,
 * paused, sign in again) is warn and a failure is bad.
 */
export const STATE_BADGES: Record<BackupState, StateBadge> = {
  queued_login: { tone: 'warn', label: 'Waiting for a turn', live: false },
  need_password: { tone: 'warn', label: 'Waiting for password', live: false },
  checking_password: { tone: 'accent', label: 'Signing in', live: true },
  need_code: { tone: 'warn', label: 'Waiting for code', live: false },
  checking_code: { tone: 'accent', label: 'Signing in', live: true },
  queued_download: { tone: 'warn', label: 'Queued', live: false },
  indexing_wait: { tone: 'warn', label: 'Waiting for Apple', live: false },
  downloading: { tone: 'accent', label: 'Downloading', live: true },
  provisioning: { tone: 'accent', label: 'Finishing', live: true },
  done: { tone: 'ok', label: 'Up to date', live: false },
  needs_login: { tone: 'warn', label: 'Sign in again', live: false },
  paused_low_disk: { tone: 'warn', label: 'Paused', live: false },
  failed: { tone: 'bad', label: 'Failed', live: false },
  cancelled: { tone: 'mute', label: 'Cancelled', live: false },
}
