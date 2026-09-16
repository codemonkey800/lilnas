'use client'

import { cns } from '@lilnas/utils/cns'
import type { DownloadJob } from '@lilnas/utils/download/types'
import { useRouter } from 'next/navigation'
import type { JSX } from 'react'
import { useEffect, useMemo, useState, useTransition } from 'react'

import { loadActivityPage } from 'src/app/actions/load-activity-page'
import { ActivityEmpty } from 'src/components/activity/activity-empty'
import { ActivityList } from 'src/components/activity/activity-list'
import { buildActivityRows } from 'src/components/activity/activity-rows'
import { ActivityTable } from 'src/components/activity/activity-table'
import { ActivityTabs } from 'src/components/activity/activity-tabs'
import { Note } from 'src/components/ui/card'
import { Chip } from 'src/components/ui/chip'
import { LoadMore } from 'src/components/ui/load-more'
import { Dot } from 'src/components/ui/status'
import type { ActivityFilters } from 'src/lib/activity-filters'
import { hasActivityFilters } from 'src/lib/activity-filters'
import { useJobEvents } from 'src/lib/use-job-events'
import type { Viewer } from 'src/lib/viewer'

/**
 * How long a finished job keeps its row before the row is removed.
 *
 * Long enough to read the final chip — `completed`, `failed`, `cancelled` — and
 * short enough that the feed still describes what is in flight rather than what
 * recently was. The full history of the terminal ones lives on the admin
 * dashboard, which is where anyone who missed this beat should be looking.
 */
export const DEPARTURE_MS = 2_600

/** Shared empty set, so the initial state is one object rather than one per render. */
const NO_EVICTIONS: ReadonlySet<string> = new Set()

/** The loud `Note` from `ui.pug`'s call sites — `Note` itself has no tone. */
const FEED_ERROR_NOTE = 'mt-6 border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

const CONTROLS_ROW =
  'mb-[18px] flex flex-wrap items-center justify-between gap-4'

export type ActivityFeedProps = {
  /** The filter the URL currently describes. */
  filters: ActivityFilters
  /** The first page of `GET /download/activity`, rendered on the server. */
  initialJobs: DownloadJob[]
  /** `nextCursor` for that page — `null` when it is the only one. */
  initialNextCursor: string | null
  /** How many in-flight jobs the filter matches in total, per the first page. */
  initialTotal: number
  /** The instant every relative stamp on the page is measured against. */
  now: number
  /**
   * The filter as a query string, handed straight back to `loadActivityPage` so
   * an appended page is filtered exactly like the first.
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
  /** Who is looking. Decides which requester cells are links. */
  viewer: Viewer | null
}

/**
 * `/activity`'s one client island: the live feed, its filter strip, and its
 * pagination.
 *
 * ## The two sources of truth, and how they meet
 *
 * The **server** renders the first page of `GET /download/activity`, which is
 * in-progress-only and masked per viewer. The **gateway** then streams every
 * job event this tab is entitled to. `buildActivityRows` merges them by
 * `job.id` with the live copy winning, because a `DownloadJobEvent.job` is a
 * full current snapshot and is by construction no older than the HTML. Jobs the
 * socket knows and the pages do not were created while this page was open, and
 * sort into place by their own `createdAt` rather than being stapled to an end.
 *
 * ## How a job leaves
 *
 * `useJobEvents` upserts and never evicts, so the eviction is here. A job whose
 * status goes terminal is rendered one more time, dimmed, wearing the status
 * that ended it, and is announced on a polite live region; `DEPARTURE_MS` later
 * its id joins `evicted` and the row unmounts. A row that blinked out the
 * instant the frame landed would read as a rendering fault rather than as a
 * finished download — and would never say which of the three ways it finished.
 *
 * The timer is started from an effect but fires `setState` asynchronously,
 * inside the `setTimeout` callback, which is what keeps it clear of
 * `react-hooks/set-state-in-effect`. Departures batch: a second job going
 * terminal while the first is still fading restarts the one timer, so both
 * leave together. That is deliberate — rows popping out one at a time is the
 * jitter this whole mechanism exists to avoid.
 *
 * ## What `connected` means here
 *
 * Strictly "a socket is OPEN right now" — false during the first connect, for
 * every backoff window, and after unmount. It drives the marker beside the
 * count and nothing else. In particular the rows' live dots are *not*
 * suppressed while it is false: a dot states the job's status, which is a
 * server fact that does not stop being true because this tab stopped hearing
 * about it. One marker saying the page has gone stale beats nine rows each
 * implying it.
 *
 * ⚠️ While disconnected the feed can only go stale, never wrong-in-the-other-
 * direction: a job that finishes during a backoff window keeps its row until
 * the socket comes back and delivers the terminal frame. That is what the
 * marker is for.
 */
