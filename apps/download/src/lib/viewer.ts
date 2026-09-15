import type { WhoamiResponse } from '@lilnas/utils/auth/types'
import { cache } from 'react'

import { getIdentifiedDownloadClient } from 'src/lib/download-client'

/**
 * Who the backend believes is looking at the page: the forwarded identity plus
 * admin status, exactly as `GET /auth/whoami` answers it.
 *
 * An alias rather than a re-declaration so the shell and the backend can never
 * drift — `isAdmin` in particular must always come from the backend and never
 * be inferred from an email list on this side.
 */
export type Viewer = WhoamiResponse

/**
 * Next.js signals control flow by *throwing*, and every one of those thrown
 * values carries a `digest` string: the static-generation bailout when
 * `headers()` is read during a prerender, plus `redirect()` and `notFound()`.
 *
 * Catching one of those and answering `null` would convert "render this route
 * dynamically" into "this viewer has no identity", and `next build` would
 * prerender the shell with the account link permanently missing. Nothing this
 * module legitimately swallows has a `digest`, so re-throwing on its presence
 * is both safe and deliberately conservative — an unfamiliar error that
 * happens to carry one propagates rather than being quietly absorbed.
 */
function isNextControlFlow(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === 'string'
  )
}

/**
 * The uncached body of `getViewer`. Separate only so the `cache()` wrapper
 * below reads as the one-line decision it is.
 *
 * `whoami()` throws rather than returning `null` when there is no forwarded
 * identity, and there are two realistic ways to hit that:
 *
 *   - dev without `DEV_USER_EMAIL`/`DEV_USER_ID`, where nothing sets
 *     `X-Forwarded-User` (there is no `lilnas-auth` in dev — see
 *     `infra/proxy.yml`), so `ForwardedUserGuard` answers 401 and the client
 *     turns that into a `DownloadApiError`;
 *   - prod during an auth blip, where the same 401 arrives for a moment.
 *
 * Neither is worth taking the whole app down for. The shell degrades to a bar
 * with no account link instead, so the doorplate and the page still render.
 * `getIdentifiedDownloadClient()` is inside the `try` on purpose: `headers()`
 * throws too when called outside a request scope, and that failure mode wants
 * the same treatment.
 *
 * The failure is logged rather than swallowed silently — an auth outage that
 * produces no server-side signal at all is how a five-minute incident becomes
 * an afternoon of guessing.
 */
async function loadViewer(): Promise<Viewer | null> {
  try {
    const client = await getIdentifiedDownloadClient()

    return await client.whoami()
  } catch (error) {
    if (isNextControlFlow(error)) {
      throw error
    }

    console.warn(
      '[viewer] GET /auth/whoami failed; rendering without an identity',
      error,
    )

    return null
  }
}

/**
 * The viewer for this request, or `null` when there is no forwarded identity.
 *
 * Wrapped in `React.cache()` so the resolution happens once per request no
 * matter how many server components ask. The root layout always asks (it needs
 * the initials for the account link) and any page that needs `isAdmin` asks
 * again; without the cache that would be two HTTP round trips to the backend on
 * every single render.
 *
 * ⚠️ The memoization is a property of the React *server* request scope. Calling
 * this outside a render — a unit test, a script — still works, it just calls
 * through every time.
 */
export const getViewer: () => Promise<Viewer | null> = cache(loadViewer)
