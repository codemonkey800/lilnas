import { dampAngle, lerpAngleShortest } from 'src/components/Scene/avatarInterp'

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

// Independent re-implementation of the "shortest signed difference" wrap --
// deliberately not imported from avatarInterp.ts, so these tests check
// dampAngle's actual behavior against a fresh calculation rather than
// against its own internals.
function angularDifference(a: number, b: number): number {
  const twoPi = Math.PI * 2
  return ((((a - b + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI
}

describe('dampAngle', () => {
  it('returns current unchanged when dt is 0', () => {
    const current = degToRad(10)
    const target = degToRad(170)

    expect(dampAngle(current, target, 15, 0)).toBe(current)
  })

  it('converges essentially to target (mod 2*pi) in one call for a very large lambda*dt', () => {
    const current = degToRad(10)
    const target = degToRad(170)

    const result = dampAngle(current, target, 15, 1000)

    expect(Math.abs(angularDifference(result, target))).toBeCloseTo(0, 5)
  })

  it('moves current toward target over repeated calls, without a wraparound in play', () => {
    let current = degToRad(0)
    const target = degToRad(90)
    const dt = 1 / 60
    const lambda = 15

    let previousDistance = Math.abs(angularDifference(current, target))
    for (let i = 0; i < 30; i++) {
      current = dampAngle(current, target, lambda, dt)
      const distance = Math.abs(angularDifference(current, target))
      // Monotonically closing in on the target every step (a tiny epsilon
      // guards against floating-point noise, not a real regression).
      expect(distance).toBeLessThanOrEqual(previousDistance + 1e-9)
      previousDistance = distance
    }

    expect(previousDistance).toBeLessThan(degToRad(1))
  })

  // The wraparound case this helper exists for: current=179deg and
  // target=-179deg are only 2deg apart the short way, but ~358deg apart the
  // naive/long way. A single call must move `current` a couple of degrees
  // *up* (toward the 181deg/-179deg representative), never sharply down
  // toward -179 directly (which is what damping the raw, unwrapped
  // difference would do).
  it('takes the short path on a single call: 179deg toward -179deg moves by a couple of degrees, not ~358deg', () => {
    const current = degToRad(179)
    const target = degToRad(-179)

    const result = dampAngle(current, target, 15, 1 / 60)

    expect(result).toBeGreaterThan(current)
    expect(result).toBeLessThan(current + degToRad(2))
  })

  it('keeps taking the short path over repeated calls and converges near -179deg, not the long way around', () => {
    const start = degToRad(179)
    const target = degToRad(-179)
    const dt = 1 / 60

    let current = start
    for (let i = 0; i < 60; i++) {
      current = dampAngle(current, target, 15, dt)
    }

    // Total movement stayed close to the short ~2deg path, nowhere near the
    // long ~358deg way around.
    const totalMovement = current - start
    expect(totalMovement).toBeGreaterThan(0)
    expect(totalMovement).toBeLessThan(degToRad(3))
    expect(Math.abs(angularDifference(current, target))).toBeLessThan(
      degToRad(0.1),
    )
  })
})

describe('lerpAngleShortest', () => {
  it('returns a unchanged at alpha=0', () => {
    const a = degToRad(10)
    const b = degToRad(170)

    expect(lerpAngleShortest(a, b, 0)).toBe(a)
  })

  it('reaches b (mod 2*pi) at alpha=1', () => {
    const a = degToRad(10)
    const b = degToRad(170)

    expect(Math.abs(angularDifference(lerpAngleShortest(a, b, 1), b))).toBe(0)
  })

  it('blends linearly with no wraparound in play', () => {
    const a = degToRad(0)
    const b = degToRad(90)

    expect(lerpAngleShortest(a, b, 0.5)).toBeCloseTo(degToRad(45), 10)
  })

  // The wraparound case this helper exists for -- same scenario as
  // dampAngle's identical test above, but for a single geometric blend
  // rather than a per-frame damping step: a=179deg, b=-179deg are only 2deg
  // apart the short way. Halfway there must be ~180deg (i.e. just past
  // +179deg), never ~0deg (the halfway point of the naive ~358deg long way).
  it('takes the short path across the +-pi seam, not the long way around', () => {
    const a = degToRad(179)
    const b = degToRad(-179)

    const midpoint = lerpAngleShortest(a, b, 0.5)

    expect(Math.abs(angularDifference(midpoint, degToRad(180)))).toBeLessThan(
      degToRad(0.01),
    )
  })
})
