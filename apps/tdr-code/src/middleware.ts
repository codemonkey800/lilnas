import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { EnvKeys } from 'src/env'

// Cheap COOKIE-PRESENCE page gate (R19: pages deny-by-default). This is
// deliberately NOT a session validation — Next's edge runtime cannot run
// better-sqlite3 (the driver Better Auth's session lookup needs), so the
// only thing this file may ever do is check whether the exact session
// cookie is present. The REAL enforcement is the NestJS global guard
// (src/auth/auth.guard.ts, U4), which calls auth.api.getSession() on every
// /api/* request — this middleware is UX only: it keeps an unauthenticated
// visitor from ever seeing a page shell that would immediately start
// 401ing. A stale-but-present cookie that fails real validation is caught
// by src/app/lib/api.ts's redirect-on-401 handler instead.
//
// EXACT session cookie name — confirmed from installed better-auth 1.6.23
// source (better-auth/dist/cookies/index.mjs's createCookieGetter /
// getCookies), not assumed or guessed:
//   - `prefix = options.advanced?.cookiePrefix || "better-auth"` — auth.ts
//     never sets `advanced.cookiePrefix`, so prefix = "better-auth".
//   - `name = options.advanced?.cookies?.[cookieName]?.name ||
//      \`${prefix}.${cookieName}\`` — never overridden here, and the
//      session-token cookie's `cookieName` is literally "session_token", so
//      name = "better-auth.session_token".
//   - The "__Secure-" prefix is NOT a fixed constant — better-auth derives
//     it PER-DEPLOYMENT from `baseURL`'s own scheme
//     (dist/cookies/index.mjs:21: `baseURLString.startsWith("https://")`),
//     where `baseURL` is built from the SAME `BETTER_AUTH_URL` env var
//     auth.ts reads (`baseURL: \`${betterAuthUrl}${PUBLIC_AUTH_PATH_SEGMENT}\``).
//     Confirmed empirically by calling the installed package's own exported
//     `getCookies()` with this app's real dev vs. prod values:
//       BETTER_AUTH_URL=http://localhost:8082      -> "better-auth.session_token"
//       BETTER_AUTH_URL=https://tdr-code.lilnas.io -> "__Secure-better-auth.session_token"
//     A prior version of this file hardcoded the "__Secure-" form
//     unconditionally. That matches production, but silently broke local
//     dev (BETTER_AUTH_URL=http://localhost:...): Better Auth genuinely set
//     the unprefixed cookie, this gate looked for the prefixed name, never
//     found it, and redirected to /login on every request — including the
//     request immediately after a successful Discord login. Re-deriving
//     the prefix from the same env var Better Auth itself keys off means
//     the two can never drift apart again.
export function getSessionCookieName(betterAuthUrl: string): string {
  const prefix = betterAuthUrl.startsWith('https://') ? '__Secure-' : ''
  return `${prefix}better-auth.session_token`
}

// Matching this EXACT literal (not a substring/prefix check against "any
// better-auth-ish cookie") is load-bearing: a half-completed OAuth
// round-trip leaves transient cookies (e.g. Better Auth's own internal
// state-tracking artifacts) with no session cookie, and that request must
// still redirect to /login — a substring match risks treating any
// better-auth-prefixed cookie as "signed in".
export const SESSION_COOKIE_NAME = getSessionCookieName(
  process.env[EnvKeys.BETTER_AUTH_URL] ?? '',
)

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // The matcher below only excludes /api, /_next/static, /_next/image, and
  // favicon.ico — it does NOT exclude /login (the yoink precedent this
  // mirrors instead excludes /login via an in-body pathname check, not the
  // matcher, and that's replicated here). Without this check, an
  // unauthenticated visit to /login would itself have no session cookie,
  // triggering a redirect to /login — an infinite self-redirect loop that
  // never lets anyone reach the login page at all.
  if (pathname === '/login') {
    return NextResponse.next()
  }

  const hasSessionCookie = req.cookies.has(SESSION_COOKIE_NAME)

  if (!hasSessionCookie) {
    const loginUrl = new URL('/login', req.nextUrl.origin)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

// Matcher mirrors apps/yoink/src/proxy.ts's precedent: EXCLUDE all of
// `/api/*` from ever reaching this middleware at all (rather than reaching
// it and allowlisting `/api/auth/*` + `/api/health` individually). Chosen
// over the "cover /api and allowlist within it" alternative the plan poses
// as the other option, because:
//   - It's the simpler, proven shape (this is the plan's own stated
//     preference: "Mirroring yoink is the simpler, proven choice").
//   - `/api/health`'s public-ness is then purely a NestJS-side @Public()
//     concern (U4) — this middleware never needs to know that route exists.
//     The Docker healthcheck hits `http://host.docker.internal:8080/api/health`
//     (deploy.yml) — under this matcher that request never reaches this
//     file, so there's no risk of a 3xx redirect breaking the probe.
//   - `/api/auth/*` (the OAuth sign-in/callback/sign-out/get-session
//     handler) never risks being redirected mid-flow — same reasoning.
// `/_next/static/*`, `/_next/image/*`, and `/favicon.ico` are excluded by
// the matcher so an unauthenticated visitor's static assets load without a
// redirect. `/login` is deliberately NOT excluded by the matcher — it IS
// covered by it — so the in-body `pathname === '/login'` early-return above
// is what lets a login-page visit through instead (mirroring yoink's
// proxy.ts, which does the same exclusion inside the function body, not the
// matcher).
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
