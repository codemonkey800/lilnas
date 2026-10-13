'use client'

import {
  ContactShadows,
  MeshReflectorMaterial,
  PerspectiveCamera,
  PresentationControls,
  useTexture,
} from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera as PerspectiveCameraImpl,
  PointLight,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'

import { CharacterModel } from './CharacterModel'
import { lightsUpDone, lightsUpIntensity } from './lightsUp'
import { StageErrorBoundary } from './StageFallback'
import { useReducedMotion } from './useReducedMotion'

// Character is recentered feet-at-y=0 (CharacterModel.tsx); actual height is
// ~1.66m feet-to-helmet. R3F's default camera auto-looks at the world
// origin, which — at this camera height — tilts the view down toward the
// floor and crops the head. Aim explicitly at mid-torso instead, and sit
// back far enough that feet and helmet both stay in frame with a little
// margin on each end (chest-height aim + the old distance cropped the feet).
const CAMERA_POSITION: [number, number, number] = [0, 1.15, 4.4]
const CAMERA_TARGET: [number, number, number] = [0, 0.9, 0]

function StageCamera() {
  const cameraRef = useRef<PerspectiveCameraImpl>(null)

  useLayoutEffect(() => {
    cameraRef.current?.lookAt(...CAMERA_TARGET)
  }, [])

  return (
    <PerspectiveCamera
      ref={cameraRef}
      makeDefault
      fov={32}
      position={CAMERA_POSITION}
    />
  )
}

// Two separate radii, not one — a previous version tied "how big the solid
// pool looks" and "how far it reaches before fully fading" to the same
// number, so resizing the pool also resized the solid center. Kept apart:
// the solid core is a fixed inner radius; the fade radius sets how far the
// gradient reaches before going fully transparent — i.e. the visible size of
// the spotlight. Tune POOL_FADE_RADIUS to resize the pool, but keep
// POOL_OPAQUE_RADIUS below it: as the fade radius approaches the opaque
// radius the gradient collapses into a hard-edged disc.
const POOL_OPAQUE_RADIUS = 0.8
const POOL_FADE_RADIUS = 1.5

// Repeats of the floor texture across the full POOL_FADE_RADIUS * 2 plane
// width. Scale this with POOL_FADE_RADIUS to hold the pattern's original
// ~0.86-repeats-per-unit (6-per-7) density so the carpet's tile size stays
// constant as the pool radius is tuned — here 3 repeats across a 3-unit plane.
// Shrinking the plane without scaling this down would make it look zoomed out.
const FLOOR_TEXTURE_REPEAT = 3
const FLOOR_TEXTURE_URL = '/textures/feature-film-charcoal.jpg'

// A soft circular "spotlight pool" rather than a hard-edged plane: opaque
// near the center, fading to fully transparent (revealing the Canvas's
// black clear-color) well inside the geometry's own edge, so there's never
// a visible boundary. Built at runtime via CanvasTexture instead of a
// static asset since it's just a plain radial gradient — cheap, and no new
// binary asset to track. Safe to call document.createElement here: this
// only ever runs from inside a <Canvas> child, and react-three-fiber never
// invokes Canvas children during SSR (their render is deferred to a
// client-only effect — see CanvasImpl's useIsomorphicLayoutEffect).
function createPoolAlphaMap(): CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  if (ctx) {
    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    )
    gradient.addColorStop(0, 'white')
    gradient.addColorStop(POOL_OPAQUE_RADIUS / POOL_FADE_RADIUS, 'white')
    gradient.addColorStop(1, 'black')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }

  return new CanvasTexture(canvas)
}