export function ActivityFeed({
  filters,
  initialJobs,
  initialNextCursor,
  initialTotal,
  now,
  search,
  viewer,
}: ActivityFeedProps): JSX.Element {
  const router = useRouter()

  const [pages, setPages] = useState(initialJobs)
  const [cursor, setCursor] = useState(initialNextCursor)
  const [total, setTotal] = useState(initialTotal)
  const [error, setError] = useState<string | null>(null)
  const [evicted, setEvicted] = useState(NO_EVICTIONS)
  const [pending, startTransition] = useTransition()

  // Unfiltered: every job the gateway sends. `/activity` is the one consumer
  // that wants the whole broadcast — `jobIds` exists for the detail pages.
  const { connected, jobs } = useJobEvents()

  const rows = useMemo(
    () =>
      buildActivityRows({ evicted, live: jobs, pages, types: filters.types }),
    [evicted, filters.types, jobs, pages],
  )

  const departing = rows.filter(row => row.departing)
  // A newline-joined key rather than the array, so the effect below re-runs on
  // a change of *contents* and not on every render's fresh array identity.
  const departingKey = departing.map(row => row.job.id).join('\n')

  useEffect(() => {
    if (departingKey === '') {
      return undefined
    }

    const ids = departingKey.split('\n')
    const timer = setTimeout(() => {
      setEvicted(previous => {
        const next = new Set(previous)
        for (const id of ids) next.add(id)
        return next
      })
    }, DEPARTURE_MS)

    return () => clearTimeout(timer)
  }, [departingKey])

  function handleLoadMore(): void {
    if (cursor === null) {
      return
    }

    startTransition(async () => {
      const result = await loadActivityPage(search, cursor)

      if ('error' in result) {
        setError(result.error)
        return
      }

      setError(null)
      setPages(previous => [...previous, ...result.items])
      setTotal(result.total)
      setCursor(result.nextCursor)
    })
  }

  const running = rows.length - departing.length

  return (
    <>
      <div className={cns(CONTROLS_ROW)}>
        <ActivityTabs
          filters={filters}
          // `scroll: false` — a filter change replaces the feed in place, and
          // yanking the viewport to the top of a page the user is already at
          // the top of is only ever felt as a jolt when they are not.
          onNavigate={href => router.push(href, { scroll: false })}
        />
        <div className="ml-auto flex items-center gap-2.5">
          {connected ? (
            <Chip tone="ok">
              <Dot tone="live" />
              {running} in flight
            </Chip>
          ) : (
            <Chip tone="warn">
              <Dot tone="warn" />
              reconnecting…
            </Chip>
          )}
        </div>
      </div>
      {/*
        The departure, for anyone not watching the screen. A row leaving is
        otherwise completely silent: nothing takes focus and nothing else
        changes. `sr-only` rather than visible, because the dimmed row already
        says it to everyone who can see it.
      */}
      <p aria-live="polite" className="sr-only">
        {departing
          .map(row => `${row.job.media.title} — ${row.job.status}`)
          .join('. ')}
      </p>
      {rows.length === 0 ? (
        <ActivityEmpty filtered={hasActivityFilters(filters)} />
      ) : (
        <>
          {/*
            Two layouts, one of them `display: none` at any given width — which
            removes it from the accessible tree too, so assistive technology
            sees exactly one copy of every row. Six columns do not fit at 390px
            and the mobile row is a genuine re-ordering of the facts rather than
            a reflow of the same cells, so this is two renders rather than a
            table that collapses.
          */}
          <div className="hidden sm:block">
            <ActivityTable now={now} rows={rows} viewer={viewer} />
          </div>
          <div className="sm:hidden">
            <ActivityList now={now} rows={rows} viewer={viewer} />
          </div>
          {error ? (
            <Note className={cns(FEED_ERROR_NOTE)} icon="alert" role="alert">
              {error}
            </Note>
          ) : null}
          <LoadMore
            className="mt-6"
            // The cursor, never `loaded < total`. That is true of every
            // paginated list in this app and doubly so of this one: the set
            // mutates live, so the two disagree constantly.
            hasMore={cursor !== null}
            loaded={rows.length}
            onLoadMore={handleLoadMore}
            pending={pending}
            // `total` is the server's count as of the last page fetched. The
            // live feed can push more rows on screen than that snapshot knew
            // about, and `Showing 26 of 24` would be a sentence that is simply
            // false — so the floor is what is actually on screen.
            total={Math.max(total, rows.length)}
          />
        </>
      )}
    </>
  )
}
