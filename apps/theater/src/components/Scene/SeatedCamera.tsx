'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type Camera, MathUtils, Vector3 } from 'three'

import { useSeatStore } from 'src/seats/store'

import { SIT_DOWN_DURATION_S, STAND_UP_DURATION_S } from './clipTimings'
import { LOOK_SENSITIVITY_RAD_PER_PX } from './firstPersonLook'
import { getSeat, type Seat, SEATED_EYE_ABOVE_CUSHION } from './seats'

// ---------------------------------------------------------------------------
// The local player's seated camera (PLAN.md "F4 -- seated local player" /
// ORCHESTRATE.md §1's seated state machine). Mounted inside <Canvas> by F8
// (this file never mounts itself), always present in the tree -- it is
// effectively inert while `seatPhaseRef.current === 'standing'`, exactly
// like Player.tsx's own freeze is inert while `frozen` is false. Renders no
// JSX of its own (`return null`), same "no local body" shape as
// LocalPresence.tsx.
//
// Implements the four LOCAL phases from ORCHESTRATE.md §1 (none of these
// ride the wire -- `useSeatStore`'s `mySeatId` is the only source of truth
// that does):
//
//   standing --claim ack ok--> sit_down --SIT_DOWN_DURATION_S--> sitting
//       ^                                                           |
//       |          STAND_UP_DURATION_S           release() called   |
//       +------------------ stand_up <----------------------------+
//
// `mySeatId` transitions null -> non-null only once `seats/store.ts`'s
// `claim()` receives `{ ok: true }` (never optimistically) -- that edge
// starts sit_down. `release()` clears `mySeatId` to null IMMEDIATELY (no
// ack wait), which is the START of stand_up, not its end -- Player.tsx's
// freeze and viewControls.ts's `E` gate both key off `seatPhaseRef` rather
// than `mySeatId` for exactly this reason (see their own comments).
//
// Position eases (smoothstep, never linear -- PLAN.md: "a linear position
// ramp reads as mechanical") between wherever the camera was when a
// transition started and the seat's eye point.
//
// The LOOK DIRECTION eases to dead-ahead over sit_down, so you always end up
// facing the screen once seated. Bugfix -- it used to hold whatever direction
// the player was looking when they pressed `E` and merely narrow the D3 clamp
// (yaw +-75deg / pitch +-45deg) around it, which meant the seated view kept
// the standing look direction indefinitely. That reliably pointed the wrong
// way, and not by accident: D9's seat targeting REQUIRES looking at the
// cushion to claim a seat at all (seats.ts's findGazedFreeSeat, within
// SEAT_TARGET_MIN_ALIGNMENT_COS of it), and a cushion you're standing next to
// is below and off to one side -- so the seeded direction was systematically
// "staring down at the seat I'm about to sit in", and that's exactly where
// the view stayed for the whole seated window.
//
// Easing the offsets themselves to 0 also removes the need to ease the clamp
// BOUND during sit_down: the interpolated value starts at the player's real
// look direction (so nothing yanks at t=0) and lands at 0, which is inside
// D3's limits by construction, so the handoff to `sitting`'s fixed clamp is
// continuous. Live mouse input still only accumulates during the `sitting`
// steady state (see applyLook / the mousemove listener below), so the player
// can look around from the seat afterwards -- they just start off facing the
// film. stand_up keeps easing its bound back open purely for symmetry.
//
// Bugfix (was: "Player.tsx ALSO teleports the physics body to this seat's
// floor position on the standing -> sit_down edge"): it no longer does. That
// teleport moved the ecctrl capsule's CENTRE (not its feet) to the seat's
// floor height, burying the capsule ~0.95m into the floor collider for the
// whole seated window (ecctrl's floating capsule normally rests that far
// above the ground) -- stand-up then resumed gravity/collision from inside
// solid geometry, reading as a violent glitch/clip through the map. The
// physics body now simply stays exactly where it was standing (frozen, like
// the iPad-open case) for the entire sit_down/sitting/stand_up window, and
// stand_up's camera ease below returns to that SAME position
// (`standingReturnPosRef`) rather than a seat-derived one -- there is no
// longer any seat-relative body placement for either file to coordinate.
//
// Camera ownership while frozen -- READ BEFORE CHANGING ANYTHING HERE:
// ecctrl 2.0 has no camera of its own (it only reads the camera's direction
// to orient WASD). The standing first-person camera is Player.tsx's, and its
// per-frame write is skipped for exactly the frames Player.tsx counts as
// `frozen`, which includes every phase here except `standing`. That is what
// gives this component exclusive camera ownership for the whole sit_down/
// sitting/stand_up window, not just at the final handoff. (Under ecctrl
// 1.0.97 the same job took the `disableFollowCam` prop, since
// `disableControl` alone never stopped ecctrl's own camera-follow.)
//
// The handoff on stand (PLAN.md "Risks & gotchas: ecctrl handoff on stand")
// is continuous by construction now. Under 1.0.97 ecctrl's own mousemove
// listener kept accumulating into its hidden `pivot`/`followCam` rotation
// the whole time the player was seated, so the follow camera resumed from a
// drifted view. PLAN.md's first fallback was to seed it via the ref's
// `rotateCamera()` on release. Player.tsx's replacement builds that in. Its
// look listener ignores the mouse while frozen, and on the unfreeze edge it
// re-seeds yaw/pitch from the camera's actual direction, i.e. wherever
// stand_up's final frame below left it. Position matches too: stand_up ends
// on `standingReturnPosRef`, and the frozen body never moved from under it.
// ---------------------------------------------------------------------------

