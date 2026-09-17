import { cns } from '@lilnas/utils/cns'
import type { AdminStatsResponse } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import { formatCount } from 'src/components/admin/admin-stats'
import { Avatar } from 'src/components/ui/avatar'
import { Card } from 'src/components/ui/card'
import type { AdminFilters } from 'src/lib/admin-filters'
import { adminHref } from 'src/lib/admin-filters'
import { initials, UNKNOWN_VALUE } from 'src/lib/format'
import type { Viewer } from 'src/lib/viewer'

/** `admin-dashboard.pug`'s `lbRow`, divider and all. */
const ROW = cns(
  'flex items-center gap-3 px-1 py-2.5',
  '[&+&]:border-t [&+&]:border-line-soft',
)

const RANK = 'w-4 shrink-0 text-center font-mono text-mono-sm text-ink-4'

const NAME = cns(
  'min-w-0 flex-1 truncate text-sm',
  'transition-colors duration-200 ease-uv hover:text-ink hover:underline',
)

const COUNT = 'font-mono text-mono tabular-nums'

export type AdminLeaderboardProps = {
  filters: AdminFilters
  stats: AdminStatsResponse
  viewer: Viewer | null
}

/**
 * Top downloaders — `AdminStatsResponse.topRequesters`, in the order the server
 * ranked them.
 *
 * Rendered exactly as it arrives. The ordering (count descending, email as the
 * tiebreak) and the cut at `TOP_REQUESTERS_LIMIT` are `AdminStatsService`'s, and
 * re-sorting or re-slicing here would let this panel disagree with a figure the
 * same response already stated.
 *
 * ⚠️ The counts are **all time**, not windowed. Only `jobsPerDay` is windowed by
 * `days` (see `AdminStatsService`), so the window control — and the window the
 * stat tiles print — say nothing about this list.
 *
 * ⚠️ Service jobs are absent by construction: `countJobsByRequester` drops rows
 * with a null requester rather than bucketing them, so "everyone who downloaded
 * something" here means every *person*.
 *
 * Every name links, because the whole page is admin-only and therefore every
 * requester on it is someone the viewer is allowed to inspect — and the link
 * goes to this page's own requester filter, which is where a per-user history
 * lives (spec §12: a filter on this view, not a route of its own).
 */
export function AdminLeaderboard({
  filters,
  stats,
  viewer,
}: AdminLeaderboardProps): JSX.Element {
  if (stats.topRequesters.length === 0) {
    return (
      <Card className="px-3 py-4">
        <p className="font-mono text-mono-sm text-ink-4">
          {UNKNOWN_VALUE} nobody has downloaded anything yet
        </p>
      </Card>
    )
  }

  return (
    <Card className="px-3 pt-1 pb-2">
      {/*
        An ordered list, and named: the rank is the whole point, and the page
        holds a second list (the audit log) that a screen-reader user otherwise
        meets as an indistinguishable "list".
      */}
      <ol aria-label="Top downloaders" className="flex flex-col stagger">
        {stats.topRequesters.map((entry, index) => {
          const you = viewer !== null && viewer.email === entry.requesterEmail
          const href = adminHref({
            ...filters,
            requester: entry.requesterEmail,
          })

          return (
            <li className={ROW} key={entry.requesterEmail}>
              <span className={RANK}>{index + 1}</span>
              <Avatar
                href={href}
                initials={initials(entry.requesterEmail)}
                ring={you}
                title={
                  you ? `${entry.requesterEmail} · you` : entry.requesterEmail
                }
              />
              <a className={NAME} href={href}>
                {entry.requesterEmail}
              </a>
              <span className={cns(COUNT, you ? 'text-uv-hi' : 'text-ink-3')}>
                {formatCount(entry.count)}
              </span>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
