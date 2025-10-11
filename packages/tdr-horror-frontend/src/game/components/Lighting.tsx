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
      {/* Ambient light - very dim for minimal global illumination */}
      <ambientLight intensity={0.1} />

      {/* Directional light (Moon) - very dim with blue tint */}
      <directionalLight
        position={[10, 20, 10]}
        intensity={0.2}
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

      {/* SpotLight (Flashlight) - follows camera */}
      <spotLight
        ref={spotlightRef}
        intensity={3}
        angle={Math.PI / 4}
        distance={30}
        penumbra={0.5}
        decay={2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.5}
        shadow-camera-far={30}
        shadow-bias={-0.0001}
      />
    </>
  )
}
