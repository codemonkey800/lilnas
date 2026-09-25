import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import {
  ACTIVITY_TITLE,
  ActivityPageShell,
} from 'src/components/activity/activity-page-shell'
import { Card } from 'src/components/ui/card'
import { Skeleton } from 'src/components/ui/feedback'

/**
 * Six rows. The real first page is 24 (`LimitSchema`'s default) but a skeleton
 * is a promise about layout rather than about count, and this feed is usually
 * one or two rows long — a screenful of placeholders would promise a busy queue
 * and then deliver an empty one.
 */
const PLACEHOLDER_ROWS = 6

/** `DataTable`'s row rhythm: `px-3 py-3` cells over a `line-soft` rule. */
const ROW = cns(
  'flex items-center gap-2.5 border-b border-line-soft px-3 py-3',
  'last:border-b-0',
)

/**
 * The activity feed's loading state.
 *
 * Skeletons in the table's own geometry rather than a spinner, so when the rows
 * land nothing on the page moves. `Skeleton` is `aria-hidden` and carries no
 * size of its own, which is why every one of them is measured here.
 */
export default function ActivityLoading(): JSX.Element {
  return (
    <ActivityPageShell aria-busy="true">
      <h1 className={ACTIVITY_TITLE}>Downloads activity</h1>
      <div className="mb-[18px] flex flex-wrap items-center justify-between gap-4">
        <div className="flex w-full gap-[22px] border-b border-line pb-[9px] sm:w-auto">
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-12" />
        </div>
        <Skeleton className="ml-auto h-[23px] w-[92px] rounded-full" />
      </div>
      <Card className="px-1.5 pt-1 pb-1.5">
        {Array.from({ length: PLACEHOLDER_ROWS }, (_unused, index) => (
          <div className={ROW} key={index}>
            <Skeleton className="h-[51px] w-[34px] rounded-xs" />
            <Skeleton className="h-[13px] w-[38%]" />
            <Skeleton className="ml-auto hidden h-[13px] w-16 sm:block" />
            <Skeleton className="hidden h-[23px] w-20 rounded-full sm:block" />
            <Skeleton className="h-[13px] w-12" />
          </div>
        ))}
      </Card>
    </ActivityPageShell>
  )
}
