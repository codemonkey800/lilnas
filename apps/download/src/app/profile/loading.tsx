import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import {
  PROFILE_GROUP_LABEL,
  PROFILE_TITLE,
  ProfilePageShell,
} from 'src/components/profile/profile-page-shell'
import { Card } from 'src/components/ui/card'
import { Skeleton } from 'src/components/ui/feedback'

/**
 * Six rows. The real first page is 24 (`LimitSchema`'s default) but a skeleton
 * is a promise about layout rather than about count, and most profiles are a
 * handful of rows long — a screenful of placeholders would promise a long
 * history and then deliver a short one.
 */
const PLACEHOLDER_ROWS = 6

/** `DataTable`'s row rhythm: `px-3 py-3` cells over a `line-soft` rule. */
const ROW = cns(
  'flex items-center gap-2.5 border-b border-line-soft px-3 py-3',
  'last:border-b-0',
)

/** The trend's own geometry, so the bars land where the placeholder sat. */
const TREND_PLOT = 'flex h-16 items-end gap-[3px]'

/**
 * The profile's loading state.
 *
 * Skeletons in the page's own geometry rather than a spinner, so when the data
 * lands nothing moves. `Skeleton` is `aria-hidden` and carries no size of its
 * own, which is why every one of them is measured here.
 */
export default function ProfileLoading(): JSX.Element {
  return (
    <ProfilePageShell aria-busy="true">
      <h1 className={PROFILE_TITLE}>User profile</h1>
      <div className="mb-6 flex items-center gap-4">
        <Skeleton className="h-[52px] w-[52px] rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-[18px] w-[220px]" />
          <Skeleton className="h-[13px] w-[260px]" />
        </div>
      </div>
      <Card className="mb-6 flex w-fit min-w-[168px] flex-col gap-[7px] px-5 pt-[18px] pb-5">
        <Skeleton className="h-[11px] w-[112px]" />
        <Skeleton className="h-[34px] w-[52px]" />
      </Card>
      <div className="mb-7 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {['by type', 'by status'].map(label => (
          <div className="flex flex-col gap-2" key={label}>
            <span className={cns(PROFILE_GROUP_LABEL)}>{label}</span>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-[23px] w-[86px] rounded-full" />
              <Skeleton className="h-[23px] w-[94px] rounded-full" />
              <Skeleton className="h-[23px] w-[78px] rounded-full" />
            </div>
          </div>
        ))}
      </div>
      <div className="mb-7 flex flex-col gap-2">
        <Skeleton className="h-[11px] w-[180px]" />
        <div className={cns(TREND_PLOT)}>
          {Array.from({ length: 30 }, (_unused, index) => (
            <Skeleton className="h-2 flex-1 rounded-t-xs" key={index} />
          ))}
        </div>
      </div>
      <h2 className="mb-3 text-h2">Download history</h2>
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
    </ProfilePageShell>
  )
}
