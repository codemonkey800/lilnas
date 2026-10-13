'use client'

import { KeyboardControls, Stats, useGLTF } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Leva } from 'leva'
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ACESFilmicToneMapping,
  type Mesh,
  SRGBColorSpace,
  VideoTexture,
} from 'three'

import { FullscreenPlayer } from 'src/components/FullscreenPlayer'
import { useMultiplayerStore } from 'src/multiplayer/store'
import { usePlaybackStore } from 'src/playback/store'
import { useVideoSync } from 'src/playback/sync'
import { useVideoAudio } from 'src/playback/useVideoAudio'

import { DebugHud } from './DebugHud'
import { IpadBrowser } from './IpadBrowser'
import { LocalPresence } from './LocalPresence'
import { MicIndicator } from './MicIndicator'
import { KEYBOARD_MAP, Player, Telemetry } from './Player'
import { RemoteAvatars } from './RemoteAvatars'
import { SeatedCamera } from './SeatedCamera'
import { useSeatTargeting } from './seatTargeting'
import { SitPrompt } from './SitPrompt'
import { SubtitleOverlay } from './SubtitleOverlay'
import { Theater } from './Theater'
import { TheaterScreen } from './TheaterScreen'
import { useViewControls } from './viewControls'

const ZERO_TELEMETRY: Telemetry = {
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
}

// Rendered inside <Canvas> (still within the existing <Suspense> boundary,
// outside <Physics> since none of this needs physics) — everything here
// needs R3F context (useThree/useFrame) that only exists for components
// actually rendered as children of <Canvas>, which Scene() itself is not
// (it returns the <Canvas>, it isn't inside one). Wires together the
// in-world screen texture, spatial audio, subtitles, and the iPad browser,
// plus the per-frame playback reconcile tick — see ORCHESTRATE.md's "Shared
// contracts" section for each piece's exact contract.
function TheaterPlayback() {
  const screenRef = useRef<Mesh>(null)

  const itemId = usePlaybackStore(state => state.itemId)
  const videoAspect = usePlaybackStore(state => state.videoAspect)

  // Built exactly once — the underlying <video> is itself a stable
  // singleton (src/playback/store.ts), so recreating this per-render would
  // be both wasteful and wrong. Only the *prop* passed to <TheaterScreen/>
  // below is conditional on `itemId`, never this texture's construction.
  const videoTexture = useMemo(() => {
    const texture = new VideoTexture(
      usePlaybackStore.getState().getVideoElement(),
    )
    texture.colorSpace = SRGBColorSpace
    return texture
  }, [])

  useVideoAudio(screenRef)

  useFrame(() => {
    usePlaybackStore.getState().tick(performance.now())
  })

  return (
    <>
      <TheaterScreen
        ref={screenRef}
        videoTexture={itemId === null ? null : videoTexture}
        videoAspect={videoAspect}
      />
      <SubtitleOverlay screenRef={screenRef} />
      <IpadBrowser />
    </>
  )
}

// Trivial wrapper whose only purpose is to run seatTargeting.ts's
// useSeatTargeting() every frame. That hook does nothing on its own — it
// must be mounted somewhere inside <Canvas> for its useFrame to ever run,
// and nothing else in this app calls it. ORCHESTRATE.md §1 ("If nothing
// mounts this, seatTargetRef never leaves null"), §5's Batch 5 gate, and §7
// all flag this exact mount as the single line most likely to be silently
// skipped in this whole phase: there is no crash and no type error if it's
// missing, `E` just permanently does nothing. Renders no JSX of its own,
// the same "no local body" shape as LocalPresence.tsx / SeatedCamera.tsx.
function SeatTargeting() {
  useSeatTargeting()
  return null
}

type SceneProps = {
  characterId: string
}

