import type { JSX } from 'react'

import { HomeHero } from 'src/components/home/home-hero'
import { QuickAccess } from 'src/components/home/quick-access'
import {
  RECENTLY_ADDED_LIMIT,
  RecentlyAdded,
} from 'src/components/home/recently-added'
import { JobEventsProvider } from 'src/components/live/job-events'
import { PageMain } from 'src/components/shell/page-main'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { getRequestInstant } from 'src/lib/request-instant'
import { getViewer } from 'src/lib/viewer'

/**
 * The library overview: quick access, then recently added.
 *
 * The hero is the page's field, so the nav bar's own is omitted here: pasting a
 * link and searching for a title are the same field, and two copies of one
 * control on one screen is two places to type.
 *
 * Nothing is caught: `getIdentifiedDownloadClient()` reads `headers()` (which
 * makes this route dynamic, correctly — the counts are per-request truth, not
 * build-time truth) and a failing backend throws through to `error.tsx`. A
 * `try` here would only be able to render the same thing that file already
 * does, and it would have to re-implement the `digest` re-throw guard
 * `src/lib/viewer.ts` documents.
 */
export default async function HomePage(): Promise<JSX.Element> {
  const client = await getIdentifiedDownloadClient()

  const [facets, recent, activity, viewer] = await Promise.all([
    client.getGalleryFacets(),
    client.getGallery({ limit: RECENTLY_ADDED_LIMIT }),
    // `limit: 1` because only the envelope is wanted: `total` is the size of
    // the whole in-flight set, so the running count costs one row instead of
    // the default page of twenty-four. Reading `items.length` here would cap
    // the tile at 1.
    client.getActivity({ limit: 1 }),
    getViewer(),
  ])

  // One instant for every relative timestamp in the grid, resolved on the
  // server and handed down — see `getRequestInstant` for why that matters.
  const now = getRequestInstant()

  return (
    <PageMain>
      <HomeHero />
      <QuickAccess facets={facets} running={activity.total} />
      {/* The live feed drops a card whose title leaves the library. */}
      <JobEventsProvider>
        <RecentlyAdded
          className="mt-10"
          items={recent.items}
          now={now}
          viewer={viewer}
        />
      </JobEventsProvider>
    </PageMain>
  )
}
