import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { GalleryControls } from 'src/components/gallery/gallery-controls'
import { GalleryPageShell } from 'src/components/gallery/gallery-page-shell'
import { GalleryResults } from 'src/components/gallery/gallery-results'
import { JobEventsProvider } from 'src/components/live/job-events'
import { Note } from 'src/components/ui/card'
import { loadGalleryView } from 'src/lib/gallery-data'
import type { GallerySearchParams } from 'src/lib/gallery-filters'
import {
  galleryFiltersToSearch,
  hasGalleryFilters,
  parseGalleryFilters,
} from 'src/lib/gallery-filters'
import { getViewer } from 'src/lib/viewer'

export const metadata = {
  title: 'Library · Download',
}

/** The loud `Note`, assembled at the call site the way `ui.pug` does it. */
const RANGE_ERROR_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

export type GalleryPageProps = {
  searchParams: Promise<GallerySearchParams>
}

/**
 * `/gallery` — videos, movies and shows in one filterable grid.
 *
 * A server component, and the filters live in `searchParams` rather than in
 * client state, which is what makes a filtered view a link someone else can
 * open and what makes the browser's back button step through filter changes.
 * The client island above the grid does nothing but push a new query string;
 * this reads it back.
 *
 * The one state this page draws instead of a grid is a rejected date range. The
 * backend answers an inverted `from`/`to` with a 400 rather than an empty page
 * on purpose (`isOrderedDateRange`), because "nothing matched" and "that range
 * is impossible" are different facts and only one of them is about the library.
 * So the range is reported here as a validation problem — on the filter panel
 * where the controls that caused it live, plus this note for the case where the
 * page was opened from a shared link with the panel closed — and never as an
 * empty result.
 */
export default async function GalleryPage({
  searchParams,
}: GalleryPageProps): Promise<JSX.Element> {
  const filters = parseGalleryFilters(await searchParams)
  // The viewer decides which attribution avatars are profile links — own
  // identity always, anyone else's only for an admin. `getViewer` is
  // `React.cache()`-wrapped, so the layout's own call and this one are one
  // round trip.
  const [view, viewer] = await Promise.all([
    loadGalleryView(filters),
    getViewer(),
  ])
  // Also this view's identity: `GalleryResults` is keyed by it, so a filter
  // change unmounts the pages accumulated under the previous filter rather
  // than needing an effect to reconcile them.
  const search = galleryFiltersToSearch(filters)

  return (
    <GalleryPageShell>
      {/*
        The mockup's screen has no visible title — the app bar names the app and
        the tab strip names the view. A document still needs a heading, so this
        is the one thing on the page that is there for a screen reader only.
      */}
      <h1 className="sr-only">Library</h1>
      <GalleryControls
        facets={view.facets}
        filters={filters}
        rangeError={view.rangeError}
        total={view.total}
      />
      {view.items === null ? (
        // No `role="alert"`: the filter panel's message already has one, and
        // announcing the same complaint twice is worse than announcing it once.
        <Note className={cns(RANGE_ERROR_NOTE)} icon="alert">
          {view.rangeError} Open <strong className="font-[620]">Filters</strong>{' '}
          to change the dates.
        </Note>
      ) : (
        // The live feed is what drops a card whose title leaves the library
        // while the page is open.
        <JobEventsProvider>
          <GalleryResults
            filtered={hasGalleryFilters(filters)}
            initialItems={view.items}
            initialNextCursor={view.nextCursor}
            initialTotal={view.total ?? 0}
            key={search}
            now={view.now}
            search={search}
            viewer={viewer}
          />
        </JobEventsProvider>
      )}
    </GalleryPageShell>
  )
}
