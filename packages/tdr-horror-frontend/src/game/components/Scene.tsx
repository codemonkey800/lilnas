import { Stats } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Leva } from 'leva'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

import { StaminaBar } from 'src/components/StaminaBar'
import {
  HEAD_BOB_AMPLITUDE,
  HEAD_BOB_FREQUENCY,
  PLAYER_HEIGHT,
} from 'src/game/constants/gameSettings'
import { usePlayerStore } from 'src/game/store/playerStore'
import { useAudioSystem } from 'src/hooks/useAudioSystem'
import { useDebugControls } from 'src/hooks/useDebugControls'
import { useInputManager } from 'src/hooks/useInputManager'

import { Lighting } from './Lighting'
import { Terrain, useTerrainStore } from './Terrain'

/**
 * AudioInitializer - Initializes the audio system with the camera
 */
function AudioInitializer() {
  const { camera } = useThree()
  const audioSystem = useAudioSystem()

  useEffect(() => {
    if (!audioSystem.isInitialized()) {
      audioSystem.init(camera)
      console.log('AudioSystem initialized in Scene')

      // Load movement sounds
      audioSystem
        .loadSound('grass-walk', 'player', '/sounds/grass-walk.mp3', false)
        .catch(err => console.error('Failed to load grass-walk sound:', err))

      audioSystem
        .loadSound('grass-run', 'player', '/sounds/grass-run.mp3', false)
        .catch(err => console.error('Failed to load grass-run sound:', err))
    }
  }, [audioSystem, camera])

  return null
}

/**
 * First-person camera controller with stamina, collision, and head bob
 */
function CameraController() {
  const { camera } = useThree()
  const inputManager = useInputManager()
  const audioSystem = useAudioSystem()
  const velocityRef = useRef(new THREE.Vector3())
  const headBobTimeRef = useRef(0)
  const previousMovementStateRef = useRef<'idle' | 'walking' | 'running'>(
    'idle',
  )

  // Player state
  const { stamina, isExhausted, drainStamina, recoverStamina } =
    usePlayerStore()

  // Terrain collision
  const treePositions = useTerrainStore(state => state.treePositions)

  // Debug controls
  const {
    walkSpeed,
    runSpeed,
    staminaDrainRate,
    staminaRecoveryRate,
    mouseSensitivity,
    godMode,
  } = useDebugControls()

  // Cleanup movement sounds on unmount
  useEffect(() => {
    return () => {
      audioSystem.stop('grass-walk')
      audioSystem.stop('grass-run')
    }
  }, [audioSystem])

  useFrame((_, delta) => {
    if (!inputManager) return

    // Set rotation order to YXZ for proper first-person camera behavior
    // This prevents gimbal lock and ensures pitch (up/down) works correctly
    camera.rotation.order = 'YXZ'

    const movement = inputManager.getMovementInput()
    const mouseDelta = inputManager.getMouseDelta()

    // Mouse look
    if (inputManager.isPointerLocked()) {
      camera.rotation.y -= mouseDelta.x * mouseSensitivity
      camera.rotation.x -= mouseDelta.y * mouseSensitivity
      camera.rotation.x = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, camera.rotation.x),
      )
    }

    // Determine speed based on run input and stamina
    const isRunning = movement.run && stamina > 0 && !isExhausted
    const moveSpeed = isRunning ? runSpeed : walkSpeed

    // Stamina management
    if (isRunning && (movement.forward || movement.backward)) {
      drainStamina(staminaDrainRate * delta)
    } else {
      recoverStamina(staminaRecoveryRate * delta)
    }

    // Movement direction
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

    // Calculate new position
    const newPosition = camera.position.clone()
    newPosition.addScaledVector(velocityRef.current, delta)

    // Tree collision detection (skip if god mode is enabled)
    const TREE_COLLISION_RADIUS = 2.5
    let collisionDetected = false

    if (!godMode) {
      for (const tree of treePositions) {
        const dx = newPosition.x - tree.x
        const dz = newPosition.z - tree.z
        const distanceSquared = dx * dx + dz * dz
        const minDistSquared =
          TREE_COLLISION_RADIUS *
          TREE_COLLISION_RADIUS *
          tree.scaleWidth *
          tree.scaleWidth

        if (distanceSquared < minDistSquared) {
          collisionDetected = true
          break
        }
      }
    }

    // Apply movement if no collision
    if (!collisionDetected) {
      camera.position.copy(newPosition)
    }

    // Ground clamping
    if (camera.position.y < PLAYER_HEIGHT) {
      camera.position.y = PLAYER_HEIGHT
    }

    // Head bob effect
    const isMoving = velocityRef.current.length() > 0.1
    if (isMoving) {
      headBobTimeRef.current += delta * HEAD_BOB_FREQUENCY
      const bobOffset =
        Math.sin(headBobTimeRef.current) * HEAD_BOB_AMPLITUDE * moveSpeed * 0.1
      camera.position.y = PLAYER_HEIGHT + bobOffset
    } else {
      // Smoothly return to normal height
      headBobTimeRef.current = 0
      camera.position.y = THREE.MathUtils.lerp(
        camera.position.y,
        PLAYER_HEIGHT,
        delta * 5,
      )
    }

    // Movement sound management
    const currentMovementState: 'idle' | 'walking' | 'running' = !isMoving
      ? 'idle'
      : isRunning
        ? 'running'
        : 'walking'

    if (currentMovementState !== previousMovementStateRef.current) {
      // Stop all movement sounds
      audioSystem.stop('grass-walk')
      audioSystem.stop('grass-run')

      // Play appropriate sound for new state
      if (currentMovementState === 'walking') {
        audioSystem.play('grass-walk', { loop: true, volume: 0.7 })
      } else if (currentMovementState === 'running') {
        audioSystem.play('grass-run', { loop: true, volume: 0.8 })
      }

      previousMovementStateRef.current = currentMovementState
    }

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

  // Debug controls
  const { fogDensity, showStats, showCollisionBoxes } = useDebugControls()

  return (
    <>
      {/* Dark background */}
      <color args={['#000000']} attach="background" />

      {/* Exponential fog for atmosphere */}
      <fogExp2 args={['#000000', fogDensity]} attach="fog" />

      {/* Performance monitoring */}
      {showStats && <Stats />}

      {/* Audio system initialization */}
      <AudioInitializer />

      {/* Camera controller */}
      <CameraController />

      {/* Lighting system */}
      <Lighting />

      {/* Game components - will be added as they are implemented */}
      {/* <Environment /> */}
      <Terrain showCollisionBoxes={showCollisionBoxes} />
      {/* <Player /> */}
    </>
  )
}

export function Scene() {
  const canvasRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={canvasRef} style={{ width: '100vw', height: '100vh' }}>
      {/* Leva debug panel - must be explicitly rendered for React 19 compatibility */}
      <Leva />

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

      {/* HUD overlay - rendered outside Canvas */}
      <StaminaBar />
    </div>
  )
}
