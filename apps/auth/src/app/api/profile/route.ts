import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'
import type { MeResponse } from 'src/me/me.controller'

import { corsHeaders, resolveAllowedOrigin } from './cors'

// A Next Route Handler, not a Nest controller — deliberately, because Next
// is the only publicly-routable HTTP surface of this container. `/me`
// (src/me/me.controller.ts) is Nest-only: next.config.js rewrites just
// `/api/auth/:path*` and `/api/sse/:path*`, so `/me` has no public route at
// all and is reachable only server-side, from src/app/lib/require-session.ts's
// fetchMe(). CORS-enabling `/me` itself was rejected for a second reason
// beyond routing: its MeResponse is documented there as the payload for
// "the redesigned home and pending pages" and is actively accreting fields
// (isAdmin, blockedAt, grants, pendingRequests) — an internal UI payload
// that would become cross-origin readable by default with every future
// field. This route instead re-fetches /me the exact same way fetchMe()
// already does and projects it down to only the fields a cross-origin
// caller (nexus-code — infra/nexus-code.yml, infra/nexus-code-mbp.yml)
// actually needs to render a user bubble/byline.
//
// `force-dynamic` because the response depends on a per-request Cookie
// header and must never be statically cached or optimized away by Next.
export const dynamic = 'force-dynamic'

function profileHeaders(allowedOrigin: string | null): Record<string, string> {
  return {
    // Per-user data — never cached, regardless of CORS outcome.
    'Cache-Control': 'no-store',
    ...corsHeaders(allowedOrigin),
  }
}

export async function GET(request: Request): Promise<Response> {
  const allowedOrigin = resolveAllowedOrigin(
    request.headers.get('origin'),
    env(EnvKeys.PROFILE_ALLOWED_ORIGINS, ''),
  )

  try {
    const cookie = request.headers.get('cookie') ?? ''
    const meRes = await fetch(
      `http://localhost:${env(EnvKeys.BACKEND_PORT)}/me`,
      { headers: { cookie }, cache: 'no-store' },
    )

    // Passed through as a 401, deliberately NOT a redirect('/login') the
    // way fetchMe() behaves for a page render — this is an API response
    // for a cross-origin caller, which has no login page to navigate to.
    // CORS headers are attached here too: without them, a real 401
    // surfaces in the caller's JS as an opaque network error instead of a
    // readable, catchable 401.
    if (meRes.status === 401) {
      return new Response(null, {
        status: 401,
        headers: profileHeaders(allowedOrigin),
      })
    }
    if (!meRes.ok) {
      return new Response(null, {
        status: 502,
        headers: profileHeaders(allowedOrigin),
      })
    }

    const me = (await meRes.json()) as MeResponse
    return new Response(
      JSON.stringify({ name: me.name, email: me.email, image: me.image }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...profileHeaders(allowedOrigin),
        },
      },
    )
  } catch {
    // A thrown error (e.g. the internal fetch itself failing) would
    // otherwise fall through to Next's default error response, which
    // carries none of the headers above — silently breaking the "every
    // response, including 5xx" CORS contract this route exists to provide.
    return new Response(null, {
      status: 500,
      headers: profileHeaders(allowedOrigin),
    })
  }
}

// Not strictly required today — a plain GET with no custom request headers
// is a CORS "simple request" and triggers no browser preflight — but this
// is cheap insurance against the route silently breaking if a future
// caller adds a request header.
export function OPTIONS(request: Request): Response {
  const allowedOrigin = resolveAllowedOrigin(
    request.headers.get('origin'),
    env(EnvKeys.PROFILE_ALLOWED_ORIGINS, ''),
  )

  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(allowedOrigin),
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Max-Age': '86400',
    },
  })
}
