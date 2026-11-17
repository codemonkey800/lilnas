import { Skeleton } from '@lilnas/ui'
import type { JSX } from 'react'

import { PageMain } from 'src/components/shell/page-main'

/** Four quick-access tiles, six cards — the shape `page.tsx` resolves into. */
const TILE_KEYS = ['movies', 'shows', 'videos', 'activity'] as const
const CARD_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const

/**
 * The homepage's loading state.
 *
 * Deliberately the page's *geometry* rather than a spinner in the middle of an
 * empty screen: the hero, the tiles and the card grid are fixed-size, so
 * drawing them empty means the real content lands in place instead of shoving
 * a spinner out of the way.
 *
 * The chrome (borders, padding, radii) is spelled out here rather than reusing
 * `Tile`/`GalleryCard`, because both of those require the content that is
 * precisely what has not arrived yet.
 */
export default function HomeLoading(): JSX.Element {
  return (
    <PageMain aria-busy="true">
      <div className="flex flex-col gap-4 pt-4 pb-8 sm:items-center sm:pt-10 sm:pb-14">
        <Skeleton className="h-10 w-4/5 sm:h-14 sm:w-[480px]" />
        <Skeleton className="h-11 w-full rounded-md sm:max-w-[680px]" />
      </div>

      <p className="mb-3 text-h2">Quick access</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {TILE_KEYS.map(key => (
          <div
            key={key}
            className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3"
          >
            <Skeleton className="size-[30px] shrink-0 rounded-md" />
            <span className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-16" />
            </span>
          </div>
        ))}
      </div>

      <p className="mt-10 mb-3 text-h2">Recently added</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
        {CARD_KEYS.map(key => (
          <div
            key={key}
            className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5"
          >
            <Skeleton className="aspect-[2/3] h-auto w-full rounded-md" />
            <Skeleton className="h-3.5" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </PageMain>
  )
}
