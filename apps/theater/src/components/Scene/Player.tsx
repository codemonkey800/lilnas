'use client'

import { KeyboardControlsEntry, useKeyboardControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'

export type Controls = 'forward' | 'backward' | 'left' | 'right'

export const KEYBOARD_MAP: KeyboardControlsEntry<Controls>[] = [
  { name: 'forward', keys: ['KeyW', 'ArrowUp'] },
  { name: 'backward', keys: ['KeyS', 'ArrowDown'] },
  { name: 'left', keys: ['KeyA', 'ArrowLeft'] },
  { name: 'right', keys: ['KeyD', 'ArrowRight'] },
]

export const EYE_HEIGHT = 1.7

const SPEED = 4

const forward = new Vector3()
const right = new Vector3()
const move = new Vector3()

export function Player() {
  const [, get] = useKeyboardControls<Controls>()

  useFrame((state, delta) => {
    const controls = get()

    forward.set(0, 0, -1).applyQuaternion(state.camera.quaternion)
    forward.y = 0
    forward.normalize()
    right.set(-forward.z, 0, forward.x)

    move.set(0, 0, 0)
    if (controls.forward) move.add(forward)
    if (controls.backward) move.sub(forward)
    if (controls.right) move.add(right)
    if (controls.left) move.sub(right)

    if (move.lengthSq() > 0) {
      state.camera.position.add(move.normalize().multiplyScalar(SPEED * delta))
    }

    state.camera.position.y = EYE_HEIGHT
  })

  return null
}
