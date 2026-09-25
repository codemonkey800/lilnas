import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import {
  ActivityArt,
  ActivityStatusChip,
} from 'src/components/activity/activity-cells'
import {
  ActivityRequester,
  jobUpstreamSource,
} from 'src/components/activity/activity-requester'
import type { ActivityRow } from 'src/components/activity/activity-rows'
import { mobileStatusLabel } from 'src/components/activity/activity-rows'
import {
  DEPARTING_ROW,
  ROW_TRANSITION,
} from 'src/components/activity/activity-table'
import { Card } from 'src/components/ui/card'
import { StateLine } from 'src/components/ui/state-line'
import { formatRelative } from 'src/lib/format'
import { mediaHref } from 'src/lib/media-route'
import type { Viewer } from 'src/lib/viewer'

/**
 * `downloads-activity.pug`'s mobile row, which is `StateLine`'s shape with a
 * tighter gap and no inline padding — the card around it supplies that. The
 * divider between consecutive rows comes from `StateLine`'s own `[&+&]:border-t`,
 * so a stack needs no separator elements and no first-child case.
 */
const MOBILE_ROW = 'gap-3 px-0'

const TITLE_LINK =
  'min-w-0 flex-1 truncate text-sm transition-colors duration-200 ease-uv hover:text-uv-hi'

export type ActivityListProps = {
  /** The instant every relative stamp on the page is measured against. */
  now: number
  rows: readonly ActivityRow[]
  viewer: Viewer | null
}

/**
 * The feed as stacked rows — `downloads-activity.pug`'s mobile frame.
 *
 * Six columns will not fit at 390px, so each row folds into two lines carrying
 * the same facts in the same order: title and age above, who and what-state
 * below. The percentage moves into the status chip, which is the only place
 * left for it (see `mobileStatusLabel`).
 *
 * The requester here is the avatar alone. A row 318px wide cannot hold an email
 * beside a title without truncating one of them into uselessness, and the
 * avatar already carries the identity as its `title` and its initials.
 */
export function ActivityList({
  now,
  rows,
  viewer,
}: ActivityListProps): JSX.Element {
  return (
    <Card className="px-3 py-1">
      <div className="flex flex-col stagger">
        {rows.map(({ departing, job }) => (
          <StateLine
            className={cns(
              MOBILE_ROW,
              ROW_TRANSITION,
              departing && DEPARTING_ROW,
            )}
            data-departing={departing ? 'true' : undefined}
            key={job.id}
          >
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
                <ActivityRequester
                  avatarClassName="h-[18px] w-[18px] text-[8px]"
                  discordRequester={job.discordRequester}
                  linkedDiscord={job.linkedDiscord}
                  nameless
                  requester={job.requester}
                  upstreamSource={jobUpstreamSource(job)}
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
