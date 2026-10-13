import {
  computeClockSample,
  selectBestSample,
  serverMsToClientMs,
} from 'src/playback/clock'

// Pure arithmetic only (this app's node-env jest convention — see
// playback/store.test.ts): the socket/timer half of clock.ts is exercised by
// the gateway's `time:ping` handler tests and the browser.

describe('computeClockSample', () => {
  it('places the server reply at the midpoint of the round trip', () => {
    // Sent at 1000, received at 1100 (rtt 100) → the server's 500_050 was
    // true at local 1050, so offset = 500_050 - 1050.
    expect(computeClockSample(1000, 1100, 500_050)).toEqual({
      offsetMs: 499_000,
      rttMs: 100,
    })
  })

  it('round-trips a server timestamp back to the local clock', () => {
    const sample = computeClockSample(1000, 1100, 500_050)
    expect(serverMsToClientMs(500_050, sample.offsetMs)).toBe(1050)
    // A state computed 2s later on the server maps 2s later locally.
    expect(serverMsToClientMs(502_050, sample.offsetMs)).toBe(3050)
  })
})

describe('selectBestSample', () => {
  it('returns null with no samples', () => {
    expect(selectBestSample([])).toBeNull()
  })

  it('prefers the lowest-RTT sample regardless of order', () => {
    const slow = { offsetMs: 10, rttMs: 300 }
    const fast = { offsetMs: 12, rttMs: 20 }
    const mid = { offsetMs: 11, rttMs: 80 }
    expect(selectBestSample([slow, fast, mid])).toBe(fast)
    expect(selectBestSample([mid, slow, fast])).toBe(fast)
  })

  it('a janky probe (handler ran late → inflated RTT) never displaces a clean one', () => {
    const clean = computeClockSample(1000, 1020, 900_010)
    // Same true offset, but the ack callback ran 1.2s late.
    const janky = computeClockSample(2000, 3220, 901_010)
    expect(selectBestSample([clean, janky])).toBe(clean)
  })
})
