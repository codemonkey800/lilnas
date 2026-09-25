'use client'

import type { DiscoveryPage } from '@lilnas/utils/download/types'
import { usePathname, useRouter } from 'next/navigation'
import type { JSX } from 'react'
import { useState, useTransition } from 'react'

import { loadMoreDiscoverResults } from 'src/app/search/actions'
import { ResultGrid } from 'src/components/search/result-grid'
import { ResultTable } from 'src/components/search/result-table'
import type {
  SearchSort,
  SearchState,
} from 'src/components/search/search-params'
import { searchStateToQueryString } from 'src/components/search/search-params'
import { Icon } from 'src/components/ui/icon'
import { LoadMore } from 'src/components/ui/load-more'

/** `search.pug:105`'s only error idiom — alert glyph, mono, `text-bad`. */
const LOAD_ERROR =
  'mt-3 flex items-center justify-center gap-[5px] font-mono text-[11px] text-bad'

const LOAD_FAILED = 'Could not load more results — try again'

export type SearchResultsProps = {
  /** The page the server rendered for the URL as it currently stands. */
  initialPage: DiscoveryPage
  state: SearchState
}

/**
 * The results themselves, in whichever view the URL asks for, plus the control
 * that appends the next page.
 *
 * ## Why this holds state at all, and how it resets
 *
 * Everything else on `/search` reads the URL and writes the URL. This one
 * component cannot: `LoadMore` merges page 2 onto page 1 on the client, and
 * that merged list has no URL to live in. It resets by **remount** — the page
 * renders `<SearchResults key={searchStateKey(state)} …>`, so a new query,
 * genre, year or sort throws this instance away and builds a fresh one from
 * the server's first page.
 *
 * That is why there is no effect here watching `initialPage` and calling
 * `setItems`. Such an effect is rejected by `react-hooks/set-state-in-effect`,
 * and it would paint one frame of the previous query's rows underneath the new
 * query's count. `key` does the same job, earlier, with no code.
 *
 * `view` is deliberately *not* part of that key: switching between the grid
 * and the table is a way of looking at rows you already have, and must not
 * throw away the pages you loaded to get them.
 */
export function SearchResults({
  initialPage,
  state,
}: SearchResultsProps): JSX.Element {
  const router = useRouter()
  const pathname = usePathname()

  const [items, setItems] = useState(initialPage.items)
  const [cursor, setCursor] = useState(initialPage.nextCursor)
  const [total, setTotal] = useState(initialPage.total)
  const [failed, setFailed] = useState(false)
  const [pending, startTransition] = useTransition()

  function loadMore(): void {
    if (cursor === null) {
      return
    }

    setFailed(false)

    startTransition(async () => {
      try {
        const next = await loadMoreDiscoverResults(
          searchStateToQueryString(state),
          cursor,
        )

        setItems(current => [...current, ...next.items])
        setTotal(next.total)
        setCursor(next.nextCursor)
      } catch (error) {
        console.error('[search] load more failed', error)
        setFailed(true)
      }
    })
  }

  function changeSort(sort: SearchSort): void {
    router.push(`${pathname}${searchStateToQueryString({ ...state, sort })}`, {
      scroll: false,
    })
  }

  return (
    <div>
      {state.view === 'list' ? (
        <ResultTable
          items={items}
          onSortChange={changeSort}
          sort={state.sort}
        />
      ) : (
        <ResultGrid items={items} />
      )}
      <LoadMore
        className="mt-6"
        // ⚠️ The cursor, never `loaded < total`: `total` counts the filtered
        // set as of the moment the page was computed, so the two can disagree
        // after a concurrent write.
        hasMore={cursor !== null}
        loaded={items.length}
        onLoadMore={loadMore}
        pending={pending}
        total={total}
      />
      {failed ? (
        <p className={LOAD_ERROR} role="alert">
          <Icon className="h-[11px] w-[11px] shrink-0" name="alert" />
          {LOAD_FAILED}
        </p>
      ) : null}
    </div>
  )
}
