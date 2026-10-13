import {
  classifyRawAnimState,
  debounceAnimState,
  type DebounceState,
  INITIAL_DEBOUNCE_STATE,
  MIN_DWELL_S,
} from 'src/components/Scene/animStateClassify'

// Regression tests for the "walk animation keeps restarting" bug:
// classifyRawAnimState picks whichever of forward/right dominates the
// other, which flips the instant the camera's facing crosses 45deg off the
// player's actual (world-space) movement direction -- an ordinary thing to
// do (e.g. walking straight down an aisle while looking off to the side).
// Avatar.tsx's crossfade effect calls action.reset() on every animState
// change, so a broadcast animState that flickers back and forth restarts
// the walk clip's stride phase every time, even though the player never
// actually stopped or changed direction. debounceAnimState must absorb
// that flicker before it's ever committed/broadcast.
//
// The dwell applies ONLY to direction changes between two walk states. Start
// and stop (idle <-> walk) commit immediately: LocalPresence classifies the
// rigid body's true velocity, so the idle threshold is a clean single crossing
// with no flicker to absorb -- dwelling on it only relagged start/stop.

describe('classifyRawAnimState', () => {
  it('classifies idle below the speed epsilon', () => {
    expect(classifyRawAnimState(0, 0, 0, 1)).toBe('idle')
    expect(classifyRawAnimState(0.01, 0, 0, 1)).toBe('idle')
  })

  it('classifies walk_fwd when moving exactly where the camera looks', () => {
    expect(classifyRawAnimState(0, 1, 0, 1)).toBe('walk_fwd')
  })

  it('classifies walk_back when moving directly away from the camera facing', () => {
    expect(classifyRawAnimState(0, -1, 0, 1)).toBe('walk_back')
  })

  it('classifies strafe_right/left relative to camera facing, not world axes', () => {
    // Facing world +Z (dirX=0, dirZ=1): right = cross(forward, up) =
    // cross((0,0,1), (0,1,0)) = (-1,0,0), i.e. world -X is "right" here --
    // so moving toward world +X is strafe_left, and world -X is strafe_right.
    expect(classifyRawAnimState(1, 0, 0, 1)).toBe('strafe_left')
    expect(classifyRawAnimState(-1, 0, 0, 1)).toBe('strafe_right')
  })

  // The instability debounceAnimState exists to absorb: fixed real-world
  // movement (walking straight in +Z), camera yaw sweeping across the
  // 45deg line relative to that direction flips the raw classification.
  it('flips right at the 45-degree camera-offset boundary under constant real-world movement', () => {
    const vx = 0
    const vz = 1.75
    const justBelow = 44 * (Math.PI / 180)
    const justAbove = 46 * (Math.PI / 180)

    expect(
      classifyRawAnimState(vx, vz, Math.sin(justBelow), Math.cos(justBelow)),
    ).toBe('walk_fwd')
    expect(
      classifyRawAnimState(vx, vz, Math.sin(justAbove), Math.cos(justAbove)),
    ).toBe('strafe_right')
  })
})

