'use client'

import { useFrame } from '@react-three/fiber'
import { Suspense, useRef, useState } from 'react'
import { Group, MathUtils, Vector3 } from 'three'

import { CHARACTERS } from 'src/components/CharacterSelect/characters'
import { peerBuffers, useMultiplayerStore } from 'src/multiplayer/store'

import { type AnimState, Avatar } from './Avatar'
import { SIT_DOWN_DURATION_S, STAND_UP_DURATION_S } from './clipTimings'
import { NameTag } from './NameTag'
import { PeerVoice } from './PeerVoice'
import { RemoteIpad } from './RemoteIpad'
import { getSeat } from './seats'
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
//
// Phase 5 (F5) extends this shell with seating: when `peerSeats[id]`
// (multiplayer/store.ts, F3) names a seat, <RemoteAvatar> stops sampling the
// interpolation buffer altogether and instead pins the group transform to
// that seat (PLAN.md's "Risks & gotchas: seated presence goes silent" -- a
// seated peer sends no `presence` packets at all, so `sampleAt` would
// otherwise hold forever at their last walking sample). `animState` is
// driven by a small local one-shot state machine, not directly by `seatId`
// -- see the seat-transition block inside <RemoteAvatar> for exactly why
// the two have to be kept separate (ORCHESTRATE.md §1's seated state
// machine / PLAN.md's "Sit-down replay on join" risk).

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

// Fallback hips-above-floor (bugfix, see `hipsAboveFloorRef`'s comment
// below) for the one-frame-or-less window before <Avatar>'s
// `onHipsMeasured` callback has reported the real, per-character bind-pose
// measurement -- <Avatar>'s recenter effect is a useLayoutEffect, so in
// practice this is never actually observed before a real value lands. The
// mean of the 7 shipped characters' own measured values (0.805-1.174),
// rather than an eyeballed guess -- unlike this file's `INTERP_DELAY_MS`
// above, real numbers were available here (measured directly off each
// character's shipped GLB while root-causing the "seated peer floats above
// the seat" bug).
const DEFAULT_HIPS_ABOVE_FLOOR_M = 0.98

