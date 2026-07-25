'use client'

import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Vector3 } from 'three'

import { getSocket } from 'src/multiplayer/store'
import { usePlaybackStore } from 'src/playback/store'

import {
  type AnimState,
  classifyRawAnimState,
  debounceAnimState,
  type DebounceState,
  INITIAL_DEBOUNCE_STATE,
} from './animStateClassify'
import { playerVelocity } from './playerVelocity'

// ---------------------------------------------------------------------------
// The local player's presence broadcaster (PLAN.md "F5" / ORCHESTRATE.md §1
// "src/components/Scene/LocalPresence.tsx"). Renders nothing -- Phase 2
// already decided the local player has no visible body of its own -- this is
// purely a `useFrame` hook shape that reads the camera and emits the
// `'presence'` wire event at a throttled, dead-banded rate. Meant to be
// rendered inside <Canvas> (needs useFrame) but OUTSIDE <Physics>: it only
// ever reads `state.camera`, never touches ecctrl/rapier directly.
//
// `getSocket()` (src/multiplayer/store.ts, F2) may return null before the
// handshake completes -- every emit below is a no-op optional call
// (`getSocket()?.emit(...)`) rather than a guarded branch, so a
// not-yet-connected frame just silently drops its packet.
//
// `AnimState`/`classifyRawAnimState`/`debounceAnimState` live in
// animStateClassify.ts, not hand-mirrored here like most other
// cross-boundary wire shapes in this app (Avatar.tsx's own `AnimState`
// comment) -- this one specifically needs to be a plain `.ts` file (not
// duplicated logic) so its debounce math is unit-testable at all, per that
// file's own header comment (this repo's jest config can't import a `.tsx`).
// ---------------------------------------------------------------------------

type PresencePayload = {
  p: [number, number, number]
  y: number
  a: AnimState
}

export type LocalPresenceProps = {
  characterId: string
}

// `state.camera.position` is the head/eye position (Player.tsx's ecctrl
// config: `camInitDis={-0.01}`, so the first-person camera sits essentially
// at the character's head) -- subtract this to land the broadcast `p` at the
// feet instead. Approximated from Player.tsx's own invisible capsule
// collider (`capsuleGeometry args={[0.3, 0.7]}`: radius 0.3, cylinder length
// 0.7, so total capsule height = 0.7 + 2*0.3 = 1.3m) -- there is no live
// browser here to measure the camera's actual offset within that capsule.
// Matches this app's established convention for a "no live browser to verify
// against" constant (IpadBrowser.tsx's HUD-sizing comments): a reasonable,
// documented approximation, not a measured figure. A few centimeters of
// feet-position error on a remote peer's rendered avatar isn't visually
// significant.
const EYE_TO_FEET_HEIGHT_M = 1.3

// Dead-band thresholds for the throttled emit below (ORCHESTRATE.md §1:
// "~13 Hz, dead-banded"): only actually send a packet once per
// PRESENCE_INTERVAL_S if position/yaw drifted past these since the LAST
// EMIT (not just the last frame), or animState flipped -- so a stationary,
// non-looking player emits nothing.
const POSITION_EPSILON_M = 0.01
const YAW_EPSILON_RAD = 0.01 // ~0.57 degrees

// Target ~13-15 Hz. Mirrors Player.tsx's TELEMETRY_INTERVAL_S /
// telemetryElapsedRef throttle shape (accumulate `delta` into a ref, act once
// it crosses the interval), just at a faster cadence.
const PRESENCE_INTERVAL_S = 0.075

// Pure angle-wrap helper for the yaw dead-band check above -- `a - b` alone
// would read e.g. `+3.13` and `-3.13` radians (physically ~0.28° apart, just
// across the +-π seam) as a huge delta and force a spurious emit every tick.
function shortestAngleDelta(a: number, b: number): number {
  const twoPi = Math.PI * 2
  let diff = (a - b) % twoPi
  if (diff > Math.PI) {
    diff -= twoPi
  } else if (diff < -Math.PI) {
    diff += twoPi
  }
  return diff
}

type LastEmitted = {
  x: number
  y: number
  z: number
  yaw: number
  anim: AnimState
}

// `characterId` is this component's declared prop (ORCHESTRATE.md §2's
// dispatch table names `LocalPresence({ characterId })` explicitly), but it
// never rides the `presence` wire event itself -- ORCHESTRATE.md §1 fixes
// that payload at exactly `{ p, y, a }`. The id only ever travels once, in
// the initial socket handshake (multiplayer/store.ts's
// `connect(characterId)`), which is F2's job, not this component's -- so
// it's structurally unused in this file's body. The `_`-prefixed local
// satisfies `noUnusedParameters` (tsconfig.base.json) and this repo's own
// `unused-imports/no-unused-vars` override (which DOES ignore a leading `_`,
// per packages/eslint-config-lilnas/base.js) -- but `tseslint.configs
// .recommended`'s own `@typescript-eslint/no-unused-vars` also fires here
// independently, at its default settings with no underscore-ignore
// configured, and still needs the explicit disable below. Same pattern as
// Scene.tsx's own `characterId` prop; confirmed by re-running eslint on a
// throwaway probe file with/without the disable comment.

