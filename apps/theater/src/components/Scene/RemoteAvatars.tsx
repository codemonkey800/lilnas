'use client'

import { useFrame } from '@react-three/fiber'
import { Suspense, useRef, useState } from 'react'
import { Group, Vector3 } from 'three'

import { CHARACTERS } from 'src/components/CharacterSelect/characters'
import {
  AnimState,
  peerBuffers,
  useMultiplayerStore,
} from 'src/multiplayer/store'

import { Avatar } from './Avatar'
import { NameTag } from './NameTag'
import { PeerVoice } from './PeerVoice'
import { RemoteIpad } from './RemoteIpad'
import { sampleAt } from './snapshotInterp'

// The Option B per-peer composition root (ORCHESTRATE.md §3 / PLAN.md "F4").
// <RemoteAvatars> maps the zustand-visible `peerIds` (multiplayer/store.ts
// -- changes only on join/leave) to one <RemoteAvatar> per peer.
// <RemoteAvatar> is a thin shell that owns the interpolated <group>
// transform and mounts the four per-feature children inside it
// (<Avatar>/<NameTag>/<PeerVoice>/<RemoteIpad>) -- it contains NO
// nametag/voice/tablet logic itself, so none of those units' owners
// (F7/VF3/TF3) ever need to reopen this file; each child runs its own small
// useFrame reading peerBuffers / the voice+tablet stores by `id` directly.
// Rendered inside <Canvas>'s existing <Suspense> but outside <Physics> (F6,
// a later unit) -- remote avatars are visual-only, no colliders, no ecctrl.

// How far in the past to render each remote peer (snapshotInterp.ts) --
// buffered snapshot interpolation, replacing an earlier per-frame damp
// straight toward the latest ~13 Hz network packet (ORCHESTRATE.md §1),
// which pulsed the rendered speed at the packet rate (see
// multiplayer/store.ts's PeerBuffer comment and snapshotInterp.ts's header
// for the full explanation). ~2x the nominal ~77ms packet gap: comfortably
// keeps the render pointer behind two real snapshots even under a skipped
// packet's worth of jitter, before ever falling back to holding at the
// newest sample. No live browser here to tune against -- this app's
// established convention for that situation (see Avatar.tsx's
// NATURAL_SPEED_MPS comment for the identical reasoning) is a reasonable
// starting guess, not a measured figure.
const INTERP_DELAY_MS = 150

// Throttled React-state promotion for `speed`, mirroring Player.tsx's
// TELEMETRY_INTERVAL_S pattern ("sample a continuously-changing per-frame
// value into occasional React state"). ~10 Hz still tracks a peer speeding
// up/slowing down closely enough for <Avatar>'s timeScale, while capping a
// moving peer to ~10 extra re-renders/sec -- negligible at the ≤8-peer scale
// ORCHESTRATE.md §3 frames this cost against.
const SPEED_STATE_INTERVAL_S = 0.1

// Below this delta (m/s), a throttled `speed` state update is skipped
// entirely -- a peer standing still (or already at the last-reported speed)
// causes zero additional re-renders, not just throttled ones.
const SPEED_STATE_EPSILON = 0.05

// Maps `peerIds` (React-visible; changes only on join/leave) to one
// <RemoteAvatar> per peer.
//
// Each gets its OWN <Suspense> boundary, not just the shared one Scene.tsx
// puts around this whole component. <Avatar>'s useGLTF(modelUrl) call
// (Avatar.tsx) suspends on an unseen character model -- unlike the five
// animation clips and cinema.glb, per-character models are never preloaded,
// since preloading all seven every session would mean downloading every
// unselected character's multi-MB GLB for nothing. Without a per-peer
// boundary, that suspend propagates up to Scene.tsx's shared <Suspense>,
// which also wraps <Physics><Player/></Physics>: React hides the whole
// boundary (blanking the local player's view -- lights sit outside it, so
// hidden geometry renders as pure black) AND tears down every RigidBody
// inside it via @react-three/rapier's cleanup effects, including the local
// player's own body and Theater's floor/wall colliders. They get recreated
// from scratch once the model resolves, snapping the camera back to
// Player.tsx's hardcoded SPAWN_POSITION with a fresh capsule dropped through
// a momentarily-absent floor collider -- i.e. every OTHER player in the
// theater gets yanked to spawn and glitches through the floor each time
// someone joins with a not-yet-cached character. Scoping the boundary to
// just the one peer whose model is loading confines the blank/hide to that
// one <RemoteAvatar>, leaving the local player and already-loaded peers
// untouched.
export function RemoteAvatars() {
  const peerIds = useMultiplayerStore(state => state.peerIds)

  return (
    <>
      {peerIds.map(id => (
        <Suspense key={id} fallback={null}>
          <RemoteAvatar id={id} />
        </Suspense>
      ))}
    </>
  )
}

