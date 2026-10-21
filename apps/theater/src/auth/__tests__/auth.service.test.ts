import { createHmac } from 'node:crypto'

import type { Request } from 'express'

import { AuthService } from 'src/auth/auth.service'

const SESSION_SECRET = 'test-session-secret'
const USERNAME = 'alice'
const SESSION_COOKIE_NAME = 'theater_session'

// Mirrors cookie-signature@1.0.6's `sign()` — the algorithm cookie-parser
// uses internally to produce the value behind `res.cookie(name, value, {
// signed: true })` — so these fixtures are byte-for-byte what the real
// middleware would have written for the same secret.
function signCookieValue(value: string, secret: string): string {
  const mac = createHmac('sha256', secret)
    .update(value)
    .digest('base64')
    .replace(/=+$/, '')
  return `s:${value}.${mac}`
}

function buildCookieHeader(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}`
}

// Changes the last character of a signed value so its HMAC no longer
// verifies, without disturbing the overall `s:<value>.<mac>` shape.
function flipLastChar(value: string): string {
  const lastChar = value.at(-1) ?? ''
  return value.slice(0, -1) + (lastChar === 'a' ? 'b' : 'a')
}

// Intentionally omits `signedCookies` — if `readSession` ever reached back
// into it, these tests would throw instead of silently passing, proving the
// refactor onto `verifySessionCookie` dropped that dependency.
function requestWithCookieHeader(cookie: string | undefined): Request {
  return { headers: { cookie } } as unknown as Request
}

describe('AuthService.verifySessionCookie', () => {
  let authService: AuthService

  beforeEach(() => {
    process.env.THEATER_SESSION_SECRET = SESSION_SECRET
    authService = new AuthService()
  })

  it('returns the username for a validly signed cookie', () => {
    const header = buildCookieHeader(
      SESSION_COOKIE_NAME,
      signCookieValue(USERNAME, SESSION_SECRET),
    )

    expect(authService.verifySessionCookie(header)).toBe(USERNAME)
  })

  it('returns null when the cookie header is undefined', () => {
    expect(authService.verifySessionCookie(undefined)).toBeNull()
  })

  it('returns null when the header is present but missing the session cookie', () => {
    const header = buildCookieHeader('other_cookie', 'whatever')

    expect(authService.verifySessionCookie(header)).toBeNull()
  })

  it('returns null when the signature has been tampered with', () => {
    const tampered = flipLastChar(signCookieValue(USERNAME, SESSION_SECRET))
    const header = buildCookieHeader(SESSION_COOKIE_NAME, tampered)

    expect(authService.verifySessionCookie(header)).toBeNull()
  })

  // Pins the auth-bypass this method must reject: cookie-parser's
  // `signedCookie()` treats any value that does NOT start with the `s:`
  // signing prefix as an already-unsigned passthrough and returns it
  // *unchanged* rather than `false`. A naive `typeof v === 'string' ? v :
  // null` around that call would hand back a signature-stripped cookie's raw
  // value as if it had been verified — this must return `null` instead.
  it('rejects a raw unsigned value with no s: prefix instead of passing it through', () => {
    const header = buildCookieHeader(SESSION_COOKIE_NAME, USERNAME)

    expect(authService.verifySessionCookie(header)).toBeNull()
  })

  it('finds the session cookie among several cookies', () => {
    const signed = buildCookieHeader(
      SESSION_COOKIE_NAME,
      signCookieValue(USERNAME, SESSION_SECRET),
    )
    const header = `first=1; ${signed}; last=3`

    expect(authService.verifySessionCookie(header)).toBe(USERNAME)
  })

  it('returns null when other cookies are present but the session cookie is not', () => {
    expect(authService.verifySessionCookie('a=1; b=2; c=3')).toBeNull()
  })

  it('percent-decodes the cookie value before verifying the signature', () => {
    // `signCookieValue` output contains `:` and `/`-class characters that
    // `encodeURIComponent` escapes (`s%3A…`), so a successful verification
    // proves the parser decoded the value.
    const signed = signCookieValue(USERNAME, SESSION_SECRET)
    const header = `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed)}`

    expect(header).toContain('%3A')
    expect(authService.verifySessionCookie(header)).toBe(USERNAME)
  })

  it('uses the first session cookie when the name is duplicated', () => {
    const valid = buildCookieHeader(
      SESSION_COOKIE_NAME,
      signCookieValue(USERNAME, SESSION_SECRET),
    )
    const forged = buildCookieHeader(
      SESSION_COOKIE_NAME,
      signCookieValue('mallory', 'attacker-secret'),
    )

    expect(authService.verifySessionCookie(`${valid}; ${forged}`)).toBe(
      USERNAME,
    )
    expect(authService.verifySessionCookie(`${forged}; ${valid}`)).toBeNull()
  })

  it('returns null for a header that is not a cookie pair', () => {
    expect(authService.verifySessionCookie('garbage')).toBeNull()
  })

  it('does not treat inherited object keys as cookies', () => {
    expect(authService.verifySessionCookie('constructor=x')).toBeNull()
    expect(authService.verifySessionCookie('__proto__=x')).toBeNull()
  })
})

describe('AuthService.readSession', () => {
  let authService: AuthService

  beforeEach(() => {
    process.env.THEATER_SESSION_SECRET = SESSION_SECRET
    authService = new AuthService()
  })

  it('returns the username for a request carrying a validly signed cookie', () => {
    const header = buildCookieHeader(
      SESSION_COOKIE_NAME,
      signCookieValue(USERNAME, SESSION_SECRET),
    )

    expect(authService.readSession(requestWithCookieHeader(header))).toBe(
      USERNAME,
    )
  })

  it('returns null for a request with no cookie header', () => {
    expect(
      authService.readSession(requestWithCookieHeader(undefined)),
    ).toBeNull()
  })

  it('returns null for a request whose cookie signature was tampered with', () => {
    const tampered = flipLastChar(signCookieValue(USERNAME, SESSION_SECRET))
    const header = buildCookieHeader(SESSION_COOKIE_NAME, tampered)

    expect(authService.readSession(requestWithCookieHeader(header))).toBeNull()
  })
})
