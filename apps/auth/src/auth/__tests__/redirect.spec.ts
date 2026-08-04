import {
  type RedirectValidationConfig,
  resolveRedirectTarget,
} from 'src/auth/redirect'

// Mirrors a production-shaped deployment: https AUTH_HOST, lilnas.io
// domain family. Used as the default fixture for every test in this file
// except the dedicated "dev-configured instance" block, which needs a
// DIFFERENT authHost scheme to prove the required scheme is derived from
// config rather than hardcoded in either direction.
const PROD_CONFIG: RedirectValidationConfig = {
  authHost: 'https://login.lilnas.io',
  allowedSuffix: 'lilnas.io',
  defaultDestination: '/',
}

// Execution note from the plan (U4): write the rejection cases FIRST,
// before the happy path and before src/auth/redirect.ts's implementation
// existed. A passing suite that happens to omit a bypass class is worse
// than no suite at all for this specific unit — so this describe block is
// deliberately the first thing in the file, not just the first thing
// executed.
describe('resolveRedirectTarget — rejection: known bypass classes (R3, AE4)', () => {
  it('rejects an unrelated external origin, falling back to the default destination', () => {
    const result = resolveRedirectTarget(
      'https://evil.example.com',
      PROD_CONFIG,
    )

    expect(result).toBe(PROD_CONFIG.defaultDestination)
  })

  it('rejects a userinfo-prefixed URL, proving hostname comes from a real parsed URL rather than a substring match', () => {
    const candidate = 'https://auth.lilnas.io@evil.com'

    // The point of this test: "auth.lilnas.io" appears in the STRING, but
    // the URL spec parses everything before "@" as userinfo, not host. A
    // naive `.includes('lilnas.io')` check would be fooled by this string;
    // reading `.hostname` off a real `new URL()` is not. Prove the parser
    // fact directly and explicitly, independent of whether
    // resolveRedirectTarget's own internals happen to agree with it.
    expect(new URL(candidate).hostname).toBe('evil.com')

    const result = resolveRedirectTarget(candidate, PROD_CONFIG)

    expect(result).toBe(PROD_CONFIG.defaultDestination)
  })

  it('rejects a suffix-position bypass (the allowed suffix appears as a PREFIX of the real host, not a proper subdomain)', () => {
    const result = resolveRedirectTarget(
      'https://lilnas.io.evil.com',
      PROD_CONFIG,
    )

    expect(result).toBe(PROD_CONFIG.defaultDestination)
  })

  it('rejects a missing-dot bypass (a hostname that merely ends with the suffix as a raw substring)', () => {
    // Proves the check is "ends with '.' + suffix", not
    // "hostname.endsWith(suffix)" — 'evil-lilnas.io' ends with the literal
    // substring 'lilnas.io' but is not a subdomain of it. This is the test
    // that would fail if the leading dot were ever dropped from
    // isAllowedHostname.
    const result = resolveRedirectTarget('https://evil-lilnas.io', PROD_CONFIG)

    expect(result).toBe(PROD_CONFIG.defaultDestination)
  })

  it('rejects a protocol-relative URL', () => {
    // Confirms the real, verified behavior rather than assuming it: a bare
    // `new URL()` call with no base throws on a schemeless
    // protocol-relative string. This is exactly the fact step 1 of
    // resolveRedirectTarget relies on to reject this bypass class — proven
    // here independently of the implementation under test.
    expect(() => new URL('//evil.com')).toThrow()

    const result = resolveRedirectTarget('//evil.com', PROD_CONFIG)

    expect(result).toBe(PROD_CONFIG.defaultDestination)
  })

  it('rejects a scheme downgrade (http) under a validator configured to require https', () => {
    // PROD_CONFIG's authHost is https://..., so the required scheme
    // (derived from authHost's own protocol, not a hardcoded literal — see
    // redirect.ts's header comment) is "https:" here. This is the
    // configuration under which downgrade-rejection must hold — see the
    // "dev-configured instance" block below for the complementary case,
    // where http is legitimately the REQUIRED (not downgraded) scheme.
    const result = resolveRedirectTarget('http://swole.lilnas.io', PROD_CONFIG)

    expect(result).toBe(PROD_CONFIG.defaultDestination)
  })

  it.each([['javascript:alert(1)'], ['data:text/html,hello']])(
    'rejects the non-http(s) scheme candidate %s',
    candidate => {
      const result = resolveRedirectTarget(candidate, PROD_CONFIG)

      expect(result).toBe(PROD_CONFIG.defaultDestination)
    },
  )
})

describe('resolveRedirectTarget — edge cases', () => {
  it('rejects the auth host itself as a redirect target (loop guard)', () => {
    // This candidate would otherwise PASS the domain-family check (it ends
    // with ".lilnas.io") — the loop guard is what has to reject it
    // specifically, not the suffix check.
    const result = resolveRedirectTarget(
      'https://login.lilnas.io/some/path',
      PROD_CONFIG,
    )

    expect(result).toBe(PROD_CONFIG.defaultDestination)
  })

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
    ['a number', 12345],
    ['null', null],
    [
      'an array (Next searchParams repeated-key shape)',
      ['https://evil.example.com'],
    ],
  ])(
    'returns the default destination for %s without throwing',
    (_label, candidate) => {
      expect(() => resolveRedirectTarget(candidate, PROD_CONFIG)).not.toThrow()
      expect(resolveRedirectTarget(candidate, PROD_CONFIG)).toBe(
        PROD_CONFIG.defaultDestination,
      )
    },
  )
})

describe('resolveRedirectTarget — happy path', () => {
  it('returns an allowed subdomain candidate unchanged, path and query intact', () => {
    const candidate = 'https://swole.lilnas.io/some/path?q=1'

    const result = resolveRedirectTarget(candidate, PROD_CONFIG)

    expect(result).toBe(candidate)
  })

  it('allows the apex domain with no subdomain', () => {
    const candidate = 'https://lilnas.io/'

    const result = resolveRedirectTarget(candidate, PROD_CONFIG)

    expect(result).toBe(candidate)
  })
})

describe('resolveRedirectTarget — dev-configured instance (required scheme is derived from AUTH_HOST, never hardcoded)', () => {
  // A deliberately DIFFERENT authHost scheme from PROD_CONFIG above, to
  // prove the required-scheme derivation actually varies with
  // configuration in both directions — not just that it can reject a
  // downgrade under an https-configured instance (already covered above),
  // but that it legitimately ALLOWS http under an http-configured one,
  // matching this repo's real dev domains (root CLAUDE.md: "*.localhost",
  // plain http, no TLS entrypoint in dev per U1's spike).
  const DEV_CONFIG: RedirectValidationConfig = {
    authHost: 'http://login.localhost',
    allowedSuffix: 'localhost',
    defaultDestination: '/',
  }

  it('allows a plain-http candidate when this deployment is itself configured over http', () => {
    const candidate = 'http://swole.localhost/'

    const result = resolveRedirectTarget(candidate, DEV_CONFIG)

    expect(result).toBe(candidate)
  })

  it("still rejects a scheme that does not match this dev instance's own (https, when http is required)", () => {
    const result = resolveRedirectTarget('https://swole.localhost/', DEV_CONFIG)

    expect(result).toBe(DEV_CONFIG.defaultDestination)
  })
})
