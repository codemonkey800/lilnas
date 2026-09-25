'use server'

import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import {
  FOREIGN_PROFILE_ERROR,
  isForbiddenProfileError,
} from 'src/lib/profile-data'
import type { LoadProfileHistoryResult } from 'src/lib/profile-filters'
import {
  parseProfileFilters,
  profileHistoryQuery,
} from 'src/lib/profile-filters'
import { getViewer } from 'src/lib/viewer'

/**
 * Appends one page to a profile's download history.
 *
 * A server action rather than a `fetch` from the browser, for the same reason
 * every other read-with-identity in this app is one: the backend masks a job's
 * `requester` per viewer, and only the server side of Next holds the forwarded
 * identity. A direct `/api/download/history` call from the browser would arrive
 * without `X-Forwarded-User`, so the first page and every appended page would
 * be masked differently.
 *
 * The filter arrives as the raw query string the page is currently at and is
 * re-parsed here rather than accepted as a structured object. A server action is
 * a real public endpoint, so running the same `parseProfileFilters` the page ran
 * means a crafted call can only ever describe a filter the URL could have
 * described anyway.
 *
 * ⚠️ The **target** is re-derived here too, and is never taken from the client:
 * `?user=` if the URL names somebody, otherwise the viewer's own email from
 * `whoami`. Accepting a requester as an argument would turn this action into an
 * unguarded "read anyone's history" endpoint — the 403 that protects
 * `getProfile` sits on that route, not on `/download/history`.
 */
export async function loadProfileHistory(
  search: string,
  cursor: string,
): Promise<LoadProfileHistoryResult> {
  const filters = parseProfileFilters(new URLSearchParams(search))

  // Outside the `try`, both: `headers()` signals a static-generation bailout by
  // throwing a value carrying a `digest`, and swallowing one of those would turn
  // "render this route dynamically" into a user-facing error message. See the
  // same note in `src/app/actions/load-gallery-page.ts`.
  const [viewer, client] = await Promise.all([
    getViewer(),
    getIdentifiedDownloadClient(),
  ])

  const requester = filters.user ?? viewer?.email ?? null

  if (requester === null) {
    return { error: 'Could not load more — sign in and try again' }
  }

  try {
    const page = await client.getHistory(
      profileHistoryQuery(filters, requester, cursor),
    )

    return {
      items: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
    }
  } catch (error) {
    if (isForbiddenProfileError(error)) {
      return { error: FOREIGN_PROFILE_ERROR }
    }

    console.error('[load-profile-history] GET /download/history failed', error)

    return { error: 'Could not load more — try again' }
  }
}
