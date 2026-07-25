import { Vector3 } from 'three'

import type { AnimState, PeerSnapshotSample } from 'src/multiplayer/store'

import { lerpAngleShortest } from './avatarInterp'

// Buffered snapshot interpolation for remote peers — replaces the original
// F4 design's per-frame exponential damp toward the latest network packet
// (see multiplayer/store.ts's PeerBuffer comment for why that throbbed).
//
// The technique (standard in networked-game client interpolation, e.g.
// Source engine's `cl_interp`): render slightly in the past
// (`renderTime = now - INTERP_DELAY_MS`, in RemoteAvatars.tsx) rather than at
// "now", so there are almost always two real network snapshots straddling
// the render point. Blend directly between those two fixed values instead of
// chasing a constantly-moving target — for constant real-world velocity,
// this reproduces an exactly constant rendered velocity, since the blend
// between any two points on a straight line at a steady rate is itself
// linear. The delay trades a small, fixed amount of latency (~150ms) for
// eliminating the throb entirely; the old damp scheme paid unbounded latency
// (it never actually reaches a moving target) and still throbbed on top of
// that.

export type SampledPose = {
  yaw: number
  animState: AnimState
  speed: number
}

/**
 * Samples `samples` (oldest first, must be non-empty) at `renderTime` (same
 * `performance.now()` domain as `PeerSnapshotSample.t`), writing the
 * interpolated position into `outPos` and returning the rest of the pose.
 *
 * - Exactly one buffered sample, or `renderTime` at/before the oldest one
 *   (just joined — not enough history yet): holds at that sample, speed 0.
 * - `renderTime` at/after the newest sample (peer stopped emitting — idle
 *   dead-band, or a network stall): holds at that sample, speed 0 —
 *   deliberately never extrapolates. ecctrl movement can start/stop
 *   abruptly, so guessing forward risks overshooting into a wall or off a
 *   step; holding is the safe default the moment fresh data resumes.
 * - Otherwise: linearly blends position and yaw (shortest path) between the
 *   two samples straddling `renderTime`, and derives `speed` analytically
 *   from that same pair's real displacement over real elapsed time — not
 *   from a frame-to-frame rendered delta, which is exactly what let the old
 *   scheme's throb leak into the walk clip's speed-matched cadence
 *   (Avatar.tsx's timeScale).
 */
export function sampleAt(
  samples: readonly PeerSnapshotSample[],
  renderTime: number,
  outPos: Vector3,
): SampledPose {
  const first = samples[0]
  if (!first) {
    // Precondition violation — callers must check `samples.length > 0`
    // first (RemoteAvatars.tsx does, mirroring its existing
    // `if (!group || !buffer) return` guard). Degrades to a harmless frozen
    // idle pose instead of throwing inside a render loop.
    outPos.set(0, 0, 0)
    return { yaw: 0, animState: 'idle', speed: 0 }
  }
  const last = samples[samples.length - 1] ?? first

  if (samples.length === 1 || renderTime <= first.t) {
    outPos.copy(first.pos)
    return { yaw: first.yaw, animState: first.animState, speed: 0 }
  }

  if (renderTime >= last.t) {
    outPos.copy(last.pos)
    return { yaw: last.yaw, animState: last.animState, speed: 0 }
  }

  // renderTime is strictly between first.t and last.t here, so some sample
  // after the first must have `t > renderTime` -- that becomes `newer`;
  // `older` is the sample immediately before it. A plain forward scan (not
  // indexed lookups at point of use) keeps this clean under
  // noUncheckedIndexedAccess without a non-null assertion; the buffer is
  // small (MAX_SNAPSHOT_SAMPLES = 20 in multiplayer/store.ts) so an O(n)
  // scan is trivial either way.
  let older = first
  let newer = last
  for (let i = 1; i < samples.length; i++) {
    const candidate = samples[i]
    if (!candidate) {
      continue
    }
    if (candidate.t > renderTime) {
      newer = candidate
      break
    }
    older = candidate
  }

  const spanMs = newer.t - older.t
  const alpha = spanMs > 0 ? (renderTime - older.t) / spanMs : 1

  outPos.lerpVectors(older.pos, newer.pos, alpha)
  const yaw = lerpAngleShortest(older.yaw, newer.yaw, alpha)

  const dx = newer.pos.x - older.pos.x
  const dz = newer.pos.z - older.pos.z
  const speed = spanMs > 0 ? Math.sqrt(dx * dx + dz * dz) / (spanMs / 1000) : 0

  // A discrete event (the peer's classifier flipped state), not something to
  // blend — using `newer.animState` before the render timeline has actually
  // reached `newer.t` would crossfade the clip early.
  const animState = alpha >= 1 ? newer.animState : older.animState

  return { yaw, animState, speed }
}