export type SeatPhase = 'standing' | 'sit_down' | 'sitting' | 'stand_up'

// Read every frame by Player.tsx (generalizes its iPad-only freeze to also
// cover the whole sit/stand transition) and by viewControls.ts (gates `E`
// during a transition, and distinguishes the seated steady state from
// mid-transition). Mirrors seatTargeting.ts's `seatTargetRef` exactly: a
// plain module-level mutable object, written every frame by THIS file's own
// useFrame (below), read from outside any parent/child relationship to it.
export const seatPhaseRef: { current: SeatPhase } = { current: 'standing' }

// D3 -- the steady-state look clamp around the seat's facing (yaw 0 == +Z,
// per seats.ts). sit_down eases INTO these bounds from wide-open; stand_up
// eases back OUT to wide-open (a no-op in practice, since nothing
// accumulates new input outside `sitting` -- see the header comment -- but
// mirrors sit_down's ease for symmetry, per PLAN.md).
const SEATED_YAW_LIMIT_RAD = MathUtils.degToRad(75)
const SEATED_PITCH_LIMIT_RAD = MathUtils.degToRad(45)

// "Wide open" bounds sit_down eases in from / stand_up eases out to -- loose
// enough that no plausible standing look direction is ever clamped at the
// moment a transition starts, which is what makes the clamp-bound ease
// itself never yank the view. 89deg rather than a full 90 avoids the pitch
// gimbal singularity at dead vertical.
const WIDE_OPEN_YAW_RAD = Math.PI
const WIDE_OPEN_PITCH_RAD = MathUtils.degToRad(89)

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// Wraps an angle into [-PI, PI], so easing it to 0 always takes the short way
// round the circle. Same job as LocalPresence.tsx's `shortestAngleDelta`, kept
// separate rather than shared: that one is a two-argument dead-band helper on
// the presence hot path, this is a one-argument normalizer used once per
// sit_down. See the seed block in useFrame for why it's needed at all.
function wrapAngle(radians: number): number {
  const twoPi = Math.PI * 2
  const wrapped = ((radians % twoPi) + twoPi) % twoPi
  return wrapped > Math.PI ? wrapped - twoPi : wrapped
}

// Applies the current look offset to the camera, clamped to whatever bound
// the caller is currently easing toward (D3's fixed limits during `sitting`;
// a smoothstep-interpolated value during sit_down/stand_up).
//
// The `Math.PI +` term is not a typo. Three.js cameras look down their local
// -Z axis by default, but this app's OWN yaw convention (seats.ts's
// `yaw: 0` meaning +Z; LocalPresence.tsx's `atan2(dir.x, dir.z)`) is defined
// relative to +Z -- exactly pi apart from -Z. Working through
// Euler('YXZ')'s actual rotation math (three.js's
// Quaternion.setFromEuler/Matrix4.makeRotationX/Y, verified directly against
// the installed three.js source, not assumed) confirms pitch has no such
// offset but yaw does: for ANY pitch, `atan2(dir.x, dir.z) === rawEulerYaw +
// PI (mod 2pi)`. Adding it back here is what makes `yawOffset = 0` actually
// face the screen instead of the back wall.
function applyLook(
  camera: Camera,
  seat: Seat,
  yawBoundRad: number,
  pitchBoundRad: number,
  yawOffsetRef: { current: number },
  pitchOffsetRef: { current: number },
): void {
  const yaw = clamp(yawOffsetRef.current, -yawBoundRad, yawBoundRad)
  const pitch = clamp(pitchOffsetRef.current, -pitchBoundRad, pitchBoundRad)
  camera.rotation.set(pitch, Math.PI + seat.yaw + yaw, 0, 'YXZ')
}

