'use client'

import type { Column } from '@lilnas/ui'
import { DataList, Icon, Panel } from '@lilnas/ui'
import type { DownloadJob } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import {
  ActivityArt,
  ActivityStatusChip,
  ActivityTypeChip,
} from 'src/components/activity/activity-cells'
import { formatRelative } from 'src/lib/format'
import { mediaHref } from 'src/lib/media-route'

const TITLE_LINK =
  'min-w-0 truncate text-[13.5px] font-medium transition-colors duration-200 ease-standard hover:text-accent-hi'

export type ProfileHistoryDataListProps = {
  jobs: readonly DownloadJob[]
  /** The instant every relative stamp on the page is measured against. */
  now: number
}

/**
 * One person's history as a `DataList`: a table from `sm` up, a card per row
 * below it, from a single column definition.
 *
 * No requester column — the page is already about one person — and, as on the
 * admin history, no progress column: the status badge says whether a row is
 * still moving.
 */
export function ProfileHistoryDataList({
  jobs,
  now,
}: ProfileHistoryDataListProps): JSX.Element {
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
          {job.hiddenAttribution ? (
            <span
              className="inline-flex shrink-0 text-ink-3"
              title="Hidden from other users"
            >
              <Icon className="size-3" name="eye-slash" />
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: job => <ActivityTypeChip job={job} />,
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
