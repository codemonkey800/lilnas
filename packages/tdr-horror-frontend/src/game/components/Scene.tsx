import { Stats } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'

import { useInputManager } from 'src/hooks/useInputManager'

import { Lighting } from './Lighting'
import { Terrain } from './Terrain'

/**
 * First-person camera controller
 */
function CameraController() {
  const { camera } = useThree()
  const inputManager = useInputManager()
  const velocityRef = useRef(new THREE.Vector3())

  useFrame((_, delta) => {
    if (!inputManager) return

    const movement = inputManager.getMovementInput()
    const mouseDelta = inputManager.getMouseDelta()

    // Mouse look
    if (inputManager.isPointerLocked()) {
      const sensitivity = 0.002
      camera.rotation.y -= mouseDelta.x * sensitivity
      camera.rotation.x -= mouseDelta.y * sensitivity
      camera.rotation.x = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, camera.rotation.x),
      )
    }

    // Movement
    const moveSpeed = 5
    const direction = new THREE.Vector3()

    if (movement.forward) direction.z -= 1
    if (movement.backward) direction.z += 1
    if (movement.left) direction.x -= 1
    if (movement.right) direction.x += 1

    if (direction.length() > 0) {
      direction.normalize()

      // Apply camera rotation to movement direction
      const forward = new THREE.Vector3(0, 0, -1)
      forward.applyQuaternion(camera.quaternion)
      forward.y = 0
      forward.normalize()

      const right = new THREE.Vector3(1, 0, 0)
      right.applyQuaternion(camera.quaternion)
      right.y = 0
      right.normalize()

      const moveDirection = new THREE.Vector3()
      moveDirection.addScaledVector(forward, -direction.z)
      moveDirection.addScaledVector(right, direction.x)

      velocityRef.current.copy(moveDirection.multiplyScalar(moveSpeed))
    } else {
      velocityRef.current.multiplyScalar(0.8)
    }

    camera.position.addScaledVector(velocityRef.current, delta)

    // Reset mouse delta
    inputManager.resetMouseDelta()
  })

  return null
}

/**
 * Scene wrapper with input manager initialization
 */
function SceneContent() {
  useInputManager()

  return (
    <>
      {/* Dark background */}
      <color args={['#000000']} attach="background" />

      {/* Exponential fog for atmosphere - reduced for visibility */}
      <fogExp2 args={['#000000', 0.008]} attach="fog" />

      {/* Performance monitoring */}
      <Stats />

      {/* Camera controller */}
      <CameraController />

      {/* Lighting system */}
      <Lighting />

      {/* Game components - will be added as they are implemented */}
      {/* <Environment /> */}
      <Terrain />
      {/* <Player /> */}
    </>
  )
}

export function Scene() {
  const canvasRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={canvasRef} style={{ width: '100vw', height: '100vh' }}>
      <Canvas
        shadows
        camera={{
          fov: 75,
          near: 0.1,
          far: 1000,
          position: [0, 1.7, 0],
          rotation: [0, 0, 0],
        }}
        dpr={[1, 2]}
        gl={{
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
        onClick={() => {
          // Request pointer lock on the canvas element
          const canvas = canvasRef.current?.querySelector('canvas')
          if (canvas) {
            canvas.requestPointerLock()
          }
        }}
      >
        <SceneContent />
      </Canvas>
    </div>
  )
}
