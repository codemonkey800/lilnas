import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'

// Timings of the state machine. Everything here is fixed by the plan; only
// the paths and limits below come from the environment.

/** How often the sign-in form is read. */
export const POLL_MS = 1_000
/** No input for this long while a sign-in form waits: the job fails. */
export const LOGIN_IDLE_MS = 10 * 60_000
/** How long to wait for icloudpd to exit after it says it is signed in. */
export const AUTH_EXIT_GRACE_MS = 30_000
export const MAX_PASSWORD_FAILURES = 3

/** Progress is written to the database and announced at most this often. */
export const PROGRESS_MS = 1_000
export const DISK_CHECK_MS = 60_000

/** Apple has not finished indexing the library: wait, then try again. */
export const INDEXING_LADDER_MS = [
  60_000, 120_000, 240_000, 480_000, 600_000, 600_000,
] as const
/** Any other download failure. */
export const ERROR_LADDER_MS = [30_000, 120_000, 600_000] as const
/** How many log lines of a failed download go into `errorDetail`. */
export const ERROR_LOG_LINES = 20

export interface JobsConfig {
  photosRoot: string
  stateRoot: string
  minFreeBytes: number
  maxDownloads: number
  /** Dry runs only: `--recent N`. */
  recent: number | undefined
  immichPlusTag: string
  slugPrefix: string
  immichExternalUrl: string
}

function positiveInt(raw: string): number | undefined {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 ? n : undefined
}

/** Read at call time, so a spec (or an operator) can change it between jobs. */
export function readConfig(): JobsConfig {
  const minFree = Number(env(EnvKeys.MIN_FREE_BYTES, '200000000000'))
  return {
    photosRoot: env(EnvKeys.PHOTOS_ROOT, '/photos'),
    stateRoot: env(EnvKeys.STATE_ROOT, '/state'),
    minFreeBytes: Number.isFinite(minFree) && minFree >= 0 ? minFree : 2e11,
    maxDownloads: positiveInt(env(EnvKeys.MAX_DOWNLOADS, '2')) ?? 2,
    recent: positiveInt(env(EnvKeys.ICLOUDPD_RECENT, '')),
    immichPlusTag: env(EnvKeys.IMMICH_EMAIL_PLUS_TAG, ''),
    slugPrefix: env(EnvKeys.ACCOUNT_SLUG_PREFIX, ''),
    immichExternalUrl: env(
      EnvKeys.IMMICH_EXTERNAL_URL,
      'https://immich.lilnas.io',
    ).replace(/\/+$/, ''),
  }
}
