'use client'

import { Billboard, Text } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Group, MathUtils, Mesh, Raycaster, Vector3 } from 'three'

import { peerBuffers, useMultiplayerStore } from 'src/multiplayer/store'

import { gazeAlignment, nextGazeState, perpendicularDistanceM } from './gaze'
import { theaterEnvRef } from './Theater'

// Fills the F4-created stub -- RemoteAvatars.tsx already mounts `<NameTag id={id} />` inside
// <RemoteAvatar>'s interpolated <group> and is never touched by this unit (ORCHESTRATE.md §2's
// stub-handoff rule). Per ORCHESTRATE.md §3 / PLAN.md's F7 section, every child of
// <RemoteAvatar> takes only `{ id }` and reads its hot per-frame data from `peerBuffers` / the
// stores by id -- never a per-frame prop -- so this component owns its own small `useFrame`
// instead of being driven by its parent.
//
// Gaze-gated nametag: hidden by default, fades in only while the local player looks
// near-directly at this peer's head (gaze.ts's cone+hysteresis test) and fades back out on
// look-away or occlusion (a wall, another peer, standing between the camera and the peer's
// head). This is also what disambiguates two peers who picked the same character model.

type NameTagProps = {
  id: string
}

// Fallback head height (meters) for the handful of frames before <Avatar>'s onMeasured
// callback (Avatar.tsx) has written a real measurement into peerBuffers -- see
// RemoteAvatars.tsx's `onMeasured` wiring. An ordinary human height, close enough that the tag
// never visibly pops once the real bind-pose measurement (`box.max.y - box.min.y`,
// CharacterSelect/pedestal.ts's `prepareCharacterScene`) lands.
const DEFAULT_HEAD_HEIGHT_M = 1.7

// Extra clearance above the measured (or fallback) head height so the tag floats just above the
// crown of the head rather than overlapping it.
const HEAD_MARGIN_M = 0.15

// Frame-rate-independent fade lambda -- THREE.MathUtils.damp's `1 - exp(-lambda*dt)` shape, the
// same family RemoteAvatars.tsx already uses for position/yaw (see that file's
// POSITION_DAMP_LAMBDA comment for the t_95 = 3/lambda derivation this reuses). lambda=12 reaches
// ~95% of the way to its on/off target in ~0.25s, inside PLAN.md's F7 section's requested
// ~0.2-0.3s fade feel.
const OPACITY_DAMP_LAMBDA = 12

// Below this, treat the tag as fully invisible: flips the group's `visible` off so three.js's
// own render-list traversal skips both the transparent draw call and handing the mesh to
// troika's onBeforeRender at all (which would otherwise call its own sync() every rendered
// frame -- cheap when a no-op, per Text.js, but still a call worth skipping entirely once the
// tag is genuinely hidden).
const MIN_VISIBLE_OPACITY = 0.01

// Occlusion raycast throttle (~15Hz) -- the same elapsed-time-accumulator shape as Player.tsx's
// TELEMETRY_INTERVAL_S. A raycast is far pricier than the dot-product gaze test above it, and
// only worth paying for peers already inside the gaze cone (PLAN.md's F7 section).
const OCCLUSION_CHECK_INTERVAL_S = 1 / 15

// Scratch objects reused across every <NameTag> instance's useFrame rather than allocated fresh
// per frame -- the same convention gaze.ts's own module-level `toTarget`/`forward` and
// CharacterSelect/pedestal.ts's `scratch` already use. Safe to share across instances: R3F runs
// one component's useFrame callback to completion before the next one starts, so nothing ever
// reads a scratch value another instance is still writing.
const scratchTagWorldPos = new Vector3()
const scratchCamForward = new Vector3()
const scratchToTag = new Vector3()

// A single reused raycaster for every peer's throttled occlusion check (PLAN.md's F7 section:
// "cast a single reused module-level THREE.Raycaster" -- far pricier to allocate per-instance
// than the dot-product math above).
const raycaster = new Raycaster()

// drei's <Text> forwards its ref straight to the underlying troika-three-text mesh (see
// node_modules/@react-three/drei/core/Text.js) -- untyped (`any`) in drei's own declarations
// because troika-three-text ships no .d.ts of its own. `fillOpacity`/`outlineOpacity` are
// troika's own plain instance properties (not React props); mutating them directly every frame
// is exactly troika's intended API for cheap per-frame updates -- neither is in troika's
// internal SYNCABLE_PROPS list, so writing them never flips the mesh's `_needsSync` flag,
// meaning the sync() call already made unconditionally from its onBeforeRender every rendered
// frame stays the cheap early-return it always was, with no text-layout recompute.
type TroikaTextMesh = Mesh & {
  fillOpacity: number
  outlineOpacity: number
}

// Casts from `camPos` toward `targetPos` against the theater's real geometry and reports
// whether something is in the way. `intersectObject(envRoot, true)` is recursive by design --
// cinema.glb's real meshes are auto-named children nested under the meaningfully-named parent
// groups (per this codebase's own findings), so a shallow intersect would miss them entirely.
function isOccluded(camPos: Vector3, targetPos: Vector3): boolean {
  const envRoot = theaterEnvRef.current
  if (!envRoot) {
    // Theater.tsx's effect hasn't run yet (first frames) -- treat as a clear line of sight,
    // per PLAN.md's F7 section ("Treat an unset ref (first frames) as not-occluded").
    return false
  }

  scratchToTag.subVectors(targetPos, camPos)
  const distance = scratchToTag.length()
  if (distance === 0) {
    return false
  }
  scratchToTag.divideScalar(distance)

  raycaster.set(camPos, scratchToTag)
  // Nothing past the tag itself can occlude it -- capping `far` at the actual distance also
  // trims how much of cinema.glb's real geometry the raycast has to walk past the peer's head.
  raycaster.far = distance
  const nearestHit = raycaster.intersectObject(envRoot, true)[0]
  return nearestHit !== undefined && nearestHit.distance < distance
}

