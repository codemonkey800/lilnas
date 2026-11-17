'use client'

import { Icon, Note } from '@lilnas/ui'
import type { DownloadJob } from '@lilnas/utils/download/types'
import type { JSX } from 'react'
import { useState, useTransition } from 'react'

import { loadProfileHistory } from 'src/app/actions/load-profile-history'
import { ProfileHistoryDataList } from 'src/components/profile/profile-history-data-list'
import { ProfileHistoryEmpty } from 'src/components/profile/profile-history-empty'
import { LoadMore } from 'src/components/ui/load-more'

export type ProfileHistoryProps = {
  /** Where the empty state's "Clear filters" goes. */
  clearHref?: string
  /**
   * Whether a type or status chip is applied, which decides which empty state
   * an empty result gets. Passed rather than re-derived from the query string
   * so one answer drives the copy.
   */
  filtered: boolean
  /** The first page of `GET /download/history`, rendered on the server. */
  initialJobs: DownloadJob[]
  /** `nextCursor` for that page — `null` when it is the only one. */
  initialNextCursor: string | null
  /** How many rows the filter matches in total, per the first page. */
  initialTotal: number
  /** The instant every relative stamp in the table is measured against. */
  now: number
  /**
   * The page's filters as a query string, handed straight back to
   * `loadProfileHistory` so an appended page is filtered and scoped exactly
   * like the first.
   *
   * ⚠️ The page also uses this as this component's React `key`. That is why
   * there is no effect in here synchronising the accumulated pages with
   * `initialJobs`: a filter change is a new key, so the pages unmount with the
   * filter that produced them and `useState` seeds itself from the new props on
   * the way in. Deriving the state instead would need either a `useEffect` that
   * calls `setState` (`react-hooks/set-state-in-effect`, an error in this
   * package) or a render-phase reset (`react-hooks/set-state-in-render`, also an
   * error), and neither is necessary when the identity of the data is already in
   * the tree.
   */
  search: string
  /** Whether this profile is the viewer's own — only reaches the empty copy. */
  you: boolean
}

/**
 * The embedded history table, its pagination, and the two ways it can be empty.
 *
 * A client component because "Load more" appends to what the server rendered
 * rather than navigating — the URL describes the *filter*, not how far down the
 * table someone has read, so paging must not create history entries the back
 * button then has to walk back through.
 */
export function ProfileHistory({
  clearHref,
  filtered,
  initialJobs,
  initialNextCursor,
  initialTotal,
  now,
  search,
  you,
}: ProfileHistoryProps): JSX.Element {
  const [jobs, setJobs] = useState(initialJobs)
  const [cursor, setCursor] = useState(initialNextCursor)
  const [total, setTotal] = useState(initialTotal)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleLoadMore(): void {
    if (cursor === null) {
      return
    }

    startTransition(async () => {
      const result = await loadProfileHistory(search, cursor)

      if ('error' in result) {
        setError(result.error)
        return
      }

      setError(null)
      setJobs(previous => [...previous, ...result.items])
      // Re-read from every page rather than kept from the first: a download
      // started while this page was open would otherwise leave the count
      // permanently one short.
      setTotal(result.total)
      setCursor(result.nextCursor)
    })
  }

  if (jobs.length === 0) {
    return (
      <ProfileHistoryEmpty
        clearHref={clearHref}
        filtered={filtered}
        you={you}
      />
    )
  }

  return (
    <>
      <ProfileHistoryDataList jobs={jobs} now={now} />
      {error ? (
        <Note
          className="mt-6"
          icon={<Icon name="alert" />}
          lead={error}
          tone="bad"
        />
      ) : null}
      <LoadMore
        className="mt-6"
        // The cursor, never `loaded < total`: `total` counts the whole filtered
        // set as of the last page fetched, and a concurrent write can leave the
        // two disagreeing.
        hasMore={cursor !== null}
        loaded={jobs.length}
        onLoadMore={handleLoadMore}
        pending={pending}
        total={total}
      />
    </>
  )
}
