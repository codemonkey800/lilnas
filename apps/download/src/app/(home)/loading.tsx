import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { Skeleton } from 'src/components/ui/feedback'

/** Four quick-access tiles, six cards — the shape `page.tsx` resolves into. */
const TILE_KEYS = ['movies', 'shows', 'videos', 'activity'] as const
const CARD_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const

/**
 * The homepage's loading state.
 *
 * Deliberately the page's *geometry* rather than a spinner in the middle of an
 * empty screen: the tiles and the card grid are fixed-size, so drawing them
 * empty means the real content lands in place instead of shoving a centred
 * spinner out of the way.
 *
 * The chrome (borders, padding, radii) is spelled out here rather than reusing
 * `Tile`/`GalleryCard`, because both of those require the content that is
 * precisely what has not arrived yet.
 */
export default function HomeLoading(): JSX.Element {
  return (
    <main
      aria-busy="true"
      className={cns(
        'flex-auto px-6 pt-[18px] pb-[30px]',
        'sm:px-8 sm:pt-[30px] sm:pb-11',
      )}
    >
      <div className="mx-auto max-w-[1080px]">
        <p className="mb-[14px] text-h2 sm:mb-4">Quick access</p>
        <div
          className={cns(
            'flex flex-col gap-2.5',
            'sm:flex-row sm:flex-wrap sm:gap-[14px]',
          )}
        >
          {TILE_KEYS.map(key => (
            <div
              key={key}
              className={cns(
                'flex items-center gap-2.5 rounded-md border border-line bg-surface p-[15px]',
                'sm:min-w-[220px] sm:flex-1 sm:flex-col sm:items-stretch',
              )}
            >
              <Skeleton className="h-[30px] w-[30px] shrink-0 rounded-lg" />
              <span className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-[15px] w-[120px]" />
                <Skeleton className="h-[11px] w-[88px]" />
              </span>
            </div>
          ))}
        </div>

        <p className="mt-[34px] mb-[14px] text-h2 sm:mt-10 sm:mb-4">
          Recently added
        </p>
        <div className="flex flex-wrap gap-4">
          {CARD_KEYS.map(key => (
            <div
              key={key}
              className={cns(
                'flex w-[calc(50%-8px)] flex-col gap-[9px]',
                'rounded-lg border border-line bg-surface p-[9px]',
                'sm:w-[158px]',
              )}
            >
              <Skeleton className="aspect-[2/3] w-full rounded-md" />
              <Skeleton className="h-[13px] w-full" />
              <Skeleton className="h-[11px] w-[70%]" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
