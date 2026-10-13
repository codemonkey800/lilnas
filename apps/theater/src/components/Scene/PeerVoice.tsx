'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  Audio,
  AudioListener,
  Group,
  type Object3D,
  PositionalAudio,
} from 'three'

import { usePlaybackStore, type ViewMode } from 'src/playback/store'
import { ensureVoiceInitialized } from 'src/voice/peerConnections'
import { inbound } from 'src/voice/store'

// Fills the F4-created stub -- RemoteAvatars.tsx already mounts `<PeerVoice id={id} />` inside
// <RemoteAvatar>'s interpolated <group> and is never touched by this unit (ORCHESTRATE.md §2's
// stub-handoff rule). Per ORCHESTRATE.md §3 / PLAN.md's VF3 section, this child takes only
// `{ id }` and reads its hot data from the voice store by id -- never a per-frame prop.
//
// Spatial voice (PLAN.md "Phase 4B"): once a peer's inbound WebRTC MediaStream shows up in
// voice/store.ts's `inbound` map (VF1/VF2, driven by peerConnections.ts's own signaling), build
// the same dual output chain useVideoAudio.ts already built for the movie -- a `PositionalAudio`
// (POV, distance-attenuated) + a plain `Audio` (fullscreen, flat), both fed from one real Web
// Audio source, with gain toggled on `usePlaybackStore`'s `view`. Attaching `positional` to a
// local anchor `<group>` that's a CHILD of <RemoteAvatar>'s already-positioned group means its
// world position tracks the peer for free via normal three.js parent/child transform
// propagation -- no per-frame position copying (contrast NameTag.tsx's gaze math, which *does*
// need the world position numerically for its dot-product test; voice doesn't).

type PeerVoiceProps = {
  id: string
}

type PeerAudioChain = {
  positional: PositionalAudio
  stereo: Audio
  sink: HTMLAudioElement
  // Captured at chain-build time rather than re-read from a ref at cleanup time -- see the
  // cleanup effect's own comment below for why.
  anchor: Group
}

// ---------------------------------------------------------------------------
// One AudioListener shared by every mounted <PeerVoice> instance, not one per peer: every
// `Audio`/`PositionalAudio` already shares the same underlying `AudioContext`
// (`AudioContext.getContext()` is a true module-level singleton -- verified against three.js's
// own AudioListener.js/AudioContext.js), but each `AudioListener` is still its own Object3D +
// gain node wired straight to `context.destination`. One per peer would mean one redundant
// top-level gain node per peer for zero benefit. Lazily created and added to the camera exactly
// ONCE, guarded the same way useVideoAudio.ts guards its one-time `setMediaElementSource()`
// call (its `mediaSourceCreated` flag) -- safe to call from any number of instances/effects.
// Never removed from the camera on any single instance's unmount: it outlives any one peer,
// the same way peerConnections.ts's `ensureVoiceInitialized()` sets up state once for the whole
// app's lifetime. Assumes a stable camera for the app's lifetime (true today -- this app never
// swaps cameras), the same class of documented, out-of-scope limitation peerConnections.ts's own
// header comment calls out for its signal-handler-to-socket binding.
//
// Also means no separate AudioContext-resume-on-pointerdown dance is needed here: this listener
// resolves to the SAME shared context useVideoAudio.ts already resumes on first `pointerdown`
// (PLAN.md's VF5 note: "AudioContext resume is already globally handled").
// ---------------------------------------------------------------------------

let sharedListener: AudioListener | null = null
let listenerAttachedToCamera = false

function ensureSharedListener(camera: Object3D): AudioListener {
  if (!sharedListener) {
    sharedListener = new AudioListener()
  }
  if (!listenerAttachedToCamera) {
    camera.add(sharedListener)
    listenerAttachedToCamera = true
  }
  return sharedListener
}

// Chrome gotcha (PLAN.md's Phase 4B section, explicit): a WebRTC MediaStream won't pump through
// Web Audio at all unless it's ALSO attached to a live, off-DOM <audio> sink. Muted so only the
// Web Audio graph below -- not this element's own direct output -- is ever audible. Hidden and
// appended to `document.body` the same way playback/store.ts's `ensureVideoElement()` hides its
// own off-DOM <video> (kept live/decoding via `opacity:0`, never `display:none`).
function createMutedStreamSink(stream: MediaStream): HTMLAudioElement {
  const audio = document.createElement('audio')
  audio.srcObject = stream
  audio.muted = true
  audio.style.position = 'fixed'
  audio.style.top = '0px'
  audio.style.left = '0px'
  audio.style.width = '2px'
  audio.style.height = '2px'
  audio.style.opacity = '0'
  audio.style.pointerEvents = 'none'
  document.body.appendChild(audio)
  void audio.play().catch(() => {})
  return audio
}

