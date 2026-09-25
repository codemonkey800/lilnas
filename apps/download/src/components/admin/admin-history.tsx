'use client'

import { cns } from '@lilnas/utils/cns'
import type { DownloadJob } from '@lilnas/utils/download/types'
import type { JSX } from 'react'
import { useState, useTransition } from 'react'

import { loadAdminHistoryPage } from 'src/app/actions/load-admin-history'
import { AdminHistoryEmpty } from 'src/components/admin/admin-history-empty'
import { AdminHistoryList } from 'src/components/admin/admin-history-list'
import { AdminHistoryTable } from 'src/components/admin/admin-history-table'
import { Note } from 'src/components/ui/card'
import { LoadMore } from 'src/components/ui/load-more'
import type { AdminFilters } from 'src/lib/admin-filters'
import { hasAdminFilters } from 'src/lib/admin-filters'
import type { Viewer } from 'src/lib/viewer'

/** The loud `Note` from `ui.pug`'s call sites — `Note` itself has no tone. */
const HISTORY_ERROR_NOTE = 'mt-6 border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

export type AdminHistoryProps = {
  /** The filter the URL currently describes. */
  filters: AdminFilters
  /** The first page of the history, rendered on the server. */
  initialJobs: DownloadJob[]
  /** `nextCursor` for that page — `null` when it is the only one. */
  initialNextCursor: string | null
  /** How many jobs the filter matches in total, per the first page. */
  initialTotal: number
  /** The instant every relative stamp on the page is measured against. */
  now: number
  /**
   * The filter as a query string, handed straight back to
   * `loadAdminHistoryPage` so an appended page is filtered exactly like the
   * first.
   *
   * ⚠️ The page also uses this as this component's React `key`. That is why
   * there is no effect in here synchronising the accumulated pages with
   * `initialJobs`: a filter change is a new key, so the pages unmount with the
   * filter that produced them and `useState` seeds itself from the new props on
   * the way in. Deriving the state instead would need either a `useEffect` that
   * calls `setState` (`react-hooks/set-state-in-effect`, an error in this
   * package) or a render-phase reset (`react-hooks/set-state-in-render`, also
   * an error), and neither is necessary when the identity of the data is
   * already in the tree.
   */
  search: string
  /** Who is looking. Decides which mark wears the "this is you" halo. */
  viewer: Viewer | null
}

/**
 * The history table and its pagination — the page's one stateful island.
 *
 * Deliberately **not** live. `/activity` mounts a `JobEventsProvider` because
 * its entire subject is what is in flight; this table is the complete record,
 * it is read to answer a question about the past, and a socket that reordered
 * rows under an admin mid-scan would be a cost with no matching benefit. The
 * running count on the stat tiles above is the server-rendered figure for the
 * same reason the home page's is.
 *
 * ⚠️ `hasMore` is the cursor (`nextCursor !== null`), never `loaded < total`:
 * `total` counts the whole filtered set as of the last page fetched, and in the
 * cross-user merge it is the exact sum across requesters while the cursor is
 * bounded by the merge's scan window — so the two legitimately disagree, and
 * only the cursor knows whether another page exists.
 */
export function AdminHistory({
  filters,
  initialJobs,
  initialNextCursor,
  initialTotal,
  now,
  search,
  viewer,
}: AdminHistoryProps): JSX.Element {
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
      const result = await loadAdminHistoryPage(search, cursor)

      if ('error' in result) {
        setError(result.error)
        return
      }

      setError(null)
      setJobs(previous => [...previous, ...result.items])
      setTotal(result.total)
      setCursor(result.nextCursor)
    })
  }

  if (jobs.length === 0) {
    return <AdminHistoryEmpty filtered={hasAdminFilters(filters)} />
  }

  return (
    <>
      {/*
        Two layouts, one of them `display: none` at any given width — which
        removes it from the accessible tree too, so assistive technology sees
        exactly one copy of every row. Six columns do not fit at 390px and the
        mobile row is a genuine re-ordering of the facts rather than a reflow of
        the same cells, so this is two renders rather than a table that
        collapses.
      */}
      <div className="hidden sm:block">
        <AdminHistoryTable
          filters={filters}
          jobs={jobs}
          now={now}
          viewer={viewer}
        />
      </div>
      <div className="sm:hidden">
        <AdminHistoryList
          filters={filters}
          jobs={jobs}
          now={now}
          viewer={viewer}
        />
      </div>
      {error ? (
        <Note className={cns(HISTORY_ERROR_NOTE)} icon="alert" role="alert">
          {error}
        </Note>
      ) : null}
      <LoadMore
        className="mt-6"
        hasMore={cursor !== null}
        loaded={jobs.length}
        onLoadMore={handleLoadMore}
        pending={pending}
        total={Math.max(total, jobs.length)}
      />
    </>
  )
}
