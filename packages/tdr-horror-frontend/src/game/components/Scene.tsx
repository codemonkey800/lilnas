import { Stats } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'

export function Scene() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Canvas
        shadows
        camera={{ fov: 75, near: 0.1, far: 1000, position: [0, 2, 5] }}
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

        {/* Temporary: basic lighting to see the cube */}
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1} />

        {/* Temporary: test cube to verify scene works */}
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="red" />
        </mesh>

        {/* Game components - will be added as they are implemented */}
        {/* <Lighting /> */}
        {/* <Environment /> */}
        {/* <Terrain /> */}
        {/* <Player /> */}
      </Canvas>
    </div>
  )
}
