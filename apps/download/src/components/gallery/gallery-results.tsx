'use client'

import { cns } from '@lilnas/utils/cns'
import type { GalleryItem } from '@lilnas/utils/download/types'
import type { JSX } from 'react'
import { useState, useTransition } from 'react'

import { loadGalleryPage } from 'src/app/actions/load-gallery-page'
import { GalleryEmpty } from 'src/components/gallery/gallery-empty'
import { GalleryItemCard } from 'src/components/gallery/gallery-item-card'
import { Note } from 'src/components/ui/card'
import { LoadMore } from 'src/components/ui/load-more'
import { useLiveLibraryItems } from 'src/lib/use-live-library-items'
import type { Viewer } from 'src/lib/viewer'

/**
 * `gallery.pug`'s grid, verbatim: a wrapping flex row rather than a CSS grid,
 * because the cards set their own width at each breakpoint and a trailing row
 * of two should sit left-aligned at that width rather than stretch to fill
 * columns. `items-stretch` is what makes every card in a row the height of the
 * tallest, which is in turn what the cards' `mt-auto` attribution row hangs
 * off.
 */
const GALLERY_GRID = 'flex flex-wrap items-stretch gap-4 stagger'

/** The loud `Note` from `ui.pug`'s call sites — `Note` itself has no tone. */
const GALLERY_ERROR_NOTE = 'mt-6 border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

export type GalleryResultsProps = {
  /**
   * Whether any filter is applied, which decides *which* empty state an empty
   * result gets. Passed rather than re-derived from the query string so the one
   * answer drives both the copy and the count.
   */
  filtered: boolean
  /** The first page, rendered on the server. */
  initialItems: GalleryItem[]
  /** `nextCursor` for that page — `null` when it is the only one. */
  initialNextCursor: string | null
  /** How many rows the filter matches in total, per the first page. */
  initialTotal: number
  /** The instant every relative stamp on the page is measured against. */
  now: number
  /**
   * The current filters as a query string, handed straight back to
   * `loadGalleryPage` so the appended page is filtered exactly like the first.
   *
   * ⚠️ The page also uses this as this component's React `key`. That is the
   * whole reason there is no effect in here synchronising `items` with
   * `initialItems`: a filter change is a new key, so the accumulated pages
   * unmount with the filter that produced them and `useState` seeds itself
   * from the new props on the way in. Deriving the state instead would need
   * either a `useEffect` that calls `setState` (`react-hooks/set-state-in-
   * effect`, an error in this package) or a render-phase reset
   * (`react-hooks/set-state-in-render`, also an error), and neither is
   * necessary when the identity of the data is already in the tree.
   */
  search: string
  /** Who is looking. Decides which attribution avatars are profile links. */
  viewer: Viewer | null
}

/**
 * The grid, its pagination, and the two ways it can be empty.
 *
 * A client component because "Load more" appends to what the server rendered
 * rather than navigating — the URL describes the *filter*, not how far down the
 * user has scrolled, so paging must not create history entries a back button
 * then has to walk back through.
 *
 * A card whose title leaves the library while the page is open drops out
 * live (`useLiveLibraryItems`), and the count drops with it. Needs a
 * `<JobEventsProvider>` ancestor for that.
 */
export function GalleryResults({
  filtered,
  initialItems,
  initialNextCursor,
  initialTotal,
  now,
  search,
  viewer,
}: GalleryResultsProps): JSX.Element {
  const [items, setItems] = useState(initialItems)
  const [cursor, setCursor] = useState(initialNextCursor)
  const [total, setTotal] = useState(initialTotal)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const visible = useLiveLibraryItems(items)
  const removed = items.length - visible.length

  function handleLoadMore(): void {
    if (cursor === null) {
      return
    }

    startTransition(async () => {
      const result = await loadGalleryPage(search, cursor)

      if ('error' in result) {
        setError(result.error)
        return
      }

      setError(null)
      // Cards that left the library are pruned here rather than kept hidden:
      // the fresh `total` below already leaves them out, so still counting
      // them in `removed` would take them off twice.
      setItems([...visible, ...result.items])
      // `total` is re-read from every page rather than kept from the first:
      // the library is live, and a title downloaded while the user was reading
      // would otherwise leave the count permanently one short.
      setTotal(result.total)
      setCursor(result.nextCursor)
    })
  }

  if (visible.length === 0 && (removed === 0 || cursor === null)) {
    return <GalleryEmpty filtered={filtered} />
  }

  return (
    <>
      <div className={GALLERY_GRID}>
        {visible.map(item => (
          <GalleryItemCard
            item={item}
            key={item.media.id}
            now={now}
            viewer={viewer}
          />
        ))}
      </div>
      {error ? (
        <Note className={cns(GALLERY_ERROR_NOTE)} icon="alert" role="alert">
          {error}
        </Note>
      ) : null}
      <LoadMore
        className="mt-6"
        hasMore={cursor !== null}
        loaded={visible.length}
        onLoadMore={handleLoadMore}
        pending={pending}
        total={total - removed}
      />
    </>
  )
}
