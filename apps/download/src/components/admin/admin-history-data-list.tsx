'use client'

import type { Column } from '@lilnas/ui'
import { DataList, Panel } from '@lilnas/ui'
import type { DownloadJob } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import {
  ActivityArt,
  ActivityStatusChip,
  ActivityTypeChip,
} from 'src/components/activity/activity-cells'
import { AdminHistoryRequester } from 'src/components/admin/admin-history-cells'
import type { AdminFilters } from 'src/lib/admin-filters'
import { formatRelative } from 'src/lib/format'
import { mediaHref } from 'src/lib/media-route'
import type { Viewer } from 'src/lib/viewer'

const TITLE_LINK =
  'min-w-0 truncate text-[13.5px] font-medium transition-colors duration-200 ease-standard hover:text-accent-hi'

export type AdminHistoryDataListProps = {
  filters: AdminFilters
  jobs: readonly DownloadJob[]
  /** The instant every relative stamp on the page is measured against. */
  now: number
  viewer: Viewer | null
}

/**
 * The full download history as one `DataList` — a table from `sm` up, a card
 * per row below it, from a single column definition.
 *
 * ⚠️ This is **not** `/activity` reused. That feed is in-progress-only
 * (`JobQueryService.listActivity` filters on the in-progress set) and evicts a
 * row seconds after it finishes; this is the complete record, every status
 * including `completed`, `failed` and `cancelled`, with nothing leaving it. The
 * *cells* are shared with that feed — `ActivityArt`, `ActivityTypeChip` and
 * `ActivityStatusChip` are plain functions of a `DownloadJob` — because the
 * columns say the same things about the same rows. Only the requester cell
 * differs, and it differs for one reason: see `AdminHistoryRequester`.
 *
 * There is no progress column: the history is read to answer a question about
 * the past, and the status badge already says whether a row is still moving.
 */
export function AdminHistoryDataList({
  filters,
  jobs,
  now,
  viewer,
}: AdminHistoryDataListProps): JSX.Element {
  const columns: Column<DownloadJob>[] = [
    {
      key: 'item',
      header: 'Item',
      primary: true,
      render: job => (
        <div className="flex items-center gap-3">
          <ActivityArt job={job} />
          <a className={TITLE_LINK} href={mediaHref(job.media)}>
            {job.media.title}
          </a>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: job => <ActivityTypeChip job={job} />,
    },
    {
      key: 'requester',
      header: 'Requested by',
      render: job => (
        <AdminHistoryRequester
          avatarSize={24}
          filters={filters}
          job={job}
          nameClassName="text-sm text-ink-2"
          viewer={viewer}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: job => <ActivityStatusChip job={job} />,
    },
    {
      key: 'started',
      header: 'Started',
      align: 'right',
      render: job => (
        <span className="text-ink-3">{formatRelative(job.createdAt, now)}</span>
      ),
    },
  ]

  return (
    <Panel>
      <DataList
        caption="Download history"
        cardBreakpoint="sm"
        columns={columns}
        rowKey={job => job.id}
        rows={jobs}
      />
    </Panel>
  )
}
