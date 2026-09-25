import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import {
  ADMIN_TITLE,
  ADMIN_TITLE_TEXT,
  AdminPageShell,
} from 'src/components/admin/admin-page-shell'
import { Card } from 'src/components/ui/card'
import { Skeleton } from 'src/components/ui/feedback'

/** The four stat tiles the real page draws. */
const PLACEHOLDER_TILES = 4

/**
 * Eight rows. The real first page is 24, but a skeleton is a promise about
 * layout rather than about count, and eight is a screenful without implying a
 * busier log than the install has.
 */
const PLACEHOLDER_ROWS = 8

/** `DataTable`'s row rhythm: `px-3 py-3` cells over a `line-soft` rule. */
const ROW = cns(
  'flex items-center gap-2.5 border-b border-line-soft px-3 py-3',
  'last:border-b-0',
)

/**
 * The admin dashboard's loading state.
 *
 * Skeletons in the page's own geometry rather than a spinner, so when the data
 * lands nothing on the page moves. `Skeleton` is `aria-hidden` and carries no
 * size of its own, which is why every one of them is measured here.
 *
 * ⚠️ This is shown to a non-admin too — a route segment's `loading.tsx` renders
 * before its `page.tsx` has resolved anything, including who is asking. It
 * gives nothing away: an empty frame is what an admin sees for the same instant.
 */
export default function AdminLoading(): JSX.Element {
  return (
    <AdminPageShell aria-busy="true">
      <h1 className={ADMIN_TITLE}>{ADMIN_TITLE_TEXT}</h1>
      <div className="mb-6 grid grid-cols-2 gap-[14px] sm:mb-8 sm:grid-cols-4">
        {Array.from({ length: PLACEHOLDER_TILES }, (_unused, index) => (
          <Card
            className="flex flex-col gap-[7px] px-5 pt-[18px] pb-5"
            key={index}
          >
            <Skeleton className="h-[11px] w-[70%]" />
            <Skeleton className="h-[30px] w-[55%]" />
            <Skeleton className="h-[11px] w-[60%]" />
          </Card>
        ))}
      </div>
      <div className="mb-[14px] flex items-center justify-between gap-4">
        <Skeleton className="h-[18px] w-[150px]" />
        <Skeleton className="h-[23px] w-[80px] rounded-full" />
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
      <div className="mt-7 flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-5">
        <div className="sm:flex-[0_0_320px]">
          <Skeleton className="mb-3 h-[18px] w-[140px] sm:mb-[14px]" />
          <Card className="flex flex-col gap-[18px] px-3 py-4">
            {Array.from({ length: 5 }, (_unused, index) => (
              <Skeleton className="h-[13px] w-full" key={index} />
            ))}
          </Card>
        </div>
        <div className="min-w-0 sm:flex-1">
          <Skeleton className="mb-3 h-[18px] w-[100px] sm:mb-[14px]" />
          <Card className="flex flex-col gap-[14px] px-2.5 py-4" sunk>
            {Array.from({ length: 8 }, (_unused, index) => (
              <Skeleton className="h-[11px] w-full" key={index} />
            ))}
          </Card>
        </div>
      </div>
    </AdminPageShell>
  )
}