type RemoteAvatarProps = {
  id: string
}

function RemoteAvatar({ id }: RemoteAvatarProps) {
  const meta = useMultiplayerStore(state => state.peerMeta[id])
  const modelUrl = CHARACTERS.find(
    character => character.id === meta?.characterId,
  )?.modelUrl

  const groupRef = useRef<Group>(null)
  // Scratch output param for sampleAt (snapshotInterp.ts) -- reused every
  // frame rather than allocating a fresh Vector3, matching this app's
  // existing scratch-vector convention for hot-path math (e.g.
  // LocalPresence.tsx's worldDirectionRef, gaze.ts's isOccluded scratch).
  const scratchPosRef = useRef(new Vector3())
  const lastReportedSpeedRef = useRef(0)
  const speedStateElapsedRef = useRef(0)

  const [animState, setAnimState] = useState<AnimState>('idle')
  const [speed, setSpeed] = useState(0)

  // The shell's single useFrame (ORCHESTRATE.md §3): sample the peer's
  // buffered network snapshots at a slightly-delayed render time
  // (snapshotInterp.ts), apply the result to the group transform, and
  // promote animState/speed into React state for <Avatar>'s props --
  // nothing else. Declared unconditionally (hooks can't be conditional); it
  // no-ops via the early return below whenever the group hasn't mounted yet
  // (peer metadata not in yet -- see the bottom of this component) or the
  // peer's buffer hasn't arrived yet / was dropped on leave / has no
  // samples yet (seedPeerBuffer always pushes one synchronously on
  // join/init, so this only guards the single frame, if any, before that
  // has run).
  useFrame((_state, delta) => {
    const group = groupRef.current
    const buffer = peerBuffers.get(id)
    if (!group || !buffer || buffer.samples.length === 0) {
      return
    }

    const renderTime = performance.now() - INTERP_DELAY_MS
    const sampled = sampleAt(buffer.samples, renderTime, scratchPosRef.current)
    group.position.copy(scratchPosRef.current)
    group.rotation.y = sampled.yaw

    // Throttled React-state promotion for <Avatar>'s plain-value props (see
    // this file's header comment / ORCHESTRATE.md §3's contract note):
    // discrete animState transitions are rare (a handful of times a
    // minute), so an every-frame equality check with no extra time-throttle
    // is cheap and safe -- it only ever calls setAnimState on an actual
    // change.
    if (sampled.animState !== animState) {
      setAnimState(sampled.animState)
    }

    // `speed` changes continuously, so it needs both a time throttle (~10Hz,
    // matching Player.tsx's TELEMETRY_INTERVAL_S) AND a magnitude epsilon --
    // without the epsilon, a peer holding a steady speed would still
    // re-render 10x/sec on floating-point noise alone.
    speedStateElapsedRef.current += delta
    if (speedStateElapsedRef.current >= SPEED_STATE_INTERVAL_S) {
      speedStateElapsedRef.current = 0
      if (
        Math.abs(sampled.speed - lastReportedSpeedRef.current) >
        SPEED_STATE_EPSILON
      ) {
        lastReportedSpeedRef.current = sampled.speed
        setSpeed(sampled.speed)
      }
    }
  })

  if (!meta || !modelUrl) {
    // Peer metadata hasn't arrived yet, or names an unknown characterId --
    // defensive against network data, the same posture multiplayer/store
    // .ts's own packet validators take.
    return null
  }

  return (
    <group ref={groupRef}>
      <Avatar
        modelUrl={modelUrl}
        animState={animState}
        speed={speed}
        onMeasured={height => {
          const buf = peerBuffers.get(id)
          if (buf) {
            buf.headHeight = height
          }
        }}
      />
      <NameTag id={id} />
      <PeerVoice id={id} />
      <RemoteIpad id={id} />
    </group>
  )
}
