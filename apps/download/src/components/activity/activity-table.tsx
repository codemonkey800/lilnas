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
import { Card } from 'src/components/ui/card'
import { DataTable } from 'src/components/ui/data-table'
import { formatRelative } from 'src/lib/format'
import { mediaHref } from 'src/lib/media-route'
import type { Viewer } from 'src/lib/viewer'

/**
 * A row on its way off the feed.
 *
 * Opacity only — a height collapse would make every row below it jump, which is
 * the "glitch" reading the departure exists to avoid. The transition runs
 * because the class flips on an element that is already mounted; the row is
 * unmounted afterwards, by the feed.
 *
 * ⚠️ `opacity-60!`, and the `!` is load-bearing. Both row stacks are `stagger`
 * children, and `stagger` ends in `animation: rise … forwards` — an animation
 * whose filled final value sits *above* normal author declarations in the
 * cascade, so a plain `opacity-60` here is simply ignored and the row leaves at
 * full strength. An important declaration outranks an animation (and is in turn
 * outranked by the transition, which is what keeps the fade smooth), and it also
 * survives the `prefers-reduced-motion` block's `opacity: 1` reset.
 *
 * 60% rather than something fainter: the whole point of the pause before the row
 * goes is that its final status — `completed`, `failed`, `cancelled` — can still
 * be read, and a chip at 35% cannot be.
 */
export const DEPARTING_ROW = 'opacity-60!'
export const ROW_TRANSITION = 'transition-opacity duration-[420ms] ease-uv'

const TITLE_LINK =
  'text-sm transition-colors duration-200 ease-uv hover:text-uv-hi'

export type ActivityTableProps = {
  /** The instant every relative stamp on the page is measured against. */
  now: number
  rows: readonly ActivityRow[]
  viewer: Viewer | null
}

/**
 * The feed as a table — `downloads-activity.pug`'s desktop frame.
 *
 * This is machine output being scanned, and columns are what scanning wants.
 * `DataTable` renders the `<table>` and carries every cell rule as a descendant
 * variant, so the rows below are plain markup with no classes on the cells
 * except the `!` overrides that have to beat those variants.
 *
 * ⚠️ The title is a link, where the mockup draws plain text. A row's detail page
 * is where a download can be paused or cancelled, so the row that tells you
 * something is stuck is exactly the row you want to be able to act from. Those
 * routes are built by a later wave and 404 today.
 */
export function ActivityTable({
  now,
  rows,
  viewer,
}: ActivityTableProps): JSX.Element {
  return (
    <Card className="px-1.5 pt-1 pb-1.5">
      <DataTable>
        <thead>
          <tr>
            <th className="w-[42%]">item</th>
            <th>type</th>
            <th>requester</th>
            <th>status</th>
            <th>progress</th>
            <th className="text-right!">started</th>
          </tr>
        </thead>
        {/*
          `stagger` deals the system's one entry motion out across the rows. It
          plays per element, so rows already on screen do not replay it and a
          row the gateway announces mid-session arrives with the same motion
          every other row arrived with.
        */}
        <tbody className="stagger">
          {rows.map(({ departing, job }) => (
            <tr
              className={cns(ROW_TRANSITION, departing && DEPARTING_ROW)}
              data-departing={departing ? 'true' : undefined}
              key={job.id}
            >
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
                <ActivityRequester
                  avatarClassName="h-[22px] w-[22px] text-[9px]"
                  discordRequester={job.discordRequester}
                  linkedDiscord={job.linkedDiscord}
                  requester={job.requester}
                  upstreamSource={jobUpstreamSource(job)}
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
