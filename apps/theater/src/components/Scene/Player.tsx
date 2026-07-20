'use client'

import { KeyboardControlsEntry } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import Ecctrl, { CustomEcctrlRigidBody } from 'ecctrl'
import { useRef } from 'react'

import { isOutOfBounds } from './respawn'

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
  const ecctrlRef = useRef<CustomEcctrlRigidBody>(null)
  const telemetryElapsedRef = useRef(0)

  useFrame((_state, delta) => {
    const body = ecctrlRef.current?.group
    if (!body) return

    if (isOutOfBounds(body.translation(), RESPAWN_MIN_Y)) {
      body.setTranslation(SPAWN_VECTOR, true)
      body.setLinvel(ZERO_VELOCITY, true)
      body.setAngvel(ZERO_VELOCITY, true)
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
      jumpVel={2.5}
      camTargetPos={CAM_TARGET_POS}
      camCollision={false}
      camInitDis={-0.01}
      camMinDis={-0.01}
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
