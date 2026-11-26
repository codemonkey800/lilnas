import { env } from '@lilnas/utils/env'
import { Injectable } from '@nestjs/common'

import { EnvKeys } from 'src/env'

export const DEFAULT_MAX_STREAMS_PER_USER = 6

// Accepts only a plain positive integer ("6", " 12 "); anything else
// ("0", "-1", "2.5", "abc", "") falls back to the default rather than
// disabling the cap or failing boot.
export function parseMaxStreams(raw: string | undefined): number {
  const trimmed = raw?.trim() ?? ''
  if (!/^[1-9]\d*$/.test(trimmed)) return DEFAULT_MAX_STREAMS_PER_USER
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : DEFAULT_MAX_STREAMS_PER_USER
}

// ──────────────────────────────────────────────────────────────────────────────
// Caps how many SSE streams one signed-in user holds open at once, across
// /sse/pending and /sse/admin together (one count per userId). Each open
// stream pins a socket and a timer, so without a cap one session could open
// them without bound. The cap (SSE_MAX_STREAMS_PER_USER, default 6) is read
// once at construction.
//
// acquire() hands back a release function that is idempotent: the
// controller calls it from both the Observable's teardown and the request's
// `close` event, and only the first call decrements. A user's entry is
// deleted when the count reaches zero, so the map holds only users with a
// live stream.
// ──────────────────────────────────────────────────────────────────────────────
@Injectable()
export class SseStreamLimiter {
  private readonly counts = new Map<string, number>()
  private readonly maxPerUser = parseMaxStreams(
    env(EnvKeys.SSE_MAX_STREAMS_PER_USER, ''),
  )

  get cap(): number {
    return this.maxPerUser
  }

  /** Takes a slot for the user. Returns an idempotent release function, or null at the cap. */
  acquire(userId: string): (() => void) | null {
    const current = this.counts.get(userId) ?? 0
    if (current >= this.maxPerUser) return null
    this.counts.set(userId, current + 1)

    let released = false
    return () => {
      if (released) return
      released = true
      const count = this.counts.get(userId) ?? 0
      if (count <= 1) {
        this.counts.delete(userId)
      } else {
        this.counts.set(userId, count - 1)
      }
    }
  }

  openStreams(userId: string): number {
    return this.counts.get(userId) ?? 0
  }

  /** Number of users holding at least one stream (for tests). */
  trackedUsers(): number {
    return this.counts.size
  }
}
