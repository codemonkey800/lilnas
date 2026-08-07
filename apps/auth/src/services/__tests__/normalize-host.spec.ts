import { normalizeHost } from 'src/services/normalize-host'

describe('normalizeHost (S4)', () => {
  it('lowercases the host', () => {
    expect(normalizeHost('SWOLE.lilnas.io')).toBe('swole.lilnas.io')
  })

  it('is a no-op for an already-lowercase, no-port host', () => {
    expect(normalizeHost('swole.lilnas.io')).toBe('swole.lilnas.io')
  })

  it('strips a trailing :port', () => {
    expect(normalizeHost('swole.lilnas.io:8443')).toBe('swole.lilnas.io')
  })

  it('lowercases AND strips a port together', () => {
    expect(normalizeHost('SWOLE.lilnas.io:8443')).toBe('swole.lilnas.io')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeHost('  swole.lilnas.io  ')).toBe('swole.lilnas.io')
  })

  it('handles a dev *.localhost host the same way', () => {
    expect(normalizeHost('Auth.Localhost:8080')).toBe('auth.localhost')
  })
})
