import { Stats } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'

import { Lighting } from './Lighting'
import { Terrain } from './Terrain'

export function Scene() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Canvas
        shadows
        camera={{ fov: 75, near: 0.1, far: 1000, position: [0, 3, 8] }}
        dpr={[1, 2]}
        gl={{
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.5,
        }}
      >
        {/* Dark background */}
        <color args={['#000000']} attach="background" />

        {/* Exponential fog for atmosphere */}
        <fogExp2 args={['#000000', 0.02]} attach="fog" />

        {/* Performance monitoring */}
        <Stats />

        {/* Lighting system */}
        <Lighting />

        {/* Game components - will be added as they are implemented */}
        {/* <Environment /> */}
        <Terrain />
        {/* <Player /> */}
      </Canvas>
    </div>
  )
}
