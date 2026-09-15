import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { GALLERY_CARD_WIDTH } from 'src/components/gallery/gallery-item-card'
import { GalleryPageShell } from 'src/components/gallery/gallery-page-shell'
import { Skeleton } from 'src/components/ui/feedback'

/**
 * One screen of cards. The real first page is 24 (`LimitSchema`'s default), but
 * a skeleton is a promise about layout rather than about count, and twelve is
 * already more than fills a 1280×900 viewport — placing another twelve below
 * the fold would only lengthen the scrollbar and then snap it back.
 */
const PLACEHOLDER_CARDS = 12

/** `GalleryCard`'s frame, without its hover — nothing here is hoverable yet. */
const CARD_FRAME = cns(
  'flex flex-col gap-[9px] rounded-lg border border-line bg-surface p-[9px]',
  GALLERY_CARD_WIDTH,
)

/**
 * The gallery's loading state.
 *
 * Skeletons rather than a spinner, and in the grid's own geometry: the poster
 * placeholder takes the same `aspect-[2/3]` the real one does, so when the data
 * lands nothing on the page moves. `Skeleton` is `aria-hidden` and carries no
 * size of its own, which is why every one of them is measured here.
 */
export default function GalleryLoading(): JSX.Element {
  return (
    <GalleryPageShell aria-busy="true">
      <div className="mb-[18px] flex flex-wrap items-center justify-between gap-4">
        <div className="flex w-full gap-[22px] border-b border-line pb-[9px] sm:w-auto">
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-12" />
        </div>
        <Skeleton className="ml-auto h-[38px] w-[104px] rounded-md" />
      </div>
      <div className="flex flex-wrap items-stretch gap-4">
        {Array.from({ length: PLACEHOLDER_CARDS }, (_unused, index) => (
          <div className={CARD_FRAME} key={index}>
            <Skeleton className="aspect-[2/3] w-full rounded-md" />
            <Skeleton className="h-[13px] w-full" />
            <Skeleton className="h-[13px] w-3/5" />
            <Skeleton className="mt-1 h-[11px] w-2/3" />
          </div>
        ))}
      </div>
    </GalleryPageShell>
  )
}
