import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'

export function Lighting() {
  const { camera } = useThree()
  const spotlightRef = useRef<THREE.SpotLight>(null)

  // Update spotlight position and direction to follow camera
  useFrame(() => {
    if (spotlightRef.current) {
      // Position spotlight at camera position
      spotlightRef.current.position.copy(camera.position)

      // Point spotlight in camera's forward direction
      const direction = new THREE.Vector3(0, 0, -1)
      direction.applyQuaternion(camera.quaternion)
      const target = camera.position.clone().add(direction)
      spotlightRef.current.target.position.copy(target)
      spotlightRef.current.target.updateMatrixWorld()
    }
  })

  return (
    <>
      {/* Ambient light - darker for horror atmosphere */}
      <ambientLight intensity={0.15} />

      {/* Directional light (Moon) - darker for horror atmosphere */}
      <directionalLight
        position={[10, 20, 10]}
        intensity={0.3}
        color="#b0c4de"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
        shadow-camera-near={0.5}
        shadow-camera-far={100}
        shadow-bias={-0.0001}
      />

      {/* SpotLight (Flashlight) - brighter and more focused */}
      <spotLight
        ref={spotlightRef}
        intensity={25}
        angle={Math.PI / 6}
        distance={80}
        penumbra={0.3}
        decay={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={80}
        shadow-bias={-0.0001}
      />
    </>
  )
}
