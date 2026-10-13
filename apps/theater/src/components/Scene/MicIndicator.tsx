'use client'

import { cns } from '@lilnas/utils/cns'
import { useShallow } from 'zustand/react/shallow'

import { useVoiceStore } from 'src/voice/store'

// ---------------------------------------------------------------------------
// Mic-state HUD chip (PLAN.md "Phase 4B — Spatial voice chat" / VF5 —
// ORCHESTRATE.md §2's "Scene/MicIndicator.tsx" contract). Purely
// presentational: reads `useVoiceStore` and renders one of three states.
// Matches the tone of Scene.tsx's existing overlay chrome (small,
// translucent `bg-black/60`, `text-xs`/`text-sm`) rather than introducing a
// new visual language.
//
// NOT mounted here — this unit only builds the component; a later
// integration step drops a single `<MicIndicator />` somewhere in
// Scene.tsx's overlay layer.
//
// States (`permissionState` is `src/voice/store.ts`'s VF5 addition,
// `ensureLocalStream()`'s observable outcome):
//   - `'denied'` — a browser/hardware constraint the user can't fix from
//     here (permission refused, no device, unsupported browser, or SSR).
//     Icon + a one-line note (PLAN.md's "on denial ... surface a one-line
//     note"), tinted amber so it never reads as the same thing as a
//     self-chosen mute.
//   - `'granted' && muted` — the user's OWN reversible choice (`M` in
//     viewControls.ts toggles it back). Icon only, neutral tone.
//   - `'granted' && !muted`, and `'unknown'` (no peer connection has needed
//     the local mic yet, so there's nothing to report) — render nothing.
//     The quieter option: an icon only earns screen space when there's
//     something noteworthy about its state, matching this app's
//     minimal-HUD aesthetic.
// ---------------------------------------------------------------------------

// Single crossed-mic glyph, reused by both "no audio" states below (the
// distinction between them is carried by color/text, not by two near-
// duplicate icons) — an inline SVG built from basic shapes, matching this
// app's established icon convention (IpadBrowserView.tsx's PlayGlyph/
// SeriesGlyph) since no icon library is installed.
function MicOffGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cns('h-4 w-4 shrink-0', className)}
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="11" rx="3" className="fill-current" />
      <path
        d="M6 10.5v1a6 6 0 0 0 12 0v-1"
        fill="none"
        className="stroke-current"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="17.5"
        x2="12"
        y2="21"
        className="stroke-current"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="8"
        y1="21"
        x2="16"
        y2="21"
        className="stroke-current"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="4"
        y1="3"
        x2="20"
        y2="21"
        className="stroke-current"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function MicIndicator() {
  const { muted, permissionState } = useVoiceStore(
    useShallow(state => ({
      muted: state.muted,
      permissionState: state.permissionState,
    })),
  )

  if (permissionState === 'denied') {
    return (
      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-1.5 rounded bg-black/60 px-2.5 py-1.5 text-xs text-white/80">
        <MicOffGlyph className="text-amber-300" />
        Mic unavailable
      </div>
    )
  }

  if (permissionState === 'granted' && muted) {
    return (
      <div className="pointer-events-none absolute left-4 top-4 rounded bg-black/60 p-1.5">
        <MicOffGlyph className="text-white/80" />
      </div>
    )
  }

  return null
}
