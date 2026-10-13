import { formatRuntime, formatTimecode } from 'src/playback/format'

const TICKS_PER_MINUTE = 10_000_000 * 60

describe('formatRuntime', () => {
  it('returns null for a missing runtime so callers can omit the field', () => {
    expect(formatRuntime(null)).toBeNull()
  })

  it('formats a sub-hour runtime as minutes only', () => {
    expect(formatRuntime(42 * TICKS_PER_MINUTE)).toBe('42m')
  })

  it('formats a multi-hour runtime as hours and minutes', () => {
    expect(formatRuntime(134 * TICKS_PER_MINUTE)).toBe('2h 14m')
  })

  it('keeps the minutes field at an exact hour boundary', () => {
    expect(formatRuntime(60 * TICKS_PER_MINUTE)).toBe('1h 0m')
  })

  it('rounds to the nearest minute', () => {
    expect(formatRuntime(90.6 * TICKS_PER_MINUTE)).toBe('1h 31m')
  })

  it('formats a zero runtime rather than treating it as missing', () => {
    expect(formatRuntime(0)).toBe('0m')
  })
})

describe('formatTimecode', () => {
  it('formats zero', () => {
    expect(formatTimecode(0)).toBe('0:00')
  })

  it('zero-pads seconds', () => {
    expect(formatTimecode(65)).toBe('1:05')
  })

  it('truncates fractional seconds rather than rounding up', () => {
    expect(formatTimecode(65.9)).toBe('1:05')
  })

  it('adds an hours field at exactly one hour', () => {
    expect(formatTimecode(3600)).toBe('1:00:00')
  })

  it('zero-pads minutes once hours are present', () => {
    expect(formatTimecode(3661)).toBe('1:01:01')
  })

  it('omits the hours field below an hour', () => {
    expect(formatTimecode(3599)).toBe('59:59')
  })

  // A scrub bar reads `duration` before load() resolves it, so these are
  // reachable inputs, not defensive theater.
  it('collapses negative input to zero', () => {
    expect(formatTimecode(-5)).toBe('0:00')
  })

  it('collapses non-finite input to zero instead of rendering NaN', () => {
    expect(formatTimecode(Number.NaN)).toBe('0:00')
    expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatTimecode(Number.NEGATIVE_INFINITY)).toBe('0:00')
  })
})
