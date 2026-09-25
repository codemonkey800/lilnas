import { cns } from '@lilnas/utils/cns'
import type { AdminStatsResponse } from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'
import type { JSX, ReactNode } from 'react'

import { Card } from 'src/components/ui/card'
import { Bar, Dot } from 'src/components/ui/status'
import { isInProgress } from 'src/lib/format'

/**
 * Thousands separators, computed rather than delegated to `toLocaleString`.
 *
 * The figure is rendered on the server and again on hydration, and an
 * `Intl.NumberFormat` whose ICU data differs between the two would be a
 * hydration mismatch on a number nobody would think to suspect. A regex over
 * the digits has no locale to disagree about.
 */
export function formatCount(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * How many jobs fall inside the stats window.
 *
 * ⚠️ `jobsPerDay` is **sparse**: a day on which nothing was downloaded has no
 * row at all, rather than a `{ count: 0 }` one, and a `(day, type)` pair is a
 * row rather than a day being a row. Summing is therefore the whole of the
 * gap-handling this figure needs — an absent day contributes nothing, which is
 * exactly right, and no densified axis has to be invented to get there.
 */
export function windowJobTotal(stats: AdminStatsResponse): number {
  return stats.jobsPerDay.reduce((total, row) => total + row.count, 0)
}

/** How many jobs carry a given status, or `0` when the status never occurred. */
function countByStatus(
  stats: AdminStatsResponse,
  status: DownloadJobStatus,
): number {
  return stats.totalsByStatus.find(row => row.status === status)?.count ?? 0
}

/**
 * How many jobs are open work right now.
 *
 * Derived through `isInProgress` — the complement of
 * `TERMINAL_DOWNLOAD_JOB_STATUSES` — rather than from a list of statuses
 * written here, so a status added upstream is counted as running unless it is
 * explicitly declared terminal.
 */
export function runningJobTotal(stats: AdminStatsResponse): number {
  return stats.totalsByStatus
    .filter(row => isInProgress(row.status))
    .reduce((total, row) => total + row.count, 0)
}

/**
 * The value. Mono and tabular — it changes, so it must not jitter.
 *
 * `admin-dashboard.pug` writes this `text-[32px]` on desktop and `text-[26px]`
 * on mobile, which the mockup can express as two separate renders and the real
 * app expresses as one responsive element.
 */
const STAT_VALUE = cns(
  'font-mono text-[26px] leading-[1.1] font-semibold tracking-[-0.02em] tabular-nums',
  'sm:text-[32px]',
)

const STAT_LABEL = cns(
  'font-mono text-label uppercase',
  // After the `text-label` token, which carries its own tracking: a font-size
  // utility clears a preceding `tracking-*` through tailwind-merge.
  'tracking-[0.11em] text-ink-4',
)

/** The licensed `ink-4`: a short machine annotation, never a sentence. */
const STAT_FOOT = 'font-mono text-mono-sm text-ink-4'

type StatTileProps = {
  /** A 0-100 share, drawn under the value. Omitted draws no bar. */
  bar?: number
  foot: ReactNode
  /**
   * The tile's name. A `ReactNode` rather than a `string` because
   * `admin-dashboard.pug`'s `statTile` takes a `labelMobile` — at 390px a
   * two-column tile is 124px wide inside its padding and a long label wraps,
   * which makes one tile in the row taller than the others.
   */
  label: ReactNode
  /**
   * Marks the figure as something happening right now — the breathing dot and
   * the `ok` ink from `admin-dashboard.pug`'s `stat.live`.
   */
  live?: boolean
  value: number
}

/**
 * One headline number. `admin-dashboard.pug`'s `statTile` mixin, including its
 * optional `+bar` — which is the mockup's own answer to "a tile that wants to
 * show a proportion", and the reason this page draws no trend chart (the
 * `trend` mixin lives only in `profile.pug`).
 */
function StatTile({
  bar,
  foot,
  label,
  live = false,
  value,
}: StatTileProps): JSX.Element {
  return (
    <Card className="flex flex-col gap-[7px] px-5 pt-[18px] pb-5">
      <span className={STAT_LABEL}>{label}</span>
      {live ? (
        <span className="flex items-center gap-2">
          <Dot tone="live" />
          <span className={cns(STAT_VALUE, 'text-ok')}>
            {formatCount(value)}
          </span>
        </span>
      ) : (
        <span className={STAT_VALUE}>{formatCount(value)}</span>
      )}
      {bar === undefined ? null : (
        // `role="presentation"` — the figure above it is the same fact in
        // words, and a progress bar announced beside it reads the tile twice.
        <Bar className="mt-px" pct={bar} role="presentation" />
      )}
      <span className={STAT_FOOT}>{foot}</span>
    </Card>
  )
}

export type AdminStatsProps = {
  stats: AdminStatsResponse
}

/**
 * The dashboard's four headline numbers.
 *
 * ## What the API can and cannot answer
 *
 * `admin-dashboard.mjs` draws *total downloads*, *active users*, *storage used*
 * and *currently running*. `GET /download/admin/stats` returns `totalJobs`,
 * `totalsByStatus`, `totalsByType`, `topRequesters` and `jobsPerDay` — there is
 * no storage figure anywhere in the API, and `topRequesters` is capped at 20
 * server-side so its length is a floor on "how many users" rather than a count.
 * Both mockup tiles are therefore replaced with figures that are actually true:
 * the windowed job count and the completed count.
 *
 * ## `windowDays`, and why the filter's `days` never appears here
 *
 * ⚠️ The window printed under the second tile is `stats.windowDays` — what the
 * backend **applied** — never what the URL asked for. The two genuinely differ:
 * `AdminStatsQuerySchema` defaults an absent `days` to 30 and bounds it to
 * 1-365, and the response is documented to echo the applied window precisely so
 * "a cached or clamped response still says which window it describes". This
 * component is not given the filters at all, which is what makes quoting the
 * wrong one impossible rather than merely discouraged.
 *
 * ⚠️ Also: only `jobsPerDay` is windowed. `totalJobs`, `totalsByStatus`,
 * `totalsByType` and `topRequesters` are all-time (see `AdminStatsService`), so
 * every other tile says "all time" and means it.
 */
export function AdminStats({ stats }: AdminStatsProps): JSX.Element {
  const windowTotal = windowJobTotal(stats)
  const completed = countByStatus(stats, DownloadJobStatus.Completed)
  const running = runningJobTotal(stats)
  const completedShare =
    stats.totalJobs > 0 ? (completed / stats.totalJobs) * 100 : 0

  return (
    <div className="mb-6 grid grid-cols-2 gap-[14px] sm:mb-8 sm:grid-cols-4">
      <StatTile
        foot="all time"
        label="total downloads"
        value={stats.totalJobs}
      />
      <StatTile
        foot={`last ${stats.windowDays} ${stats.windowDays === 1 ? 'day' : 'days'}`}
        label="recent downloads"
        value={windowTotal}
      />
      <StatTile
        bar={completedShare}
        foot={
          <>
            of {formatCount(stats.totalJobs)}
            <span className="hidden sm:inline"> all time</span>
          </>
        }
        label="completed"
        value={completed}
      />
      <StatTile
        foot={
          <>
            <span className="sm:hidden">in progress</span>
            <span className="hidden sm:inline">downloads in progress</span>
          </>
        }
        label={
          <>
            <span className="sm:hidden">running</span>
            <span className="hidden sm:inline">currently running</span>
          </>
        }
        live={running > 0}
        value={running}
      />
    </div>
  )
}
