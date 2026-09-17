import { cns } from '@lilnas/utils/cns'
import type { DownloadJob } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import {
  ActivityArt,
  ActivityProgress,
  ActivityStatusChip,
  ActivityTypeChip,
} from 'src/components/activity/activity-cells'
import { Card } from 'src/components/ui/card'
import { DataTable } from 'src/components/ui/data-table'
import { Icon } from 'src/components/ui/icon'
import { formatRelative } from 'src/lib/format'
import { mediaHref } from 'src/lib/media-route'

const TITLE_LINK =
  'text-sm transition-colors duration-200 ease-uv hover:text-uv-hi'

/**
 * `search.pug`'s narrow-viewport idiom for a table this wide: scroll it, do not
 * reflow it.
 *
 * ⚠️ A deviation from `profile.pug`, which draws the identical five-column
 * table at 390px. Measured inside the mockup's own mobile frame that table is
 * 564px wide in a 338px card, so `progress` and `started` are simply clipped
 * off by the frame's `overflow-hidden` — an artifact of the frame, not a mobile
 * design. `search.pug` hits the same problem with the same column count and
 * answers it exactly this way.
 */
const HISTORY_CARD = 'overflow-x-auto px-1.5 pt-1 pb-1.5 sm:overflow-x-visible'
const HISTORY_TABLE = 'min-w-[480px] sm:min-w-0'

export type ProfileHistoryTableProps = {
  jobs: readonly DownloadJob[]
  /** The instant every relative stamp in the table is measured against. */
  now: number
}

/**
 * One person's downloads, newest first.
 *
 * ⚠️ **No requester column**, unlike `/activity`'s otherwise-identical table.
 * The page is already scoped to one person, so attribution is page context
 * rather than a per-row fact, and a column repeating the same email down every
 * row would be the widest thing on screen saying the least.
 *
 * ⚠️ A job hidden from everyone else still shows the eye-slash marker rather
 * than going anonymous. On your own profile — or an admin's view of someone
 * else's — there is no oracle to defend: the row's owner is the subject of the
 * page, and the marker is telling you that *others* cannot see this one.
 *
 * ⚠️ The title is a link, where the mockup draws plain text — the same call
 * `ActivityTable` makes, for the same reason: the row that tells you something
 * went wrong is exactly the row you want to be able to act from.
 */
export function ProfileHistoryTable({
  jobs,
  now,
}: ProfileHistoryTableProps): JSX.Element {
  return (
    <Card className={cns(HISTORY_CARD)}>
      <DataTable className={cns(HISTORY_TABLE)}>
        <thead>
          <tr>
            <th className="w-[46%]">item</th>
            <th>type</th>
            <th>status</th>
            <th>progress</th>
            <th className="text-right!">started</th>
          </tr>
        </thead>
        {/*
          `stagger` deals the system's one entry motion out across the rows. It
          plays per element, so a page appended by "Load more" arrives with the
          same motion the first page arrived with instead of replaying it for
          rows that were already there.
        */}
        <tbody className="stagger">
          {jobs.map(job => (
            <tr key={job.id}>
              <td>
                <div className="flex items-center gap-2.5">
                  <ActivityArt job={job} />
                  <a className={cns(TITLE_LINK)} href={mediaHref(job.media)}>
                    {job.media.title}
                  </a>
                  {job.hiddenAttribution ? (
                    <span
                      className="inline-flex shrink-0 text-ink-4"
                      title="Hidden from other users"
                    >
                      <Icon className="h-3 w-3" name="eye-slash" />
                    </span>
                  ) : null}
                </div>
              </td>
              <td>
                <ActivityTypeChip job={job} />
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
