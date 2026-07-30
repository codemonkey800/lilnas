'use client'

import { KeyboardControlsEntry } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import Ecctrl, { CustomEcctrlRigidBody } from 'ecctrl'
import { useRef, useState } from 'react'

import { usePlaybackStore } from 'src/playback/store'

import { playerVelocity } from './playerVelocity'
import { isFiniteVec3, isOutOfBounds } from './respawn'
import { seatPhaseRef } from './SeatedCamera'

export type Controls =
  | 'forward'
  | 'backward'
  | 'leftward'
  | 'rightward'
  | 'jump'
  | 'run'

export const KEYBOARD_MAP: KeyboardControlsEntry<Controls>[] = [
  { name: 'forward', keys: ['KeyW', 'ArrowUp'] },
  { name: 'backward', keys: ['KeyS', 'ArrowDown'] },
  { name: 'leftward', keys: ['KeyA', 'ArrowLeft'] },
  { name: 'rightward', keys: ['KeyD', 'ArrowRight'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'run', keys: ['ShiftLeft', 'ShiftRight'] },
]

// Picked from the debug HUD's live position readout while standing on the
// raked floor, so the player spawns resting on the floor instead of falling
// onto it.
const SPAWN_POSITION: [number, number, number] = [2.19, 1.13, -3.62]
const SPAWN_VECTOR = {
  x: SPAWN_POSITION[0],
  y: SPAWN_POSITION[1],
  z: SPAWN_POSITION[2],
}
const ZERO_VELOCITY = { x: 0, y: 0, z: 0 }

// Theater.tsx recenters the model so its lowest floor point is always
// exactly y=0 in world space — so falling this far below is unambiguously
// off the collision mesh, not a legitimate low point of a real floor.
// isOutOfBounds' NaN check catches ecctrl's separate NaN-position failure
// mode (see the capsule-sizing comment below) regardless of this threshold.
const RESPAWN_MIN_Y = -2

// Shrinking the actual capsule (capsuleRadius/capsuleHalfHeight) destabilizes
// ecctrl's floating-capsule physics — the RigidBody's auto-computed mass
// drops with its volume, but ecctrl's spring/jump force constants stay
// absolute, so the same forces overpower the lighter body. Confirmed via
// testing: shrinking the radius alone produces NaN positions within ~1-2s
// of sustained wall contact + a jump. Keep ecctrl's tested default capsule
// size, and only lower the camera's look-target height — a pure visual
// offset with no physics feedback — to make the default eye-height feel
// less like a looming adult.
const CAM_TARGET_POS = { x: 0, y: -0.2, z: 0 }

// ecctrl's own per-frame loop returns immediately when `disableControl` is
// true — before it applies the floating-capsule spring force that holds a
// grounded character up, and before its gravityScale management runs (see
// node_modules/ecctrl/dist/Ecctrl.js). That leaves gravityScale pinned at
// whatever it last was (1, ecctrl's own default, for a character standing
// still) with nothing left to counteract it, so a motionless character
// starts falling — fast enough to tunnel straight through the floor's thin
// trimesh collider (ecctrl has no CCD) well before the iPad closes (or the
// sit/stand transition finishes). Freezing gravity + velocity here for the
// whole time `frozen` is true (iPad open OR any part of the seated state
// machine below, per `seatPhaseRef`) is what actually keeps the character
// "exactly in place", restoring ecctrl's default the instant it unfreezes
// so its own floor-spring/gravity logic resumes correctly from the next
// frame.
const FROZEN_GRAVITY_SCALE = 0
const DEFAULT_GRAVITY_SCALE = 1 // matches ecctrl's own unconfigured default

// A debug HUD only needs a human-readable refresh rate — pushing telemetry
// into React state at useFrame's display-refresh cadence (~60Hz) would mean
// 60 Scene re-renders/sec for numbers nobody can read that fast.
const TELEMETRY_INTERVAL_S = 0.1

export type Telemetry = {
  position: { x: number; y: number; z: number }
  velocity: { x: number; y: number; z: number }
}

export type PlayerProps = {
  onTelemetry?: (telemetry: Telemetry) => void
}

export function Player({ onTelemetry }: PlayerProps) {
  const ipadOpen = usePlaybackStore(state => state.ipadOpen)
  const ecctrlRef = useRef<CustomEcctrlRigidBody>(null)
  const telemetryElapsedRef = useRef(0)
  // Tracks "frozen as of the end of the last frame", read/written ONLY
  // inside useFrame below (never during render -- react-hooks/refs flags
  // exactly that) so the gravity-restore edge and the frozenState sync
  // below always compare against the previous frame's value, not whatever
  // frozenState happens to still read while a render is pending.
  const wasFrozenRef = useRef(ipadOpen)
  // The actual value read by the JSX below for <Ecctrl>'s
  // disableControl/disableFollowCam props -- see the sync comment inside
  // useFrame for why this can't just be the ref above.
  const [frozenState, setFrozenState] = useState(ipadOpen)

  useFrame((state, delta) => {
    const body = ecctrlRef.current?.group
    if (!body) return

    // Bugfix: no seat teleport here anymore. The old behavior moved the
    // physics body's ORIGIN (the ecctrl capsule's centre) to the seat's
    // FLOOR position — but ecctrl's floating capsule rests with its centre
    // `capsuleHalfHeight + capsuleRadius + floatHeight` above the ground
    // (node_modules/ecctrl/dist/Ecctrl.js's own defaults: 0.35 + 0.3 + 0.3 =
    // 0.95m — matches SPAWN_POSITION.y = 1.13 "resting on the floor" above),
    // so the body ended up buried ~0.95m into the floor collider for the
    // whole seated window. On stand-up, gravity/collision resumed from
    // inside solid geometry: best case a hard pop back to the surface,
    // worst case Rapier's own penetration-recovery shove sent it flying,
    // which read as "glitch out and clip through the map." The player's
    // body simply stays exactly where it was standing (frozen in place
    // below, same as it already does while the iPad is open) for the whole
    // sit_down/sitting/stand_up window — SeatedCamera.tsx eases the local
    // camera back to that SAME standing position on stand-up (see its
    // `standingReturnPosRef`), so there's no seat-derived position this
    // file needs to compute or teleport to at all.

    // Publish the player's TRUE planar velocity for LocalPresence's animState
    // classification (see playerVelocity.ts). The Rapier rigid body's linvel is
    // read straight off the physics state -- accurate magnitude, no camera-delta
    // aliasing, and a sharp start/stop edge -- replacing the camera-position
    // delta + EMA that lagged the classified stop by ~0.3s.
    const linvel = body.linvel()
    playerVelocity.x = linvel.x
    playerVelocity.z = linvel.z

    // Frozen while the iPad is open OR while any part of the sit/stand
    // transition is in flight. `seatPhaseRef.current !== 'standing'` covers
    // sit_down/sitting/stand_up as ONE window, not just the seated steady
    // state: useSeatStore's `mySeatId` clears at the START of stand_up (see
    // SeatedCamera.tsx), so keying off `mySeatId` alone would unfreeze one
    // whole animation early and drop the character mid stand-up.
    const frozen = ipadOpen || seatPhaseRef.current !== 'standing'
    const wasFrozen = wasFrozenRef.current

    if (frozen !== wasFrozen) {
      // <Ecctrl>'s disableControl/disableFollowCam props (below) only take
      // effect on a fresh render of THIS component -- r3f's useFrame
      // captures each render's props into a ref via a layout effect
      // (useMutableCallback), so `frozen` changing here doesn't reach them
      // on its own. `ipadOpen` toggling already re-renders us via its own
      // zustand subscription above, but the seatPhaseRef-driven edge
      // (specifically stand_up -> standing, a pure timer inside
      // SeatedCamera.tsx with no store change of its own to subscribe to)
      // would otherwise never trigger one. `setFrozenState` only fires on an
      // actual transition, matching this file's own established discipline
      // against pushing every-frame values into React state (see
      // TELEMETRY_INTERVAL_S's comment).
      setFrozenState(frozen)
    }

    // Every frame, not just on the frozen edge — a one-time zero would still
    // leave gravityScale at 1 with nothing opposing it (see the constant's
    // comment above), so the character would resume falling on the very next
    // physics step.
    if (frozen) {
      body.setGravityScale(FROZEN_GRAVITY_SCALE, true)
      body.setLinvel(ZERO_VELOCITY, true)
      body.setAngvel(ZERO_VELOCITY, true)
    } else if (wasFrozen) {
      // Just unfroze — hand gravityScale back so ecctrl's own management
      // (which only runs while disableControl is false) resumes from a
      // known-good value instead of the frozen 0 we left it at.
      body.setGravityScale(DEFAULT_GRAVITY_SCALE, true)
    }
    wasFrozenRef.current = frozen

    if (isOutOfBounds(body.translation(), RESPAWN_MIN_Y)) {
      body.setTranslation(SPAWN_VECTOR, true)
      body.setLinvel(ZERO_VELOCITY, true)
      body.setAngvel(ZERO_VELOCITY, true)
    }

    // Backstop alongside the body respawn above: ecctrl's camera-follow
    // lerp (THREE.Vector3.lerp) never recovers once a component goes
    // non-finite ("NaN + anything" stays NaN), which otherwise throws
    // inside AudioListener.updateMatrixWorld the next time positional audio
    // updates (linearRampToValueAtTime rejects non-finite values). Snap
    // directly — not via lerp — the instant that happens.
    if (!isFiniteVec3(state.camera.position)) {
      state.camera.position.set(...SPAWN_POSITION)
    }

    if (onTelemetry) {
      telemetryElapsedRef.current += delta
      if (telemetryElapsedRef.current >= TELEMETRY_INTERVAL_S) {
        telemetryElapsedRef.current = 0
        onTelemetry({ position: body.translation(), velocity: body.linvel() })
      }
    }
  })

  return (
    <Ecctrl
      ref={ecctrlRef}
      // Freezes WASD/jump input (and reading it at all) while frozen —
      // without this, typing in the iPad's search box (or sitting in a
      // seat) moves the character, since drei's KeyboardControls listens on
      // `window` regardless of DOM focus. This also stops ecctrl's own
      // internal movement/jump handling (see the FROZEN_GRAVITY_SCALE
      // comment above for why that alone isn't safe for gravity
      // specifically), so the useFrame above takes over holding the
      // character in place for as long as this is true.
      disableControl={frozenState}
      // ecctrl's OWN camera-follow (`state.camera.position.lerp(...)` +
      // `.lookAt(...)`, node_modules/ecctrl/dist/Ecctrl.js) is gated on
      // THIS prop, not disableControl — disableControl's early return
      // happens AFTER the camera-follow block, so it gates
      // movement/jump/gravity management but never the camera itself.
      // Without also disabling this, ecctrl would keep dragging the camera
      // back toward the character's head every frame, fighting
      // SeatedCamera.tsx's per-frame camera writes for the entire seated
      // window rather than just risking a snap at the final handoff. This
      // prop is what actually gives SeatedCamera.tsx exclusive camera
      // ownership while frozen.
      disableFollowCam={frozenState}
      jumpVel={2.5}
      camTargetPos={CAM_TARGET_POS}
      camCollision={false}
      camInitDis={-0.01}
      camMinDis={-0.01}
      // ecctrl's own first-person recipe omits this, but it leaves the
      // mouse-wheel camera-zoom listener (Ecctrl.js's onDocumentMouseWheel)
      // active on the canvas — since the cam sits at -0.01 (the character's
      // head), any scroll zooms it out toward camMaxDis, which reads as the
      // character/world lurching away. Zeroing zoom speed neutralizes that
      // handler without touching the rest of the FP camera setup.
      camZoomSpeed={0}
      camFollowMult={1000}
      camLerpMult={1000}
      turnVelMultiplier={1}
      turnSpeed={100}
      mode="CameraBasedMovement"
      position={SPAWN_POSITION}
    >
      <mesh visible={false}>
        <capsuleGeometry args={[0.3, 0.7]} />
        <meshBasicMaterial />
      </mesh>
    </Ecctrl>
  )
}