// Lives inside PresentationControls' rotating group (a sibling of
// CharacterModel), not up with the top-level lights — unlike the key light,
// there's no "lit side rotates away from camera" failure mode here (a
// horizontal disc looks the same from above regardless of which way it's
// spun around its own vertical axis), and MeshReflectorMaterial's blur is
// anisotropic (`blur={[400, 200]}`, more in one texture axis than the
// other) so the pool's own rotation does have a real, if subtle, visible
// effect on the reflection.
function Floor() {
  const alphaMap = useMemo(() => createPoolAlphaMap(), [])

  // wrapS/wrapT/repeat/colorSpace are per-texture, not per-material, so
  // configuring this tiled color map has no effect on `alphaMap` above —
  // that one stays a single, un-repeated stretch across the same UVs.
  // Cloned rather than configured in place: the linter treats useTexture's
  // return value as immutable (even from inside a useMemo fed by it), so
  // this constructs a genuinely new Texture — sharing the same underlying
  // image bitmap — and configures that instead.
  const rawColorMap = useTexture(FLOOR_TEXTURE_URL)
  const colorMap = useMemo(() => {
    const texture = rawColorMap.clone()
    texture.wrapS = RepeatWrapping
    texture.wrapT = RepeatWrapping
    texture.repeat.set(FLOOR_TEXTURE_REPEAT, FLOOR_TEXTURE_REPEAT)
    texture.colorSpace = SRGBColorSpace
    texture.needsUpdate = true
    return texture
  }, [rawColorMap])

  return (
    <mesh
      position={[0, -0.005, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[POOL_FADE_RADIUS * 2, POOL_FADE_RADIUS * 2]} />
      {/* color tints `map` down to ~30% (it multiplies with the texture,
          same as it would've zeroed it out entirely back when this floor
          had no map and color was pure black). The source photo was shot
          under bright, even studio lighting for a product listing, so it
          reads too vivid at full brightness against this dark scene — cut
          via the material's own albedo rather than the scene lights, which
          also light Master Chief and needed to go up, not down. */}
      <MeshReflectorMaterial
        transparent
        depthWrite={false}
        map={colorMap}
        alphaMap={alphaMap}
        color="#4d4d4d"
        resolution={512}
        blur={[400, 200]}
        mixBlur={1}
        mixStrength={1}
        roughness={0.97}
        metalness={0.1}
        depthScale={1}
        minDepthThreshold={0.85}
        maxDepthThreshold={1.2}
      />
    </mesh>
  )
}

// Key + fill + rim, not <Environment preset> — that fetches an HDRI from a
// CDN and fails offline/behind forward-auth (Scene.tsx's convention for the
// same reason). Tuned for a ~2m tabletop-scale subject, not Scene.tsx's
// room-scale values.
const HEMISPHERE_LIGHT_INTENSITY = 0.3
// 9, not the original 2.5 — confirmed via screenshot that 2.5 left his
// dark-green/black armor reading almost silhouette-black; a directional
// light has no distance falloff to lean on the way the point lights below
// do, so it needs to be driven much harder to read as the dominant "key"
// it's meant to be.
const KEY_LIGHT_INTENSITY = 9
const FILL_LIGHT_INTENSITY = 12
const RIM_LIGHT_INTENSITY = 18

// The stage's opening beat: a dark room, then these four lights rising to
// the targets above (lightsUp.ts has the hold/ramp/ease math) — a one-time
// reveal for this component's own mount, not something that replays on a
// character switch (StageLights never remounts on one; only the character
// inside CharacterStage's PresentationControls does).
//
// Refs, not the `intensity` prop on the elements below, own these values
// after mount — re-rendering four lights every frame would fight the whole
// point of useFrame. `intensity={0}` there is just the pre-ramp resting
// value; nothing here ever renders it back to that once the ramp starts.
function StageLights() {
  const hemisphereRef = useRef<HemisphereLight>(null)
  const keyRef = useRef<DirectionalLight>(null)
  const fillRef = useRef<PointLight>(null)
  const rimRef = useRef<PointLight>(null)
  const prefersReducedMotion = useReducedMotion()
  const doneRef = useRef(false)

  useFrame(state => {
    if (doneRef.current) {
      return
    }

    const targets = [
      [hemisphereRef, HEMISPHERE_LIGHT_INTENSITY],
      [keyRef, KEY_LIGHT_INTENSITY],
      [fillRef, FILL_LIGHT_INTENSITY],
      [rimRef, RIM_LIGHT_INTENSITY],
    ] as const

    if (prefersReducedMotion) {
      for (const [ref, target] of targets) {
        if (ref.current) {
          ref.current.intensity = target
        }
      }
      doneRef.current = true
      return
    }

    const elapsedMs = state.clock.elapsedTime * 1000
    for (const [ref, target] of targets) {
      if (ref.current) {
        ref.current.intensity = lightsUpIntensity(elapsedMs, target)
      }
    }
    if (lightsUpDone(elapsedMs)) {
      doneRef.current = true
    }
  })

  return (
    <>
      <hemisphereLight
        ref={hemisphereRef}
        intensity={0}
        color="#8fa3c9"
        groundColor="#050505"
      />
      {/* Key light — plain directional, no visible cone (a volumetric
          SpotLight was tried here; didn't read well and had no relation to
          the actual light-to-character throw distance). Fixed in world
          space, roughly co-located with the camera: a directional light's
          direction is set by position -> target, and an unset target stays
          frozen at world (0,0,0) — never added to the scene graph, so its
          matrix is unaffected by anything else rotating — which keeps
          whichever side currently faces the camera also facing the light,
          for any rotation. shadow-bias/-normalBias fix shadow acne —
          self-shadow banding from shadow-map depth-precision limits, on a
          mesh this covered in small angled plates. It's not new; it's just
          that at intensity=2.5 the shadow contrast was too weak to notice,
          and 9 made it stark. */}
      <directionalLight
        ref={keyRef}
        position={[1.6, 3.2, 2.2]}
        intensity={0}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0015}
        shadow-normalBias={0.02}
      />
      <pointLight
        ref={fillRef}
        position={[-1.8, 1.2, -1.2]}
        intensity={0}
        distance={6}
        decay={2}
      />
      <pointLight
        ref={rimRef}
        position={[0, 1.6, -1.8]}
        intensity={0}
        distance={5}
        decay={2}
        color="#8fb8ff"
      />
    </>
  )
}

