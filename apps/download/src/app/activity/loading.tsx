import { Skeleton } from '@lilnas/ui'
import type { JSX } from 'react'

import {
  ACTIVITY_TITLE,
  ACTIVITY_TITLE_TEXT,
  ActivityPageShell,
} from 'src/components/activity/activity-page-shell'

/**
 * Five rows. The real first page is 24 (`LimitSchema`'s default) but a skeleton
 * is a promise about layout rather than about count, and this feed is usually
 * one or two rows long — a screenful of placeholders would promise a busy queue
 * and then deliver an empty one.
 */
const PLACEHOLDER_ROWS = 5

/** The tab strip's four labels, at the widths they usually run. */
const TAB_WIDTHS = ['w-5', 'w-12', 'w-12', 'w-10']

/**
 * The activity feed's loading state.
 *
 * Skeletons in the feed's own geometry rather than a spinner, so when the rows
 * land nothing on the page moves. `Skeleton` is `aria-hidden` and carries no
 * size of its own, which is why every one of them is measured here.
 */
export default function ActivityLoading(): JSX.Element {
  return (
    <ActivityPageShell aria-busy="true">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className={ACTIVITY_TITLE}>{ACTIVITY_TITLE_TEXT}</h1>
        <Skeleton className="h-3.5 w-20" />
      </div>
      <div className="mb-5 flex gap-6 border-b border-line pb-3">
        {TAB_WIDTHS.map(width => (
          <Skeleton className={`h-4 ${width}`} key={width} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: PLACEHOLDER_ROWS }, (_unused, index) => (
          <div
            className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3"
            key={index}
          >
            <Skeleton className="h-12 w-8 shrink-0 rounded-xs" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
            <Skeleton className="hidden h-6 w-24 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </ActivityPageShell>
  )
}
