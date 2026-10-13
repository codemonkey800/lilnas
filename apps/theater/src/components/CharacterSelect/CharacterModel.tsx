'use client'

import { useAnimations, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { AnimationAction, Bone } from 'three'
import { SkeletonUtils } from 'three-stdlib'

import { stripProportionTracks } from 'src/components/Scene/clipTracks'

import {
  applyPedestal,
  PedestalAnchor,
  prepareCharacterScene,
} from './pedestal'
import { useReducedMotion } from './useReducedMotion'

export type CharacterModelProps = {
  modelUrl: string
  animationUrl?: string
}

// Every rig in this app is a Mixamo export, and the same fixed name is what
// makes cross-character clip sharing possible at all (see animationUrl's
// comment in characters.ts) — this is that same assumption, not a new one.
const ROOT_BONE_NAME = 'mixamorig:Hips'

// Freeze frame for prefers-reduced-motion — a front-facing standing beat
// with the visor and chest marking clearly visible. The idle clip runs
// ~2s and its poses barely vary (a subtle breathing sway), so any point
// comfortably inside its range reads fine; this sits mid-clip, clear of
// the loop seam at either end.
const HERO_FRAME_TIME_S = 1

// Fraction of the clip's horizontal root travel to keep as on-stage sway.
// The source asset's animation curves are ~100x too large (a units mismatch —
// centimetre-magnitude curves on a metre-scale rig) and swing the body ~±80m,
// so this scales that down to a visible-but-contained ~±0.35m drift that reads
// as the character shifting his weight without wandering off the spotlight
// (~0.8m opaque radius). Applies to x/z only; vertical is always fully planted
// so the feet stay on the floor. Tune to taste: 0 pins him dead centre, higher
// lets him roam further across the pool.
const ROOT_SWAY_SCALE = 0.004

// useGLTF's cache returns the *same* scene instance for a given URL across
// every mount. The pedestal (below) overwrites scene.position every frame,
// and the mixer leaves the skeleton frozen mid-clip on unmount — neither
// resets on its own, so switching characters and switching back used to
// recenter and re-anchor against that leftover pose instead of the bind
// pose, throwing the character off to wherever the clip's root bone happened
// to be frozen. SkeletonUtils.clone (not scene.clone(), which drops the
// SkinnedMesh's bone bindings) gives each mount its own independent copy of
// the cached scene to mutate, so the cache — and any other mount sharing it
// — is never touched.
export function CharacterModel({
  modelUrl,
  animationUrl,
}: CharacterModelProps) {
  const { scene: cachedScene } = useGLTF(modelUrl)
  const scene = useMemo(() => SkeletonUtils.clone(cachedScene), [cachedScene])
  // Animation-only glTF, sharing the model's skeleton (bone names match, so
  // three.js's PropertyBinding resolves each track against `scene` below with
  // no retargeting). Falls back to the model's own file when no separate
  // animationUrl is given, so a character without a dedicated clip still
  // plays whatever (if anything) is embedded in its model.
  const { animations } = useGLTF(animationUrl ?? modelUrl)
  const clips = useMemo(
    () => animations.map(clip => stripProportionTracks(clip, ROOT_BONE_NAME)),
    [animations],
  )
  const { actions, names, mixer } = useAnimations(clips, scene)
  const prefersReducedMotion = useReducedMotion()

  const actionRef = useRef<AnimationAction | null>(null)

  // Per-frame "pedestal" state. These clips can't be trusted to animate in
  // place: a units mismatch in the source asset (centimetre-magnitude
  // animation curves baked onto a metre-scale rig) sends the whole body flying
  // tens of metres — hundreds of times the character's own height, on every
  // axis. Rather than depend on the clip, we cancel its whole-body travel each
  // frame: re-anchor the skeleton's root bone over the centre of the stage and
  // re-plant the lowest bone on the floor, leaving only the limb articulation
  // (bone *rotations*, which no unit bug touches) visible. Operating on the
  // ~100 skeleton bones — not the ~17k skinned vertices — keeps this cheap.
  const rootBoneRef = useRef<Bone | null>(null)
  const bonesRef = useRef<Bone[]>([])
  // Root bone's bind-pose world x/z — the fixed spot we pin it back to.
  const anchorRef = useRef<PedestalAnchor | null>(null)
  // Lowest bone's bind-pose world y. Re-planting the lowest bone to this height
  // each frame lands the mesh's actual lowest vertex (the boot sole) back on
  // the floor, since the bind recenter already put that sole at y=0.
  const groundYRef = useRef(0)

  // Recenter + capture the pedestal anchor once against `scene`'s bind pose
  // (prepareCharacterScene, pedestal.ts). Keyed on `scene` itself rather than
  // `modelUrl` — `scene` is this mount's own clone, freshly created by the
  // `useMemo` above, so it's genuinely still at bind pose every time this
  // runs, unlike the shared useGLTF cache a previous mount may have already
  // animated and repositioned.
  useLayoutEffect(() => {
    const { rootBone, bones, anchor, groundY } = prepareCharacterScene(scene)
    rootBoneRef.current = rootBone
    bonesRef.current = bones
    anchorRef.current = anchor
    groundYRef.current = groundY
  }, [scene])

  // Start playback — deliberately not keyed on `prefersReducedMotion` (see
  // the effect below for that). `mixer.update(0)` forces the clip's frame-0
  // pose onto the bones synchronously so the very first rendered frame is
  // already mid-animation rather than flashing the bind pose for a tick.
  useLayoutEffect(() => {
    const action = actions[names[0] ?? ''] ?? null
    actionRef.current = action
    if (!action) {
      return
    }

    action.play()
    mixer.update(0)
  }, [actions, names, mixer])

  // Reduced motion: freeze on a hero frame instead of stopping the mixer
  // outright (still one writer — the mixer — on the bone transforms).
  // Also keyed on `actions`/`names` (not read directly in the body, which
  // reads the ref the effect above just populated) so swapping to a
  // different character while reduced motion is active re-freezes the new
  // action instead of leaving it playing — the two effects run in
  // declaration order within the same commit, so `actionRef.current` is
  // already fresh by the time this one runs.
  useLayoutEffect(() => {
    const action = actionRef.current
    if (!action) {
      return
    }

    if (prefersReducedMotion) {
      action.time = HERO_FRAME_TIME_S
      action.paused = true
    } else {
      action.paused = false
    }
  }, [actions, names, prefersReducedMotion])

  // The pedestal. Runs after useAnimations' own useFrame (registered first, in
  // declaration order) has advanced the mixer, so the bones hold this frame's
  // pose. `updateMatrixWorld` flushes that pose into the bone world matrices
  // applyPedestal reads (see pedestal.ts for why it goes through
  // scene.worldToLocal rather than the matrices' raw world coordinates).
  useFrame(() => {
    const rootBone = rootBoneRef.current
    const bones = bonesRef.current
    const anchor = anchorRef.current
    if (!rootBone || !anchor || bones.length === 0) {
      return
    }

    scene.updateMatrixWorld(true)
    applyPedestal(
      scene,
      rootBone,
      bones,
      anchor,
      groundYRef.current,
      ROOT_SWAY_SCALE,
    )
  })

  return <primitive object={scene} />
}
