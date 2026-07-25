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
