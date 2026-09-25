import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import {
  DegradedSourcesNote,
  NoMatchesNote,
  ShortQueryNote,
} from 'src/components/search/search-notes'
import {
  hasValidYearRange,
  isSearchableQuery,
  parseSearchState,
  searchStateKey,
  toDiscoverQuery,
  toReadableSearchParams,
  YEAR_RANGE_ERROR,
} from 'src/components/search/search-params'
import { SearchResults } from 'src/components/search/search-results'
import { SearchToolbar } from 'src/components/search/search-toolbar'
import { Note } from 'src/components/ui/card'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

/**
 * Every render of this page calls a per-viewer backend through
 * `headers()`, so there is nothing here that could ever be prerendered.
 * Stating it keeps the failure mode a config line rather than a confusing
 * bailout at build time.
 */
export const dynamic = 'force-dynamic'

const LOUD_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * `/search` — movie and show discovery.
 *
 * The whole page is a function of the URL. `?q=` carries the query (the
 * spelling `NavSearch` pushes), `?genre=`/`?yearFrom=`/`?yearTo=` the filters,
 * `?sort=` and `?view=` the rest — and nothing on the page holds a second copy
 * of any of it. The hero lives in `layout.tsx`, above the loading boundary;
 * see the note there for why.
 *
 * ## The two-character floor
 *
 * `DiscoverQuerySchema` requires `query: z.string().min(2)` and answers
 * `400 too_small` below it, so the call is simply not made. That check lives
 * here, once, rather than in the field: the field is one of several ways a
 * query can arrive (`NavSearch` pushes one from any other route, and so does a
 * bookmark), and the page is the only place all of them pass through.
 *
 * ⚠️ The page's parameter is `q`; the API's is `query`. `toDiscoverQuery()` is
 * the single place the two are bridged.
 */
export default async function SearchPage({
  searchParams,
}: SearchPageProps): Promise<JSX.Element> {
  const state = parseSearchState(toReadableSearchParams(await searchParams))

  if (!isSearchableQuery(state.query)) {
    // Nothing typed yet is not a state worth narrating — the hero above is
    // already the whole invitation. One character is, because the field looks
    // like it should be working.
    return state.query.length === 0 ? (
      <></>
    ) : (
      <ShortQueryNote className="mt-[22px] sm:mt-[30px]" />
    )
  }

  if (!hasValidYearRange(state)) {
    // Only reachable by hand-editing the URL — the filter panel disables its
    // own confirm on an inverted range. The API refines this and 400s, so it
    // is caught before the call rather than through the error boundary.
    return (
      <Note className={cns('mt-[22px] sm:mt-[30px]', LOUD_NOTE)} role="status">
        <b className="text-ink">{YEAR_RANGE_ERROR}.</b> Widen the release-year
        range and the results will come back.
      </Note>
    )
  }

  const client = await getIdentifiedDownloadClient()
  const page = await client.getDiscover(toDiscoverQuery(state))

  return (
    <>
      {/* Above the count, because it is the count that it qualifies. */}
      <DegradedSourcesNote
        className="mt-[22px] sm:mt-[30px]"
        degradedSources={page.degradedSources}
      />
      <SearchToolbar
        facets={page.facets}
        showViewToggle={page.total > 0}
        state={state}
        total={page.total}
      />
      {page.total === 0 ? (
        <NoMatchesNote query={state.query} />
      ) : (
        <SearchResults
          initialPage={page}
          // Resets the merged pages by remount whenever the *result set*
          // changes. `view` is excluded — see `searchStateKey`.
          key={searchStateKey(state)}
          state={state}
        />
      )}
    </>
  )
}
