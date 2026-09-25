import type { ProfileResponse } from '@lilnas/utils/download/types'

const DAY_MS = 86_400_000

/**
 * `Sep 11`. Fixed locale and fixed time zone, both deliberately: this label is
 * rendered on the server and shipped as HTML, so a client-resolved locale would
 * relabel every bar on hydration, and a local-time zone would disagree with the
 * `YYYY-MM-DD` the API bucketed in UTC — a bar could read `Sep 10` while
 * carrying `2026-09-11`'s count.
 */
const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** One tick of the trend — a day that happened, whether or not anything did. */
export type ProfileTrendDay = {
  /** Every type's jobs on that day, summed. */
  count: number
  /** `YYYY-MM-DD`, UTC, exactly as `jobsPerDay` spells it. */
  day: string
  /** The human form of {@link ProfileTrendDay.day} — `Sep 11`. */
  label: string
}

export type FillJobsPerDayOptions = {
  /** `ProfileResponse.jobsPerDay`, sparse and split by type, as it arrives. */
  jobsPerDay: ProfileResponse['jobsPerDay']
  /** The instant the page is being rendered at, in epoch milliseconds. */
  now: number
  /**
   * `ProfileResponse.windowDays` — the window the API says it **actually**
   * applied, never a hardcoded 30. A request for 7 days answered with 7 and
   * charted across 30 would draw three weeks of invented silence.
   */
  windowDays: number
}

/**
 * Turns the API's sparse, type-split `jobsPerDay` into exactly `windowDays`
 * contiguous days, oldest first, with a zero on every day nothing happened.
 *
 * ## Why this exists at all
 *
 * `jobsPerDay` is a `GROUP BY` result: a day with no jobs produces no row, and
 * a day with a movie and two videos produces *two* rows. Charted as it arrives,
 * a fortnight of silence between two busy days would collapse into two
 * neighbouring bars and read as "downloads every day" — the chart would
 * misrepresent the shape of somebody's activity rather than merely look wrong.
 * So the gaps are filled here, once, as a pure function, and the component that
 * draws the bars never sees a sparse series.
 *
 * ## Where the window is anchored
 *
 * At the later of "today, in UTC" and the newest day the series mentions. The
 * `now`-derived end is the right answer in every normal case; taking the max
 * with the series is what keeps a bucket the backend already counted from
 * falling off the end of the chart when its clock and this process's disagree
 * across a midnight boundary.
 *
 * A day in the payload that falls *before* the window start is dropped — the
 * window is `windowDays` long by contract, and the alternative is a chart whose
 * width silently depends on its data.
 *
 * A `windowDays` that is not a positive integer yields an empty array rather
 * than a guess; `ProfileQuerySchema` clamps it to 1–365, so this is the
 * defensive branch, not a reachable one.
 */
export function fillJobsPerDay({
  jobsPerDay,
  now,
  windowDays,
}: FillJobsPerDayOptions): ProfileTrendDay[] {
  const span = Math.trunc(windowDays)

  if (!Number.isFinite(span) || span < 1) {
    return []
  }

  const counts = new Map<string, number>()

  for (const row of jobsPerDay) {
    counts.set(row.day, (counts.get(row.day) ?? 0) + row.count)
  }

  const end = windowEnd(counts, now)
  const days: ProfileTrendDay[] = []

  for (let offset = span - 1; offset >= 0; offset--) {
    const date = new Date(end - offset * DAY_MS)
    const day = date.toISOString().slice(0, 10)

    days.push({
      count: counts.get(day) ?? 0,
      day,
      label: DAY_LABEL.format(date),
    })
  }

  return days
}

/**
 * The UTC midnight the window ends on, in epoch milliseconds.
 *
 * An unparseable `day` string is ignored rather than poisoning the comparison
 * with `NaN`, which would make the window end wherever the first bad row said.
 */
function windowEnd(counts: ReadonlyMap<string, number>, now: number): number {
  let end = Math.floor(now / DAY_MS) * DAY_MS

  for (const day of counts.keys()) {
    const parsed = Date.parse(`${day}T00:00:00.000Z`)

    if (!Number.isNaN(parsed) && parsed > end) {
      end = parsed
    }
  }

  return end
}