// Same fallback window as DEFAULT_HIPS_ABOVE_FLOOR_M above, for the
// horizontal counterpart (bugfix -- see `rootBoneOffsetX`'s doc comment on
// pedestal.ts's `PreparedCharacterScene`). Unlike hips-above-floor, the 7
// shipped characters' measured horizontal offsets don't share a consistent
// sign or magnitude (Kanna's is 0.127m; the rest are under 3cm, some
// negative) -- there's no single "mean" that's a better guess than zero for
// an unmeasured character, so this falls back to 0 (no correction, i.e.
// today's pre-fix behaviour) rather than manufacturing an average that could
// point the wrong way.
const DEFAULT_HIPS_OFFSET_M = 0

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
  // Absent/`undefined` = standing (multiplayer/store.ts's peerSeats comment)
  // -- `seatId` is the ONLY source of truth for "is this peer sitting"
  // (ORCHESTRATE.md §1's wire invariants: "seatId -- not an AnimState --
  // means 'is sitting'"). The seat-transition block below reacts to CHANGES
  // in this value to drive the local one-shot machine; the wire-sampled
  // branch of the useFrame further down (unchanged from before Phase 5)
  // still drives `animState` the rest of the time -- the two never run in
  // the same frame, since `snappedSeatId` gates one path or the other.
  const seatId = useMultiplayerStore(state => state.peerSeats[id])
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
  // This peer's measured bind-pose hips-above-floor offset (bugfix --
  // <Avatar>'s `onHipsMeasured`, reporting CharacterSelect/pedestal.ts's
  // `rootBoneHeight`), read every frame by the seat-pin branch below.
  // Purely local to this component -- unlike `headHeight` (peerBuffers,
  // needed by the sibling <NameTag>), nothing outside <RemoteAvatar> needs
  // this value, so it doesn't need to ride the cross-component
  // `peerBuffers` map the way that measurement does.
  const hipsAboveFloorRef = useRef(DEFAULT_HIPS_ABOVE_FLOOR_M)
  // Horizontal counterpart to hipsAboveFloorRef above -- same bugfix, same
  // single consumer (the seat-pin branch below), just the X/Z axes instead
  // of Y. See pedestal.ts's `rootBoneOffsetX` doc comment for why the seat
  // pin needs this at all.
  const hipsOffsetXRef = useRef(DEFAULT_HIPS_OFFSET_M)
  const hipsOffsetZRef = useRef(DEFAULT_HIPS_OFFSET_M)
  // Bugfix (seat-pin ease -- see the useFrame's own comment): where the peer
  // was standing when sit_down began, which stand_up eases back to. The
  // peer's body is frozen in place for the whole seated window (Player.tsx no
  // longer teleports it to the seat), so this one capture is valid for both
  // transitions. Mirrors SeatedCamera.tsx's `standingReturnPosRef` exactly,
  // for the same reason and over the same durations.
  const standingPosRef = useRef(new Vector3())
  const haveStandingPosRef = useRef(false)
  const phaseElapsedRef = useRef(0)
  // "animState as of the last PINNED frame" -- deliberately not updated on
  // buffer-sampled frames, so the first pinned frame always reads as an edge
  // and captures. Only ever touched inside useFrame, never during render.
  const prevPinAnimRef = useRef<AnimState>(seatId ? 'sitting' : 'idle')
  const seatPinScratchRef = useRef(new Vector3())

  // Seeded from whatever `seatId` already is the first time this component
  // ever renders -- `<RemoteAvatar id>` only ever mounts fresh for a peer
  // becoming known to us (peerIds changes only on join/leave, per this
  // file's own header comment), so a peer already seated at that instant
  // (peers:init's bulk seed, or a peer:join that already carried `seatId`)
  // is a STEADY STATE, not a transition (ORCHESTRATE.md §1's seated state
  // machine note / PLAN.md's "Sit-down replay on join" risk) -- straight to
  // 'sitting', no `sit_down` replay. `useState`'s lazy-initializer form runs
  // exactly once, at mount, which is what makes this the steady-state path
  // with no ref/effect bookkeeping of its own.
  const [animState, setAnimState] = useState<AnimState>(() =>
    seatId ? 'sitting' : 'idle',
  )
  const [speed, setSpeed] = useState(0)

  // Which seat (if any) this peer's group transform is currently pinned to
  // -- read every frame by the useFrame below. Seeded the same way
  // `animState` is above: whatever `seatId` already is at first render. Set
  // at the START of `sit_down` (the clip is rotation-only after
  // stripToRotation, so the seat position must already be correct for the
  // pose to land right -- A1's root-motion note / PLAN.md's "Sit pose
  // alignment" risk) and left set through `sitting`. On the way back out,
  // `seatId` itself is already gone by the time `stand_up` starts, so THIS
  // -- not `seatId` -- is what lets the useFrame below keep rendering the
  // peer AT the seat for the whole of `stand_up`; only
  // `onOneShotEnd('stand_up')` (below) clears it and hands the group back to
  // buffer sampling.
  const [snappedSeatId, setSnappedSeatId] = useState<string | null>(
    seatId ?? null,
  )

  // Detects a REAL `seatId` transition on an already-known peer, as opposed
  // to the steady-state-at-mount case the two lazy initializers above
  // already cover -- `prevSeatId` starts equal to `seatId`, so this can
  // never fire on the first render, by construction (no separate "is this
  // the first run" ref/effect needed).
  //
  // This adjusts state directly during render, guarded by the comparison
  // below, rather than inside a useEffect/useLayoutEffect -- deliberately:
  // it's React's own documented pattern for "adjusting state when a prop
  // changes"
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
  // and it's required here, not just stylistic --
  // eslint-plugin-react-hooks' `set-state-in-effect` rule flags a
  // synchronous setState call inside an effect body, and its
  // `set-state-in-render` rule only flags setState calls that run
  // UNCONDITIONALLY on every render (verified against that rule's own
  // source -- it checks each call against the set of blocks that execute
  // unconditionally, so a call gated behind the `if` below is exempt). A ref
  // (rather than this second piece of state) would have been the more
  // familiar shape for "remember the previous value," but
  // eslint-plugin-react-hooks' `refs` rule disallows reading/writing
  // `.current` during render at all -- refs stay reserved for the
  // useFrame/event-handler contexts below, exactly where that rule's own
  // message says they belong.
  const [prevSeatId, setPrevSeatId] = useState(seatId)
  if (seatId !== prevSeatId) {
    setPrevSeatId(seatId)
    if (seatId) {
      // standing -> sat: a genuine peer:seat transition on an already-known
      // peer. Snap NOW, at the start of the one-shot (see
      // `snappedSeatId`'s comment) -- Avatar.tsx's
      // onOneShotEnd('sit_down') is what advances us to 'sitting' once the
      // clip actually finishes.
      setSnappedSeatId(seatId)
      setSpeed(0)
      setAnimState('sit_down')
    } else {
      // sat -> standing: stand_up plays AT the last seat position --
      // `snappedSeatId` is deliberately left as-is here (`seatId` is
      // already gone by this point, but this still names the seat the peer
      // was just sitting in). onOneShotEnd('stand_up') is what clears it
      // and resumes buffer sampling -- expect a short glide once it does,
      // since the peer's first fresh presence packet may be a few hundred
      // ms stale (PLAN.md's F5 section: acceptable, cheaper than
      // special-casing).
      setSpeed(0)
      setAnimState('stand_up')
    }
  }

  // The shell's single useFrame (ORCHESTRATE.md §3). While seated (or
  // transitioning into/out of a seat -- `snappedSeatId` covers all three of
  // sit_down/sitting/stand_up), pin the group transform to the seat table
  // instead of sampling the peer's buffered network snapshots -- otherwise
  // sampleAt would hold forever at the peer's last walking sample (PLAN.md's
  // "Risks & gotchas: seated presence goes silent" -- a seated peer sends no
  // `presence` packets at all). Otherwise, unchanged from before Phase 5:
  // sample the peer's buffered network snapshots at a slightly-delayed
  // render time (snapshotInterp.ts), apply the result to the group
  // transform, and promote animState/speed into React state for <Avatar>'s
  // props. Declared unconditionally (hooks can't be conditional); it no-ops
  // via the early return below whenever the group hasn't mounted yet (peer
  // metadata not in yet -- see the bottom of this component) or the peer's
  // buffer hasn't arrived yet / was dropped on leave / has no samples yet
  // (seedPeerBuffer always pushes one synchronously on join/init, so this
  // only guards the single frame, if any, before that has run).
  useFrame((_state, delta) => {
    const group = groupRef.current
    if (!group) {
      return
    }

    if (snappedSeatId) {
      // Defensive against a seat id that doesn't resolve (shouldn't happen
      // -- the gateway only ever broadcasts ids from its own SEAT_IDS
      // allowlist -- but this app's convention is to stay defensive against
      // anything that crosses the network, same posture as
      // multiplayer/store.ts's own packet validators): freeze in place
      // rather than fall through to a stale buffer sample.
      const seat = getSeat(snappedSeatId)
      if (seat) {
        // Bugfix: pin so the character's HIPS (not feet) land on the
        // cushion. Every seat clip is rotation-only (Scene/clipTracks.ts's
        // stripToRotation), so the Hips bone stays at its bind-pose offset
        // above the group origin (the feet) for the whole seated window --
        // subtracting that measured, per-character offset (not a shared
        // guessed constant) from the cushion height is what lands the hips
        // AT the cushion instead of floating above it.
        //
        // Bugfix, second half: that pin is only correct once the pose is
        // actually SEATED, and it must not be applied at full strength for
        // the whole sit_down/stand_up window. Because the clips are
        // rotation-only, the hips sit at their bind-pose height above the
        // group origin in EVERY pose, seated or standing alike -- so pinning
        // hips-to-cushion while the clip is still near a standing pose puts
        // the group origin (the feet) a cushion-height below the floor. The
        // cushion measures 0.378m above its own row's floor in all six rows,
        // and hips sit 0.80-1.17m above the feet depending on character, so
        // the feet ended up 0.43-0.80m UNDER the floor -- the avatar visibly
        // sunk to mid-thigh in the seat block for the ~1.5s sit_down and
        // ~0.9s stand_up. Easing the group between where the peer was
        // standing and the seat pin, over the same durations the clips play
        // (clipTimings.ts, shared with SeatedCamera.tsx's local camera ease),
        // keeps the feet on the floor at the standing end and the hips on
        // the cushion at the seated end.
        //
        // Rotation still snaps to the seat's facing; the clips carry the
        // body's own turn, and no rotation complaint has been reported.
        //
        // Bugfix, third half: the pin above only ever matched the group's
        // X/Z straight to the cushion's own X/Z, with no correction -- fine
        // for a rig whose bind-pose bounding box happens to centre on its
        // own hips, but Kanna's hair and tail extend behind her, pulling
        // that box (and so the recentred group origin the X/Z pin was
        // targeting) 0.127m behind her actual hips. That landed her hips 90%
        // of the way across the cushion's depth and her back ~12.5cm clear
        // of the backrest -- visible as a gap between her and the seat.
        // `hipsOffsetXRef`/`hipsOffsetZRef` (pedestal.ts's
        // `rootBoneOffsetX`/`rootBoneOffsetZ`, reported through the same
        // onHipsMeasured callback as the Y correction above) are the
        // measured, per-character horizontal equivalent -- subtracting them
        // from the cushion's own X/Z is exactly the correction the Y axis
        // already applied, just late to arrive on the other two.
        if (animState !== prevPinAnimRef.current) {
          if (animState === 'sit_down') {
            // The PREVIOUS frame took the buffer-sampling branch below, so
            // group.position still holds the peer's last standing position
            // (feet on the floor) -- capture it before overwriting it here.
            standingPosRef.current.copy(group.position)
            haveStandingPosRef.current = true
          } else if (animState === 'stand_up' && !haveStandingPosRef.current) {
            // A peer who was ALREADY seated when we first saw them never ran
            // sit_down here, so there is no captured standing position. They
            // resume broadcasting the instant stand_up starts, and their body
            // stayed frozen where they originally sat down, so their buffered
            // samples name the very spot they're about to stand at.
            const standingBuffer = peerBuffers.get(id)
            if (standingBuffer && standingBuffer.samples.length > 0) {
              sampleAt(
                standingBuffer.samples,
                performance.now() - INTERP_DELAY_MS,
                standingPosRef.current,
              )
              haveStandingPosRef.current = true
            }
          }
          prevPinAnimRef.current = animState
          phaseElapsedRef.current = 0
        }
        phaseElapsedRef.current += delta

        const seated = seatPinScratchRef.current.set(
          seat.cushion[0] - hipsOffsetXRef.current,
          seat.cushion[1] - hipsAboveFloorRef.current,
          seat.cushion[2] - hipsOffsetZRef.current,
        )

        // Smoothstep, not linear -- matches SeatedCamera.tsx's own position
        // ease so a seated player's camera and the avatar every other client
        // sees move on the same curve, not just over the same duration.
        if (animState === 'sit_down' && haveStandingPosRef.current) {
          group.position.lerpVectors(
            standingPosRef.current,
            seated,
            MathUtils.smoothstep(
              phaseElapsedRef.current,
              0,
              SIT_DOWN_DURATION_S,
            ),
          )
        } else if (animState === 'stand_up' && haveStandingPosRef.current) {
          group.position.lerpVectors(
            seated,
            standingPosRef.current,
            MathUtils.smoothstep(
              phaseElapsedRef.current,
              0,
              STAND_UP_DURATION_S,
            ),
          )
        } else {
          // `sitting` steady state, or a transition with no standing position
          // to ease from/to (see the stand_up fallback above).
          group.position.copy(seated)
        }
        group.rotation.y = seat.yaw
      }
      return
    }

    const buffer = peerBuffers.get(id)
    if (!buffer || buffer.samples.length === 0) {
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
        onHipsMeasured={hips => {
          hipsAboveFloorRef.current = hips.aboveFloor
          hipsOffsetXRef.current = hips.offsetX
          hipsOffsetZRef.current = hips.offsetZ
        }}
        onOneShotEnd={finishedState => {
          // Reports WHICH one-shot just finished, not the state it
          // transitions into (Avatar.tsx's onOneShotEnd comment) -- this is
          // the one place that turns that into the next animState.
          if (finishedState === 'sit_down') {
            setAnimState('sitting')
          } else {
            setSnappedSeatId(null)
            setAnimState('idle')
          }
        }}
      />
      <NameTag id={id} />
      <PeerVoice id={id} />
      <RemoteIpad id={id} />
    </group>
  )
}
