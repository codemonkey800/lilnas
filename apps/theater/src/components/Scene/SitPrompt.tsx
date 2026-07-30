'use client'

import { useEffect, useState } from 'react'

import { seatPhaseRef } from './SeatedCamera'
import { seatTargetRef } from './seatTargeting'

// ---------------------------------------------------------------------------
// The sit/stand affordance (PLAN.md "F8 — Scene wiring + the sit prompt" /
// ORCHESTRATE.md §1, §2's F8 row). Plain DOM overlay, mounted by Scene.tsx
// OUTSIDE <Canvas> — this file never touches react-three-fiber (no
// useFrame; a <Canvas>-scoped hook couldn't run out here anyway).
//
// Reads `seatPhaseRef` (SeatedCamera.tsx, F4) and `seatTargetRef`
// (seatTargeting.ts, F4) DIRECTLY rather than recomputing anything.
// ORCHESTRATE.md §1's "why seatTargetRef exists at all" is explicit that
// both consumers of that ref (viewControls.ts's `E` handler and this
// component) must read the SAME published answer and never call
// `findGazedFreeSeat` a second time — two independent computations could
// drift a frame apart, or, worse, someone "simplifying" one call site later
// could silently change only one of the two behaviors.
//
// `seatPhaseRef`, not `useSeatStore`'s `mySeatId`, is what distinguishes
// "seated" from "mid-transition" from "standing": `mySeatId` clears to null
// the INSTANT release() is called, which is the START of stand_up, not its
// end (SeatedCamera.tsx's header comment) — it can't tell "still standing
// up" apart from "fully standing," but `seatPhaseRef` can.
// ---------------------------------------------------------------------------

// ~5 Hz, matching RemoteAvatars.tsx's SPEED_STATE_INTERVAL_S throttle
// discipline for "a continuously-polled value promoted into occasional React
// state" — a text prompt only needs human-reaction-time granularity, not
// per-frame (60 Hz) granularity. A plain setInterval rather than a useFrame
// accumulator, since this component renders outside <Canvas> and has no R3F
// frame loop to hook into.
const POLL_INTERVAL_MS = 200

type PromptText = 'Press E to sit' | 'Press E to stand' | null

function computePrompt(): PromptText {
  const phase = seatPhaseRef.current

  if (phase === 'sitting') {
    return 'Press E to stand'
  }

  if (phase === 'sit_down' || phase === 'stand_up') {
    // Mid-transition: viewControls.ts ignores `E` entirely here (D5/F4), so
    // there is nothing to prompt.
    return null
  }

  // phase === 'standing': prompt only if D9's gaze+proximity test currently
  // names a free seat.
  return seatTargetRef.current !== null ? 'Press E to sit' : null
}

export function SitPrompt() {
  const [text, setText] = useState<PromptText>(null)

  useEffect(() => {
    const id = setInterval(() => {
      setText(previous => {
        const next = computePrompt()
        return next === previous ? previous : next
      })
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  if (text === null) {
    return null
  }

  return (
    <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded bg-black/60 px-4 py-2 text-sm">
      {text}
    </div>
  )
}
