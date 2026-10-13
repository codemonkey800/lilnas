import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'

import { useMultiplayerStore } from 'src/multiplayer/store'
import { useSeatStore } from 'src/seats/store'

import { findGazedFreeSeat } from './seats'

// ---------------------------------------------------------------------------
// D9's gaze+proximity seat target (PLAN.md's F1/F4 sections; ORCHESTRATE.md
// §1's "why seatTargetRef exists at all"). `viewControls.ts` handles `E` via
// a plain `window.addEventListener('keydown', ...)` -- it has no camera
// access, since it isn't rendered inside <Canvas>. `useSeatTargeting()` is
// the thing that DOES run inside <Canvas>, publishing "which free seat, if
// any, currently passes D9's test" once a frame into `seatTargetRef`, for
// both that keydown handler and <SitPrompt>'s throttled poll (F8) to read
// synchronously -- neither ever calls `findGazedFreeSeat` a second time
// itself, which is what keeps the prompt and the keypress from disagreeing
// about which seat (ORCHESTRATE.md §7).
//
// Mirrors playerVelocity.ts's exact shape: a module-level mutable object,
// written every frame by ONE useFrame, read elsewhere with no parent/child
// relationship to it -- not a new mechanism, the same one applied to a new
// value.
//
// `useSeatTargeting()` must be mounted inside <Canvas> by F8 (Scene.tsx) --
// nothing else runs it. If that mount is ever missed, this silently stays
// `null` forever: no crash, no type error, `E` just never claims a seat
// (ORCHESTRATE.md §7: "seatTargeting.ts is a fourth silent-failure spot").
// ---------------------------------------------------------------------------

export const seatTargetRef: { current: string | null } = { current: null }

// Reused across frames instead of allocating a fresh Vector3 every tick --
// mirrors gaze.ts's / seats.ts's own module-level scratch vector convention.
// Safe as a module-level (rather than per-hook-instance) scratch because
// exactly one instance of this hook is ever mounted (F8 mounts it once).
const forwardScratch = new Vector3()

export function useSeatTargeting(): void {
  useFrame(state => {
    if (useSeatStore.getState().mySeatId !== null) {
      // Already seated (or mid sit_down/stand_up -- mySeatId only clears at
      // the START of stand_up, see SeatedCamera.tsx) -- you don't target a
      // seat to sit in while sitting in one.
      seatTargetRef.current = null
      return
    }

    const camera = state.camera
    const camForward = camera.getWorldDirection(forwardScratch)
    const occupied = new Set(
      Object.values(useMultiplayerStore.getState().peerSeats),
    )
    const seat = findGazedFreeSeat(camera.position, camForward, occupied)
    seatTargetRef.current = seat?.id ?? null
  })
}
