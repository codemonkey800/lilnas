import { shouldReuseInFlightLoad } from 'src/playback/store'

// Pure decision-function tests only (per this app's no-browser-verification
// convention — see multiplayer/store.test.ts) — `load()` itself is DOM/
// network-heavy (document.createElement, fetch, hls.js) and isn't worth the
// mocking cost; `shouldReuseInFlightLoad` is the one branch point it makes
// before touching any of that, so it's the testable surface of the fix for
// the enqueue/video:state double-load race (see store.ts's `inFlightLoad`
// comment).

describe('shouldReuseInFlightLoad', () => {
  it('returns false when nothing is in flight', () => {
    expect(shouldReuseInFlightLoad(null, 'movie-1')).toBe(false)
  })

  it('returns true for a second call with the same id as the in-flight load', () => {
    const inFlight = { itemId: 'movie-1', promise: Promise.resolve() }
    expect(shouldReuseInFlightLoad(inFlight, 'movie-1')).toBe(true)
  })

  it('returns false for a different id than the in-flight load', () => {
    const inFlight = { itemId: 'movie-1', promise: Promise.resolve() }
    expect(shouldReuseInFlightLoad(inFlight, 'movie-2')).toBe(false)
  })
})
