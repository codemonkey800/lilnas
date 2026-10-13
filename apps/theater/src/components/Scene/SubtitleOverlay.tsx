'use client'

import { cns } from '@lilnas/utils/cns'
import { Html } from '@react-three/drei'
import { type RefObject, useEffect, useLayoutEffect, useState } from 'react'
import type { Object3D } from 'three'

import { usePlaybackStore } from 'src/playback/store'

// ---------------------------------------------------------------------------
// POV's half of subtitle rendering (PLAN.md "Quality & subtitles", the
// zustand store contract in ORCHESTRATE.md). `store.ts`'s
// `syncSubtitleTrackElement()` is the single source of truth for which
// <track> exists on the shared <video> — it always leaves that track's
// `mode` at `hidden` (never `showing`), which is enough for the browser's
// own VTT parser to keep firing `cuechange` and populating
// `track.activeCues`. This component never parses WebVTT itself; it only
// reads whatever the browser already parsed. Fullscreen's native caption
// rendering (flipping the same track to `showing`) is wired up separately in
// FullscreenPlayer.tsx.
//
// The store swaps the <track> element out (remove old, create new) on every
// load()/setQuality()/setSubtitle() call, so the `cuechange` listener can't
// just be attached once at mount — it has to be re-attached whenever that
// DOM node might have been replaced. Keying the effect below on both
// `subtitleIndex` and `subtitles` (not just `subtitleIndex`) also covers the
// case where a *new item* is loaded with the same `subtitleIndex` value
// (e.g. both null): the <track> element is still swapped even though that
// primitive value didn't change.
// ---------------------------------------------------------------------------

// A fixed drop below the screen's center. Deliberately not derived from the
// screen's real size — that would mean duplicating TheaterScreen's GLB
// box-finding logic, which this component intentionally avoids (screenRef
// is already correctly placed by TheaterScreen); a fixed offset reads as
// "under the screen" without needing the exact panel height.
const CAPTION_Y_OFFSET = -1.2

// There's at most one `kind: 'subtitles'` track on the shared <video> at a
// time (store.ts removes the old one before adding a new one).
function findActiveSubtitleTrack(video: HTMLVideoElement): TextTrack | null {
  for (const track of video.textTracks) {
    if (track.kind === 'subtitles') {
      return track
    }
  }
  return null
}

// Cues expose their text via `.text` on a `VTTCue`. Joined rather than just
// taking the first, in case a track ever has stacked/overlapping cues —
// usually this is 0 or 1.
function readActiveCueText(track: TextTrack): string {
  const cues = track.activeCues
  if (!cues) {
    return ''
  }

  const lines: string[] = []
  for (const cue of cues) {
    if (cue instanceof VTTCue) {
      lines.push(cue.text)
    }
  }
  return lines.join('\n')
}

export type SubtitleOverlayProps = {
  screenRef: RefObject<Object3D | null>
}

/**
 * POV-only caption overlay: renders the shared <video>'s currently active
 * subtitle cue text under the in-world screen. Same `screenRef` prop shape
 * as `useVideoAudio(screenRef)` — a later integration wave passes the same
 * ref from `<TheaterScreen ref={screenRef}/>` to both.
 */
export function SubtitleOverlay({ screenRef }: SubtitleOverlayProps) {
  const subtitleIndex = usePlaybackStore(state => state.subtitleIndex)
  const subtitles = usePlaybackStore(state => state.subtitles)
  const [cueText, setCueText] = useState('')
  const [position, setPosition] = useState<[number, number, number]>([
    0,
    CAPTION_Y_OFFSET,
    0,
  ])

  useEffect(() => {
    // Routed through one helper (rather than calling `setCueText` directly
    // at the effect's top level) so every branch below — "off", "no
    // matching track", and "found a track" — updates state the same way.
    const applyCueText = (activeTrack: TextTrack | null) => {
      setCueText(activeTrack ? readActiveCueText(activeTrack) : '')
    }

    if (subtitleIndex === null) {
      applyCueText(null)
      return
    }

    const video = usePlaybackStore.getState().getVideoElement()
    const track = findActiveSubtitleTrack(video)
    applyCueText(track)
    if (!track) {
      return
    }

    const handleCueChange = () => applyCueText(track)
    track.addEventListener('cuechange', handleCueChange)
    return () => {
      track.removeEventListener('cuechange', handleCueChange)
    }
  }, [subtitleIndex, subtitles])

  // Refs can't be read during render (react-hooks/refs) — sync the screen's
  // position into state just before a caption is about to render instead of
  // reading `screenRef.current` inline below. TheaterScreen sets this once
  // at mount and never moves it, so re-syncing on every `cueText` change is
  // cheap and also self-heals if this component ever renders before
  // TheaterScreen's (Suspense-gated) ref has attached. `useLayoutEffect`
  // (not `useEffect`) so the very first caption never flashes at the
  // fallback position before snapping to the real one.
  useLayoutEffect(() => {
    const screen = screenRef.current
    if (!screen) {
      return
    }
    setPosition([
      screen.position.x,
      screen.position.y + CAPTION_Y_OFFSET,
      screen.position.z,
    ])
  }, [cueText, screenRef])

  // Covers "subtitleIndex === null", "no matching track", and "no active
  // cue right now" in one check — all three leave `cueText` at ''.
  if (cueText === '') {
    return null
  }

  return (
    <Html center position={position} pointerEvents="none">
      <div
        className={cns(
          'max-w-md whitespace-pre-line rounded bg-black/75 px-4 py-2 text-center text-lg text-white',
        )}
      >
        {cueText}
      </div>
    </Html>
  )
}