// Builds the dual output chain for one peer's inbound voice stream. Unlike
// `setMediaElementSource` (the video case in useVideoAudio.ts -- `createMediaElementSource` can
// only be called once per <video> for the whole page), `setMediaStreamSource` has no such
// restriction: verified against three.js's actual source (Audio.js), it just calls
// `this.context.createMediaStreamSource(mediaStream)` with no internal reuse/guard, and a
// `MediaStreamAudioSourceNode` per the Web Audio spec allows any number of independent source
// nodes from the same MediaStream. So `positional` and `stereo` each call it directly on the
// same `stream` below -- no `reuseMediaElementSource`-style fan-out needed. Distance-only
// attenuation (PLAN.md, explicit -- no wall occlusion): `positional`'s distance
// model/refDistance/rolloff are left at three.js's defaults, untouched.
function buildPeerAudioChain(
  stream: MediaStream,
  listener: AudioListener,
  anchor: Group,
): PeerAudioChain {
  const positional = new PositionalAudio(listener)
  positional.setMediaStreamSource(stream)
  anchor.add(positional)

  const stereo = new Audio(listener)
  stereo.setMediaStreamSource(stream)

  const sink = createMutedStreamSink(stream)

  return { positional, stereo, sink, anchor }
}

// Voice has no separate user-facing volume slider like the movie does (playback store's
// `volume`) -- full volume when the relevant chain is active; distance attenuation happens for
// free via the POV panner.
function applyViewGain(chain: PeerAudioChain, view: ViewMode): void {
  chain.positional.setVolume(view === 'pov' ? 1 : 0)
  chain.stereo.setVolume(view === 'fullscreen' ? 1 : 0)
}

export function PeerVoice({ id }: PeerVoiceProps) {
  const camera = useThree(state => state.camera)
  const view = usePlaybackStore(state => state.view)

  const anchorRef = useRef<Group>(null)
  const chainRef = useRef<PeerAudioChain | null>(null)
  const streamAttemptedRef = useRef(false)

  // Idempotent no matter how many mounted <PeerVoice> instances call it -- the real
  // peer-connection setup (peerConnections.ts) runs exactly once for the whole app.
  useEffect(() => {
    ensureVoiceInitialized()
  }, [])

  // One-time (module-wide, not per-instance) listener/camera wiring -- see
  // ensureSharedListener's own comment for why this never tears down on unmount.
  useEffect(() => {
    ensureSharedListener(camera)
  }, [camera])

  // `inbound` (voice/store.ts) is a plain, non-reactive Map mutated by peerConnections.ts
  // whenever WebRTC negotiation completes for this peer -- there's no React-visible signal for
  // that moment, so this polls it every frame until the stream shows up. `streamAttemptedRef`
  // guards the build so it only ever runs once per mounted instance, not every frame.
  useFrame(() => {
    if (streamAttemptedRef.current) {
      return
    }
    const anchor = anchorRef.current
    const stream = inbound.get(id)
    if (!anchor || !stream) {
      return
    }
    streamAttemptedRef.current = true

    const chain = buildPeerAudioChain(
      stream,
      ensureSharedListener(camera),
      anchor,
    )
    // Apply the CURRENT view's gain immediately -- the view-toggle effect below only fires on
    // a future `view` change, so without this, a chain built after the last `view` change would
    // sit at Web Audio's default gain (1) on both chains at once.
    applyViewGain(chain, view)
    chainRef.current = chain
  })

  // View-based gain toggle only -- connection/graph setup above never re-runs when `view`
  // changes, matching useVideoAudio.ts's split ("gain toggles never touch connection state").
  // Guarded for the chain not existing yet (stream hasn't arrived).
  useEffect(() => {
    const chain = chainRef.current
    if (!chain) {
      return
    }
    applyViewGain(chain, view)
  }, [view])

  // Peer left -> this component unmounts (RemoteAvatars.tsx stops rendering
  // `<RemoteAvatar key={id}>` for a departed peerId) -> tear down whatever chain we built.
  // `chain.anchor` is the Group captured at chain-build time, not a fresh read of
  // `anchorRef.current`: by the time a passive effect's cleanup runs on unmount, React has
  // already nulled host-node refs during the commit's mutation phase, so re-reading the ref
  // here would find `null` (mirrors useVideoAudio.ts's own "captured once ... since the ref's
  // value could otherwise have changed by the time cleanup runs" comment for `screenRef`).
  useEffect(() => {
    return () => {
      const chain = chainRef.current
      if (!chain) {
        return
      }
      chain.anchor.remove(chain.positional)
      // `.stop()`/`.play()`/`.pause()` all early-return (with a console warning) once
      // `hasPlaybackControl` is false -- which `setMediaStreamSource` always sets, per
      // three.js's Audio.js -- so `.disconnect()` (unconditional, source-type-agnostic) is the
      // real teardown here. PositionalAudio overrides `disconnect()` to also disconnect its
      // panner, so one call covers each chain member.
      chain.positional.disconnect()
      chain.stereo.disconnect()
      chain.sink.pause()
      chain.sink.srcObject = null
      chain.sink.remove()
      chainRef.current = null
    }
  }, [])

  return <group ref={anchorRef} />
}
