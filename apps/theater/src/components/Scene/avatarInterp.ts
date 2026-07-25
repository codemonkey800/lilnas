// Pure, framework-free angle-damping helper for the F4 <RemoteAvatar> shell
// (ORCHESTRATE.md §3 / PLAN.md "F4"). Kept in its own file, with no
// react-three-fiber import, for two reasons that both matter here:
//
//   - Testability: this app's jest config (jest.config.js) only registers a
//     ts-jest transform for `^.+\.ts$` -- there is no transform for `.tsx`
//     at all, so a test can never import a `.tsx` file (confirmed directly:
//     importing a `.tsx` component from a jest test throws a `SyntaxError:
//     Unexpected token '<'` at the JSX). That's exactly why every other pure
//     helper in this app (clipTracks.ts, gaze.ts, respawn.ts, meshCollider
//     .ts, characterNav.ts, lightsUp.ts, libraryFilter.ts, pedestal.ts, ...)
//     lives beside its consuming component rather than inside it -- this
//     file follows that same, already-established convention.
//   - RemoteAvatars.tsx itself pulls in Avatar.tsx (module-level `useGLTF
//     .preload(...)` side effects) and the multiplayer store -- keeping the
//     pure math importable on its own avoids ever needing to import any of
//     that into a test.
//
// THREE.MathUtils.damp (`lerp(x, y, 1 - exp(-lambda*dt))`) already
// frame-rate-independently smooths a *linear* value toward a target, but it
// has no notion of angle wraparound: naively damping a yaw straight toward a
// target angle would send a peer turning from 179deg to -179deg the "long
// way" around (~358deg) instead of the true shortest ~2deg step. dampAngle
// below first rewraps the raw `target - current` delta into `(-pi, pi]` --
// the shortest signed rotation -- then applies exactly the same
// exponential-decay shape MathUtils.damp uses, just to that wrapped delta
// instead of to the raw values, so its dt=0 / large-lambda*dt edge-case
// behavior matches MathUtils.damp's own.

const TWO_PI = Math.PI * 2

// Wraps `angle` (radians) into `(-pi, pi]`.
function wrapToPi(angle: number): number {
  return angle - TWO_PI * Math.floor((angle + Math.PI) / TWO_PI)
}

/**
 * Frame-rate-independent damping toward `target`, like `THREE.MathUtils
 * .damp`, but for an angle (radians): the step moves along the shortest
 * signed direction around the circle rather than the raw linear difference
 * -- e.g. current=179deg, target=-179deg converges via +2deg, never the long
 * -358deg way. `lambda` is the same "higher = snappier" damping rate
 * `MathUtils.damp` takes. `dt<=0` returns `current` unchanged; a very large
 * `lambda * dt` converges essentially to `target` (mod 2*pi) in a single
 * call -- both match `MathUtils.damp`'s own edge-case behavior exactly,
 * since this reuses its `1 - exp(-lambda*dt)` factor verbatim.
 */
export function dampAngle(
  current: number,
  target: number,
  lambda: number,
  dt: number,
): number {
  const shortestDelta = wrapToPi(target - current)
  const factor = 1 - Math.exp(-lambda * dt)
  return current + shortestDelta * factor
}

/**
 * Geometric shortest-path interpolation between two FIXED angles `a` and `b`
 * (radians) by fraction `alpha` (0 -> `a`, 1 -> `b`) -- e.g. a=179deg,
 * b=-179deg converges via +2deg at alpha=1, never the long -358deg way.
 * Unlike `dampAngle` above (which exponentially damps a moving value toward
 * a moving target, frame by frame), this is a plain linear blend between two
 * known endpoints -- what `snapshotInterp.ts`'s bracketed sampling needs to
 * interpolate yaw between two buffered network snapshots, as opposed to
 * `RemoteAvatar`'s old per-frame damping this replaces.
 */
export function lerpAngleShortest(a: number, b: number, alpha: number): number {
  const shortestDelta = wrapToPi(b - a)
  return a + shortestDelta * alpha
}