export type CharacterStageProps = {
  modelUrl: string
  animationUrl?: string
}

export function CharacterStage({
  modelUrl,
  animationUrl,
}: CharacterStageProps) {
  return (
    // The stage is purely decorative — the character's name/tagline is the
    // DOM source of truth (CharacterSelect.tsx), announced there on change.
    <Canvas
      shadows="percentage"
      gl={{ toneMapping: ACESFilmicToneMapping }}
      aria-hidden
    >
      <StageCamera />

      {/* Dark room, then lights up — see StageLights for the reveal and the
          lighting rationale/intensities. */}
      <StageLights />

      {/* Floor, lights, and the contact shadow sit OUTSIDE the character's
          Suspense boundary, so the spotlit stage stays on screen the whole
          time a character's multi-MB model is streaming in. Only
          <CharacterModel> suspends on a first-time (uncached) load; when it
          does, just its spot on the stage goes empty — the floor and spotlight
          no longer blank to the Canvas's black background. (They used to share
          one <Suspense fallback={null}>, so a suspending model took the whole
          stage down with it — the black flash on every first switch.)

          The only rotation on stage is the user's own drag — no auto-spin, no
          snap-back on release: wherever they leave it is where it stays.
          `speed` scales drag-to-rotation (default 1 read as sluggish — a
          full-width drag only turned the character 180°). Because
          PresentationControls now lives above the per-character boundary, it
          no longer remounts on a switch, so the turntable angle also carries
          across a character swap instead of snapping back to front. */}
      <PresentationControls
        global
        rotation={[0, 0, 0]}
        polar={[-0.15, 0.15]}
        azimuth={[-Infinity, Infinity]}
        speed={2.5}
      >
        {/* Inside PresentationControls because the floor rotates with the drag
            — MeshReflectorMaterial's blur is anisotropic, so its own spin is
            subtly visible. Its own Suspense catches the one-time floor-texture
            load; that texture is shared by every character and stays cached
            after first paint, so it never re-suspends on a switch (only the
            very first stage mount ever waits on it). */}
        <Suspense fallback={null}>
          <Floor />
        </Suspense>

        {/* Keyed on modelUrl+animationUrl so swapping characters (or just
            their clip) remounts a fresh boundary instead of staying stuck on a
            previous load failure. fallback={null} leaves the performer's spot
            empty — never black, since the stage around it stays mounted — until
            the new model resolves. */}
        <StageErrorBoundary key={`${modelUrl}:${animationUrl ?? ''}`}>
          <Suspense fallback={null}>
            <CharacterModel modelUrl={modelUrl} animationUrl={animationUrl} />
          </Suspense>
        </StageErrorBoundary>
      </PresentationControls>

      {/* Outside PresentationControls so it doesn't rotate with the drag, and
          outside the character Suspense so the grounding shadow stays put while
          a model loads. scale tracks the pool — kept within POOL_FADE_RADIUS *
          2 so the contact shadow stays inside the lit pool instead of spilling
          onto the black floor beyond it (where it darkens nothing and
          vanishes). */}
      <ContactShadows
        position={[0, 0, 0]}
        opacity={0.6}
        scale={2.5}
        blur={2.4}
        far={2}
      />
    </Canvas>
  )
}
