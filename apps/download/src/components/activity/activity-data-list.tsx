'use client'

import type { Column } from '@lilnas/ui'
import { DataList, Panel } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import {
  ActivityArt,
  ActivityProgress,
  ActivityStatusChip,
  ActivityTypeChip,
} from 'src/components/activity/activity-cells'
import {
  ActivityRequester,
  jobUpstreamSource,
} from 'src/components/activity/activity-requester'
import type { ActivityRow } from 'src/components/activity/activity-rows'
import { formatRelative } from 'src/lib/format'
import { mediaHref } from 'src/lib/media-route'
import type { Viewer } from 'src/lib/viewer'

/**
 * A row on its way off the feed, faded as a whole (`<tr>` and card `<li>`).
 *
 * Opacity only — a height collapse would make every row below it jump, which is
 * the "glitch" reading the departure exists to avoid. The transition runs
 * because the class flips on content that is already mounted; the row is
 * unmounted afterwards, by the feed.
 *
 * 60% rather than something fainter: the whole point of the pause before the row
 * goes is that its final status — `completed`, `failed`, `cancelled` — can still
 * be read, and a badge at 35% cannot be.
 *
 * Under `prefers-reduced-motion` the global clamp in `@lilnas/ui/theme.css`
 * shortens both this transition and the entry animation to 0.01ms.
 */
export const DEPARTING = 'opacity-60'
export const DEPARTING_TRANSITION =
  'transition-[background-color,opacity] duration-[420ms] ease-standard'

/** Rows after this one share its delay, so a long feed doesn't crawl in. */
const STAGGER_STEP_MS = 40
const STAGGER_MAX_ROWS = 8

const TITLE_LINK =
  'min-w-0 truncate text-[13.5px] font-medium transition-colors duration-200 ease-standard hover:text-accent-hi'

/**
 * The row's own state: the departure marker and fade, and a staggered rise for
 * a row that has just mounted.
 *
 * The rise is `backwards`-filled, not the `both` that `--animate-rise` carries:
 * a held `opacity: 1` would outrank the departing class. A departing row drops
 * the animation altogether, so its opacity transitions from 1 to 60%.
 */
function rowProps(row: ActivityRow, index: number) {
  if (row.departing) {
    return {
      className: cns(DEPARTING_TRANSITION, DEPARTING),
      'data-departing': 'true',
    }
  }

  return {
    className: DEPARTING_TRANSITION,
    style: {
      animation: 'var(--animate-rise)',
      animationDelay: `${Math.min(index, STAGGER_MAX_ROWS) * STAGGER_STEP_MS}ms`,
      animationFillMode: 'backwards',
    },
  }
}

export type ActivityDataListProps = {
  /** The instant every relative stamp on the page is measured against. */
  now: number
  rows: readonly ActivityRow[]
  viewer: Viewer | null
}

/**
 * The feed as one `DataList`: a table from `sm` up, a card per row below it,
 * both from this single column definition so the two cannot drift.
 *
 * ⚠️ The title is a link, where the mockup draws plain text. A row's detail page
 * is where a download can be paused or cancelled, so the row that tells you
 * something is stuck is exactly the row you want to be able to act from.
 */
export function ActivityDataList({
  now,
  rows,
  viewer,
}: ActivityDataListProps): JSX.Element {
  const columns: Column<ActivityRow>[] = [
    {
      key: 'item',
      header: 'Item',
      primary: true,
      render: row => (
        <div className="flex items-center gap-3">
          <ActivityArt job={row.job} />
          <a className={TITLE_LINK} href={mediaHref(row.job.media)}>
            {row.job.media.title}
          </a>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: row => <ActivityTypeChip job={row.job} />,
    },
    {
      key: 'requester',
      header: 'Requested by',
      render: row => (
        <ActivityRequester
          avatarSize={24}
          nameClassName="text-sm text-ink-2"
          discordRequester={row.job.discordRequester}
          linkedDiscord={row.job.linkedDiscord}
          requester={row.job.requester}
          upstreamSource={jobUpstreamSource(row.job)}
          viewer={viewer}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: row => <ActivityStatusChip job={row.job} />,
    },
    {
      key: 'progress',
      header: 'Progress',
      render: row => <ActivityProgress job={row.job} />,
    },
    {
      key: 'started',
      header: 'Started',
      align: 'right',
      render: row => (
        <span className="text-ink-3 tabular-nums">
          {formatRelative(row.job.createdAt, now)}
        </span>
      ),
    },
  ]

  return (
    <Panel>
      <DataList
        caption="Downloads in flight"
        cardBreakpoint="sm"
        columns={columns}
        rowKey={row => row.job.id}
        rowProps={rowProps}
        rows={rows}
      />
    </Panel>
  )
}
