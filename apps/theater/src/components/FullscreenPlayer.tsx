'use client'

import { useEffect, useRef } from 'react'

import { usePlaybackStore } from 'src/playback/store'

// ---------------------------------------------------------------------------
// There is exactly ONE real <video> DOM node for the whole app — the shared
// element `playback/store.ts` creates once and normally keeps hidden (still
// decoding, so POV's VideoTexture keeps getting frames) appended to
// document.body. This component never renders a second <video>; instead it
// REPARENTS that same element into this overlay while fullscreen is active,
// then moves it back out on the way out (view change or unmount). Moving a
// <video> between DOM parents — without ever touching `.src` — does not
// reset currentTime/readyState/decoding, so playback continues untouched
// across the swap (PLAN.md "Views": "playback is continuous because both
// views share one element").
// ---------------------------------------------------------------------------

// Mirrors the hidden styling `store.ts`'s ensureVideoElement() applies at
// creation time — duplicated here (not imported; store.ts has no exported
// "hide" helper) so leaving fullscreen restores the exact state POV expects:
// still decoding, but visually and interactively out of the way.
function hideSharedVideo(video: HTMLVideoElement): void {
  document.body.appendChild(video)
  video.controls = false
  video.style.position = 'fixed'
  video.style.top = '0px'
  video.style.left = '0px'
  video.style.width = '2px'
  video.style.height = '2px'
  video.style.opacity = '0'
  video.style.pointerEvents = 'none'
  video.style.objectFit = ''
}

// Restyles the shared element to fill this overlay's container.
function showSharedVideo(
  container: HTMLDivElement,
  video: HTMLVideoElement,
): void {
  container.appendChild(video)
  video.style.position = 'static'
  video.style.top = ''
  video.style.left = ''
  video.style.width = '100%'
  video.style.height = '100%'
  video.style.opacity = '1'
  video.style.pointerEvents = 'auto'
  video.style.objectFit = 'contain'
  video.controls = true
}

// Same `textTracks` lookup SubtitleOverlay.tsx uses for POV's overlay —
// duplicated rather than imported (a two-line helper; the two files
// otherwise have no reason to depend on each other, mirroring how
// TheaterScreen.tsx duplicates rather than imports Theater.tsx's model URL).
// store.ts's `syncSubtitleTrackElement()` keeps at most one
// `kind: 'subtitles'` track on the shared <video> at a time.
function findSubtitleTextTrack(video: HTMLVideoElement): TextTrack | null {
  for (const track of video.textTracks) {
    if (track.kind === 'subtitles') {
      return track
    }
  }
  return null
}

// Mount this unconditionally (a later integration wave places it as a
// sibling of <Canvas> in Scene.tsx) — it reads `view` itself and renders
// nothing outside of fullscreen, so callers never need to gate it.
export function FullscreenPlayer() {
  const view = usePlaybackStore(state => state.view)
  const loading = usePlaybackStore(state => state.loading)
  const error = usePlaybackStore(state => state.error)
  const subtitleIndex = usePlaybackStore(state => state.subtitleIndex)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isFullscreen = view === 'fullscreen'

  useEffect(() => {
    if (!isFullscreen) {
      return
    }
    const container = containerRef.current
    if (!container) {
      return
    }

    const video = usePlaybackStore.getState().getVideoElement()
    showSharedVideo(container, video)

    // Native <video> caption rendering only happens for a track in
    // `showing` mode — store.ts's syncSubtitleTrackElement() always leaves
    // it `hidden` (POV's baseline, so SubtitleOverlay's `activeCues` reads
    // keep working outside fullscreen), so fullscreen has to flip it itself.
    const enteringTrack = findSubtitleTextTrack(video)
    if (enteringTrack) {
      enteringTrack.mode = 'showing'
    }

    return () => {
      hideSharedVideo(video)
      // Re-find rather than reuse `enteringTrack` — a subtitle switch while
      // fullscreen was open swaps in a different <track> element, and it's
      // that current one that needs resetting to store.ts's `hidden`
      // baseline, not whichever track was active when this effect ran.
      const currentTrack = findSubtitleTextTrack(video)
      if (currentTrack) {
        currentTrack.mode = 'hidden'
      }
    }
  }, [isFullscreen])

  // The iPad's subtitle picker is POV-only per PLAN.md, but `Tab`'s handling
  // in viewControls.ts doesn't check the current view, so a subtitle change
  // can still land while already fullscreen. store.ts's
  // syncSubtitleTrackElement() always creates the newly swapped-in <track>
  // at its `hidden` baseline — without re-asserting `showing` here, captions
  // would silently disappear from the native player until the next
  // fullscreen toggle re-ran the effect above.
  useEffect(() => {
    if (!isFullscreen) {
      return
    }
    const video = usePlaybackStore.getState().getVideoElement()
    const track = findSubtitleTextTrack(video)
    if (track) {
      track.mode = 'showing'
    }
  }, [isFullscreen, subtitleIndex])

  if (!isFullscreen) {
    return null
  }

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 bg-black">
      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        </div>
      )}

      {error && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
          <p className="max-w-lg rounded bg-red-900/80 px-4 py-2 text-center text-sm text-white">
            {error}
          </p>
        </div>
      )}
    </div>
  )
}
