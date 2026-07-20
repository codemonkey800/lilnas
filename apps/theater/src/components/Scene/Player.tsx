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

// Spawned above the room (recentered height is ~5m) so the player visibly
// falls onto the raked floor instead of spawning inside a raised back row.
const SPAWN_POSITION: [number, number, number] = [0, 5.5, -3]
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

export function Player() {
  const ecctrlRef = useRef<CustomEcctrlRigidBody>(null)

  useFrame(() => {
    const body = ecctrlRef.current?.group
    if (body && isOutOfBounds(body.translation(), RESPAWN_MIN_Y)) {
      body.setTranslation(SPAWN_VECTOR, true)
      body.setLinvel(ZERO_VELOCITY, true)
      body.setAngvel(ZERO_VELOCITY, true)
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
