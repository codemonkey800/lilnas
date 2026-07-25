import { MathUtils, Vector3 } from 'three'

import {
  CLOSE_RANGE_RADIUS_M,
  GAZE_ENTER_COS,
  GAZE_EXIT_COS,
  gazeAlignment,
  nextGazeState,
  perpendicularDistanceM,
} from 'src/components/Scene/gaze'

// Most nextGazeState tests below care only about the angular behavior --
// this stands in for "far outside CLOSE_RANGE_RADIUS_M" so the close-range
// OR-condition never accidentally satisfies them.
const FAR_PERP_DISTANCE_M = 10

describe('gazeAlignment', () => {
  it('is ~1 when the target is dead-centre of the camera forward direction', () => {
    const camPos = new Vector3(0, 0, 0)
    const camForward = new Vector3(0, 0, -1)
    const targetPos = new Vector3(0, 0, -5)

    expect(gazeAlignment(camPos, camForward, targetPos)).toBeCloseTo(1, 5)
  })

  it('is ~0 when the target is 90 degrees off-axis', () => {
    const camPos = new Vector3(0, 0, 0)
    const camForward = new Vector3(0, 0, -1)
    const targetPos = new Vector3(5, 0, 0)

    expect(gazeAlignment(camPos, camForward, targetPos)).toBeCloseTo(0, 5)
  })

  it('is ~-1 when the target is directly behind the camera', () => {
    const camPos = new Vector3(0, 0, 0)
    const camForward = new Vector3(0, 0, -1)
    const targetPos = new Vector3(0, 0, 5)

    expect(gazeAlignment(camPos, camForward, targetPos)).toBeCloseTo(-1, 5)
  })

  // Regression guard for the degenerate case: camPos and targetPos coincide,
  // so there's no direction to normalize. A naive implementation divides a
  // zero-length vector by its own (zero) length and propagates NaN forever
  // (NaN compares false to everything, including nextGazeState's
  // thresholds) -- see respawn.test.ts for the same class of failure mode.
  it('is finite -- not NaN -- when camPos and targetPos coincide', () => {
    const camPos = new Vector3(3, 1, -2)
    const camForward = new Vector3(0, 0, -1)
    const targetPos = camPos.clone()

    const result = gazeAlignment(camPos, camForward, targetPos)

    expect(Number.isFinite(result)).toBe(true)
    // The documented sane fallback (see gaze.ts): a neutral "90 degrees
    // off" reading, which fails nextGazeState's ENTER threshold exactly
    // like a genuinely off-axis target would.
    expect(result).toBe(0)
  })

  it('still returns a value in [-1, 1] when camForward is not unit-length', () => {
    const camPos = new Vector3(0, 0, 0)
    const camForward = new Vector3(0, 0, -10) // deliberately not normalized
    const targetPos = new Vector3(0, 0, -5)

    expect(gazeAlignment(camPos, camForward, targetPos)).toBeCloseTo(1, 5)
  })

  // camForward is documented as "assumed unit-length, defensively
  // re-normalized on a local clone" -- this guards against a regression
  // where that defensive copy is dropped and camForward.normalize() is
  // called directly on the caller's own vector.
  it('does not mutate any of its input vectors', () => {
    const camPos = new Vector3(1, 2, 3)
    const camForward = new Vector3(0, 0, -1)
    const targetPos = new Vector3(1, 2, -2)

    const camPosBefore = camPos.clone()
    const camForwardBefore = camForward.clone()
    const targetPosBefore = targetPos.clone()

    gazeAlignment(camPos, camForward, targetPos)

    expect(camPos.equals(camPosBefore)).toBe(true)
    expect(camForward.equals(camForwardBefore)).toBe(true)
    expect(targetPos.equals(targetPosBefore)).toBe(true)
  })
})

