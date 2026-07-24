'use client'

import { KeyboardControlsEntry } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import Ecctrl, { CustomEcctrlRigidBody } from 'ecctrl'
import { useRef } from 'react'

import { usePlaybackStore } from 'src/playback/store'

import { isFiniteVec3, isOutOfBounds } from './respawn'

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
// trimesh collider (ecctrl has no CCD) well before the iPad closes. Freezing
// gravity + velocity here for the whole time the iPad is open is what
// actually keeps the character "exactly in place", restoring ecctrl's
// default the instant it closes so its own floor-spring/gravity logic
// resumes correctly from the next frame.
const IPAD_OPEN_GRAVITY_SCALE = 0
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
  const wasIpadOpenRef = useRef(false)

  useFrame((state, delta) => {
    const body = ecctrlRef.current?.group
    if (!body) return

    if (ipadOpen) {
      // Every frame, not just on open — a one-time zero would still leave
      // gravityScale at 1 with nothing opposing it (see the constant's
      // comment above), so the character would resume falling on the very
      // next physics step.
      body.setGravityScale(IPAD_OPEN_GRAVITY_SCALE, true)
      body.setLinvel(ZERO_VELOCITY, true)
      body.setAngvel(ZERO_VELOCITY, true)
    } else if (wasIpadOpenRef.current) {
      // Just closed — hand gravityScale back so ecctrl's own management
      // (which only runs while disableControl is false) resumes from a
      // known-good value instead of the frozen 0 we left it at.
      body.setGravityScale(DEFAULT_GRAVITY_SCALE, true)
    }
    wasIpadOpenRef.current = ipadOpen

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
      // Freezes WASD/jump input (and reading it at all) while the iPad is
      // open — without this, typing in the iPad's search box moves the
      // character, since drei's KeyboardControls listens on `window`
      // regardless of DOM focus. This also stops ecctrl's own internal
      // frame logic (see the IPAD_OPEN_GRAVITY_SCALE comment above for why
      // that's not safe on its own), so the useFrame below takes over
      // holding the character in place for as long as this is true.
      disableControl={ipadOpen}
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
