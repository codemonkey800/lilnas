import { corsHeaders, resolveAllowedOrigin } from 'src/app/api/profile/cors'

describe('resolveAllowedOrigin', () => {
  it('returns the request origin verbatim when it exactly matches an allowlist entry', () => {
    expect(
      resolveAllowedOrigin(
        'http://localhost:5173',
        'http://localhost:5173,http://localhost:8765',
      ),
    ).toBe('http://localhost:5173')
  })

  it('tolerates whitespace around allowlist entries', () => {
    expect(
      resolveAllowedOrigin(
        'http://localhost:8765',
        ' http://localhost:5173 , http://localhost:8765 ',
      ),
    ).toBe('http://localhost:8765')
  })

  it('rejects an origin not present in the allowlist', () => {
    expect(
      resolveAllowedOrigin(
        'https://evil.example.com',
        'http://localhost:5173,http://localhost:8765',
      ),
    ).toBeNull()
  })

  it('fails closed when the allowlist is empty', () => {
    expect(resolveAllowedOrigin('http://localhost:5173', '')).toBeNull()
  })

  it('fails closed when there is no request Origin header at all', () => {
    expect(
      resolveAllowedOrigin(null, 'http://localhost:5173,http://localhost:8765'),
    ).toBeNull()
  })

  it('never matches via a literal wildcard allowlist entry — the trustedOrigins trap', () => {
    // Regression guard for the exact bug src/auth/auth.ts's trustedOrigins
    // comment documents: a `https://*.lilnas.io`-shaped entry must not
    // silently match every subdomain (or anything else) once compared with
    // plain string equality.
    expect(
      resolveAllowedOrigin(
        'https://nexus-code.lilnas.io',
        'https://*.lilnas.io',
      ),
    ).toBeNull()
  })

  it('is case-insensitive, matching email allowlist matching elsewhere in this app — and echoes the request Origin verbatim, not the normalized form', () => {
    expect(
      resolveAllowedOrigin(
        'https://Nexus-Code.lilnas.io',
        'https://nexus-code.lilnas.io',
      ),
    ).toBe('https://Nexus-Code.lilnas.io')
  })

  it('tolerates a single trailing slash on an allowlist entry — a real Origin header never has one', () => {
    expect(
      resolveAllowedOrigin(
        'https://nexus-code.lilnas.io',
        'https://nexus-code.lilnas.io/',
      ),
    ).toBe('https://nexus-code.lilnas.io')
  })

  it('tolerates both case and a trailing slash at once', () => {
    expect(
      resolveAllowedOrigin(
        'https://Nexus-Code.lilnas.io',
        'https://nexus-code.lilnas.io/',
      ),
    ).toBe('https://Nexus-Code.lilnas.io')
  })

  it('does not tolerate more than one trailing slash on an allowlist entry', () => {
    expect(
      resolveAllowedOrigin(
        'https://nexus-code.lilnas.io',
        'https://nexus-code.lilnas.io//',
      ),
    ).toBeNull()
  })
})

describe('corsHeaders', () => {
  it('returns the full CORS header set for a matched origin', () => {
    expect(corsHeaders('http://localhost:5173')).toEqual({
      'Access-Control-Allow-Origin': 'http://localhost:5173',
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    })
  })

  it('returns no headers at all when there is no matched origin', () => {
    expect(corsHeaders(null)).toEqual({})
  })

  it('never emits a wildcard origin, which is incompatible with credentials: include', () => {
    const headers = corsHeaders('http://localhost:5173')
    expect(headers['Access-Control-Allow-Origin']).not.toBe('*')
  })
})
