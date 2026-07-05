import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'

import type { BotStatusDto } from './bot-status.dto'

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

// Single source of truth for the botOffline rule — shared by LiveService's
// getLive() and SseHubService's computeLiveDigest() so the two derivations
// of the same live-page rule (one building the real DTO, one a cheap digest
// for change-detection) cannot silently diverge on what 'starting' means.
// 'starting' counts as online: a bot that has begun but hasn't heartbeated
// yet isn't known-bad.
export function isBotOffline(status: BotStatusDto['status']): boolean {
  return status !== 'online' && status !== 'starting'
}
