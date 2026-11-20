import { formatBytes, formatCount, formatRelative } from 'src/lib/format'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1500, '1.5 KB'],
    [12_400_000_000, '12.4 GB'],
    [999_960, '1.0 MB'],
    [2_500_000_000_000, '2.5 TB'],
    [-5, '0 B'],
    [Number.NaN, '0 B'],
  ])('formats %p as %p', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })
})

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(18532)).toBe('18,532')
    expect(formatCount(7)).toBe('7')
  })
})

describe('formatRelative', () => {
  const now = Date.parse('2026-11-19T12:00:00.000Z')
  const ago = (seconds: number): string =>
    new Date(now - seconds * 1000).toISOString()

  it.each([
    [10, 'just now'],
    [5 * 60, '5 minutes ago'],
    [3 * 3600, '3 hours ago'],
    [26 * 3600, 'yesterday'],
    [4 * 86400, '4 days ago'],
    [70 * 86400, '2 months ago'],
  ])('%p seconds ago reads %p', (seconds, text) => {
    expect(formatRelative(ago(seconds), now)).toBe(text)
  })

  it('reads a future time', () => {
    expect(formatRelative(ago(-2 * 3600), now)).toBe('in 2 hours')
  })

  it('is empty for a bad date', () => {
    expect(formatRelative('nope', now)).toBe('')
  })
})
