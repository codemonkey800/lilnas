'use client'

import { useAnimations, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { AnimationAction, AnimationClip, LoopOnce } from 'three'
import { SkeletonUtils } from 'three-stdlib'

import { prepareCharacterScene } from 'src/components/CharacterSelect/pedestal'

import { SIT_STAND_PLAYBACK_RATE } from './clipTimings'
import { stripToRotation } from './clipTracks'

// Wire contract (ORCHESTRATE.md §1 / presence.schema.ts's ANIM_STATES) --
// hand-mirrored here rather than imported, matching this app's existing
// convention for crossing the frontend/backend boundary (IpadBrowser.tsx's
// local `TheaterItemType` mirrors emby.service.ts's DTO the same way instead
// of importing across it). This also keeps Avatar.tsx buildable standalone --
// F3b (this file) does not depend on F2's multiplayer/store.ts
// (ORCHESTRATE.md §2), which is being built concurrently in the same wave
// and may not exist yet.
//
// 'sit_down' | 'sitting' | 'stand_up' (Phase 5, F5) are the one exception --
// client-side-only render states that never ride the wire. `seatId`, not an
// AnimState, is the wire's source of truth for "is sitting" (ORCHESTRATE.md
// §1: "seatId -- not an AnimState -- means 'is sitting'. Nothing named
// 'sitting' crosses the wire."). Each client derives these three locally off
// the `peer:seat` transition it observes (RemoteAvatars.tsx) -- there is no
// corresponding change to presence.schema.ts's ANIM_STATES.
export type AnimState =
  | 'idle'
  | 'walk_fwd'
  | 'walk_back'
  | 'strafe_left'
  | 'strafe_right'
  | 'sit_down'
  | 'sitting'
  | 'stand_up'

// States whose clip is speed-matched to `speed` via NATURAL_SPEED_MPS below.
// Excludes 'idle' (existing) and the three seated states (Phase 5, F5) --
// none of the four ever move, so they always play at a fixed real-time rate
// instead (see the useFrame at the bottom of this file).
type WalkAnimState = Exclude<
  AnimState,
  'idle' | 'sit_down' | 'sitting' | 'stand_up'
>

export type AvatarProps = {
  modelUrl: string
  animState: AnimState
  speed: number
  /**
   * Deliberate, backward-compatible extension of the frozen 3-prop contract
   * (ORCHESTRATE.md §1/§3: `<Avatar modelUrl animState speed />`) -- `<Avatar>`
   * stays presentational/props-only, but something still has to get the
   * measured head height (see the recenter effect below) out to where
   * `<NameTag>` -- a sibling child mounted by a later unit, F7 -- can read it
   * from `peerBuffers`. `<Avatar>` is the one child in the `<RemoteAvatar>`
   * composition that never receives its own peer `id` (ORCHESTRATE.md §3),
   * so it has no way to write `peerBuffers.get(id).headHeight` itself; it
   * reports the measurement upward through this callback instead. The
   * parent, `<RemoteAvatar>` (built in the very next wave, F4), is expected
   * to wire `onMeasured={(h) => { peerBuffers.get(id)!.headHeight = h }}`.
   */
  onMeasured?: (headHeight: number) => void
  /**
   * Bugfix companion to `onMeasured` above -- fires once, alongside it, with
   * this character's measured bind-pose hips offset from the recentred group
   * origin on all three axes (CharacterSelect/pedestal.ts's
   * `prepareCharacterScene` -> `rootBoneHeight`/`rootBoneOffsetX`/
   * `rootBoneOffsetZ` -- see `rootBoneOffsetX`'s own doc comment for why the
   * horizontal fields exist). Root motion is stripped from every seat clip
   * (clipTracks.ts's `stripToRotation`), so the Hips bone never moves from
   * this bind-pose offset for the whole sit_down/sitting/stand_up window --
   * `<RemoteAvatar>` (RemoteAvatars.tsx) needs these exact numbers to pin a
   * seated peer's group transform so the character's HIPS, not feet, land on
   * the seat cushion.
   * Reported through its own callback rather than folded into `onMeasured`'s
   * existing single-argument signature -- the two serve unrelated consumers
   * (NameTag placement vs seat pinning), matching this component's own
   * "deliberate, backward-compatible extension" convention for `onMeasured`
   * itself, just one level further: an additive prop instead of an additive
   * argument. `aboveFloor`/`offsetX`/`offsetZ` stay bundled in this ONE
   * callback rather than split into three of their own, unlike that
   * split -- all three feed the exact same single consumer (RemoteAvatars.tsx's
   * seat pin) from the same measurement pass, so there's no second consumer
   * here to separate from.
   */
  onHipsMeasured?: (hips: {
    aboveFloor: number
    offsetX: number
    offsetZ: number
  }) => void
  /**
   * NEW (ORCHESTRATE.md §1's `<Avatar>` props contract, Phase 5/F5) -- fires
   * once when the `sit_down` or `stand_up` one-shot finishes playing (the
   * mixer's `'finished'` event, scoped to whichever of the two actions
   * actually fired it -- see the one-shot setup effect below). Reports
   * WHICH one-shot just ended, not the state it transitions into next:
   * `<RemoteAvatar>` (RemoteAvatars.tsx) owns turning a finished `'sit_down'`
   * into its own next `animState` of `'sitting'`, and a finished `'stand_up'`
   * into `'idle'` (plus resuming its position-interpolation buffer
   * sampling) -- the same separation `onMeasured` above already established:
   * `<Avatar>` reports an event upward, it never reaches for a store or
   * decides what the report means.
   */
  onOneShotEnd?: (state: 'sit_down' | 'stand_up') => void
}

// Animation-only GLTFs sharing the CHARACTERS models' skeleton bone names --
// see characters.ts's `animationUrl` comment. All eight are single-clip
// (`.animations[0]`); A1 produced the two strafe files plus the three sit
// clips below (Phase 5), the other three already existed on disk but were
// wired to nothing before this component.
const IDLE_URL = '/animations/idle.glb'
const WALK_FWD_URL = '/animations/walk.glb'
const WALK_BACK_URL = '/animations/walk-back.glb'
const STRAFE_LEFT_URL = '/animations/walk-strafe-left.glb'
const STRAFE_RIGHT_URL = '/animations/walk-strafe-right.glb'
// Phase 5 (D1/A1). sitting-down.glb / stand-up.glb are one-shots (see the
// mixer 'finished' listener below); sitting-idle.glb is a normal loop like
// every clip above it, just entered/exited only via the other two.
const SIT_DOWN_URL = '/animations/sitting-down.glb'
const SITTING_IDLE_URL = '/animations/sitting-idle.glb'
const STAND_UP_URL = '/animations/stand-up.glb'

// ---------------------------------------------------------------------------
// Bone-naming mismatch -- verified directly against the shipped GLBs (loaded
// through the real three-stdlib GLTFLoader drei's useGLTF uses, not just
// read off the raw glTF JSON), not assumed:
//
// idle.glb / walk.glb / walk-back.glb, and every CHARACTERS model
// (master-chief / kanna / anis / ghost / xxxtentacion / tamara / charlie),
// all export raw glTF node names in Mixamo's "mixamorig:" form (e.g.
// "mixamorig:Hips"). The loader sanitizes every node name through
// THREE.PropertyBinding.sanitizeNodeName, which strips every "reserved" path
// character on load -- `.`, `:`, `/`, `[`, `]` -- so the colon never survives:
// loading these files with the real loader and inspecting the resulting
// Bone.name / AnimationClip track names shows every one of them as
// "mixamorigHips", "mixamorigLeftUpLeg", etc. (no colon), consistently on
// BOTH the clip side and every character's skeleton side. That consistency --
// not the literal colon -- is what makes the shipped clips already bind
// correctly today.
//
// walk-strafe-left.glb / walk-strafe-right.glb (A1) were exported from a
// different source rig with bare, unprefixed bone names ("Hips",
// "LeftUpLeg", ...) -- confirmed the same way: 0 of 84 nodes carry any Mixamo
// prefix at all, vs. 65-73 "mixamorig"-prefixed nodes in every other
// clip/character. Left alone, none of their tracks would resolve against any
// cast member's skeleton. Bare names map 1:1 onto the prefixed cast once
// re-prefixed; the strafe source's few extra fine-rig bones (finger/neck
// twist joints the simpler shipped rigs don't have) simply find no matching
// bone on those skeletons and are silently ignored by three's
// PropertyBinding, exactly like any other unresolvable track.
//
// sitting-down.glb / sitting-idle.glb / stand-up.glb (Phase 5, A1) are bare-
// named too -- confirmed the same way: zero "mixamorig" occurrences across
// all three ("Hips", "Spine", "Spine2", "LeftUpLeg", "RightUpLeg", "LeftArm",
// "LeftFoot", "Head", plus ~40 finger joints, no twist bones). Same
// treatment as the strafe clips above applies: withMixamoPrefix() is
// load-bearing, not optional -- skip it and all three silently bind to
// nothing, holding the avatar at bind pose with no error anywhere (PLAN.md's
// "Risks & gotchas: Clip<->skeleton binding for the three sit clips"). A1
// confirmed all three bind on every selectable character, including the
// RPM-rigged Charlie.
// ---------------------------------------------------------------------------
const MIXAMO_PREFIX = 'mixamorig' // NB: no trailing ':' -- see above.

function withMixamoPrefix(clip: AnimationClip): AnimationClip {
  const fixed = clip.clone()
  for (const track of fixed.tracks) {
    if (!track.name.startsWith(MIXAMO_PREFIX)) {
      track.name = `${MIXAMO_PREFIX}${track.name}`
    }
  }
  return fixed
}

function buildClip(rawClip: AnimationClip, state: AnimState): AnimationClip {
  const clip = stripToRotation(withMixamoPrefix(rawClip))
  // useAnimations (drei) keys its lazy `actions` map by AnimationClip.name,
  // not by array position -- and several source clips share a name outright:
  // three of the original five duplicate Mixamo's literal default export
  // name verbatim ("Armature|mixamo.com|Layer0" for idle/walk/walk-back; the
  // two strafe clips duplicate their own "AvatarRoot|mixamo.com|Layer0"
  // between themselves), and all three Phase-5 sit clips carry one anim
  // stack named "mixamo.com" too (A1), confirmed against the shipped GLBs.
  // Left alone, only the LAST clip sharing a given name would stay reachable
  // through that map (useAnimations registers `actions[clip.name]` per
  // clip, in array order, so later entries clobber earlier ones with the
  // same name). Renaming each clip to its own AnimState key sidesteps the
  // collision and makes `actions[state]` resolve unambiguously regardless of
  // what the source asset called it.
  clip.name = state
  return clip
}

// Hand-picked, not measured off the clips themselves: clipTracks.ts's
// stripToRotation comment (and CharacterModel.tsx's ROOT_SWAY_SCALE comment)
// both note the shipped source assets carry a ~100x root-motion units bug,
// which makes deriving a "natural" speed from a clip's own root track
// meaningless. There's also no live browser here to tune against -- this
// app's convention for that situation (e.g. IpadBrowser.tsx's HUD-sizing
// constants) is to pick a reasonable eyeballed value and document it as a
// rough starting point for a later manual tuning pass. ecctrl's own walk cap
// is 2.5 m/s (Player.tsx never overrides maxVelLimit), so this sits inside
// an ordinary walking pace, comfortably below a full sprint. All four
// currently share one starting guess -- Mixamo's stock walk-family cycles
// read as a broadly similar cadence, and there's no way to justify
// differentiating them without being able to look at the result -- but
// they're split out per-state (not one shared constant) so a later tuning
// pass can nudge just one without touching the others.
const NATURAL_SPEED_MPS: Record<WalkAnimState, number> = {
  walk_fwd: 1.75,
  walk_back: 1.75,
  strafe_left: 1.75,
  strafe_right: 1.75,
}

// Clamp bounds for the timeScale below, so a near-zero or very large `speed`
// can't freeze or hyper-speed the active clip.
const MIN_TIME_SCALE = 0.5
const MAX_TIME_SCALE = 2

const CROSSFADE_DURATION_S = 0.2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// The reusable world-space avatar (PLAN.md "F3" / ORCHESTRATE.md §3).
// Unlike CharacterSelect/CharacterModel.tsx, this renders NO per-frame
// pedestal loop -- position/yaw come entirely from the parent group's
// transform (network `p`/`y`, applied by <RemoteAvatar>, F4, from
// multiplayer/store.ts's peerBuffers), so re-anchoring here would double-move
// the character on top of that and slide the feet (see clipTracks.ts's
// stripToRotation comment).
export function Avatar({
  modelUrl,
  animState,
  speed,
  onMeasured,
  onHipsMeasured,
  onOneShotEnd,
}: AvatarProps) {
  const { scene: cachedScene } = useGLTF(modelUrl)
  // useGLTF's cache returns the same scene instance for a given URL across
  // every mount (see CharacterModel.tsx's identical clone comment).
  // SkeletonUtils.clone (not scene.clone(), which drops the SkinnedMesh's
  // bone bindings) gives each mounted avatar its own independent copy to
  // recenter and animate, so the cache -- and any other mount sharing it --
  // is never touched.
  const scene = useMemo(() => SkeletonUtils.clone(cachedScene), [cachedScene])

  const { animations: idleAnimations } = useGLTF(IDLE_URL)
  const { animations: walkFwdAnimations } = useGLTF(WALK_FWD_URL)
  const { animations: walkBackAnimations } = useGLTF(WALK_BACK_URL)
  const { animations: strafeLeftAnimations } = useGLTF(STRAFE_LEFT_URL)
  const { animations: strafeRightAnimations } = useGLTF(STRAFE_RIGHT_URL)
  const { animations: sitDownAnimations } = useGLTF(SIT_DOWN_URL)
  const { animations: sittingIdleAnimations } = useGLTF(SITTING_IDLE_URL)
  const { animations: standUpAnimations } = useGLTF(STAND_UP_URL)

  const clips = useMemo(() => {
    const raw: [AnimState, AnimationClip | undefined][] = [
      ['idle', idleAnimations[0]],
      ['walk_fwd', walkFwdAnimations[0]],
      ['walk_back', walkBackAnimations[0]],
      ['strafe_left', strafeLeftAnimations[0]],
      ['strafe_right', strafeRightAnimations[0]],
      ['sit_down', sitDownAnimations[0]],
      ['sitting', sittingIdleAnimations[0]],
      ['stand_up', standUpAnimations[0]],
    ]
    return raw
      .filter(
        (entry): entry is [AnimState, AnimationClip] => entry[1] !== undefined,
      )
      .map(([state, rawClip]) => buildClip(rawClip, state))
  }, [
    idleAnimations,
    walkFwdAnimations,
    walkBackAnimations,
    strafeLeftAnimations,
    strafeRightAnimations,
    sitDownAnimations,
    sittingIdleAnimations,
    standUpAnimations,
  ])

  const { actions, mixer } = useAnimations(clips, scene)

  // Always-fresh ref to the latest `onMeasured`, updated in its own effect
  // (never during render -- react-hooks/refs disallows that) so the recenter
  // effect below can stay keyed on `[scene]` alone (see that effect's
  // comment) without re-running every time the parent passes a new callback
  // identity. Declared first so it always runs before the recenter effect
  // (React fires same-phase effects in declaration order), which is all
  // that matters: the recenter effect only ever reads this once, at mount.
  const onMeasuredRef = useRef(onMeasured)
  useLayoutEffect(() => {
    onMeasuredRef.current = onMeasured
  }, [onMeasured])

  // Same always-fresh-ref treatment for `onHipsMeasured`, for the same
  // reason.
  const onHipsMeasuredRef = useRef(onHipsMeasured)
  useLayoutEffect(() => {
    onHipsMeasuredRef.current = onHipsMeasured
  }, [onHipsMeasured])

  // Same always-fresh-ref treatment for `onOneShotEnd`, for the same reason:
  // the one-shot setup effect further below is keyed on `[actions, mixer]`
  // (it must NOT re-subscribe the mixer's 'finished' listener just because
  // the parent passed a new callback identity), so it has to read this
  // callback through a ref rather than close over the prop directly.
  const onOneShotEndRef = useRef(onOneShotEnd)
  useLayoutEffect(() => {
    onOneShotEndRef.current = onOneShotEnd
  }, [onOneShotEnd])

  // One-time recenter so the parent group's origin (the network-driven feet
  // position) lines up with the avatar's actual feet -- reusing only
  // prepareCharacterScene's recenter step, never applyPedestal's per-frame
  // loop (that would fight the parent group's own positioning). Also reports
  // the measured head height once via onMeasured (see AvatarProps' comment).
  // Keyed on `scene` itself, not `modelUrl`: `scene` is this mount's own
  // fresh clone, so it's still genuinely at bind pose here, unlike the
  // shared useGLTF cache a previous mount may already have animated (see the
  // clone comment above). Declared before the "start idle" effect below so
  // it always runs first (React fires same-phase effects in declaration
  // order) and measures the real bind pose, not one the mixer has already
  // moved off of.
  useLayoutEffect(() => {
    const { height, rootBoneHeight, rootBoneOffsetX, rootBoneOffsetZ } =
      prepareCharacterScene(scene)
    onMeasuredRef.current?.(height)
    onHipsMeasuredRef.current?.({
      aboveFloor: rootBoneHeight,
      offsetX: rootBoneOffsetX,
      offsetZ: rootBoneOffsetZ,
    })
  }, [scene])

  // One-shot setup for `sit_down`/`stand_up` -- new to this component
  // entirely; every other clip loops (PLAN.md's "Risks & gotchas: one-shot
  // clips are new to Avatar.tsx"). Both `LoopOnce` and `clampWhenFinished`
  // are required together: `LoopOnce` alone snaps back to bind pose on the
  // very last frame the instant the clip ends, which looks like the
  // character briefly T-posing into the chair. Configuring this here (once
  // the actions exist, before the "start on idle"/crossfade effects below
  // can ever call `.play()` on either of them) means the flags are already
  // in place no matter which state transition first plays either action.
  //
  // `sitDownActionRef`/`standUpActionRef` exist for the same reason
  // `activeActionRef` further below does: mutating `.clampWhenFinished`
  // directly on a value obtained straight from `actions` (this component's
  // `useAnimations()` return) trips eslint-plugin-react-hooks' newer
  // react-compiler-oriented `immutability` rule, which treats hook return
  // values as read-only. Stashing the action in a ref first and mutating it
  // via the ref's `.current` (the same indirection `activeActionRef` uses
  // for `.timeScale`) is the sanctioned escape hatch. `.setLoop(...)` is a
  // plain method call, not a property assignment, so it's fine to call
  // directly -- exactly like the crossfade effect below already calls
  // `.play()`/`.stop()`/`.fadeIn()`/`.fadeOut()`/`.reset()` directly on
  // `actions[state]` with no ref indirection.
  //
  // The mixer's `'finished'` event is shared across every action on this
  // mixer (verified against three.js's own AnimationMixer.js -- one
  // dispatcher, not per-action), so the handler below checks WHICH action
  // fired before reporting anything upward through `onOneShotEndRef`.
  const sitDownActionRef = useRef<(typeof actions)['sit_down'] | null>(null)
  const standUpActionRef = useRef<(typeof actions)['stand_up'] | null>(null)
  useLayoutEffect(() => {
    sitDownActionRef.current = actions.sit_down ?? null
    standUpActionRef.current = actions.stand_up ?? null

    const sitDown = sitDownActionRef.current
    if (sitDown) {
      sitDown.setLoop(LoopOnce, 1)
      sitDown.clampWhenFinished = true
    }
    const standUp = standUpActionRef.current
    if (standUp) {
      standUp.setLoop(LoopOnce, 1)
      standUp.clampWhenFinished = true
    }

    function handleFinished(event: { action: AnimationAction }): void {
      if (event.action === sitDownActionRef.current) {
        onOneShotEndRef.current?.('sit_down')
      } else if (event.action === standUpActionRef.current) {
        onOneShotEndRef.current?.('stand_up')
      }
    }

    mixer.addEventListener('finished', handleFinished)
    return () => {
      mixer.removeEventListener('finished', handleFinished)
    }
  }, [actions, mixer])

  // Tracks "what's actually playing on the mixer right now, as far as the
  // crossfade effect below is concerned" -- see that effect's own comment
  // for the steady-state crossfade behavior this ref drives. Declared here,
  // before the "start on idle" effect, so that effect (next) can reset it.
  const prevAnimStateRef = useRef<AnimState>('idle')

  // Start on idle -- deliberately independent of the crossfade effect below.
  // `mixer.update(0)` forces the clip's frame-0 pose onto the bones
  // synchronously so the very first rendered frame is already mid-animation
  // rather than flashing the bind pose for a tick (matches CharacterModel
  // .tsx's identical start-up pattern). If the initial `animState` prop
  // isn't already 'idle', the crossfade effect below -- which also runs once
  // on mount -- immediately fades from this into the real initial state
  // (including straight into 'sitting' for a peer who joined already
  // seated -- RemoteAvatars.tsx never plays a 'sit_down' replay for that
  // case, but this component doesn't need to know that; it just crossfades
  // from whatever `prevAnimStateRef` starts at into whatever `animState`
  // it's first given, same as any other non-idle initial state).
  //
  // Resetting `prevAnimStateRef.current` to 'idle' here -- not just relying
  // on its `useRef('idle')` initial value -- is what survives a React
  // StrictMode double-invoke on mount (dev-only, but Next enables
  // `reactStrictMode` by default when unset, which this app's next.config.js
  // doesn't override). drei's `useAnimations` tears its mixer down on the
  // PASSIVE effect cleanup between StrictMode's simulated unmount/remount
  // (`lazyActions.current = {}`, `mixer.stopAllAction()`,
  // `mixer.uncacheAction(...)` on every cached action --
  // node_modules/@react-three/drei/core/useAnimations.js), which runs AFTER
  // this component's own LAYOUT effect cleanups but BEFORE they replay. On
  // replay, this effect re-plays a brand-new `idle` action from scratch --
  // the mixer's only genuinely active action at that point -- but
  // `prevAnimStateRef.current` is a plain ref, untouched by that mixer wipe,
  // so without this reset it would still read whatever non-idle state the
  // FIRST pass already faded into (e.g. 'sitting' for an already-seated
  // peer). The crossfade effect below would then see `prevState === animState`
  // and skip entirely, permanently stranding the character on `idle` with no
  // further animState change ever able to fix it (a static seated peer's
  // animState never changes again -- see RemoteAvatars.tsx's seat-transition
  // comment). Resetting here -- right where `idle` becomes the mixer's one
  // true active action, on EVERY run of this effect, first mount or replay
  // alike -- keeps the ref honest about what the mixer actually reflects, so
  // the crossfade effect (declared next, always running after this one per
  // React's same-phase declaration-order guarantee) correctly re-fades into
  // the real `animState` every time.
  useLayoutEffect(() => {
    const action = actions.idle ?? null
    if (!action) {
      return
    }
    action.play()
    mixer.update(0)
    prevAnimStateRef.current = 'idle'
  }, [actions, mixer])

  // Crossfade on animState change -- three/drei's standard AnimationAction
  // idiom. React runs every effect once on mount regardless of its deps,
  // which is what lets this compose with the "start on idle" effect above:
  // `prevAnimStateRef` starts at 'idle', so if the very first `animState`
  // prop is something else, this fires on mount too and fades from idle into
  // the real initial state instead of popping straight to it.
  //
  // Stopping (entering 'idle') is the one transition that skips the
  // crossfade and snaps instantly instead: a lingering CROSSFADE_DURATION_S
  // walk-fade-out after the player has already come to a hard stop reads as
  // the legs sliding/finishing the stride late, well after the body itself
  // stopped moving. Starting to walk (the reverse direction) keeps the
  // smooth crossfade -- only stopping needs to be instant. `sit_down`,
  // `sitting`, and `stand_up` (Phase 5) all take the ELSE branch below --
  // the normal crossfade, never this instant snap -- since snapping straight
  // into a seated pose would look broken (PLAN.md's F5 section).
  //
  // `next.reset().play()` / `prev.stop()` (no fadeIn/fadeOut) is a genuine
  // instant snap, not just a very short fade: `.reset()` clears any
  // interpolant left over from an earlier fadeIn/fadeOut on this same
  // reused action (AnimationAction.js's `reset()` calls `stopFading()`),
  // `.weight` itself is never set anywhere in this file (always its default
  // 1), so with no interpolant scheduled `next`'s effective weight is
  // exactly 1 from the very first frame it's evaluated -- and `.stop()`
  // removes `prev` from the mixer's active-action list outright (verified
  // against node_modules/three/src/animation/{AnimationAction,
  // AnimationMixer}.js), not just fading its weight toward 0, so it stops
  // contributing to the blended pose immediately.
  useLayoutEffect(() => {
    const prevState = prevAnimStateRef.current
    prevAnimStateRef.current = animState
    if (prevState === animState) {
      return
    }
    const next = actions[animState] ?? null
    const prev = actions[prevState] ?? null
    if (animState === 'idle') {
      next?.reset().play()
      prev?.stop()
    } else {
      next?.reset().fadeIn(CROSSFADE_DURATION_S).play()
      prev?.fadeOut(CROSSFADE_DURATION_S)
    }
  }, [animState, actions])

  // The currently-active action, kept in a ref so the useFrame below can
  // mutate its `.timeScale` directly (three.js's own API for it) without
  // eslint-plugin-react-hooks' newer react-compiler-oriented `immutability`
  // rule flagging a mutation traced back to useAnimations' return value.
  // Extracting the *specific* action into its own ref here -- rather than
  // mutating `actions[animState]` in place -- mirrors CharacterModel.tsx's
  // identical `actionRef` indirection for the same `.time`/`.paused` mutation.
  const activeActionRef = useRef<(typeof actions)[AnimState] | null>(null)
  useLayoutEffect(() => {
    activeActionRef.current = actions[animState] ?? null
  }, [actions, animState])

  // Speed-matched cadence, every frame, so a walk-family clip's stride
  // visually matches the rendered movement speed instead of skating (see
  // NATURAL_SPEED_MPS's comment). Runs after useAnimations' own useFrame
  // (registered first, in declaration order above) has already advanced the
  // mixer for this frame, so this sets the timeScale the NEXT frame's
  // advance will use -- the same one-frame-lag reasoning as CharacterModel
  // .tsx's pedestal useFrame.
  useFrame(() => {
    const action = activeActionRef.current
    if (!action) {
      return
    }
    // 'idle' and 'sitting' (the seated loop) never move, so they always play
    // at a fixed real-time rate rather than being speed-matched to `speed`.
    if (animState === 'idle' || animState === 'sitting') {
      action.timeScale = 1
      return
    }
    // `sit_down`/`stand_up` are one-shots played back faster than their
    // authored (measured) speed -- see clipTimings.ts's
    // SIT_STAND_PLAYBACK_RATE comment. Both SeatedCamera.tsx's ease duration
    // and the mixer's 'finished' event (which fires once the clip's internal
    // time, advanced by `delta * timeScale` each frame, reaches its
    // authored duration) derive from the SAME constant, so this and the
    // camera ease can never drift out of sync.
    if (animState === 'sit_down' || animState === 'stand_up') {
      action.timeScale = SIT_STAND_PLAYBACK_RATE
      return
    }
    const natural = NATURAL_SPEED_MPS[animState]
    action.timeScale = clamp(speed / natural, MIN_TIME_SCALE, MAX_TIME_SCALE)
  })

  return <primitive object={scene} />
}

useGLTF.preload(IDLE_URL)
useGLTF.preload(WALK_FWD_URL)
useGLTF.preload(WALK_BACK_URL)
useGLTF.preload(STRAFE_LEFT_URL)
useGLTF.preload(STRAFE_RIGHT_URL)
useGLTF.preload(SIT_DOWN_URL)
useGLTF.preload(SITTING_IDLE_URL)
useGLTF.preload(STAND_UP_URL)
