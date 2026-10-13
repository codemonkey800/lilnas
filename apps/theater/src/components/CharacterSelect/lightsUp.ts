// Time-since-mount -> per-light intensity for the character-select stage's
// opening beat: a dark room, then the lights rising to their working levels
// (see CharacterStage.tsx's StageLights for where this drives the actual
// THREE.Light objects). A brief hold at zero before the ramp starts is what
// reads as "starts dark" rather than an ordinary fade-in from frame one.
export const LIGHTS_UP_HOLD_MS = 300
export const LIGHTS_UP_RAMP_MS = 1400

// Smoothstep: eases in and out with no overshoot. A linear ramp would make
// the lights visibly "snap on" at a constant rate instead of rising and
// settling the way a lighting board fade-up does.
function easeInOut(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * `targetIntensity` scaled by how far into the reveal `elapsedMs` (time
 * since the stage mounted) is: 0 through the hold, easing up to
 * `targetIntensity` over the ramp, held there after. Pure so the hold/ramp/
 * ease math is unit-testable without a THREE or R3F render tree.
 */
export function lightsUpIntensity(
  elapsedMs: number,
  targetIntensity: number,
): number {
  const progress = Math.min(
    Math.max((elapsedMs - LIGHTS_UP_HOLD_MS) / LIGHTS_UP_RAMP_MS, 0),
    1,
  )
  return targetIntensity * easeInOut(progress)
}

/** True once the reveal has settled at its target intensities. */
export function lightsUpDone(elapsedMs: number): boolean {
  return elapsedMs >= LIGHTS_UP_HOLD_MS + LIGHTS_UP_RAMP_MS
}
