import { formatBytes, formatRuntime } from 'src/media/format'

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats bytes without decimal', () => {
    expect(formatBytes(500)).toBe('500 B')
  })

  it('formats KB with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
  })

  it('formats fractional KB', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
  })

  it('formats GB', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
  })

  it('formats TB', () => {
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB')
  })

  it('formats fractional GB', () => {
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
  })
})

describe('formatRuntime', () => {
  it('formats minutes only', () => {
    expect(formatRuntime(45)).toBe('45m')
  })

  it('formats zero minutes', () => {
    expect(formatRuntime(0)).toBe('0m')
  })

  it('formats hours only (no remainder)', () => {
    expect(formatRuntime(120)).toBe('2h')
  })

  it('formats hours and minutes', () => {
    expect(formatRuntime(95)).toBe('1h 35m')
  })

  it('formats exactly 1 hour', () => {
    expect(formatRuntime(60)).toBe('1h')
  })

  it('formats 1 hour 1 minute', () => {
    expect(formatRuntime(61)).toBe('1h 1m')
  })
})
