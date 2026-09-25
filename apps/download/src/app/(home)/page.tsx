import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { QuickAccess } from 'src/components/home/quick-access'
import {
  RECENTLY_ADDED_LIMIT,
  RecentlyAdded,
} from 'src/components/home/recently-added'
import { JobEventsProvider } from 'src/components/live/job-events'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { getRequestInstant } from 'src/lib/request-instant'
import { getViewer } from 'src/lib/viewer'

/**
 * The library overview: quick access, then recently added.
 *
 * Note what is *not* here — an input of its own. Pasting a link and searching
 * for a title both happen in the nav-bar field, which `layout.tsx` mounts on
 * every route, so a hero field here would be a second copy of the same control
 * with the same two behaviours.
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
    <main
      className={cns(
        'flex-auto px-6 pt-[18px] pb-[30px]',
        'sm:px-8 sm:pt-[30px] sm:pb-11',
      )}
    >
      <div className="mx-auto max-w-[1080px]">
        <QuickAccess facets={facets} running={activity.total} />
        {/* The live feed drops a card whose title leaves the library. */}
        <JobEventsProvider>
          <RecentlyAdded
            className="mt-[34px] sm:mt-10"
            items={recent.items}
            now={now}
            viewer={viewer}
          />
        </JobEventsProvider>
      </div>
    </main>
  )
}
