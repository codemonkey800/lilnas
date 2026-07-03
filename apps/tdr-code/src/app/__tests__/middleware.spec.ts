import { NextRequest } from 'next/server'

import {
  config as middlewareConfig,
  getSessionCookieName,
  middleware,
  SESSION_COOKIE_NAME,
} from 'src/middleware'

const ORIGIN = 'https://tdr-code.lilnas.io'

function makeRequest(path: string, cookieHeader?: string): NextRequest {
  // Typed via NextRequest's own constructor parameter (Next ships its own
  // narrower RequestInit type — distinct from the global DOM RequestInit —
  // so an intermediate `const init: RequestInit` object would mismatch);
  // letting the object literal's type be inferred in-place at the call
  // site avoids that mismatch entirely.
  return new NextRequest(
    new URL(path, ORIGIN),
    cookieHeader ? { headers: { cookie: cookieHeader } } : undefined,
  )
}

describe('middleware (cookie-presence page gate)', () => {
  it('redirects to /login when visiting / with no session cookie', () => {
    const res = middleware(makeRequest('/'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login`)
  })

  it('lets a request through when the exact session cookie is present', () => {
    const res = middleware(
      makeRequest('/', `${SESSION_COOKIE_NAME}=some-signed-token-value`),
    )
    // NextResponse.next() carries no Location header and (per Next's own
    // convention) a 200-ish "pass through" marker rather than a redirect
    // status — asserting the ABSENCE of a redirect is the load-bearing
    // check here, not a specific status code Next's internals may format
    // differently across versions.
    expect(res.headers.get('location')).toBeNull()
  })

  it('redirects when only a transient/non-session OAuth cookie is present (no exact-name match)', () => {
    // Simulates a half-completed OAuth round-trip: Better Auth's `database`
    // state strategy (kept per auth.ts) means state itself isn't a cookie,
    // but this still proves the matcher is an EXACT name check, not a
    // substring/prefix check against "any better-auth-ish cookie" — a
    // cookie that merely contains "better-auth" must not be treated as a
    // valid session.
    const res = middleware(
      makeRequest(
        '/',
        '__Secure-better-auth.dont_remember=true; better-auth.session_data=abc',
      ),
    )
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login`)
  })

  it('does not redirect a visit to /login itself (no self-redirect loop)', () => {
    const res = middleware(makeRequest('/login'))
    expect(res.headers.get('location')).toBeNull()
  })

  describe('matcher excludes /api/* entirely (Nest-side @Public() owns /api/health)', () => {
    it.each([
      '/api/health',
      '/api/auth/sign-in/social',
      '/api/auth/callback/discord',
      '/api/live',
      '/api/config',
    ])('matcher does not cover %s', path => {
      const matches = matchesConfiguredMatcher(path)
      expect(matches).toBe(false)
    })
  })

  describe('matcher still covers ordinary pages and /login', () => {
    it.each(['/', '/sessions', '/config', '/git-identity', '/login'])(
      'matcher covers %s',
      path => {
        expect(matchesConfiguredMatcher(path)).toBe(true)
      },
    )
  })
})

// Regression coverage for the dev-mode redirect-loop bug: this file
// previously hardcoded SESSION_COOKIE_NAME to the "__Secure-"-prefixed form,
// which only matches what better-auth actually sets when BETTER_AUTH_URL is
// https:// (production). Every test above exercises the module-load-time
// SESSION_COOKIE_NAME constant, which resolves once per process — it can't
// observe a different BETTER_AUTH_URL without a module reset. Testing the
// pure getSessionCookieName() function directly, with explicit inputs,
// covers the branch those tests structurally cannot: local dev
// (BETTER_AUTH_URL=http://localhost:...), where better-auth drops the
// prefix entirely.
describe("getSessionCookieName (mirrors better-auth's own secureCookiePrefix branch)", () => {
  it('drops the "__Secure-" prefix for an http:// BETTER_AUTH_URL (local dev)', () => {
    expect(getSessionCookieName('http://localhost:8082')).toBe(
      'better-auth.session_token',
    )
  })

  it('adds the "__Secure-" prefix for an https:// BETTER_AUTH_URL (production)', () => {
    expect(getSessionCookieName('https://tdr-code.lilnas.io')).toBe(
      '__Secure-better-auth.session_token',
    )
  })

  it('treats an empty/unset BETTER_AUTH_URL as non-secure rather than throwing', () => {
    expect(getSessionCookieName('')).toBe('better-auth.session_token')
  })
})

// Next's `config.matcher` is consumed by Next's own build-time routing
// manifest, not by calling `middleware()` directly — there is no exported
// Next API to ask "would the matcher apply to this path" outside a full
// Next dev/build server. This test instead evaluates the EXACT matcher
// pattern string that ships in src/middleware.ts's `config.matcher` as a
// plain JavaScript RegExp. That's valid here specifically because this
// pattern contains no path-to-regexp `:param`-style tokens — it's a single
// literal negative-lookahead group
// (`/((?!api|_next/static|_next/image|favicon.ico).*)`), which is already
// syntactically valid vanilla regex as-is (confirmed by constructing it
// directly with `new RegExp` and checking it against representative paths —
// no path-to-regexp-specific compilation step is needed for this
// particular literal). Reading the pattern from `middlewareConfig.matcher`
// itself (not a second hand-typed copy of the literal) means a future edit
// to the real matcher is exactly what this test would catch.
function matchesConfiguredMatcher(path: string): boolean {
  const [pattern] = middlewareConfig.matcher
  const regex = new RegExp(`^${pattern}$`)
  return regex.test(path)
}
