import { useEffect } from 'react'

import { getSocket } from 'src/multiplayer/store'
import { usePlaybackStore } from 'src/playback/store'
import { useSeatStore } from 'src/seats/store'
import { getLocalStream, useVoiceStore } from 'src/voice/store'

import { seatPhaseRef } from './SeatedCamera'
import { seatTargetRef } from './seatTargeting'

// Standard guard so Tab/Escape/F don't fire while the user is typing into
// some future text input (the iPad's own UI, most likely). Checked against
// document.activeElement rather than the event target — it's the single
// source of truth for "what currently has focus" regardless of how a
// window-level keydown event happened to bubble.
function isEditingText(): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) {
    return false
  }
  return (
    active.tagName === 'INPUT' ||
    active.tagName === 'TEXTAREA' ||
    active.isContentEditable
  )
}

// Captures whichever element (if any) was pointer-locked at the moment the
// iPad was summoned, so closing it can restore exactly that state instead of
// unconditionally dropping the user back to "click to relock." Module-level
// (not a useEffect-local var) to mirror the singleton pattern store.ts/
// useVideoAudio.ts already use for this file's other cross-call state, and
// so it stays reachable regardless of how many times this hook re-runs.
let lockedElementBeforeIpad: Element | null = null

function openIpad(): void {
  lockedElementBeforeIpad = document.pointerLockElement
  usePlaybackStore.getState().setIpadOpen(true)
  document.exitPointerLock()
}

// Restores pointer lock only if something was actually locked before the
// iPad opened (a `null` capture means "wasn't locked to begin with," so
// there's nothing to restore) — this is what makes the close respect
// whichever state the user was originally in, rather than always
// (re)locking or always leaving it unlocked.
//
// Known gotcha, left as-is rather than worked around (unverifiable without a
// live browser): browsers don't reliably grant pointer-lock-re-request
// activation from an `Escape` keystroke specifically — it's the same key
// users press to *exit* lock, so re-arming it from that exact key is
// deliberately restricted (Chromium has historically applied a short
// cooldown here). A `Tab`-triggered close activates normally and should
// restore reliably; an `Escape`-triggered restore may silently no-op, which
// just degrades to today's shipped behavior (click the canvas once to
// relock) rather than being a regression.
function closeIpad(): void {
  usePlaybackStore.getState().setIpadOpen(false)
  if (lockedElementBeforeIpad) {
    lockedElementBeforeIpad.requestPointerLock().catch(() => {})
    lockedElementBeforeIpad = null
  }
}

// Global key bindings for the theater's playback chrome (PLAN.md "Views" /
// "iPad browser" / Phase 5 "seats"):
//   - Tab   summons/dismisses the iPad, dropping pointer lock on summon and
//           restoring it on dismiss iff it was locked beforehand (see
//           openIpad/closeIpad above). Inert while `view === 'fullscreen'`
//           (D7) — no tablet in fullscreen at all — but still
//           preventDefault()s either way, so focus can't escape the canvas
//           regardless.
//   - Escape dismisses the iPad if it's open (same restore as Tab);
//           otherwise a no-op. Checked *before* the isEditingText() guard
//           below — unlike Tab/E/F/M, Escape must still close the iPad even
//           while its own search input (IpadBrowser.tsx) has focus, the way
//           any search UI is expected to let Escape back out.
//   - E     toggles sit/stand (D5, D9). Ignored entirely while a sit_down/
//           stand_up one-shot is in flight (SeatedCamera.tsx's
//           `seatPhaseRef`); releases the held seat if already seated;
//           otherwise claims whichever seat seatTargeting.ts's
//           `seatTargetRef` currently names, if any. Never recomputes the
//           gaze+proximity test itself — reads the SAME ref <SitPrompt>
//           (F8) polls, so the prompt and the keypress can't disagree about
//           which seat (ORCHESTRATE.md §1).
//   - F     toggles the POV/fullscreen view. Closes the iPad on the way IN
//           to fullscreen (D7) via closeIpad() (not setIpadOpen directly,
//           so its pointer-lock-restore bookkeeping still runs) — otherwise
//           it's left open-but-unreachable behind the fullscreen overlay.
//   - M     toggles mic mute (PLAN.md "Phase 4B"). The voice store's
//           `muted` flag is the source of truth — flipped first — then
//           applied to every local audio track's `.enabled`, so intent
//           toggles coherently even if getLocalStream() is still `null`
//           (mic never acquired/denied): it takes effect the moment a
//           stream does exist. Optionally emits `peer:mute` so peers can
//           show a muted icon. Checked after isEditingText(), like
//           Tab/E/F, so typing "m" into the iPad's search box doesn't
//           toggle mute.
//
// Takes no arguments and returns nothing — a later integration wave calls
// this once from Scene.tsx.
export function useViewControls(): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (usePlaybackStore.getState().ipadOpen) {
          closeIpad()
        }
        return
      }

      if (isEditingText()) {
        return
      }

      if (event.key === 'Tab') {
        // Stop the browser from cycling focus off the canvas — even while
        // inert below (D7: no tablet in fullscreen), so focus still can't
        // escape the canvas either way.
        event.preventDefault()
        if (usePlaybackStore.getState().view === 'fullscreen') {
          return
        }
        if (usePlaybackStore.getState().ipadOpen) {
          closeIpad()
        } else {
          openIpad()
        }
        return
      }

      if (event.key.toLowerCase() === 'e') {
        // D5/D9: E toggles sit/stand. Ignored entirely while a one-shot is
        // in flight — simpler than queueing, and both windows are under 5s
        // (clipTimings.ts).
        const phase = seatPhaseRef.current
        if (phase === 'sit_down' || phase === 'stand_up') {
          return
        }
        if (phase === 'sitting') {
          useSeatStore.getState().release()
          return
        }
        const seatId = seatTargetRef.current
        if (seatId !== null) {
          useSeatStore.getState().claim(seatId)
        }
        return
      }

      if (event.key.toLowerCase() === 'f') {
        const { view, ipadOpen, setView } = usePlaybackStore.getState()
        const nextView = view === 'fullscreen' ? 'pov' : 'fullscreen'
        if (nextView === 'fullscreen' && ipadOpen) {
          // D7: never leave the tablet open-but-unreachable behind the
          // fullscreen overlay. closeIpad() (not setIpadOpen directly) so
          // its pointer-lock-restore bookkeeping still runs.
          closeIpad()
        }
        setView(nextView)
      }

      if (event.key.toLowerCase() === 'm') {
        const nextMuted = !useVoiceStore.getState().muted
        useVoiceStore.getState().setMuted(nextMuted)
        const stream = getLocalStream()
        stream?.getAudioTracks().forEach(track => {
          track.enabled = !nextMuted
        })
        getSocket()?.emit('peer:mute', { muted: nextMuted })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
