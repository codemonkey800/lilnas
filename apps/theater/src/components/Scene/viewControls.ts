import { useEffect } from 'react'

import { usePlaybackStore } from 'src/playback/store'

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
// "iPad browser"):
//   - Tab   summons/dismisses the iPad, dropping pointer lock on summon and
//           restoring it on dismiss iff it was locked beforehand (see
//           openIpad/closeIpad above).
//   - Escape dismisses the iPad if it's open (same restore as Tab);
//           otherwise a no-op. Checked *before* the isEditingText() guard
//           below — unlike Tab/F, Escape must still close the iPad even
//           while its own search input (IpadBrowser.tsx) has focus, the way
//           any search UI is expected to let Escape back out.
//   - F     toggles the POV/fullscreen view.
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
        // Stop the browser from cycling focus off the canvas.
        event.preventDefault()
        if (usePlaybackStore.getState().ipadOpen) {
          closeIpad()
        } else {
          openIpad()
        }
        return
      }

      if (event.key.toLowerCase() === 'f') {
        const { view, setView } = usePlaybackStore.getState()
        setView(view === 'fullscreen' ? 'pov' : 'fullscreen')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
