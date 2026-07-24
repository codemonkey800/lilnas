'use client'

import { useThree } from '@react-three/fiber'
import { type RefObject, useEffect, useRef } from 'react'
import { Audio, AudioListener, type Object3D, PositionalAudio } from 'three'

import { usePlaybackStore } from './store'

// ---------------------------------------------------------------------------
// Spatial audio routing (POV vs fullscreen) — ORCHESTRATE.md's "Spatial
// audio routing (POV vs fullscreen) — useVideoAudio.ts" contract, and
// PLAN.md's D10 (POV = spatialized, fullscreen = full-volume stereo).
//
// The hard Web Audio constraint driving all of this:
// `HTMLMediaElement.createMediaElementSource()` may be called at most ONCE
// per <video> for the entire page — a second call throws `InvalidStateError`.
// So only ONE `THREE.Audio`-family instance may ever call
// `setMediaElementSource()` on the shared <video> (the singleton from
// `src/playback/store.ts`). Rather than dynamically `connect()`/
// `disconnect()`-ing a single output chain when the view changes (which
// risks clicks/pops and a half-wired graph), this hook builds BOTH output
// chains once — a `PositionalAudio` panner attached to the screen mesh for
// POV, and a plain (non-positional) `Audio` for fullscreen — and fans the
// ONE real `MediaElementAudioSourceNode` out to both. Both chains stay
// connected permanently; only their gain (`setVolume`) toggles with the view.
// ---------------------------------------------------------------------------

// Guards the one real `createMediaElementSource()` call for the whole app's
// lifetime. Module-level (not component state) because a remount — e.g.
// React StrictMode's dev-only mount -> cleanup -> mount double-invoke — must
// NOT call it a second time on the same <video>. Mirrors the SSR-singleton
// pattern already used for `sharedVideoElement`/`sharedHls` in store.ts.
let mediaSourceCreated = false

// The node itself, kept alongside the flag above so a hypothetical remount
// can still wire its (fresh) `PositionalAudio`/`Audio` instances up to a real
// source via `reuseMediaElementSource` below, instead of leaving them
// silently disconnected. Defensive only — the app mounts its screen/camera
// exactly once for its lifetime in practice.
let sharedMediaElementSource: AudioNode | null = null

// Wires an already-created `MediaElementAudioSourceNode` into a *second*
// Audio-family instance, mirroring exactly what `setMediaElementSource()`
// does internally (`source` / `sourceType` / `hasPlaybackControl`, then
// `connect()`) without invoking that browser API a second time. three's
// public types mark those three fields `readonly` (they're normally only
// ever set by three's own `set*Source()` methods), so `Object.assign` performs
// the same field writes without a readonly-violation type error — nothing
// prevents this at runtime, it's the same object either way.
function reuseMediaElementSource(
  target: Audio<AudioNode>,
  source: AudioNode,
): void {
  Object.assign(target, {
    source,
    sourceType: 'mediaNode',
    hasPlaybackControl: false,
  })
  target.connect()
}

/**
 * Builds and maintains the two Web Audio output chains for the shared
 * playback `<video>` (`src/playback/store.ts`) — a `PositionalAudio` panner
 * attached to the in-world screen mesh (POV) and a plain full-volume `Audio`
 * (fullscreen) — and toggles which one is audible via `setVolume` whenever
 * `usePlaybackStore`'s `view` changes. A plain effect hook; renders nothing.
 */
export function useVideoAudio(screenRef: RefObject<Object3D | null>): void {
  const camera = useThree(state => state.camera)
  const view = usePlaybackStore(state => state.view)
  const volume = usePlaybackStore(state => state.volume)

  const positionalRef = useRef<PositionalAudio | null>(null)
  const stereoRef = useRef<Audio | null>(null)

  // Builds both chains exactly once — the module-level guard above means a
  // remount reuses the existing source rather than re-deriving it. Kept
  // separate from the view-driven effect below so gain toggles never touch
  // connection state.
  useEffect(() => {
    const listener = new AudioListener()
    camera.add(listener)

    const positional = new PositionalAudio(listener)
    if (!mediaSourceCreated) {
      // The ONE real call for the whole app's lifetime.
      positional.setMediaElementSource(
        usePlaybackStore.getState().getVideoElement(),
      )
      sharedMediaElementSource = positional.source
      mediaSourceCreated = true
    } else if (sharedMediaElementSource) {
      reuseMediaElementSource(positional, sharedMediaElementSource)
    }
    // Captured once (rather than re-reading `screenRef.current` in the
    // cleanup below) since the ref's value could otherwise have changed by
    // the time cleanup runs. three's per-frame updateMatrixWorld keeps the
    // panner positioned at the screen automatically once it's a child of
    // that Object3D.
    const screen = screenRef.current
    screen?.add(positional)

    const stereo = new Audio(listener)
    if (sharedMediaElementSource) {
      reuseMediaElementSource(stereo, sharedMediaElementSource)
    }

    positionalRef.current = positional
    stereoRef.current = stereo

    // Autoplay-with-sound gotcha: the AudioContext starts suspended until a
    // user gesture. Self-resume on the first pointerdown anywhere so this
    // doesn't depend on which other component's click handler fires first
    // (poster click, canvas click, etc.).
    const resumeAudioContext = () => {
      void listener.context.resume().catch(() => {})
    }
    window.addEventListener('pointerdown', resumeAudioContext, {
      once: true,
    })

    // Best-effort: only unwinds the scene-graph attachments, not the shared
    // source node — see the module-level comment above.
    return () => {
      camera.remove(listener)
      screen?.remove(positional)
    }
  }, [camera, screenRef])

  // Gain-only routing: both chains stay connected at all times (dynamically
  // connect()/disconnect()-ing on view change risks clicks/pops and a
  // half-wired graph) — only which one is audible changes. The iPad's
  // volume slider (store's `volume`) only scales the POV/positional chain —
  // fullscreen already has its own independent, visible volume control via
  // the native `<video controls>` FullscreenPlayer.tsx turns on, and folding
  // the same `volume` into `stereo` too would make a POV slider position
  // silently carry over and attenuate fullscreen, contradicting D10's
  // "fullscreen = full-volume stereo" (PLAN.md).
  useEffect(() => {
    const positional = positionalRef.current
    const stereo = stereoRef.current
    if (!positional || !stereo) {
      return
    }
    positional.setVolume(view === 'pov' ? volume : 0)
    stereo.setVolume(view === 'fullscreen' ? 1 : 0)
  }, [view, volume])
}
