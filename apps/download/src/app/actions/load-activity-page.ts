'use server'

import type { LoadActivityPageResult } from 'src/lib/activity-filters'
import {
  activityFiltersToQuery,
  parseActivityFilters,
} from 'src/lib/activity-filters'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

/**
 * Appends one page to the activity feed.
 *
 * A server action rather than a `fetch` from the browser, for the same reason
 * every other read-with-identity in this app is one: `projectJobForViewer`
 * masks `DownloadJob.requester` per viewer, and only the server side of Next
 * holds the forwarded identity. A direct `/api/download/activity` call from the
 * browser would arrive without `X-Forwarded-User`, so an admin would see the
 * true requester on the first page and a masked one on every appended page.
 *
 * The filter arrives as the raw query string the page is currently at and is
 * re-parsed here rather than accepted as a structured object. A server action is
 * a real public endpoint, so running the same `parseActivityFilters` the page
 * ran means a crafted call can only ever describe a filter the URL could have
 * described anyway.
 */
export async function loadActivityPage(
  search: string,
  cursor: string,
): Promise<LoadActivityPageResult> {
  const filters = parseActivityFilters(new URLSearchParams(search))

  // Outside the `try`: `headers()` signals a static-generation bailout by
  // throwing a value carrying a `digest`, and swallowing one of those would
  // turn "render this route dynamically" into a user-facing error message. See
  // the same note in `src/app/actions/load-gallery-page.ts`.
  const client = await getIdentifiedDownloadClient()

  try {
    const page = await client.getActivity(
      activityFiltersToQuery(filters, cursor),
    )

    return {
      items: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
    }
  } catch (error) {
    console.error('[load-activity-page] GET /download/activity failed', error)

    return { error: 'Could not load more — try again' }
  }
}
