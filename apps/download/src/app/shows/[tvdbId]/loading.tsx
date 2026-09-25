import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { ShowPageShell } from 'src/components/detail/show-page-shell'
import { Skeleton } from 'src/components/ui/feedback'

/** Three seasons' worth of tab stubs - `show-detail.pug:329,359`. */
const TAB_KEYS = ['a', 'b', 'c'] as const

/**
 * Three episode rows, at the widths `show-detail.mjs`'s `SKELETON_EPISODES`
 * gives them. The mobile frame stacks two lines per row; the desktop one puts
 * a fixed-width stub beside a fluid one.
 */
const EPISODE_KEYS = [
  { lead: 'w-[60%]', trail: 'w-[40%]' },
  { lead: 'w-[55%]', trail: 'w-[35%]' },
  { lead: 'w-[50%]', trail: 'w-[30%]' },
] as const

/** Two lead-cast stubs - `show-detail.pug:349`. */
const CAST_KEYS = ['a', 'b'] as const

/**
 * `/shows/<tvdbId>`'s loading state - `show-detail.pug`'s `loadingState`
 * mixin, with its two viewport frames reconciled into one responsive block.
 *
 * The page's *geometry* rather than a spinner in the middle of an empty screen:
 * a 200px poster column, a heading run, three full-width action buttons, the
 * season strip and a sunk card of episode rows are all fixed-size, so drawing
 * them empty means the real content lands in place instead of shoving a centred
 * spinner out of the way.
 *
 * The chrome is spelled out here rather than reusing `DetailHeader` /
 * `ShowSeasons`, because both of those require precisely the data that has not
 * arrived yet.
 *
 * ⚠️ Sonarr is the slow half. `getMedia` reads a cached library map, but
 * `listSeasons` goes upstream per request, so this is a state a user genuinely
 * sees - it is not decoration for a 40ms gap.
 */
export default function ShowLoading(): JSX.Element {
  return (
    <ShowPageShell aria-busy="true">
      <Skeleton className="mb-[22px] h-3 w-16" />

      <div className={cns('flex flex-col sm:flex-row sm:items-start sm:gap-6')}>
        <Skeleton
          className={cns(
            'mx-auto mb-4 aspect-[2/3] w-full max-w-[220px] rounded-md',
            'sm:mx-0 sm:mb-0 sm:w-[200px] sm:max-w-none',
          )}
        />
        <div
          className={cns(
            'flex min-w-0 flex-1 flex-col gap-4 sm:gap-[14px] sm:pt-0.5',
          )}
        >
          <Skeleton className="mx-auto h-[23px] w-[65%] sm:mx-0 sm:w-[50%]" />
          <Skeleton className="mx-auto h-[13px] w-[40%] sm:mx-0 sm:w-[30%]" />
          <div className="hidden flex-wrap gap-4 sm:flex">
            {CAST_KEYS.map(key => (
              <div className="flex items-center gap-2" key={key}>
                <Skeleton className="h-[30px] w-[30px] rounded-full" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
          <div
            className={cns(
              'mt-1 flex flex-col gap-2',
              'sm:flex-row sm:items-center sm:gap-2.5',
            )}
          >
            <Skeleton className="h-[38px] w-full rounded-md sm:w-[100px]" />
            <Skeleton className="h-[38px] w-full rounded-md sm:w-[148px]" />
            <Skeleton className="h-[38px] w-full rounded-md sm:w-[128px]" />
          </div>
        </div>
      </div>

      <div
        className={cns(
          'mt-7 mb-4 flex gap-4',
          'sm:mt-8 sm:mb-5 sm:gap-[22px] sm:border-b sm:border-line sm:pb-[9px]',
        )}
      >
        {TAB_KEYS.map(key => (
          <Skeleton className="h-7 w-16 sm:h-3" key={key} />
        ))}
      </div>

      <div
        className={cns(
          'mb-[14px] flex flex-col gap-2.5',
          'sm:flex-row sm:items-center sm:justify-between sm:gap-4',
        )}
      >
        <Skeleton className="h-[15px] w-[130px] sm:w-[150px]" />
        <div className={cns('flex flex-col gap-2 sm:flex-row sm:gap-2')}>
          <Skeleton className="h-[30px] w-full rounded-md sm:w-[150px]" />
          <Skeleton className="h-[30px] w-full rounded-md sm:w-[130px]" />
        </div>
      </div>

      <div className="rounded-lg border border-line bg-bg-sunk p-4">
        <div className="flex flex-col gap-4">
          {EPISODE_KEYS.map(({ lead, trail }) => (
            <div
              className={cns(
                'flex flex-col gap-1.5',
                'sm:flex-row sm:items-center sm:gap-[14px]',
              )}
              key={lead}
            >
              <Skeleton className={cns('h-[13px]', lead, 'sm:w-[190px]')} />
              <Skeleton className={cns('h-[13px]', trail, 'sm:flex-1')} />
            </div>
          ))}
        </div>
      </div>
    </ShowPageShell>
  )
}
