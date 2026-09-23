import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { VideoDetailShell } from 'src/components/detail/video-detail'
import { Skeleton } from 'src/components/ui/feedback'

/**
 * `DetailHeader`'s own geometry, so nothing moves when the real page lands:
 * the `wide` poster column (`mb-4 w-full sm:mb-0 sm:w-[340px]`) beside a
 * `min-w-0 flex-1` stack.
 */
const POSTER = 'mb-4 aspect-video w-full rounded-md sm:mb-0 sm:w-[340px]'

/**
 * The video detail page's loading state.
 *
 * Skeletons in the page's shape rather than a spinner in the middle of an
 * empty screen. The poster column is the expensive one to get wrong — it is
 * 340px of fixed width on desktop and the full column on a phone, so a
 * centred spinner would shove the whole header sideways when the video
 * arrived.
 *
 * Deliberately no status chip and no action row: which of those exist is a
 * function of the video's media state, which nobody has yet, and drawing a
 * button-shaped placeholder for a control that may not appear is a promise the
 * page cannot keep. `Skeleton` is `aria-hidden` and carries no size of its own, which is
 * why every one of these is measured here.
 */
export default function VideoDetailLoading(): JSX.Element {
  return (
    <VideoDetailShell aria-busy="true">
      <Skeleton className="mb-[22px] h-[15px] w-[70px]" />
      <div className={cns('flex flex-col sm:flex-row sm:items-start sm:gap-6')}>
        <Skeleton className={cns(POSTER)} />
        <div
          className={cns(
            'flex min-w-0 flex-1 flex-col gap-4 sm:gap-[14px] sm:pt-0.5',
          )}
        >
          <div>
            <Skeleton className="mb-[9px] h-[23px] w-[62%]" />
            <Skeleton className="h-[13px] w-[180px]" />
          </div>
          <Skeleton className="h-[15px] w-[140px]" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-[13px] w-[190px]" />
          </div>
          <Skeleton className="h-[23px] w-[104px] rounded-full" />
        </div>
      </div>
    </VideoDetailShell>
  )
}
