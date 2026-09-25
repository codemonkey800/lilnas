import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { Skeleton } from 'src/components/ui/feedback'

/** `mock.pug`'s `appBody` at both widths, spelled the way `src/app/(home)/page.tsx` does. */
const PAGE_SHELL = cns(
  'flex-auto px-6 pt-[18px] pb-[30px]',
  'sm:px-8 sm:pt-[30px] sm:pb-11',
)

/** `DetailHeader`'s own poster column, so the real art lands exactly here. */
const POSTER = cns(
  'mx-auto mb-4 aspect-[2/3] w-full max-w-[220px] rounded-md',
  'sm:mx-0 sm:mb-0 sm:w-[200px] sm:max-w-none',
)

/** Three credited names on a desktop row, two on a phone — `movie-detail.pug:285,313`. */
const CAST_PLACEHOLDERS = ['a', 'b', 'c'] as const

/**
 * `/movies/<tmdbId>`'s loading state — `movie-detail.pug`'s `loadingState`
 * mixin, reconciled into one responsive tree.
 *
 * Every measurement is the real page's own geometry rather than the mixin's, so
 * nothing moves when Radarr answers: the poster takes `DetailHeader`'s exact
 * column at both widths, the action row takes `Button`'s 38px, and the release
 * block draws the *prompt* card.
 *
 * Three deliberate departures from the mixin, each because the mockup drew
 * something this page does not render:
 *
 * - **The title and metadata bars are not centred on the phone.** The mixin
 *   centres them (`mx-auto`); `movie-detail.pug`'s own mobile header does not,
 *   and `DetailHeader` left-aligns both at every width. A centred placeholder
 *   would promise a layout that never arrives.
 * - **No trailer block.** The mockup reserves an `aspect-video` slot for one.
 *   Nothing on the wire carries a trailer — `MediaBase` has no such field — so
 *   the slot is spent on the status panel the real page does render.
 * - **The release block is the search prompt, not a list.** The list costs an
 *   interactive indexer sweep that only a button press may start, so the state
 *   this page loads into is always the prompt: two lines of prose and a
 *   30px `sm` button.
 */
export default function MovieLoading(): JSX.Element {
  return (
    <main aria-busy="true" className={PAGE_SHELL}>
      <div className={cns('mx-auto max-w-[1080px]')}>
        {/* `LibraryLink`'s row. */}
        <Skeleton className={cns('mb-[22px] h-3 w-16')} />

        <div
          className={cns('flex flex-col sm:flex-row sm:items-start sm:gap-6')}
        >
          <Skeleton className={cns(POSTER)} />
          <div
            className={cns(
              'flex min-w-0 flex-1 flex-col gap-4 sm:gap-[14px] sm:pt-0.5',
            )}
          >
            <div>
              <Skeleton className={cns('mb-2 h-[23px] w-[70%] sm:w-[55%]')} />
              <Skeleton className={cns('h-[13px] w-[45%] sm:w-[32%]')} />
            </div>
            <div className={cns('flex flex-col gap-[7px]')}>
              <Skeleton className={cns('h-[13px] w-full')} />
              <Skeleton className={cns('h-[13px] w-[82%] sm:w-[78%]')} />
            </div>
            <div className={cns('flex items-center gap-4')}>
              {CAST_PLACEHOLDERS.map((key, index) => (
                <div
                  className={cns(
                    'flex items-center gap-2',
                    // The third name only fits beside the others from `sm`.
                    index === 2 && 'hidden sm:flex',
                  )}
                  key={key}
                >
                  <Skeleton className={cns('h-[30px] w-[30px] rounded-full')} />
                  <Skeleton className={cns('h-3 w-[60px] sm:w-16')} />
                </div>
              ))}
            </div>
            <div
              className={cns(
                'flex flex-col gap-2',
                'sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5',
              )}
            >
              <Skeleton
                className={cns('h-[38px] w-full rounded-md sm:w-[108px]')}
              />
              <Skeleton
                className={cns('h-[38px] w-full rounded-md sm:w-[100px]')}
              />
            </div>
          </div>
        </div>

        <div className={cns('mt-7 sm:mt-8')}>
          {/* The `Status` eyebrow, then the chip `MediaStatus` opens with. */}
          <Skeleton className={cns('mb-2.5 h-[11px] w-[58px]')} />
          <Skeleton className={cns('h-[23px] w-[132px] rounded-full')} />
        </div>

        <div className={cns('mt-7 sm:mt-8')}>
          {/* `ReleasePicker`'s `text-h2` heading. */}
          <Skeleton className={cns('mb-3 h-[15px] w-[74px]')} />
          <div
            className={cns(
              'rounded-lg border border-line bg-bg-sunk px-[14px] py-4',
              'sm:px-4 sm:py-[18px]',
            )}
          >
            <div className={cns('mb-[14px] flex flex-col gap-[7px]')}>
              <Skeleton className={cns('h-[13px] w-full')} />
              <Skeleton className={cns('h-[13px] w-[62%]')} />
            </div>
            <Skeleton
              className={cns('h-[30px] w-full rounded-md sm:w-[132px]')}
            />
          </div>
        </div>
      </div>
    </main>
  )
}
