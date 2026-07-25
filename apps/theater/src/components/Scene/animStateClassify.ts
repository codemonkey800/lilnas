// Pure, framework-free animState classification + debouncing for the F5
// local-presence broadcaster (LocalPresence.tsx). Kept in its own file, with
// no react-three-fiber import, for the same testability reason as this app's
// other pure Scene/* helpers (avatarInterp.ts, clipTracks.ts, gaze.ts,
// snapshotInterp.ts) -- see avatarInterp.ts's header comment: this repo's
// jest config has no transform for `.tsx` at all, so a test can never import
// LocalPresence.tsx directly.
//
// Bug this exists to fix: classifying "which direction am I moving, relative
// to where I'm looking" is inherently unstable right at its own decision
// boundary. `classifyRawAnimState` below picks whichever of forward/right
// dominates the other, which flips the instant the camera's facing crosses
// 45 degrees off the player's actual (world-space) movement direction -- a
// completely ordinary thing to do (e.g. walking straight down an aisle while
// looking off to the side at the screen). Sampled at LocalPresence.tsx's
// ~13 Hz broadcast rate, a camera that hovers near that 45-degree line
// flickers the broadcast animState back and forth every packet or two. Each
// flicker is a genuine wire-level animState change, and
// RemoteAvatars.tsx/Avatar.tsx's crossfade effect calls `action.reset()` on
// every animState change (correct, for a REAL transition) -- so a remote
// peer watching this sees the walk cycle restart from frame 0 over and
// over, never completing a stride. `debounceAnimState` requires a new raw
// classification to stay stable for MIN_DWELL_S before committing it --
// which absorbs that flicker without touching the classification math itself.
//
// That dwell applies ONLY to changes between two walk states (the direction
// flicker above). Start/stop -- any idle <-> walk transition -- commits
// immediately: LocalPresence feeds this the rigid body's true velocity
// (playerVelocity.ts), so the idle speed threshold is a clean single crossing
// with no flicker to absorb, and dwelling on it just relagged start/stop. See
// debounceAnimState's body.

export type AnimState =
  | 'idle'
  | 'walk_fwd'
  | 'walk_back'
  | 'strafe_left'
  | 'strafe_right'

// Below this world-space planar (XZ) speed, classify as 'idle' rather than
// any walk/strafe state -- filters camera/position jitter while genuinely
// standing still. ecctrl's own walk cap is 2.5 m/s (Avatar.tsx's
// NATURAL_SPEED_MPS comment), so this sits comfortably below any intentional
// movement.
const SPEED_EPSILON_MPS = 0.05

/**
 * Classifies world-space XZ velocity (vx, vz) into a discrete AnimState
 * RELATIVE TO FACING, not world axes: diagonal input (e.g. W+A) must snap to
 * whichever axis dominates, never blend into a 6th state.
 *
 * `dirX`/`dirZ` are the XZ components of the camera's world forward
 * direction (`Camera.getWorldDirection()`) -- the SAME vector `yaw` is
 * derived from in LocalPresence.tsx. This projects `(vx, vz)` onto the
 * camera's own yaw-only forward/right basis directly from `dir`'s
 * components, rather than rebuilding sin(yaw)/cos(yaw) from the
 * already-atan2'd angle and rotating by that -- pairing the "textbook"
 * 2D-rotation-by-yaw formula with a yaw defined as `atan2(dirX, dirZ)`
 * does NOT come out yaw-invariant (checked by hand: dir=(0,0,1) vs.
 * dir=(1,0,0), velocity set equal to dir in both, land on opposite-signed
 * results). Projecting onto `dir`'s own components instead gives
 * `localZ = vx*dirX + vz*dirZ` for BOTH cases -- verified yaw-invariant.
 *
 * Convention:
 *   - `localZ = vx*dirX + vz*dirZ` -- velocity's component along the
 *     camera's forward direction. Positive => moving toward where the
 *     camera looks => 'walk_fwd'; negative => 'walk_back'.
 *   - `localX = vz*dirX - vx*dirZ` -- velocity's component along the
 *     camera's *right* vector (`right = cross(forward, up)`, the standard
 *     three.js/OpenGL right-handed camera basis -- forward=-Z, right=+X,
 *     up=+Y at zero rotation). Positive => moving toward the camera's right
 *     => 'strafe_right'; negative => 'strafe_left'.
 *   - Whichever magnitude dominates wins outright; a tie (only possible at
 *     vx=vz=0, already routed to 'idle' above) falls to fwd/back.
 *
 * Deliberately "raw" -- flips the instant the dominant axis changes, with no
 * memory of the previous frame. Callers driving this from a live camera
 * should run its output through `debounceAnimState` below rather than
 * broadcasting it directly; see this file's header comment.
 */
