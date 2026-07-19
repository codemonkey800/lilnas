'use client'

import { KeyboardControls, PointerLockControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'

import { Floor } from './Floor'
import { EYE_HEIGHT, KEYBOARD_MAP, Player } from './Player'

const BOX_POSITIONS: [number, number, number][] = [
  [-3, 0.5, -3],
  [3, 0.5, -3],
  [-3, 0.5, 2],
  [3, 0.5, 2],
  [0, 0.5, -6],
]

export function Scene() {
  return (
    <KeyboardControls map={KEYBOARD_MAP}>
      <div className="relative min-h-0 flex-auto">
        <Canvas camera={{ position: [0, EYE_HEIGHT, 5], fov: 75 }}>
          <ambientLight intensity={0.6} />
          <directionalLight intensity={1.2} position={[5, 10, 5]} />

          <Floor />

          {BOX_POSITIONS.map(position => (
            <mesh key={position.join('-')} position={position}>
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial color="orange" />
            </mesh>
          ))}

          <Player />
          <PointerLockControls />
        </Canvas>

        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/60 px-4 py-2 text-sm">
          Click to look · WASD to move · Esc to release
        </div>
      </div>
    </KeyboardControls>
  )
}
