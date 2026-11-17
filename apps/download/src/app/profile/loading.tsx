import { Card, Skeleton } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { ProfilePageShell } from 'src/components/profile/profile-page-shell'

/**
 * Four rows. The real first page is 24 (`LimitSchema`'s default) but a skeleton
 * is a promise about layout rather than about count, and most profiles are a
 * handful of rows long — a screenful of placeholders would promise a long
 * history and then deliver a short one.
 */
const PLACEHOLDER_ROWS = 4

export default function ProfileLoading(): JSX.Element {
  return (
    <ProfilePageShell aria-busy="true">
      <h1 className="sr-only">User profile</h1>
      <div className="mb-6 flex items-center gap-4">
        <Skeleton className="size-16 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
      <Card className="mb-6 flex w-fit min-w-[168px] flex-col gap-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-14" />
      </Card>
      <div className="mb-6 flex flex-wrap gap-2">
        {['w-[88px]', 'w-24', 'w-20', 'w-[104px]', 'w-[92px]'].map(width => (
          <Skeleton className={cns('h-8 rounded-md', width)} key={width} />
        ))}
      </div>
      <Skeleton className="mb-7 h-16 w-full sm:h-20" />
      <h2 className="mb-3 text-h2">Download history</h2>
      <div className="flex flex-col gap-2">
        {Array.from({ length: PLACEHOLDER_ROWS }, (_unused, index) => (
          <div
            className="flex items-center gap-4 rounded-lg border border-line bg-surface p-3"
            key={index}
          >
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="ml-auto h-6 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </ProfilePageShell>
  )
}
