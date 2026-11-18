import { extractSessionCookieValue } from 'src/verify/access-cache.service'

describe('extractSessionCookieValue (P2)', () => {
  it('extracts the value for the unprefixed dev-mode cookie name', () => {
    expect(
      extractSessionCookieValue('lilnas-auth.session_token=abc123.sig'),
    ).toBe('abc123.sig')
  })

  it('extracts the value for the __Secure- prefixed prod-mode cookie name', () => {
    expect(
      extractSessionCookieValue(
        '__Secure-lilnas-auth.session_token=abc123.sig',
      ),
    ).toBe('abc123.sig')
  })

  it('finds the session cookie among several unrelated cookies, regardless of position', () => {
    expect(
      extractSessionCookieValue(
        'foo=bar; lilnas-auth.session_token=abc123.sig; baz=qux',
      ),
    ).toBe('abc123.sig')
    expect(
      extractSessionCookieValue(
        'lilnas-auth.session_token=abc123.sig; foo=bar',
      ),
    ).toBe('abc123.sig')
  })

  it('returns null when no cookie matches either session-cookie name', () => {
    expect(extractSessionCookieValue('foo=bar; baz=qux')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(extractSessionCookieValue('')).toBeNull()
  })

  it('does not match a cookie whose name merely contains the session cookie name as a substring', () => {
    expect(
      extractSessionCookieValue('xlilnas-auth.session_token=should-not-match'),
    ).toBeNull()
    expect(
      extractSessionCookieValue('lilnas-auth.session_tokenx=should-not-match'),
    ).toBeNull()
  })

  it('trims surrounding whitespace around the cookie pair', () => {
    expect(
      extractSessionCookieValue('  lilnas-auth.session_token=abc123.sig  '),
    ).toBe('abc123.sig')
  })

  it("a value containing '=' (base64 padding) is preserved in full, split only on the FIRST '='", () => {
    expect(
      extractSessionCookieValue('lilnas-auth.session_token=abc.dGVzdA=='),
    ).toBe('abc.dGVzdA==')
  })

  it('does not match the old better-auth default names, in either form', () => {
    expect(
      extractSessionCookieValue('better-auth.session_token=abc123.sig'),
    ).toBeNull()
    expect(
      extractSessionCookieValue(
        '__Secure-better-auth.session_token=abc123.sig',
      ),
    ).toBeNull()
  })

  it('does not match a name that wraps the new session cookie name at either end', () => {
    expect(
      extractSessionCookieValue('xlilnas-auth.session_token=nope'),
    ).toBeNull()
    expect(
      extractSessionCookieValue('lilnas-auth.session_tokenx=nope'),
    ).toBeNull()
    expect(
      extractSessionCookieValue('x__Secure-lilnas-auth.session_token=nope'),
    ).toBeNull()
  })
})
