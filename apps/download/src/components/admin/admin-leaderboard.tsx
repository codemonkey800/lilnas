import { cns } from '@lilnas/utils/cns'
import type { AdminStatsResponse } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import { discordAvatarTitle } from 'src/components/activity/activity-requester'
import { DiscordIdentityMark } from 'src/components/activity/discord-identity-mark'
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
 * ⚠️ Service jobs are absent by construction: the repo counts drop rows with
 * no person behind them rather than bucketing them, so "everyone who downloaded
 * something" here means every *person* — web requesters and Discord submitters
 * alike, with a linked Discord account already folded into its email's row.
 *
 * Every email links, because the whole page is admin-only and therefore every
 * requester on it is someone the viewer is allowed to inspect — and the link
 * goes to this page's own requester filter, which is where a per-user history
 * lives (spec §12: a filter on this view, not a route of its own). An unclaimed
 * Discord account has no email for that filter to key on, so it renders like
 * `AdminActor`'s unlinked branch: handle plus `DiscordIdentityMark`, no link.
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
          const rank = <span className={RANK}>{index + 1}</span>
          const countCell = (tone: string) => (
            <span className={cns(COUNT, tone)}>{formatCount(entry.count)}</span>
          )

          if (entry.requesterEmail === null) {
            if (entry.discordRequester === null) {
              return null
            }

            const { discordUserId, discordUsername } = entry.discordRequester

            return (
              <li className={ROW} key={`discord:${discordUserId}`}>
                {rank}
                <Avatar
                  initials={initials(discordUsername)}
                  title={discordAvatarTitle(discordUsername)}
                />
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="truncate text-sm">{discordUsername}</span>
                  <DiscordIdentityMark
                    discordUserId={discordUserId}
                    discordUsername={discordUsername}
                  />
                </span>
                {countCell('text-ink-3')}
              </li>
            )
          }

          const email = entry.requesterEmail
          const you = viewer !== null && viewer.email === email
          const href = adminHref({ ...filters, requester: email })

          return (
            <li className={ROW} key={email}>
              {rank}
              <Avatar
                href={href}
                initials={initials(email)}
                ring={you}
                title={you ? `${email} · you` : email}
              />
              <a className={NAME} href={href}>
                {email}
              </a>
              {countCell(you ? 'text-uv-hi' : 'text-ink-3')}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
