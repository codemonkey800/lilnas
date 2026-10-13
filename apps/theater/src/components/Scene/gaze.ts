import { MathUtils, Vector3 } from 'three'

// Pure, framework-free gaze test for the F7 gaze-gated nametag feature
// (PLAN.md's F7 section) -- no react-three-fiber import here by design, so
// this stays importable and testable with zero rendering context. Two
// halves:
//
//   - gazeAlignment  -- "how close is this target to my screen centre," a
//     reticle test using the camera's full 3D direction, pitch included.
//   - nextGazeState  -- a pure hysteresis (Schmitt-trigger) step that turns
//     the *decision* to show a name on/off without flickering at the cone
//     edge.
//
// Deliberate contrast with the avatar body's own yaw-only "compass bearing"
// rule used elsewhere in this build (PLAN.md's F5 section): that rule strips
// out pitch because looking up/down must never tilt a walking body. Gaze
// asks the opposite question -- "is their head near the centre of what I'm
// looking at" -- so it deliberately keeps pitch in the dot product below.

// Scratch vectors reused across calls instead of allocating a fresh Vector3
// every invocation. gazeAlignment is meant to run once per on-screen peer
// per frame (NameTag.tsx's own useFrame, per PLAN.md's F7 section), so this
// matters the same way CharacterSelect/pedestal.ts's module-level `scratch`
// does.
const toTarget = new Vector3()
const forward = new Vector3()

/**
 * Normalized alignment between the camera's forward direction and the
 * direction from `camPos` to `targetPos` -- the cosine of the angle between
 * them. `1` when `targetPos` is dead-centre of the camera's view direction,
 * falling toward `0` at 90 degrees off-axis and toward `-1` directly behind
 * the camera. Callers wanting "is the user looking at this peer's face"
 * should pass the peer's head position, not their feet.
 *
 * `camForward` is assumed to already be unit-length (true of
 * `Camera.getWorldDirection()`, the expected caller) -- but it is still
 * defensively re-normalized on a local clone (the caller's vector is never
 * mutated) so a not-quite-unit input can't silently break the `[-1, 1]`
 * range this function promises. The direction to `targetPos` is always
 * computed fresh and normalized locally regardless, since it is never a
 * caller-owned unit vector to begin with.
 */
export function gazeAlignment(
  camPos: Vector3,
  camForward: Vector3,
  targetPos: Vector3,
): number {
  toTarget.subVectors(targetPos, camPos)
  const distance = toTarget.length()

  // Degenerate case: camPos and targetPos coincide, so there is no direction
  // to measure an angle against. Normalizing a zero-length vector divides by
  // zero and yields NaN, which would then poison nextGazeState's threshold
  // comparisons forever (NaN compares false to every number, including its
  // own thresholds -- the same footgun respawn.ts's isFiniteVec3 guards
  // against). Returning 0 -- a neutral, "90 degrees off" reading -- fails
  // nextGazeState's ENTER threshold exactly like a genuinely off-axis target
  // would, so a peer with no defined direction never spuriously lights up a
  // nametag.
  if (distance === 0) {
    return 0
  }
  toTarget.divideScalar(distance)

  forward.copy(camForward).normalize()

  return toTarget.dot(forward)
}

/**
 * Perpendicular (off-axis) distance in meters from `targetPos` to the
 * camera's forward ray, or `null` if `targetPos` is behind the camera
 * (`alongForward <= 0` -- there's no meaningful "how far off my look line"
 * reading for something you're facing away from).
 *
 * `gazeAlignment`'s fixed ANGULAR cone is forgiving at long range but
 * breaks down up close: NameTag.tsx's tag floats a roughly fixed
 * WORLD-SPACE margin above the head (`HEAD_MARGIN_M`), so the same physical
 * offset subtends a shrinking angle at range but a widening one up close --
 * e.g. standing 1m away and looking at a peer's face (not straight up at
 * the tag) reads as ~19 degrees off, already outside even the 18-degree
 * exit cone, so the tag can never turn on no matter how directly you're
 * "looking at" the peer. This distance-independent measurement is
 * `nextGazeState`'s fix for that: a fixed few tens of centimeters of
 * "physically close to my look line" ENTER fallback that only matters up
 * close, where the angular test alone is too strict.
 */
export function perpendicularDistanceM(
  camPos: Vector3,
  camForward: Vector3,
  targetPos: Vector3,
): number | null {
  toTarget.subVectors(targetPos, camPos)
  const distance = toTarget.length()
  if (distance === 0) {
    return 0
  }

  forward.copy(camForward).normalize()
  const alongForward = toTarget.dot(forward)
  if (alongForward <= 0) {
    return null
  }

  const perpSq = Math.max(0, distance * distance - alongForward * alongForward)
  return Math.sqrt(perpSq)
}

// Alignment must exceed this to turn a name ON (off -> on transition). 12
// degrees is the tighter of the two cones -- PLAN.md's F7 section: "these
// two constants are the taste dial -- widen for 'who's in front of me,'
// tighten for 'precisely centred.'"
export const GAZE_ENTER_COS = Math.cos(MathUtils.degToRad(12))

// Alignment must drop below this to turn a name OFF (on -> off transition).
// 18 degrees is a *wider* cone than the 12-degree enter cone, and cosine
// decreases as the angle widens, so GAZE_EXIT_COS < GAZE_ENTER_COS -- the
// sticky band nextGazeState below holds state inside is exactly
// `(GAZE_EXIT_COS, GAZE_ENTER_COS)`. That gap is what stops a name
// flickering when gaze hovers near the cone edge: a single threshold would
// let alignment tick back and forth across it frame to frame; two
// thresholds with a gap between them can't.
export const GAZE_EXIT_COS = Math.cos(MathUtils.degToRad(18))

// Distance-independent ENTER fallback (see perpendicularDistanceM's header
// comment): up close, "physically within this many meters of my exact look
// line" turns a name on even when the fixed angular cone above would
// reject it, since a nametag floating a fixed real-world margin above the
// head subtends a much wider angle at close range than at distance. Sized
// to comfortably cover looking at a peer's face/chest rather than straight
// up at their floating tag (~0.3-0.4m of vertical offset in the close-range
// case that motivated this) with some margin. No live browser here to tune
// against -- this app's established convention for that situation (see
// Avatar.tsx's NATURAL_SPEED_MPS comment) is a reasonable starting guess.
// Deliberately NOT applied to the EXIT check below -- looking far enough
// away should still hide the tag regardless of how close you are standing.
export const CLOSE_RANGE_RADIUS_M = 0.6

/**
 * Pure Schmitt-trigger (hysteresis) step for the gaze on/off decision.
 * Reads no state of its own -- callers (NameTag.tsx) are expected to hold
 * `prevOn` in a ref, not React state, so recomputing this every frame never
 * triggers a re-render (the same no-re-render discipline as the
 * position/yaw buffers in multiplayer/store.ts).
 *
 * `perpDistanceM` (from `perpendicularDistanceM`) is an OR'd-in alternative
 * ENTER condition, not a replacement for the angular test -- see
 * CLOSE_RANGE_RADIUS_M's comment for why the angular cone alone isn't
 * enough up close.
 */
export function nextGazeState(
  prevOn: boolean,
  alignment: number,
  perpDistanceM: number | null,
): boolean {
  const withinCloseRange =
    perpDistanceM !== null && perpDistanceM < CLOSE_RANGE_RADIUS_M
  if (!prevOn && (alignment > GAZE_ENTER_COS || withinCloseRange)) {
    return true
  }
  if (prevOn && alignment < GAZE_EXIT_COS) {
    return false
  }
  return prevOn
}