export function NameTag({ id }: NameTagProps) {
  const username = useMultiplayerStore(state => state.peerMeta[id]?.username)
  const camera = useThree(state => state.camera)

  const billboardRef = useRef<Group>(null)
  const textRef = useRef<TroikaTextMesh | null>(null)

  // No-re-render discipline (ORCHESTRATE.md §3 / PLAN.md's F7 section): the gaze on/off flag,
  // the last occlusion result, the damped opacity, and the occlusion throttle timer all live in
  // refs, never React state. A `useState` gaze flag would re-render this peer's <NameTag> on
  // every single look-toward/away transition -- exactly the per-frame-churn problem the
  // peerBuffers module-level-mutation architecture in this build exists to avoid.
  const gazeOnRef = useRef(false)
  const occludedRef = useRef(false)
  const opacityRef = useRef(0)
  const occlusionElapsedRef = useRef(0)

  // One-time material setup: transparent + no depth write/test, so the tag draws on top of the
  // avatar's own head geometry instead of z-fighting/being clipped by it (real occlusion by the
  // theater's walls is decided by the raycast above, at the opacity level -- not the depth
  // buffer). Runs after the outline props below have already been applied by R3F's own prop
  // application at mount (which happens before layout effects run), so troika's `hasOutline()`
  // -- and therefore whether `.material` below returns one material or the [outline, fill] pair
  // -- is already settled by the time this reads it, regardless of prop application order.
  useLayoutEffect(() => {
    const text = textRef.current
    if (!text) {
      return
    }
    const materials = Array.isArray(text.material)
      ? text.material
      : [text.material]
    for (const material of materials) {
      material.transparent = true
      material.depthWrite = false
      material.depthTest = false
    }
  }, [])

  useFrame((_state, delta) => {
    const billboard = billboardRef.current
    if (!billboard) {
      return
    }

    // Local Y offset above the group's own origin (the avatar's feet, by construction --
    // RemoteAvatars.tsx's <group> is the thing <RemoteAvatar>'s useFrame positions/rotates at
    // the peer's live world transform). Read fresh every frame, never cached, so a late
    // `headHeight` measurement is picked up the moment it lands.
    const height =
      (peerBuffers.get(id)?.headHeight ?? DEFAULT_HEAD_HEIGHT_M) + HEAD_MARGIN_M
    billboard.position.y = height

    // The tag's true current world position, reflecting the live parent transform -- no
    // position data needed from peerBuffers for this (see this file's owning unit's task
    // description); only `headHeight`, above, comes from the buffer.
    billboard.getWorldPosition(scratchTagWorldPos)
    camera.getWorldDirection(scratchCamForward)

    const alignment = gazeAlignment(
      camera.position,
      scratchCamForward,
      scratchTagWorldPos,
    )
    // Distance-independent fallback alongside the angular test above (see
    // gaze.ts's perpendicularDistanceM/CLOSE_RANGE_RADIUS_M comments) --
    // without it, standing close and looking at a peer's face rather than
    // straight up at their floating tag falls outside the angular cone
    // entirely, and the name can never appear.
    const perpDistanceM = perpendicularDistanceM(
      camera.position,
      scratchCamForward,
      scratchTagWorldPos,
    )
    gazeOnRef.current = nextGazeState(
      gazeOnRef.current,
      alignment,
      perpDistanceM,
    )

    // Only bother raycasting once the cheap cone+hysteresis test already says "on", and only at
    // ~15Hz -- both throttle conditions gate the SAME accumulator (Player.tsx's
    // TELEMETRY_INTERVAL_S shape), so time spent with gaze off doesn't count toward the next
    // cast's budget. occludedRef caches the last result between throttled casts rather than
    // assuming not-occluded in between.
    if (gazeOnRef.current) {
      occlusionElapsedRef.current += delta
      if (occlusionElapsedRef.current >= OCCLUSION_CHECK_INTERVAL_S) {
        occlusionElapsedRef.current = 0
        occludedRef.current = isOccluded(camera.position, scratchTagWorldPos)
      }
    }

    const targetOpacity = gazeOnRef.current && !occludedRef.current ? 1 : 0
    opacityRef.current = MathUtils.damp(
      opacityRef.current,
      targetOpacity,
      OPACITY_DAMP_LAMBDA,
      delta,
    )

    const text = textRef.current
    if (text) {
      text.fillOpacity = opacityRef.current
      text.outlineOpacity = opacityRef.current
    }
    // Skip the transparent draw call (and troika's per-frame onBeforeRender/sync entirely) once
    // fully faded, rather than leaving a technically-invisible-but-still-drawn quad every frame.
    billboard.visible = opacityRef.current > MIN_VISIBLE_OPACITY
  })

  if (!username) {
    // Peer metadata hasn't arrived yet -- defensive against network data, the same posture
    // multiplayer/store.ts's own packet validators and RemoteAvatars.tsx's `!meta` guard take.
    return null
  }

  return (
    <Billboard
      ref={billboardRef}
      position={[0, DEFAULT_HEAD_HEIGHT_M + HEAD_MARGIN_M, 0]}
    >
      <Text
        ref={textRef}
        fontSize={0.3}
        color="white"
        outlineWidth="8%"
        outlineColor="black"
        renderOrder={999}
      >
        {username}
      </Text>
    </Billboard>
  )
}
