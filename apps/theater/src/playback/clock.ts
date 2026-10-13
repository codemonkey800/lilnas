'use client'

import type { Socket } from 'socket.io-client'

// ---------------------------------------------------------------------------
// Server-clock offset estimation for video sync.
//
// `video:state` carries `atServerMs` — the server-clock instant its
// `playhead` was true. To anchor to that instant, a client needs to know
// where the server's `Date.now()` sits on its own `performance.now()`
// timeline. This module estimates that offset NTP-style: emit `time:ping`,
// note the local send/receive times, and place the server's reply at the
// midpoint of the round trip. Each probe is only as good as its RTT (the
// error bound is ±rtt/2), so the estimate in force is always the lowest-RTT
// probe among the most recent few — recent, so that a laptop sleeping or the
// server's clock being stepped can't leave a stale "best" sample in charge
// forever.
//
// Everything that touches the socket or timers lives in
// `startServerClockSync`; the arithmetic is split out as pure functions so
// it can be unit-tested without a DOM (this app's node-env jest convention).
// ---------------------------------------------------------------------------

export type ClockSample = {
  // `serverMs - clientMs` at the same instant: add to a performance.now()
  // reading to get server time, subtract from a server time to get the
  // matching performance.now() reading.
  offsetMs: number
  rttMs: number
}

// How many recent samples compete for "best". Nine probes arrive in the
// first ~2s of a connection (the burst below), then one every
// `RESAMPLE_INTERVAL_MS` — so this window spans roughly the last two minutes
// of steady state.
const SAMPLE_WINDOW = 8
const BURST_COUNT = 5
const BURST_INTERVAL_MS = 250
const RESAMPLE_INTERVAL_MS = 15_000
// A server timestamp that maps more than this far from the client's "now"
// means the offset estimate is garbage (or the message is absurdly stale);
// fall back to anchoring at receipt rather than trusting it.
const MAX_PLAUSIBLE_ANCHOR_AGE_MS = 10_000

export function computeClockSample(
  sentAtMs: number,
  receivedAtMs: number,
  serverMs: number,
): ClockSample {
  const rttMs = receivedAtMs - sentAtMs
  return { offsetMs: serverMs - (sentAtMs + rttMs / 2), rttMs }
}

// The lowest-RTT sample wins; `samples` is newest-last, so a tie keeps the
// earlier (older) one — irrelevant in practice, but deterministic.
export function selectBestSample(samples: ClockSample[]): ClockSample | null {
  let best: ClockSample | null = null
  for (const sample of samples) {
    if (best === null || sample.rttMs < best.rttMs) {
      best = sample
    }
  }
  return best
}

export function serverMsToClientMs(serverMs: number, offsetMs: number): number {
  return serverMs - offsetMs
}

function isPingAck(value: unknown): value is { serverMs: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { serverMs?: unknown }).serverMs === 'number' &&
    Number.isFinite((value as { serverMs: number }).serverMs)
  )
}

// Module-level, like `multiplayer/store.ts`'s socket — there's exactly one
// server clock to track per page.
let recentSamples: ClockSample[] = []

export function resetServerClock(): void {
  recentSamples = []
}

export function getServerClockOffsetMs(): number | null {
  return selectBestSample(recentSamples)?.offsetMs ?? null
}

/**
 * Maps a server-clock timestamp onto this client's `performance.now()`
 * timeline, or returns `null` when there's no usable estimate yet (or the
 * result is implausible) — callers fall back to `performance.now()`, i.e.
 * the pre-clock-sync "anchor at receipt" behaviour.
 */
export function serverMsToClientClockMs(
  serverMs: number,
  nowMs = performance.now(),
): number | null {
  const offsetMs = getServerClockOffsetMs()
  if (offsetMs === null) {
    return null
  }
  const clientMs = serverMsToClientMs(serverMs, offsetMs)
  if (Math.abs(nowMs - clientMs) > MAX_PLAUSIBLE_ANCHOR_AGE_MS) {
    return null
  }
  return clientMs
}

function probe(socket: Socket): void {
  const sentAtMs = performance.now()
  socket.emit('time:ping', (ack: unknown) => {
    if (!isPingAck(ack)) {
      return
    }
    recentSamples.push(
      computeClockSample(sentAtMs, performance.now(), ack.serverMs),
    )
    if (recentSamples.length > SAMPLE_WINDOW) {
      recentSamples.splice(0, recentSamples.length - SAMPLE_WINDOW)
    }
  })
}

/**
 * Starts probing `socket` for the server clock: a quick burst so the first
 * `video:state` after (re)connect already has an estimate to anchor against,
 * then a slow trickle to keep it fresh. Returns the stop function; `sync.ts`
 * calls this from the same effect that binds its `video:state` listener, so
 * a reconnect that swaps in a new socket restarts probing against it.
 */
export function startServerClockSync(socket: Socket): () => void {
  resetServerClock()

  let burstsLeft = BURST_COUNT
  const burst = window.setInterval(() => {
    probe(socket)
    burstsLeft -= 1
    if (burstsLeft <= 0) {
      window.clearInterval(burst)
    }
  }, BURST_INTERVAL_MS)
  probe(socket)
  const trickle = window.setInterval(() => probe(socket), RESAMPLE_INTERVAL_MS)

  return () => {
    window.clearInterval(burst)
    window.clearInterval(trickle)
  }
}
