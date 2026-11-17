import { Card, Skeleton } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import {
  ADMIN_SECTION_HEADING,
  ADMIN_TITLE,
  ADMIN_TITLE_TEXT,
  AdminPageShell,
} from 'src/components/admin/admin-page-shell'

/** The four stat tiles the real page draws. */
const PLACEHOLDER_TILES = 4

/**
 * Five rows. The real first page is 24, but a skeleton is a promise about
 * layout rather than about count, and five is a screenful without implying a
 * busier history than the install has.
 */
const PLACEHOLDER_ROWS = 5

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
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: PLACEHOLDER_TILES }, (_unused, index) => (
          <Card className="flex flex-col gap-3" key={index}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-28" />
          </Card>
        ))}
      </div>
      <h2 className={cns('mb-3', ADMIN_SECTION_HEADING)}>Download history</h2>
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
    </AdminPageShell>
  )
}