export function classifyRawAnimState(
  vx: number,
  vz: number,
  dirX: number,
  dirZ: number,
): AnimState {
  if (Math.hypot(vx, vz) < SPEED_EPSILON_MPS) {
    return 'idle'
  }

  const localZ = vx * dirX + vz * dirZ
  const localX = vz * dirX - vx * dirZ

  if (Math.abs(localZ) >= Math.abs(localX)) {
    return localZ > 0 ? 'walk_fwd' : 'walk_back'
  }
  return localX > 0 ? 'strafe_right' : 'strafe_left'
}

export type DebounceState = {
  committed: AnimState
  pendingState: AnimState | null
  pendingElapsedS: number
}

export const INITIAL_DEBOUNCE_STATE: DebounceState = {
  committed: 'idle',
  pendingState: null,
  pendingElapsedS: 0,
}

// How long a new raw classification must stay stable, uninterrupted, before
// it's accepted as the committed/broadcast animState. Sized to comfortably
// outlast a single frame's worth of classification noise (a camera-yaw
// wobble crossing classifyRawAnimState's own decision boundary, or a
// momentary ecctrl velocity dip descending a step) while staying well under
// Avatar.tsx's own CROSSFADE_DURATION_S (0.2s) so a genuine, deliberate
// direction change still feels responsive. No live browser here to tune
// against -- this app's established convention for that situation (see
// Avatar.tsx's NATURAL_SPEED_MPS comment) is a reasonable starting guess.
export const MIN_DWELL_S = 0.15

/**
 * Advances a debounce state machine by one frame. `raw` is this frame's
 * `classifyRawAnimState` output; `dt` is the frame's delta time (seconds).
 * Returns the NEXT `DebounceState` -- `.committed` is what the caller should
 * actually use/broadcast as `animState`.
 *
 * - `raw` matching the already-committed state clears any in-progress
 *   pending switch (the classifier "changed its mind back").
 * - Any transition INVOLVING idle (starting to move, or coming to a stop)
 *   commits immediately -- see the "start/stop commits immediately" comment
 *   in the body.
 * - Between two walk states (a direction change), a `raw` value different
 *   from the current pending candidate restarts the dwell timer for that new
 *   candidate (each distinct flicker gets its own fresh window -- a value has
 *   to win outright, not accumulate credit across different candidates), and a
 *   `raw` value sustained for >= `MIN_DWELL_S` in a row commits it.
 */
export function debounceAnimState(
  state: DebounceState,
  raw: AnimState,
  dt: number,
): DebounceState {
  if (raw === state.committed) {
    return {
      committed: state.committed,
      pendingState: null,
      pendingElapsedS: 0,
    }
  }
  // Start/stop (any idle <-> walk transition) commits immediately, with no
  // dwell. LocalPresence now feeds classifyRawAnimState the rigid body's TRUE
  // velocity (playerVelocity.ts), so the idle speed threshold is a single clean
  // crossing -- there is no idle<->walk aliasing flicker left to absorb, and
  // dwelling on it was pure start/stop latency (runtime-measured ~130ms each
  // way, the "still a bit sluggish" residual after the EMA was removed). The
  // dwell below is only for the ONE thing that genuinely still flickers: a
  // direction change among walk states, when the camera hovers at
  // classifyRawAnimState's 45deg forward/strafe boundary (see this file's
  // header) -- and that never involves idle.
  if (raw === 'idle' || state.committed === 'idle') {
    return { committed: raw, pendingState: null, pendingElapsedS: 0 }
  }
  if (state.pendingState !== raw) {
    return {
      committed: state.committed,
      pendingState: raw,
      pendingElapsedS: dt,
    }
  }
  const pendingElapsedS = state.pendingElapsedS + dt
  if (pendingElapsedS >= MIN_DWELL_S) {
    return { committed: raw, pendingState: null, pendingElapsedS: 0 }
  }
  return { committed: state.committed, pendingState: raw, pendingElapsedS }
}