describe('debounceAnimState', () => {
  it('stays on the committed state while raw flickers between two other candidates faster than MIN_DWELL_S', () => {
    let state: DebounceState = {
      ...INITIAL_DEBOUNCE_STATE,
      committed: 'walk_fwd',
    }
    const dt = 1 / 60 // 60fps, ~16.7ms/frame -- well under MIN_DWELL_S

    // Simulate a camera hovering right at the 45-degree line: the raw
    // classification alternates every frame, never settling.
    for (let i = 0; i < 120; i++) {
      const raw = i % 2 === 0 ? 'walk_fwd' : 'strafe_right'
      state = debounceAnimState(state, raw, dt)
      expect(state.committed).toBe('walk_fwd')
    }
  })

  it('stays on the committed state while raw flickers among three different candidates, none sustained', () => {
    let state: DebounceState = {
      ...INITIAL_DEBOUNCE_STATE,
      committed: 'walk_fwd',
    }
    const dt = 1 / 60
    const candidates: DebounceState['committed'][] = [
      'strafe_right',
      'strafe_left',
      'walk_back',
    ]

    for (let i = 0; i < 120; i++) {
      const raw = candidates[i % candidates.length] ?? 'strafe_right'
      state = debounceAnimState(state, raw, dt)
      expect(state.committed).toBe('walk_fwd')
    }
  })

  it('commits a start (idle->walk) immediately, with no dwell', () => {
    // With LocalPresence classifying the rigid body's true velocity, the idle
    // threshold is a clean single crossing -- so starting to walk must be
    // instant, not dwell-delayed (the "sluggish to start" residual).
    const state = debounceAnimState(
      { ...INITIAL_DEBOUNCE_STATE, committed: 'idle' },
      'walk_fwd',
      1 / 60,
    )
    expect(state.committed).toBe('walk_fwd')
    expect(state.pendingState).toBeNull()
  })

  it('commits a stop (walk->idle) immediately, with no dwell', () => {
    // Coming to a stop is unambiguous (speed crosses to ~0 once) -- commit it
    // the same frame, no lingering walk cycle after the body has halted.
    const state = debounceAnimState(
      { ...INITIAL_DEBOUNCE_STATE, committed: 'walk_fwd' },
      'idle',
      1 / 60,
    )
    expect(state.committed).toBe('idle')
    expect(state.pendingState).toBeNull()
  })

  it('commits a sustained direction change (walk->walk) once it lasts at least MIN_DWELL_S', () => {
    // A direction change between two walk states is the ONE transition that
    // still goes through the dwell (the 45deg forward/strafe flicker guard).
    let state: DebounceState = {
      ...INITIAL_DEBOUNCE_STATE,
      committed: 'walk_fwd',
    }
    const dt = 1 / 60
    let framesUntilCommit = 0

    while (state.committed !== 'strafe_right') {
      state = debounceAnimState(state, 'strafe_right', dt)
      framesUntilCommit += 1
      expect(framesUntilCommit).toBeLessThan(600) // sanity bound, not a real limit
    }

    const elapsedS = framesUntilCommit * dt
    expect(elapsedS).toBeGreaterThanOrEqual(MIN_DWELL_S)
    // Committed on the very first frame that crosses the dwell threshold,
    // not meaningfully later than it.
    expect(elapsedS).toBeLessThan(MIN_DWELL_S + dt * 2)
  })

  it('clears a pending switch (resets the dwell timer to zero) the instant raw reasserts the current committed state', () => {
    let state: DebounceState = {
      ...INITIAL_DEBOUNCE_STATE,
      committed: 'walk_fwd',
    }
    const dt = 1 / 60

    // Almost long enough to commit strafe_right...
    for (let i = 0; i < 8; i++) {
      state = debounceAnimState(state, 'strafe_right', dt)
    }
    expect(state.committed).toBe('walk_fwd')
    expect(state.pendingElapsedS).toBeGreaterThan(0)

    // ...but the player's actual direction reasserts itself before the
    // dwell time elapses.
    state = debounceAnimState(state, 'walk_fwd', dt)
    expect(state.committed).toBe('walk_fwd')
    expect(state.pendingState).toBeNull()
    expect(state.pendingElapsedS).toBe(0)
  })

  it('restarts the dwell timer (does not accumulate) when the pending candidate itself changes', () => {
    let state: DebounceState = {
      ...INITIAL_DEBOUNCE_STATE,
      committed: 'walk_fwd',
    }
    const dt = 1 / 60

    state = debounceAnimState(state, 'strafe_right', dt)
    state = debounceAnimState(state, 'strafe_right', dt)
    const elapsedBeforeSwitch = state.pendingElapsedS

    // Pending candidate itself changes -- must NOT carry over the strafe_right
    // dwell progress onto walk_back's counter.
    state = debounceAnimState(state, 'walk_back', dt)

    expect(state.pendingState).toBe('walk_back')
    expect(state.pendingElapsedS).toBeCloseTo(dt, 10)
    expect(state.pendingElapsedS).toBeLessThan(elapsedBeforeSwitch + dt)
  })

  it('eventually commits a genuine, sustained direction change', () => {
    let state: DebounceState = {
      ...INITIAL_DEBOUNCE_STATE,
      committed: 'walk_fwd',
    }
    const dt = 1 / 60
    const framesNeeded = Math.ceil(MIN_DWELL_S / dt) + 1

    for (let i = 0; i < framesNeeded; i++) {
      state = debounceAnimState(state, 'strafe_left', dt)
    }

    expect(state.committed).toBe('strafe_left')
  })
})
