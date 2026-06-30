import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'

// staleThreshold = heartbeatInterval + busy_timeout + margin.
// Kept lazy (reads env at call time) so per-test env overrides still work.
export function staleThresholdMs(): number {
  const heartbeatMs = parseInt(env(EnvKeys.BOT_HEARTBEAT_MS, '5000'), 10)
  const busyTimeoutMs = 5000
  const margin = 5000
  const override = parseInt(
    env(EnvKeys.BOT_HEARTBEAT_STALE_THRESHOLD_MS, '0'),
    10,
  )
  return override > 0 ? override : heartbeatMs + busyTimeoutMs + margin
}
