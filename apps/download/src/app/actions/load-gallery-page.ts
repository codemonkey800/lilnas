'use server'

import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import type { LoadGalleryPageResult } from 'src/lib/gallery-filters'
import {
  galleryFiltersToQuery,
  parseGalleryFilters,
} from 'src/lib/gallery-filters'

/**
 * Appends one page to the gallery grid.
 *
 * A server action rather than a `fetch` from the browser, for the same reason
 * every other write in this app is one: the request has to carry the viewer's
 * forwarded identity, and only the server side of Next has it. A direct
 * `/api/download/gallery` call from the browser would arrive at the backend
 * without `X-Forwarded-User`, and `projectJobForViewer` would mask the
 * attribution on every appended card while the first page's cards — rendered
 * through `getIdentifiedDownloadClient()` — kept theirs. Half the grid would
 * silently disagree with the other half about who uploaded what.
 *
 * The filters arrive as the raw query string the page is currently at and are
 * re-parsed here rather than accepted as a structured object. A server action
 * is a real public endpoint, so nothing the browser sends is trusted; running
 * the same `parseGalleryFilters` the page ran means a crafted call can only
 * ever describe a filter the URL could have described anyway.
 */
export async function loadGalleryPage(
  search: string,
  cursor: string,
): Promise<LoadGalleryPageResult> {
  const filters = parseGalleryFilters(new URLSearchParams(search))

  // Outside the `try`: `headers()` signals a static-generation bailout by
  // throwing a value carrying a `digest`, and swallowing one of those would
  // turn "render this route dynamically" into a user-facing error message. See
  // the same note in `src/app/actions/start-video-download.ts`.
  const client = await getIdentifiedDownloadClient()

  try {
    const page = await client.getGallery(galleryFiltersToQuery(filters, cursor))

    return {
      items: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
    }
  } catch (error) {
    console.error('[load-gallery-page] GET /download/gallery failed', error)

    // Deliberately not the inverted-range message: a cursor is only ever
    // handed out by a request that already succeeded, so a range the backend
    // accepted once cannot be the reason this call failed.
    return { error: 'Could not load more — try again' }
  }
}