export function SeatedCamera() {
  const prevMySeatIdRef = useRef<string | null>(null)
  const activeSeatRef = useRef<Seat | null>(null)
  const elapsedRef = useRef(0)
  const phaseStartPosRef = useRef(new Vector3())
  // Bugfix: where stand_up eases BACK TO -- captured once, at the exact
  // moment sit_down begins, and left untouched for the whole seated window
  // (unlike `phaseStartPosRef`, which gets overwritten again at the START of
  // stand_up for ITS OWN "ease from" purpose). The physics body itself never
  // moves from this spot for the whole sit_down/sitting/stand_up window
  // (Player.tsx no longer teleports it to the seat -- see this file's header
  // comment), so easing the camera back to the exact position it started
  // from is what keeps the visual camera in sync with where the body
  // actually is once Player.tsx's follow camera resumes.
  const standingReturnPosRef = useRef(new Vector3())
  const directionScratchRef = useRef(new Vector3())
  const positionTargetScratchRef = useRef(new Vector3())
  const yawOffsetRef = useRef(0)
  const pitchOffsetRef = useRef(0)
  // The look offsets sit_down eases FROM -- the player's real look direction
  // at the instant they pressed `E`, captured once so the per-frame lerp
  // toward dead-ahead has a fixed start. Separate refs from
  // `yawOffsetRef`/`pitchOffsetRef` because those get overwritten every frame
  // with the interpolated result (and then by live mouse input once seated).
  const sitDownFromYawRef = useRef(0)
  const sitDownFromPitchRef = useRef(0)

  useEffect(() => {
    // Same sensitivity as Player.tsx's standing look (firstPersonLook.ts),
    // so the seated view turns at the same rate as the standing one.
    function handleMouseMove(event: MouseEvent): void {
      if (seatPhaseRef.current !== 'sitting' || !document.pointerLockElement) {
        // D8: openIpad() releases pointer lock but mousemove keeps firing --
        // without this check, reaching for a tablet button while seated
        // would swing the seated view. Player.tsx's standing look listener
        // gates on pointer lock the same way.
        return
      }
      yawOffsetRef.current = clamp(
        yawOffsetRef.current - event.movementX * LOOK_SENSITIVITY_RAD_PER_PX,
        -SEATED_YAW_LIMIT_RAD,
        SEATED_YAW_LIMIT_RAD,
      )
      pitchOffsetRef.current = clamp(
        pitchOffsetRef.current - event.movementY * LOOK_SENSITIVITY_RAD_PER_PX,
        -SEATED_PITCH_LIMIT_RAD,
        SEATED_PITCH_LIMIT_RAD,
      )
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  useFrame((state, delta) => {
    const camera = state.camera
    const mySeatId = useSeatStore.getState().mySeatId
    const prevMySeatId = prevMySeatIdRef.current
    prevMySeatIdRef.current = mySeatId

    // standing -> sit_down: claim() acked. Player.tsx independently detects
    // this SAME store transition to place the rigid body -- see its own
    // comment on why that isn't done here instead (avoiding an import
    // cycle between the two files).
    if (
      seatPhaseRef.current === 'standing' &&
      prevMySeatId === null &&
      mySeatId !== null
    ) {
      const seat = getSeat(mySeatId)
      if (seat) {
        activeSeatRef.current = seat
        seatPhaseRef.current = 'sit_down'
        elapsedRef.current = 0
        phaseStartPosRef.current.copy(camera.position)
        // Captured ONCE, here, for the whole seated window -- see this
        // ref's own declaration comment for why it's a separate ref from
        // `phaseStartPosRef` above.
        standingReturnPosRef.current.copy(camera.position)

        // Seed the look accumulator from the CURRENT look direction so
        // sit_down's ease toward dead-ahead starts from where the player was
        // actually looking rather than yanking. yaw/pitch here are in this
        // app's OWN convention (atan2(dir.x, dir.z) / asin(dir.y)), matching
        // seats.ts's `yaw: 0` -- see applyLook's comment for why that needs
        // a +PI correction when it's converted back into a raw camera
        // Euler.
        //
        // Yaw is wrapped into [-PI, PI] relative to the seat's facing before
        // being used as the ease's start point: `atan2` and `seat.yaw` can
        // straddle the +-PI seam (e.g. looking at +3.1 rad from a seat facing
        // -3.1), and lerping the unwrapped difference to 0 would swing the
        // long way round the circle instead of the ~0.08 rad short way.
        const dir = camera.getWorldDirection(directionScratchRef.current)
        yawOffsetRef.current = wrapAngle(Math.atan2(dir.x, dir.z) - seat.yaw)
        pitchOffsetRef.current = Math.asin(clamp(dir.y, -1, 1))
        sitDownFromYawRef.current = yawOffsetRef.current
        sitDownFromPitchRef.current = pitchOffsetRef.current
      }
    }

    // sitting -> stand_up: release() called. mySeatId clears at the START
    // of stand_up, not its end (see this file's header comment).
    if (seatPhaseRef.current === 'sitting' && mySeatId === null) {
      seatPhaseRef.current = 'stand_up'
      elapsedRef.current = 0
      phaseStartPosRef.current.copy(camera.position)
    }

    const seat = activeSeatRef.current
    const phase = seatPhaseRef.current
    if (phase === 'standing' || !seat) {
      // Inert -- Player.tsx's follow camera owns the camera again (see the
      // header comment for exactly what makes that safe).
      return
    }

    elapsedRef.current += delta

    if (phase === 'sit_down') {
      const t = MathUtils.smoothstep(elapsedRef.current, 0, SIT_DOWN_DURATION_S)

      // Ease the look offsets themselves to 0 (dead-ahead == the screen, per
      // seats.ts's `yaw: 0` convention), so the player lands facing the film
      // rather than still staring at the seat D9 made them look at to claim
      // it. The clamp stays wide open for this phase: the interpolated value
      // is bounded by its own endpoints, and the endpoint it reaches (0) is
      // already inside D3's steady-state limits, so `sitting` picks it up
      // continuously.
      yawOffsetRef.current = MathUtils.lerp(sitDownFromYawRef.current, 0, t)
      pitchOffsetRef.current = MathUtils.lerp(sitDownFromPitchRef.current, 0, t)
      applyLook(
        camera,
        seat,
        WIDE_OPEN_YAW_RAD,
        WIDE_OPEN_PITCH_RAD,
        yawOffsetRef,
        pitchOffsetRef,
      )

      positionTargetScratchRef.current.set(
        seat.cushion[0],
        seat.cushion[1] + SEATED_EYE_ABOVE_CUSHION,
        seat.cushion[2],
      )
      camera.position.lerpVectors(
        phaseStartPosRef.current,
        positionTargetScratchRef.current,
        t,
      )

      if (t >= 1) {
        seatPhaseRef.current = 'sitting'
        elapsedRef.current = 0
      }
      return
    }

    if (phase === 'sitting') {
      applyLook(
        camera,
        seat,
        SEATED_YAW_LIMIT_RAD,
        SEATED_PITCH_LIMIT_RAD,
        yawOffsetRef,
        pitchOffsetRef,
      )
      camera.position.set(
        seat.cushion[0],
        seat.cushion[1] + SEATED_EYE_ABOVE_CUSHION,
        seat.cushion[2],
      )
      return
    }

    if (phase === 'stand_up') {
      const t = MathUtils.smoothstep(elapsedRef.current, 0, STAND_UP_DURATION_S)
      applyLook(
        camera,
        seat,
        MathUtils.lerp(SEATED_YAW_LIMIT_RAD, WIDE_OPEN_YAW_RAD, t),
        MathUtils.lerp(SEATED_PITCH_LIMIT_RAD, WIDE_OPEN_PITCH_RAD, t),
        yawOffsetRef,
        pitchOffsetRef,
      )

      // Bugfix: ease back to `standingReturnPosRef` -- the exact camera
      // position captured when sit_down began -- rather than a computed
      // seat-relative position. Player.tsx no longer teleports the physics
      // body to the seat (see this file's header comment), so the body has
      // been sitting exactly there, motionless, the whole time; landing the
      // camera back on it is what keeps the eventual Player.tsx handoff
      // (header comment) starting from the right place, with no seat
      // geometry or capsule-height math needed here at all.
      camera.position.lerpVectors(
        phaseStartPosRef.current,
        standingReturnPosRef.current,
        t,
      )

      if (t >= 1) {
        seatPhaseRef.current = 'standing'
        elapsedRef.current = 0
        activeSeatRef.current = null
      }
    }
  })

  return null
}
