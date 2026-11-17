import { Panel, PanelHead, Table } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { AdminStatsResponse } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import {
  discordAvatarTitle,
  LINKED_DISCORD_TITLE,
  linkedDiscordLabel,
} from 'src/components/activity/activity-requester'
import { DiscordIdentityMark } from 'src/components/activity/discord-identity-mark'
import { formatCount } from 'src/components/admin/admin-stats'
import { PersonAvatar } from 'src/components/ui/person-avatar'
import type { AdminFilters } from 'src/lib/admin-filters'
import { adminHref } from 'src/lib/admin-filters'
import { initials } from 'src/lib/format'
import type { Viewer } from 'src/lib/viewer'

const RANK = 'w-8 text-center text-cap text-ink-3 tabular-nums'

const NAME = cns(
  'min-w-0 truncate text-sm',
  'transition-colors duration-200 ease-standard hover:text-ink hover:underline',
)

/** The email and, when the account has one, its linked handle. */
const NAME_RUN = 'flex min-w-0 flex-1 items-baseline gap-1.5'

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
 * alike, with a linked Discord account already folded into its email's row (which
 * still names that account's handle beside the email).
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
  return (
    <Panel>
      <PanelHead title="Top downloaders" />
      {stats.topRequesters.length === 0 ? (
        <p className="px-4 py-5 text-sm text-ink-3">
          Nobody has downloaded anything yet.
        </p>
      ) : (
        <Table.Root aria-label="Top downloaders">
          <Table.Head>
            <Table.Row>
              <Table.Th align="right" className="w-12 pl-4" scope="col">
                #
              </Table.Th>
              <Table.Th scope="col">Downloader</Table.Th>
              <Table.Th align="right" className="pr-4" scope="col">
                Downloads
              </Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {stats.topRequesters.map((entry, index) => (
              <LeaderRow
                entry={entry}
                filters={filters}
                key={
                  entry.requesterEmail ??
                  entry.discordRequester?.discordUserId ??
                  index
                }
                rank={index + 1}
                viewer={viewer}
              />
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Panel>
  )
}

type LeaderRowProps = {
  entry: AdminStatsResponse['topRequesters'][number]
  filters: AdminFilters
  rank: number
  viewer: Viewer | null
}

function LeaderRow({
  entry,
  filters,
  rank,
  viewer,
}: LeaderRowProps): JSX.Element | null {
  const rankCell = (
    <Table.Td align="right" className="pl-4">
      <span className={RANK}>{rank}</span>
    </Table.Td>
  )
  const countCell = (you: boolean) => (
    <Table.Td
      align="right"
      className={cns('pr-4 text-sm', you ? 'text-accent-hi' : 'text-ink-2')}
    >
      {formatCount(entry.count)}
    </Table.Td>
  )

  if (entry.requesterEmail === null) {
    if (entry.discordRequester === null) {
      return null
    }

    const { discordUserId, discordUsername } = entry.discordRequester

    return (
      <Table.Row>
        {rankCell}
        <Table.Td>
          <span className="flex min-w-0 items-center gap-3">
            <PersonAvatar
              initials={initials(discordUsername)}
              size={32}
              title={discordAvatarTitle(discordUsername)}
            />
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <span className="truncate text-sm">{discordUsername}</span>
              <DiscordIdentityMark
                discordUserId={discordUserId}
                discordUsername={discordUsername}
              />
            </span>
          </span>
        </Table.Td>
        {countCell(false)}
      </Table.Row>
    )
  }

  const email = entry.requesterEmail
  const you = viewer !== null && viewer.email === email
  const href = adminHref({ ...filters, requester: email })

  return (
    <Table.Row>
      {rankCell}
      <Table.Td>
        <span className="flex min-w-0 items-center gap-3">
          <PersonAvatar
            href={href}
            initials={initials(email)}
            ring={you}
            size={32}
            title={you ? `${email} · you` : email}
          />
          <span className={NAME_RUN}>
            <a className={NAME} href={href}>
              {email}
            </a>
            {/*
              Inert text, never a `DiscordIdentityMark` — same call as
              `AdminActor`: this says who the person also is, not that the row
              is an unclaimed account.
            */}
            {entry.linkedDiscord === null ? null : (
              <span
                className="shrink-0 truncate text-cap text-ink-3"
                title={LINKED_DISCORD_TITLE}
              >
                {linkedDiscordLabel(entry.linkedDiscord.discordUsername)}
              </span>
            )}
          </span>
        </span>
      </Table.Td>
      {countCell(you)}
    </Table.Row>
  )
}
