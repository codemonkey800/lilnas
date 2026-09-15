'use server'

import type { DiscoveryPage } from '@lilnas/utils/download/types'

import {
  hasValidYearRange,
  isSearchableQuery,
  parseSearchState,
  toDiscoverQuery,
} from 'src/components/search/search-params'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

/**
 * What a rejected or impossible request answers with, rather than throwing
 * into the client's transition.
 *
 * ⚠️ This is a `'use server'` module, so it may *export* nothing but async
 * functions — which is why this stays module-private rather than being shared
 * with the page. Only `export type` would survive here, and it erases.
 */
const EMPTY_PAGE: DiscoveryPage = {
  degradedSources: [],
  facets: { genres: [] },
  items: [],
  nextCursor: null,
  total: 0,
}

/**
 * Fetch one more page of discovery results for the query currently in the URL.
 *
 * The state is passed as the page's own **query string** and re-parsed here
 * rather than handed over as a structured object. A server action is a real
 * public endpoint, so the input is untrusted either way — and re-parsing means
 * `parseSearchState` is the one place that decides what `?sort=banana` means,
 * for the first page and every page after it alike.
 *
 * Returns an empty page rather than throwing when the query is too short or
 * the year range is inverted. Both are states the *page* already renders
 * properly; a throw here would blow past that into the error boundary on
 * behalf of a button the user could only reach if results were already on
 * screen.
 */
export async function loadMoreDiscoverResults(
  search: string,
  cursor: string,
): Promise<DiscoveryPage> {
  const state = parseSearchState(new URLSearchParams(search))

  if (!isSearchableQuery(state.query) || !hasValidYearRange(state)) {
    return EMPTY_PAGE
  }

  // ⚠️ `getIdentifiedDownloadClient()`, never `DownloadClient.localInstance` —
  // the plain client drops the `X-Forwarded-User` pair Traefik set on this
  // request. Outside any `try`, because `headers()` signals a static-generation
  // bailout by throwing a value carrying a `digest`, and swallowing one of
  // those is never right (see `src/lib/viewer.ts`).
  const client = await getIdentifiedDownloadClient()

  return client.getDiscover(toDiscoverQuery(state, cursor))
}
