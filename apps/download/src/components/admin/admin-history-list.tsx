import type { DownloadJob } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import {
  ActivityArt,
  ActivityStatusChip,
} from 'src/components/activity/activity-cells'
import { mobileStatusLabel } from 'src/components/activity/activity-rows'
import { AdminHistoryRequester } from 'src/components/admin/admin-history-cells'
import { Card } from 'src/components/ui/card'
import { StateLine } from 'src/components/ui/state-line'
import type { AdminFilters } from 'src/lib/admin-filters'
import { formatRelative } from 'src/lib/format'
import { mediaHref } from 'src/lib/media-route'
import type { Viewer } from 'src/lib/viewer'

/**
 * `admin-dashboard.pug`'s mobile row, which is `StateLine`'s shape with a
 * tighter gap and no inline padding — the card around it supplies that. The
 * divider between consecutive rows comes from `StateLine`'s own
 * `[&+&]:border-t`, so a stack needs no separator elements and no first-child
 * case.
 */
const MOBILE_ROW = 'gap-3 px-0'

const TITLE_LINK =
  'min-w-0 flex-1 truncate text-sm transition-colors duration-200 ease-uv hover:text-uv-hi'

export type AdminHistoryListProps = {
  filters: AdminFilters
  jobs: readonly DownloadJob[]
  /** The instant every relative stamp on the page is measured against. */
  now: number
  viewer: Viewer | null
}

/**
 * The history as stacked rows — `admin-dashboard.pug`'s mobile frame.
 *
 * Six columns will not fit at 390px, so each row folds into two lines carrying
 * the same facts in the same order: title and age above, who and what-state
 * below. The percentage moves into the status chip, which is the only place
 * left for it (see `mobileStatusLabel`).
 *
 * ⚠️ The requester keeps its avatar *and* its eye-slash marker here, where
 * `ActivityList` drops to the avatar alone. The marker is the one fact on this
 * page that exists nowhere else — it says an admin is seeing something every
 * other user sees masked — and a 12px glyph is affordable where a full email is
 * not.
 */
export function AdminHistoryList({
  filters,
  jobs,
  now,
  viewer,
}: AdminHistoryListProps): JSX.Element {
  return (
    <Card className="px-3 py-1">
      <div className="flex flex-col stagger">
        {jobs.map(job => (
          <StateLine className={MOBILE_ROW} key={job.id}>
            <ActivityArt job={job} />
            <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
              <span className="flex items-center justify-between gap-2">
                <a className={TITLE_LINK} href={mediaHref(job.media)}>
                  {job.media.title}
                </a>
                <span className="font-mono text-mono-sm tabular-nums text-ink-4">
                  {formatRelative(job.createdAt, now)}
                </span>
              </span>
              <span className="flex items-center justify-between gap-2">
                <AdminHistoryRequester
                  avatarClassName="h-[18px] w-[18px] text-[8px]"
                  filters={filters}
                  job={job}
                  nameless
                  viewer={viewer}
                />
                <ActivityStatusChip
                  className="h-5 shrink-0"
                  job={job}
                  label={mobileStatusLabel(job)}
                />
              </span>
            </div>
          </StateLine>
        ))}
      </div>
    </Card>
  )
}
