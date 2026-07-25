import { Vector3 } from 'three'

import { sampleAt } from 'src/components/Scene/snapshotInterp'
import type { PeerSnapshotSample } from 'src/multiplayer/store'

// Regression tests for the throbbing/stuttering remote-walk bug: the OLD
// `RemoteAvatars.tsx` scheme exponentially damped `group.position` toward
// only the LATEST 13 Hz network packet every frame. Low-pass filtering a
// piecewise-constant (staircase) signal like that can only ever hand back a
// staircase or a rubber-banding exponential -- never the constant-velocity
// glide real motion needs -- so the rendered speed (and therefore the walk
// clip's timeScale, Avatar.tsx's speed-matched cadence) pulsed at the packet
// rate. `sampleAt` replaces that with buffered snapshot interpolation
// (bracket the two network samples straddling a slightly-delayed render
// time, then blend) -- the standard fix for this class of bug. These tests
// assert the property the old scheme violated: constant input velocity must
// produce constant output velocity, not a throb.

function sample(
  t: number,
  x: number,
  y: number,
  z: number,
): PeerSnapshotSample {
  return { t, pos: new Vector3(x, y, z), yaw: 0, animState: 'walk_fwd' }
}

describe('sampleAt', () => {
  it('linearly interpolates position and derives speed between two bracketing samples', () => {
    // 1m over 100ms = 10 m/s.
    const samples = [sample(0, 0, 0, 0), sample(100, 1, 0, 0)]
    const out = new Vector3()

    const result = sampleAt(samples, 50, out)

    expect(out.x).toBeCloseTo(0.5, 10)
    expect(result.speed).toBeCloseTo(10, 10)
    expect(result.animState).toBe('walk_fwd')
  })

  // The core regression guard: at a brisk theater walking pace (1.75 m/s,
  // Avatar.tsx's NATURAL_SPEED_MPS), emitted at the nominal ~13 Hz cadence
  // (ORCHESTRATE.md sec 1, ~77ms/packet), sampling every ~16.7ms (60fps) must
  // yield an IDENTICAL per-step position delta throughout -- not a value
  // that swings between packet arrivals the way frame-to-frame damping did.
  it('produces a constant per-frame position delta under constant-velocity network input (no throb)', () => {
    const speedMps = 1.75
    const packetGapMs = 77
    const dxPerPacket = (speedMps * packetGapMs) / 1000

    const samples: PeerSnapshotSample[] = []
    for (let i = 0; i <= 20; i++) {
      samples.push(sample(i * packetGapMs, i * dxPerPacket, 0, 0))
    }

    const renderStepMs = 1000 / 60
    const out = new Vector3()
    const deltas: number[] = []
    let previousX: number | null = null

    // Stay comfortably inside the buffered range (skip the first/last
    // packet gap, which legitimately clamp rather than bracket).
    for (
      let renderTime = packetGapMs;
      renderTime <= 19 * packetGapMs;
      renderTime += renderStepMs
    ) {
      sampleAt(samples, renderTime, out)
      if (previousX !== null) {
        deltas.push(out.x - previousX)
      }
      previousX = out.x
    }

    const expectedStepDelta = (speedMps * renderStepMs) / 1000
    for (const delta of deltas) {
      expect(delta).toBeCloseTo(expectedStepDelta, 6)
    }
  })

  it('holds at the newest sample (and reports zero speed) once render time runs past all buffered data', () => {
    const samples = [sample(0, 0, 0, 0), sample(100, 1, 0, 0)]
    const out = new Vector3()

    const result = sampleAt(samples, 500, out)

    expect(out.x).toBe(1)
    expect(result.speed).toBe(0)
    expect(result.animState).toBe('walk_fwd')
  })

  it('holds at the oldest sample (and reports zero speed) before any buffered data', () => {
    const samples = [sample(100, 5, 0, 0), sample(200, 6, 0, 0)]
    const out = new Vector3()

    const result = sampleAt(samples, 0, out)

    expect(out.x).toBe(5)
    expect(result.speed).toBe(0)
  })

  it('holds at the single sample available right after join', () => {
    const samples = [sample(100, 2, 1, -3)]
    const out = new Vector3()

    const result = sampleAt(samples, 250, out)

    expect(out.equals(new Vector3(2, 1, -3))).toBe(true)
    expect(result.speed).toBe(0)
    expect(result.yaw).toBe(0)
  })

  it('switches animState exactly at the newer sample time, never blending it mid-bracket', () => {
    const older = { ...sample(0, 0, 0, 0), animState: 'idle' as const }
    const newer = { ...sample(100, 0, 0, 0), animState: 'walk_fwd' as const }
    const out = new Vector3()

    expect(sampleAt([older, newer], 1, out).animState).toBe('idle')
    expect(sampleAt([older, newer], 99, out).animState).toBe('idle')
    expect(sampleAt([older, newer], 100, out).animState).toBe('walk_fwd')
  })

  it('interpolates yaw the short way across the +-pi seam', () => {
    const older = { ...sample(0, 0, 0, 0), yaw: Math.PI - 0.01 }
    const newer = { ...sample(100, 0, 0, 0), yaw: -Math.PI + 0.01 }
    const out = new Vector3()

    const result = sampleAt([older, newer], 50, out)

    // Short way crosses the seam near +-pi; the long way would land near 0.
    expect(Math.abs(result.yaw)).toBeGreaterThan(Math.PI - 0.02)
  })

  it('finds the correct bracket among many buffered samples, not just the last pair', () => {
    const samples = [
      sample(0, 0, 0, 0),
      sample(77, 1, 0, 0),
      sample(154, 2, 0, 0),
      sample(231, 3, 0, 0),
      sample(308, 4, 0, 0),
    ]
    const out = new Vector3()

    sampleAt(samples, 100, out)

    // 100ms falls between the t=77 (x=1) and t=154 (x=2) samples.
    expect(out.x).toBeGreaterThan(1)
    expect(out.x).toBeLessThan(2)
  })
})
