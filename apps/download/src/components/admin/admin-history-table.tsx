import type { DownloadJob } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import {
  ActivityArt,
  ActivityProgress,
  ActivityStatusChip,
  ActivityTypeChip,
} from 'src/components/activity/activity-cells'
import { AdminHistoryRequester } from 'src/components/admin/admin-history-cells'
import { Card } from 'src/components/ui/card'
import { DataTable } from 'src/components/ui/data-table'
import type { AdminFilters } from 'src/lib/admin-filters'
import { formatRelative } from 'src/lib/format'
import { mediaHref } from 'src/lib/media-route'
import type { Viewer } from 'src/lib/viewer'

const TITLE_LINK =
  'text-sm transition-colors duration-200 ease-uv hover:text-uv-hi'

export type AdminHistoryTableProps = {
  filters: AdminFilters
  jobs: readonly DownloadJob[]
  /** The instant every relative stamp on the page is measured against. */
  now: number
  viewer: Viewer | null
}

/**
 * The full download history as a table — `admin-dashboard.pug`'s desktop frame.
 *
 * ⚠️ This is **not** `/activity` reused. That feed is in-progress-only
 * (`JobQueryService.listActivity` filters on the in-progress set) and evicts a
 * row seconds after it finishes; this is the complete record, every status
 * including `completed`, `failed` and `cancelled`, with nothing leaving it. The
 * *cells* are shared with that feed — `ActivityArt`, `ActivityTypeChip`,
 * `ActivityStatusChip`, `ActivityProgress` are all plain functions of a
 * `DownloadJob` — because the columns say the same things about the same rows.
 * Only the requester cell differs, and it differs for one reason: see
 * `AdminHistoryRequester`.
 *
 * `DataTable` renders the `<table>` and carries every cell rule as a descendant
 * variant, so the rows below are plain markup with no classes on the cells
 * except the `!` overrides that have to beat those variants.
 */
export function AdminHistoryTable({
  filters,
  jobs,
  now,
  viewer,
}: AdminHistoryTableProps): JSX.Element {
  return (
    <Card className="px-1.5 pt-1 pb-1.5">
      <DataTable>
        <thead>
          <tr>
            <th className="w-[38%]">item</th>
            <th>type</th>
            <th>requester</th>
            <th>status</th>
            <th>progress</th>
            <th className="text-right!">started</th>
          </tr>
        </thead>
        {/*
          `stagger` deals the system's one entry motion out across the rows. It
          plays per element, so rows already on screen do not replay it when a
          further page is appended.
        */}
        <tbody className="stagger">
          {jobs.map(job => (
            <tr key={job.id}>
              <td>
                <div className="flex items-center gap-2.5">
                  <ActivityArt job={job} />
                  <a className={TITLE_LINK} href={mediaHref(job.media)}>
                    {job.media.title}
                  </a>
                </div>
              </td>
              <td>
                <ActivityTypeChip job={job} />
              </td>
              <td>
                <AdminHistoryRequester
                  avatarClassName="h-[22px] w-[22px] text-[9px]"
                  filters={filters}
                  job={job}
                  viewer={viewer}
                />
              </td>
              <td>
                <ActivityStatusChip job={job} />
              </td>
              <td>
                <ActivityProgress job={job} />
              </td>
              <td className="text-right! font-mono text-mono-sm tabular-nums text-ink-3">
                {formatRelative(job.createdAt, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Card>
  )
}