export function Scene({ characterId }: SceneProps) {
  useViewControls()
  // Attaches this client's room video-sync socket listeners for as long as
  // Scene itself is mounted, rebinding on reconnect (src/playback/sync.ts,
  // F6). Not a useFrame hook, so — unlike useSeatTargeting() below — it has
  // no need to run inside <Canvas>; called here at the top level for the
  // same "runs for the whole scene's lifetime" reason useViewControls() is.
  useVideoSync()

  const view = usePlaybackStore(state => state.view)
  const peerCount = useMultiplayerStore(state => state.peerIds.length)

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

  // Join/leave the multiplayer room alongside this component's own
  // mount/unmount lifecycle. Imperative `.getState()` calls (matching this
  // store's action-API design, and TheaterPlayback's own
  // `usePlaybackStore.getState().tick(...)` pattern above) rather than
  // subscribing via the `useMultiplayerStore(...)` hook — this effect has
  // nothing to react to besides `characterId` itself. `connect`/`disconnect`
  // are already StrictMode-safe (multiplayer/store.ts's deferred-teardown
  // guard), so no extra guarding is needed here.
  useEffect(() => {
    useMultiplayerStore.getState().connect(characterId)
    return () => useMultiplayerStore.getState().disconnect()
  }, [characterId])

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
          frameloop={view === 'fullscreen' ? 'never' : 'always'}
          onCreated={state => {
            canvasRef.current = state.gl.domElement
            // Trackpad pinch-to-zoom has no touch events to hook (trackpads
            // aren't touchscreens) — browsers instead synthesize a `wheel`
            // event with ctrlKey set, for both pinch and actual Ctrl+scroll.
            // Must be a native listener: React attaches its own onWheel as
            // passive, which makes preventDefault() inside it a silent
            // no-op. This only blocks the browser's page-zoom; Player.tsx's
            // camZoomSpeed={0} already neutralizes ecctrl's own camera zoom.
            state.gl.domElement.addEventListener(
              'wheel',
              e => {
                if (e.ctrlKey) e.preventDefault()
              },
              { passive: false },
            )
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
            <TheaterPlayback />
            {/* Remote avatars are visual-only (no colliders/ecctrl) and
                LocalPresence only reads the camera — both live outside
                <Physics> per RemoteAvatars.tsx / LocalPresence.tsx. */}
            <RemoteAvatars />
            <LocalPresence characterId={characterId} />
            {/* Seats (Phase 5 / F4, mounted here by F8): <SeatedCamera />
                owns the local camera for the whole sit_down/sitting/stand_up
                window (SeatedCamera.tsx), and <SeatTargeting /> is what
                actually runs useSeatTargeting()'s per-frame publish into
                seatTargetRef — see its own comment above for why this exact
                mount matters. Neither needs <Physics>. */}
            <SeatedCamera />
            <SeatTargeting />
          </Suspense>
        </Canvas>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-2 w-2 rounded-full bg-white/80" />
        </div>

        {/* Sits just above the movement-hint bar below (F8, PLAN.md "F8 —
            Scene wiring + the sit prompt") — self-positioning and
            self-hiding, like <MicIndicator/> below. */}
        <SitPrompt />

        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/60 px-4 py-2 text-sm">
          {pointerLocked
            ? 'WASD move · Space jump · Tab tablet · F fullscreen'
            : 'Click to look around · WASD move · Space jump · Tab tablet · F fullscreen'}
        </div>

        {/* Cheap demo affordance (PLAN.md "F6") — confirms presence is
            actually wired without needing the debug HUD. */}
        <div className="pointer-events-none absolute bottom-4 right-4 rounded bg-black/60 px-4 py-2 text-sm">
          {peerCount} {peerCount === 1 ? 'other' : 'others'} in the theater
        </div>

        {/* VF5 built this standalone (voice/store.ts's permissionState +
            muted); mounted here since Scene.tsx isn't any voice unit's file
            to touch. Positions itself at top-left. */}
        <MicIndicator />

        {debugMode && <DebugHud telemetry={telemetry} />}
      </div>

      <FullscreenPlayer />
    </KeyboardControls>
  )
}

useGLTF.preload('/models/cinema.glb')
