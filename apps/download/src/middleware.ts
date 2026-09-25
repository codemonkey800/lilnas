import { type NextRequest, NextResponse } from 'next/server'

import {
  isMediaRouteKind,
  mediaIdFromRoute,
  type MediaRouteKind,
} from 'src/lib/media-route'

/**
 * A path no route answers, so Next serves the root `not-found.tsx` for it the
 * same way it serves `/no-such-route`: a real `404` with a server-rendered body.
 */
export const NOT_FOUND_REWRITE = '/__not-found__'

/**
 * Refuses a malformed detail-route segment before the page ever renders.
 *
 * ⚠️ **This is the status-code fix, not the security boundary.** Each detail
 * route ships a `loading.tsx`, so Next streams the shell — and commits a `200`
 * — before the page's own `mediaIdFromRoute` guard gets to call `notFound()`
 * (plan 013, H3). A rewrite here never throws, so the answer is a true `404`
 * and every skeleton stays. The page-level guards remain, unchanged, as the
 * check the pages document and the unit tests exercise.
 *
 * Only the *shape* of the segment is checked. Whether a well-formed id names
 * anything needs a fetch, and middleware is the wrong place for one.
 */
export function middleware(request: NextRequest): NextResponse {
  const [, kind = '', segment = ''] = request.nextUrl.pathname.split('/')

  if (isMediaRouteKind(kind) && isValidSegment(kind, segment)) {
    return NextResponse.next()
  }

  return NextResponse.rewrite(new URL(NOT_FOUND_REWRITE, request.url))
}

/**
 * The page sees its param percent-decoded, so the segment is decoded here too
 * — otherwise `/movies/%31` would be refused here and accepted by the page. A
 * sequence that does not decode at all is simply malformed.
 */
function isValidSegment(kind: MediaRouteKind, segment: string): boolean {
  try {
    return mediaIdFromRoute(kind, decodeURIComponent(segment)) !== null
  } catch {
    return false
  }
}

export const config = {
  matcher: ['/movies/:id', '/shows/:id', '/videos/:id'],
}