export function LocalPresence({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  characterId: _characterId,
}: LocalPresenceProps) {
  const presenceElapsedRef = useRef(0)
  const lastEmittedRef = useRef<LastEmitted | null>(null)
  const worldDirectionRef = useRef(new Vector3())
  const debounceStateRef = useRef<DebounceState>(INITIAL_DEBOUNCE_STATE)

  useFrame((state, delta) => {
    // Movement (and camera input generally) is frozen while the iPad is
    // open (Player.tsx's own `disableControl={ipadOpen}`) -- broadcasting a
    // motionless snapshot at ~13 Hz the whole time it's open would be pure
    // waste, so this skips computation and emission entirely rather than
    // just suppressing the network call. Read via `.getState()`, not the
    // `usePlaybackStore(...)` hook -- this component never re-renders (it
    // returns null), so there's nothing for a subscription to refresh.
    if (usePlaybackStore.getState().ipadOpen) {
      return
    }

    const camera = state.camera
    const feetX = camera.position.x
    const feetY = camera.position.y - EYE_TO_FEET_HEIGHT_M
    const feetZ = camera.position.z

    // World-space XZ velocity, straight from the player's Rapier rigid body
    // (playerVelocity.ts, published by Player.tsx). This is the physics
    // engine's true velocity: accurate magnitude with NO aliasing and a sharp
    // start/stop edge. It replaces an earlier camera-position-delta velocity
    // that had to be EMA-smoothed to survive render/physics-rate aliasing (0 on
    // frames between physics steps, ~2x on the frame one lands) -- and that
    // smoothing's decay tail lagged the classified stop by ~0.3s (smoothed
    // speed still read ~1.3 m/s a frame after the true velocity had already hit
    // 0), the "walk animation keeps going ~1s after you stop" bug. See
    // playerVelocity.ts for the full explanation.
    const vx = playerVelocity.x
    const vz = playerVelocity.z

    // Yaw only -- NEVER feed camera pitch into the broadcast body (PLAN.md
    // Risks: "looking up/down must not tilt the body"). `getWorldDirection`
    // returns the camera's full 3D look direction regardless of roll/pitch;
    // taking atan2 over just its XZ components extracts a pure compass
    // bearing that's robust to whatever pitch/roll the camera currently has
    // -- no Euler-order gimbal pitfalls. See animStateClassify.ts's
    // classifyRawAnimState comment for the exact convention this pairs with,
    // and how it was verified.
    const dir = camera.getWorldDirection(worldDirectionRef.current)
    const yaw = Math.atan2(dir.x, dir.z)

    // Raw per-frame classification is unstable right at its own decision
    // boundary (animStateClassify.ts's header comment -- e.g. walking
    // straight ahead while looking ~45deg off to the side flips between
    // walk_fwd/strafe on ordinary camera wobble). Debouncing here, every
    // rendered frame with the real per-frame `delta` -- NOT just once per
    // throttled emit below -- is what makes MIN_DWELL_S mean actual elapsed
    // seconds of sustained input, independent of the ~13 Hz emit rate.
    const rawAnimState = classifyRawAnimState(vx, vz, dir.x, dir.z)
    debounceStateRef.current = debounceAnimState(
      debounceStateRef.current,
      rawAnimState,
      delta,
    )
    const animState = debounceStateRef.current.committed

    presenceElapsedRef.current += delta
    if (presenceElapsedRef.current < PRESENCE_INTERVAL_S) {
      return
    }
    presenceElapsedRef.current = 0

    const last = lastEmittedRef.current
    const changed =
      last === null ||
      animState !== last.anim ||
      Math.abs(shortestAngleDelta(yaw, last.yaw)) > YAW_EPSILON_RAD ||
      (feetX - last.x) ** 2 + (feetY - last.y) ** 2 + (feetZ - last.z) ** 2 >
        POSITION_EPSILON_M ** 2
    if (!changed) {
      return
    }

    if (
      !Number.isFinite(feetX) ||
      !Number.isFinite(feetY) ||
      !Number.isFinite(feetZ) ||
      !Number.isFinite(yaw)
    ) {
      // Defensive only -- never broadcast a corrupted camera position.
      // Player.tsx has its own same-frame NaN backstop (snapping the camera
      // back to spawn), but this component has no visibility into whether
      // that has already run for a given frame.
      return
    }

    lastEmittedRef.current = {
      x: feetX,
      y: feetY,
      z: feetZ,
      yaw,
      anim: animState,
    }
    const payload: PresencePayload = {
      p: [feetX, feetY, feetZ],
      y: yaw,
      a: animState,
    }
    getSocket()?.emit('presence', payload)
  })

  return null
}