describe('perpendicularDistanceM', () => {
  it('is 0 when the target sits directly on the forward ray', () => {
    const camPos = new Vector3(0, 0, 0)
    const camForward = new Vector3(0, 0, -1)
    const targetPos = new Vector3(0, 0, -5)

    expect(perpendicularDistanceM(camPos, camForward, targetPos)).toBeCloseTo(
      0,
      5,
    )
  })

  it('returns the true off-axis distance for a target in front but offset', () => {
    const camPos = new Vector3(0, 0, 0)
    const camForward = new Vector3(0, 0, -1)
    // 5m straight ahead, 0.4m up -- perpendicular distance is exactly 0.4.
    const targetPos = new Vector3(0, 0.4, -5)

    expect(perpendicularDistanceM(camPos, camForward, targetPos)).toBeCloseTo(
      0.4,
      5,
    )
  })

  it('is null when the target is behind the camera', () => {
    const camPos = new Vector3(0, 0, 0)
    const camForward = new Vector3(0, 0, -1)
    const targetPos = new Vector3(0, 0, 5)

    expect(perpendicularDistanceM(camPos, camForward, targetPos)).toBeNull()
  })

  it('is 0 -- not NaN -- when camPos and targetPos coincide', () => {
    const camPos = new Vector3(3, 1, -2)
    const camForward = new Vector3(0, 0, -1)
    const targetPos = camPos.clone()

    expect(perpendicularDistanceM(camPos, camForward, targetPos)).toBe(0)
  })

  // The exact scenario this exists to fix: standing 1m from a peer, looking
  // level at their face while the nametag floats ~0.4m above eye height --
  // this is comfortably WITHIN close range even though it's already
  // outside gazeAlignment's 18-degree exit cone (~19 degrees off, per the
  // numeric check that found this bug).
  it('reads within close range for a realistic close-up "looking at the face, not the floating tag" case', () => {
    const camPos = new Vector3(0, 0, 0)
    const camForward = new Vector3(0, 0, -1)
    const targetPos = new Vector3(0, 0.4, -1)

    const perp = perpendicularDistanceM(camPos, camForward, targetPos)
    expect(perp).not.toBeNull()
    expect(perp as number).toBeLessThan(CLOSE_RANGE_RADIUS_M)
  })
})

describe('nextGazeState', () => {
  it('turns on once alignment exceeds GAZE_ENTER_COS, from off', () => {
    const insideEnterCone = Math.cos(MathUtils.degToRad(6))
    expect(insideEnterCone).toBeGreaterThan(GAZE_ENTER_COS)

    expect(nextGazeState(false, insideEnterCone, FAR_PERP_DISTANCE_M)).toBe(
      true,
    )
  })

  it('turns off once alignment drops below GAZE_EXIT_COS, from on', () => {
    const outsideExitCone = Math.cos(MathUtils.degToRad(30))
    expect(outsideExitCone).toBeLessThan(GAZE_EXIT_COS)

    expect(nextGazeState(true, outsideExitCone, FAR_PERP_DISTANCE_M)).toBe(
      false,
    )
  })

  // The actual hysteresis behavior: the same alignment reading, strictly
  // inside the sticky band between the two thresholds, must hold whatever
  // state it was already in rather than recompute a fresh answer -- that's
  // what a Schmitt trigger means, and it's what stops a name flickering
  // when gaze hovers near the cone edge.
  it('holds inside the sticky band, keeping whatever state it was already in', () => {
    const midBand = Math.cos(MathUtils.degToRad(15))

    // Self-check that this value genuinely lands inside
    // `(GAZE_EXIT_COS, GAZE_ENTER_COS)`: 15 degrees sits strictly between
    // the 12-degree enter cone and the 18-degree exit cone, and cosine is
    // monotonically decreasing over that range, so this can't accidentally
    // drift outside the band even if the tuning constants above change.
    expect(midBand).toBeGreaterThan(GAZE_EXIT_COS)
    expect(midBand).toBeLessThan(GAZE_ENTER_COS)

    // Same input, opposite prior states, opposite outputs.
    expect(nextGazeState(true, midBand, FAR_PERP_DISTANCE_M)).toBe(true)
    expect(nextGazeState(false, midBand, FAR_PERP_DISTANCE_M)).toBe(false)
  })

  it('never spuriously turns on when alignment is far outside the cone and far from the look line', () => {
    expect(nextGazeState(false, -1, FAR_PERP_DISTANCE_M)).toBe(false)
  })

  // Regression guard for the close-range nametag bug: alignment alone
  // (looking at the face, not the floating tag) fails even the wider exit
  // cone, but the target is well within CLOSE_RANGE_RADIUS_M of the look
  // line -- the tag must still turn on.
  it('turns on from off when within close range, even though alignment alone would fail the exit cone too', () => {
    const outsideExitCone = Math.cos(MathUtils.degToRad(19))
    expect(outsideExitCone).toBeLessThan(GAZE_EXIT_COS)

    const closeUp = CLOSE_RANGE_RADIUS_M / 2
    expect(nextGazeState(false, outsideExitCone, closeUp)).toBe(true)
  })

  it('does not turn on from off via close range alone once perpDistanceM reaches CLOSE_RANGE_RADIUS_M', () => {
    expect(nextGazeState(false, -1, CLOSE_RANGE_RADIUS_M)).toBe(false)
  })

  // The close-range fallback deliberately does NOT protect the EXIT
  // transition -- looking far enough away should still hide the tag no
  // matter how close you're standing.
  it('still turns off via the angular exit cone even when within close range', () => {
    const outsideExitCone = Math.cos(MathUtils.degToRad(30))
    const closeUp = CLOSE_RANGE_RADIUS_M / 2

    expect(nextGazeState(true, outsideExitCone, closeUp)).toBe(false)
  })

  it('treats a null perpDistanceM (target behind camera) as never satisfying the close-range fallback', () => {
    expect(nextGazeState(false, -1, null)).toBe(false)
  })
})
