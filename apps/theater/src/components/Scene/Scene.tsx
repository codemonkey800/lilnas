'use client'

import { KeyboardControls, Stats, useGLTF } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Leva } from 'leva'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ACESFilmicToneMapping } from 'three'

import { DebugHud } from './DebugHud'
import { KEYBOARD_MAP, Player, Telemetry } from './Player'
import { Theater } from './Theater'

const ZERO_TELEMETRY: Telemetry = {
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
}

export function Scene() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [pointerLocked, setPointerLocked] = useState(false)
  const [debugMode] = useState(() =>
    new URLSearchParams(window.location.search).has('debug'),
  )
  const [telemetry, setTelemetry] = useState<Telemetry>(ZERO_TELEMETRY)

  useEffect(() => {
    const handlePointerLockChange = () => {
      setPointerLocked(document.pointerLockElement === canvasRef.current)
    }
    document.addEventListener('pointerlockchange', handlePointerLockChange)
    return () =>
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
  }, [])

  // ecctrl already rotates the camera on mousemove whenever
  // document.pointerLockElement is set (no ecctrl props needed) — this just
  // requests the lock itself, which browsers only grant from a user gesture.
  const requestLook = useCallback(() => {
    canvasRef.current?.requestPointerLock().catch(() => {
      // Rejected outside a user gesture, or unsupported — ignore.
    })
  }, [])

  return (
    <KeyboardControls map={KEYBOARD_MAP}>
      <Leva hidden />

      <div className="relative min-h-0 flex-auto" onClick={requestLook}>
        <Canvas
          shadows="percentage"
          camera={{ fov: 75 }}
          gl={{ toneMapping: ACESFilmicToneMapping }}
          onCreated={state => {
            canvasRef.current = state.gl.domElement
          }}
        >
          {debugMode && <Stats />}

          {/* Dim sky/ground fill so unlit corners aren't pure black —
              a stand-in for bounce light since the model has no baked GI. */}
          <hemisphereLight
            intensity={0.15}
            color="#8fa3c9"
            groundColor="#15111a"
          />

          {/* Ceiling-mounted practical lights, not a directional "sun" —
              this room has no windows, so light should fall off with
              distance the way real fixtures do. */}
          <pointLight
            position={[0, 4.3, 2.5]}
            intensity={12}
            distance={11}
            decay={2}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <pointLight
            position={[0, 4.3, -2.5]}
            intensity={9}
            distance={11}
            decay={2}
          />

          <Suspense fallback={null}>
            <Physics debug={debugMode} gravity={[0, -9.81, 0]}>
              <Theater />
              <Player onTelemetry={debugMode ? setTelemetry : undefined} />
            </Physics>
          </Suspense>
        </Canvas>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-2 w-2 rounded-full bg-white/80" />
        </div>

        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/60 px-4 py-2 text-sm">
          {pointerLocked
            ? 'WASD move · Space jump'
            : 'Click to look around · WASD move · Space jump'}
        </div>

        {debugMode && <DebugHud telemetry={telemetry} />}
      </div>
    </KeyboardControls>
  )
}

useGLTF.preload('/models/cinema.glb')
