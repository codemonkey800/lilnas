import { Skeleton } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { GalleryPageShell } from 'src/components/gallery/gallery-page-shell'

/**
 * One screen of cards. The real first page is 24 (`LimitSchema`'s default), but
 * a skeleton is a promise about layout rather than about count, and twelve is
 * already more than fills a 1280×900 viewport — placing another twelve below
 * the fold would only lengthen the scrollbar and then snap it back.
 */
const PLACEHOLDER_CARDS = 12

/** The widths of the four tab labels, as `gallery.pug`'s skeleton draws them. */
const TAB_WIDTHS = ['w-7', 'w-12', 'w-[52px]', 'w-11'] as const

/**
 * The gallery's loading state: the tab strip, the Filters button and a grid of
 * poster cards, in the page's own geometry so the real content lands in place.
 */
export default function GalleryLoading(): JSX.Element {
  return (
    <GalleryPageShell aria-busy="true">
      <div className="mb-4 flex items-center justify-between gap-4 border-b border-line pb-3">
        <div className="flex gap-6">
          {TAB_WIDTHS.map(width => (
            <Skeleton className={cns('h-4', width)} key={width} />
          ))}
        </div>
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
        {Array.from({ length: PLACEHOLDER_CARDS }, (_unused, index) => (
          <div
            className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5"
            key={index}
          >
            <Skeleton className="aspect-[2/3] w-full rounded-md" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="mt-1 h-3 w-2/3" />
          </div>
        ))}
      </div>
    </GalleryPageShell>
  )
}
