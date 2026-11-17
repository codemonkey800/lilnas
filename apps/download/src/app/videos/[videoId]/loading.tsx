import { Skeleton } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { VideoDetailShell } from 'src/components/detail/video-detail'

/** Six facts, the two grids the Details and File sections draw between them. */
const FACT_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const

/**
 * `/videos/<videoId>`'s loading state - `video-detail.pug`'s `videoSkeleton`.
 *
 * The page's own geometry rather than a spinner: the title and its meta line,
 * the lifecycle badge, the one action, the 16:9 player and the facts grid are
 * all fixed-size, so drawing them empty means the real page lands in place.
 * The header has no poster column - a video's picture is the player under it.
 *
 * ⚠️ Adding this boundary is a trade. Without a Suspense boundary above the
 * page, `notFound()` is thrown before any byte is committed and the answer is
 * a real `404`; with this one the shell streams first, so an unknown id is the
 * not-found copy over a `200`. The proxy still refuses a malformed segment
 * before the route runs, and the copy is the same either way.
 */
export default function VideoLoading(): JSX.Element {
  return (
    <VideoDetailShell aria-busy="true">
      {/* `LibraryLink`'s row. */}
      <Skeleton className={cns('mb-[22px] h-3 w-16')} />
      <Skeleton className={cns('mb-2 h-6 w-3/5')} />
      <Skeleton className={cns('mb-4 h-3.5 w-2/5')} />
      <Skeleton className={cns('mb-4 h-6 w-28 rounded-full')} />
      <Skeleton className={cns('mb-8 h-9 w-40 rounded-md')} />
      <Skeleton className={cns('aspect-video h-auto w-full rounded-lg')} />
      <div
        className={cns('mt-8 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3')}
      >
        {FACT_KEYS.map(key => (
          <div className={cns('flex flex-col gap-2')} key={key}>
            <Skeleton className={cns('h-3 w-16')} />
            <Skeleton className={cns('h-3.5 w-28')} />
          </div>
        ))}
      </div>
    </VideoDetailShell>
  )
}
