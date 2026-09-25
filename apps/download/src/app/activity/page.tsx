import type { JSX } from 'react'

import { ActivityFeed } from 'src/components/activity/activity-feed'
import {
  ACTIVITY_TITLE,
  ActivityPageShell,
} from 'src/components/activity/activity-page-shell'
import { JobEventsProvider } from 'src/components/live/job-events'
import type { ActivitySearchParams } from 'src/lib/activity-filters'
import {
  activityFiltersToQuery,
  activityFiltersToSearch,
  parseActivityFilters,
} from 'src/lib/activity-filters'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { getRequestInstant } from 'src/lib/request-instant'
import { getViewer } from 'src/lib/viewer'

export const metadata = {
  title: 'Downloads activity · Download',
}

export type ActivityPageProps = {
  searchParams: Promise<ActivitySearchParams>
}

/**
 * `/activity` — everything in flight, across every user, live.
 *
 * Visible to anyone, and **in-progress only**: `JobQueryService.listActivity`
 * filters on `IN_PROGRESS_DOWNLOAD_JOB_STATUSES`, so a completed, failed or
 * cancelled job is never in the first page. The full history of those belongs to
 * the admin dashboard, not here.
 *
 * `paused` and `pausing` are *not* terminal — the in-progress set is the
 * complement of `TERMINAL_DOWNLOAD_JOB_STATUSES`, and neither is in it — so a
 * paused download stays on this feed, both on the server's page and through the
 * live merge.
 *
 * ## Where `<JobEventsProvider>` is mounted, and why here
 *
 * Here, at this page's own root, wrapping only `ActivityFeed` — deliberately
 * **not** in `layout.tsx`. The provider owns the socket, so mounting it app-wide
 * would open a gateway connection on every route including the ones that want
 * no live data at all; the home page made the matching call in the other
 * direction, serving its "downloads activity" count as a server-rendered number
 * precisely so that one integer could not drag a WebSocket into the shell.
 * `/activity` is the page whose entire subject is jobs in flight, so it is the
 * page that pays for the connection — and it opens exactly one, for every
 * consumer inside it, because `useJobEvents()` throws without an ancestor rather
 * than quietly opening a second.
 *
 * The provider sits *outside* `ActivityFeed`'s `key`, so a filter change
 * remounts the feed and its accumulated pages without tearing the socket down
 * and climbing the backoff ladder again.
 *
 * Nothing is caught: `getIdentifiedDownloadClient()` reads `headers()` (which
 * makes this route dynamic, correctly — what is downloading is per-request truth)
 * and a failing backend throws through to `error.tsx`.
 */
export default async function ActivityPage({
  searchParams,
}: ActivityPageProps): Promise<JSX.Element> {
  const filters = parseActivityFilters(await searchParams)
  const client = await getIdentifiedDownloadClient()

  const [page, viewer] = await Promise.all([
    client.getActivity(activityFiltersToQuery(filters)),
    getViewer(),
  ])

  // One instant for every relative timestamp in the feed, resolved on the
  // server and handed down — see `getRequestInstant` for why that matters.
  const now = getRequestInstant()
  // Also this view's identity: the feed is keyed by it, so a filter change
  // unmounts the pages accumulated under the previous filter rather than
  // needing an effect to reconcile them.
  const search = activityFiltersToSearch(filters)

  return (
    <ActivityPageShell>
      <h1 className={ACTIVITY_TITLE}>Downloads activity</h1>
      <JobEventsProvider>
        <ActivityFeed
          filters={filters}
          initialJobs={page.items}
          initialNextCursor={page.nextCursor}
          initialTotal={page.total}
          key={search}
          now={now}
          search={search}
          viewer={viewer}
        />
      </JobEventsProvider>
    </ActivityPageShell>
  )
}
