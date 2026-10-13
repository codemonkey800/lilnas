'use client'

import { useEffect } from 'react'

import { usePlaybackStore } from './store'

// ---------------------------------------------------------------------------
// The playback reconcile loop — drives `playback/store.ts`'s `tick()`, which
// nudges the shared <video>'s currentTime/playbackRate toward the room
// anchor every client converges on (`applyAnchor()` via `sync.ts`).
//
// Deliberately NOT a `useFrame` hook. Scene.tsx stops the R3F render loop
// (`frameloop="never"`) while the fullscreen player is up, so a `useFrame`-
// driven tick silently stopped running there: a room seek/play/pause arriving
// while this client was fullscreen updated the anchor but never touched the
// <video>, and the client drifted indefinitely from the rest of the room
// until it left fullscreen. A plain interval runs in both views. It also
// keeps running (browser-throttled to ~1 Hz) in a hidden tab, where rAF
// stops entirely, so a backgrounded client still hard-seeks back into sync
// rather than waiting for the tab to be foregrounded.
// ---------------------------------------------------------------------------

// Drift correction is a proportional `playbackRate` nudge (store.ts's
// `DRIFT_CORRECTION_GAIN`), not a per-frame animation — 10 Hz is plenty for
// it to converge smoothly, and `applyAnchor()` reconciles immediately on
// every incoming room anchor anyway, so no seek ever waits on this interval.
const RECONCILE_INTERVAL_MS = 100

function reconcileNow(): void {
  usePlaybackStore.getState().tick(performance.now())
}

/**
 * Runs the playback reconcile loop for as long as the caller is mounted,
 * independent of the R3F frameloop (POV or fullscreen) and of tab
 * visibility. Mount once, at the top level of Scene — alongside
 * `useVideoSync()`, never inside <Canvas>.
 */
export function usePlaybackReconcile(): void {
  useEffect(() => {
    const interval = window.setInterval(reconcileNow, RECONCILE_INTERVAL_MS)

    // A tab coming back from the background may have had its interval
    // throttled hard for minutes; reconcile the moment it's visible again
    // instead of waiting for the next (possibly still-throttled) tick.
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        reconcileNow()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])
}
