import { DownloadApiError } from '@lilnas/utils/download/client'
import type {
  DownloadGalleryFacets,
  GalleryItem,
} from '@lilnas/utils/download/types'

import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import type { GalleryFilters } from 'src/lib/gallery-filters'
import {
  galleryFiltersToQuery,
  INVALID_RANGE_MESSAGE,
} from 'src/lib/gallery-filters'

/**
 * Whether a thrown value is the API rejecting the date range, as opposed to any
 * other failure.
 *
 * An inverted range is a deliberate 400 rather than an empty page (see
 * `isOrderedDateRange` in `packages/utils/src/download/schema.ts`): an empty
 * result would be indistinguishable from "nothing was downloaded in that
 * window", which is a lie about the library. So it is recognized here and
 * turned into a validation message on the field that caused it, and *only* it —
 * every other 400 and every 5xx keeps propagating to the error boundary, where
 * an unexpected failure belongs.
 *
 * The body is inspected rather than the status alone, because the same endpoint
 * answers 400 for a malformed cursor too, and "the start date must not be after
 * the end date" would be a confusing thing to say about one of those.
 */
export function isInvertedRangeError(error: unknown): boolean {
  if (!(error instanceof DownloadApiError) || error.status !== 400) {
    return false
  }

  const body = error.body

  if (typeof body !== 'object' || body === null) {
    return false
  }

  const errors = (body as { errors?: unknown }).errors

  if (!Array.isArray(errors)) {
    return false
  }

  return errors.some(entry => {
    const path = (entry as { path?: unknown }).path

    return (
      Array.isArray(path) &&
      path.some(segment => segment === 'from' || segment === 'to')
    )
  })
}

/**
 * Everything `/gallery` needs for one render.
 *
 * `items` and `total` are `null` in exactly one case — the range the URL asks
 * for is inverted, so there is no answer to show and `rangeError` says why.
 * `null` rather than `[]`/`0` on purpose: an empty array further down the page
 * would render the "no matches" empty state, which is the one thing that
 * mis-describes this situation.
 */
export type GalleryView = {
  facets: DownloadGalleryFacets
  items: GalleryItem[] | null
  nextCursor: string | null
  /** The instant every relative timestamp on the page is measured against. */
  now: number
  rangeError: string | null
  total: number | null
}

/**
 * Facets are computed over the **date range only**, never over the selected
 * type or uploader, so narrowing by one facet never empties the others out from
 * under the user. That is a backend guarantee (`DownloadGalleryFacets`), and
 * the only thing this side has to do is not undo it by passing the rest of the
 * filter through.
 */
function facetsQuery(filters: GalleryFilters): { from?: Date; to?: Date } {
  const { from, to } = galleryFiltersToQuery(filters)

  return { from, to }
}

/**
 * Loads the first page of the gallery plus the facet vocabulary for the current
 * date window.
 *
 * `now` is pinned here, once, and threaded down to every card. `formatRelative`
 * defaults to `Date.now()`, and a grid of cards each resolving that for itself
 * would produce one instant on the server and a different one in the browser —
 * a hydration mismatch on every `12m ago` stamp on the page.
 *
 * ⚠️ `getIdentifiedDownloadClient()`, never `DownloadClient.localInstance`: the
 * gallery's `lastRequester` is masked per-viewer server-side, and a client with
 * no forwarded identity would be masked as an anonymous service caller.
 */
export async function loadGalleryView(
  filters: GalleryFilters,
): Promise<GalleryView> {
  const client = await getIdentifiedDownloadClient()
  const now = Date.now()

  try {
    const [page, facets] = await Promise.all([
      client.getGallery(galleryFiltersToQuery(filters)),
      client.getGalleryFacets(facetsQuery(filters)),
    ])

    return {
      facets,
      items: page.items,
      nextCursor: page.nextCursor,
      now,
      rangeError: null,
      total: page.total,
    }
  } catch (error) {
    if (!isInvertedRangeError(error)) {
      throw error
    }

    // The facets are refetched with no window at all rather than reused from
    // the failed call, which returned nothing. Without them the panel would
    // lose its entire vocabulary at the exact moment the user needs it to fix
    // the range they just broke.
    return {
      facets: await client.getGalleryFacets(),
      items: null,
      nextCursor: null,
      now,
      rangeError: INVALID_RANGE_MESSAGE,
      total: null,
    }
  }
}
