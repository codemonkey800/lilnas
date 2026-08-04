import type { Auth } from 'src/auth/auth'
import { AUTH_PATH_SEGMENT } from 'src/auth/auth'

// ──────────────────────────────────────────────────────────────────────────────
// Shared test fixture: drives a REAL sign-in through a REAL buildAuth()
// instance (mocking only the network boundary this app doesn't own —
// Google's own token endpoint) and returns the exact `name=value` session
// cookie pair a browser would then present on every subsequent request.
//
// This exists because U5's own instructions are explicit: do NOT
// reimplement Better Auth's cookie-signing scheme to fabricate a session
// cookie by hand — the signing helpers live in better-call's crypto.mjs,
// which isn't part of that package's public exports. Driving a real
// sign-in through auth.handler() is the sanctioned alternative: it
// produces a genuinely, correctly signed cookie without this file ever
// touching HMAC internals, using the exact technique
// src/auth/__tests__/auth-mount.spec.ts already established and proved
// working (its "Secure cookie attribute" describe block calls
// auth.handler(new Request(...)) directly, with no HTTP server, exactly
// like this helper does) — reused here (not imported from that spec file;
// Jest spec files aren't meant to be imported by other spec files) because
// access-cache.service.spec.ts and verify.service.spec.ts both need it.
// Excluded from being treated as its own test suite by jest.config.js's
// `!**/__tests__/helpers/**/*` testMatch negation (a convention already
// present in this app's scaffold since U2, previously unused).
//
// This file is excluded from collectCoverageFrom's negative patterns too
// (`!src/**/__tests__/**/*`), consistent with every other __tests__ file.
// ──────────────────────────────────────────────────────────────────────────────

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

// Fabricates a Google id_token good enough for getUserInfo() to accept —
// see auth-mount.spec.ts's identical helper for the full citation: the
// callback path decodes this JWT's payload WITHOUT verifying the
// signature, so the trailing "signature" segment is never validated and
// can be any non-empty base64url string.
function fakeGoogleIdToken(profile: { sub: string; email: string }): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = base64url(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: process.env.GOOGLE_CLIENT_ID,
      sub: profile.sub,
      email: profile.email,
      email_verified: true,
      name: 'Test User',
      given_name: 'Test',
      family_name: 'User',
      picture: 'https://example.com/avatar.png',
      iat: now,
      exp: now + 3600,
    }),
  )
  return `${header}.${payload}.fake-signature-never-verified-by-getUserInfo`
}

// Extracts just the `name=value` pairs (before each cookie's first `;`)
// from a set of Set-Cookie headers, joined the way a browser's own Cookie
// header would be — same helper as auth-mount.spec.ts's identically-named
// function.
function cookieHeaderFromSetCookies(setCookieHeaders: string[]): string {
  return setCookieHeaders
    .map(cookie => cookie.split(';')[0])
    .filter((pair): pair is string => Boolean(pair))
    .join('; ')
}

/**
 * Drives a full sign-in-with-Google flow against a REAL `buildAuth()`
 * instance and returns the single `better-auth.session_token=...` (or
 * `__Secure-...`) cookie pair the resulting session cookie sets — suitable
 * for use directly as a raw `Cookie` header value in
 * AccessCacheService.resolveSession() / VerifyService.decide() calls.
 *
 * `authHost` is passed explicitly (not read from `process.env.AUTH_HOST`
 * inside this function) so this helper stays a plain function of its
 * arguments, mirroring src/auth/redirect.ts's own "no env reads inside
 * this module" rationale for test predictability.
 */
export async function signInAndGetSessionCookiePair(
  auth: Auth,
  authHost: string,
  profile: { sub: string; email: string },
): Promise<string> {
  const signInResponse = await auth.handler(
    new Request(`${authHost}${AUTH_PATH_SEGMENT}/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
    }),
  )
  const signInBody = (await signInResponse.json()) as { url: string }
  const state = new URL(signInBody.url).searchParams.get('state')
  if (!state) {
    throw new Error('expected sign-in response to carry a state')
  }
  const signInCookie = cookieHeaderFromSetCookies(
    signInResponse.headers.getSetCookie(),
  )

  const idToken = fakeGoogleIdToken(profile)
  const fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockImplementation(async input => {
      const href =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (href.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'fake-google-access-token',
            id_token: idToken,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid email profile',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`Unexpected fetch call in test: ${href}`)
    })
  try {
    const callbackResponse = await auth.handler(
      new Request(
        `${authHost}${AUTH_PATH_SEGMENT}/callback/google?state=${encodeURIComponent(state)}&code=fake-google-auth-code`,
        { headers: { cookie: signInCookie } },
      ),
    )
    const setCookies = callbackResponse.headers.getSetCookie()
    const sessionCookie = setCookies.find(cookie =>
      cookie.includes('session_token'),
    )
    if (!sessionCookie) {
      throw new Error('expected callback to set a session_token cookie')
    }
    const pair = sessionCookie.split(';')[0]
    if (!pair) {
      throw new Error('expected a non-empty session cookie pair')
    }
    return pair
  } finally {
    fetchSpy.mockRestore()
  }
}
