import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { PROFILE_GROUP_LABEL } from 'src/components/profile/profile-page-shell'
import { Note } from 'src/components/ui/card'
import type { ProfileTrendDay } from 'src/lib/jobs-per-day'

/**
 * The floor a zero day is drawn at, as a percentage of the plot height, and the
 * band a non-zero day is drawn in.
 *
 * A zero is a short flat tick rather than nothing at all: a missing bar reads as
 * a hole in the chart, where a tick reads as "that day happened and nothing was
 * downloaded". And the shortest *real* bar starts well above that tick, so one
 * download on a busy month is still unmistakably a bar.
 */
const ZERO_HEIGHT_PCT = 6
const MIN_BAR_PCT = 15
const BAR_RANGE_PCT = 85

/** `profile.pug`'s `trend`: 64px of plot, bars growing up off the baseline. */
const TREND_PLOT = 'flex h-16 items-end gap-[3px]'

const TREND_BAR = 'flex-1 rounded-t-xs transition-[height] duration-200 ease-uv'

export type ProfileTrendProps = {
  /**
   * The window, gap-filled — exactly `windowDays` contiguous entries, oldest
   * first. Comes from `fillJobsPerDay`, never straight from `jobsPerDay`: the
   * API omits a day on which nothing happened, and charting that sparse series
   * would squeeze a fortnight of silence into one bar's width.
   */
  days: readonly ProfileTrendDay[]
  /**
   * `ProfileResponse.windowDays` — what the API says it actually applied, which
   * is what the caption states. Never assumed to be 30.
   */
  windowDays: number
}

/**
 * Downloads per day, as a bar per day.
 *
 * The bars are tall enough to compare and too small to read a number off, which
 * is the point: this answers "when was this person busy", and the history table
 * directly underneath answers everything else. Each bar carries its day and
 * count as a `title` for a pointer.
 *
 * ⚠️ The heights are inline styles, as they are in the mockup, because they are
 * data rather than design — a per-day percentage cannot be a utility class
 * without generating one class per possible value.
 *
 * The plot is one `role="img"` with a summary label rather than 30 announced
 * elements. A screen-reader user stepping through a month of bars learns
 * nothing; the total and the window are the facts the picture is carrying.
 */
export function ProfileTrend({
  days,
  windowDays,
}: ProfileTrendProps): JSX.Element {
  const total = days.reduce((sum, day) => sum + day.count, 0)
  const max = Math.max(...days.map(day => day.count), 1)

  return (
    <div className="mb-7 flex flex-col gap-2">
      <span className={cns(PROFILE_GROUP_LABEL)}>
        downloads per day · last {windowDays}
      </span>
      {days.length === 0 || total === 0 ? (
        <Note icon="activity">No activity in the selected window.</Note>
      ) : (
        <div
          aria-label={`${total} ${total === 1 ? 'download' : 'downloads'} over the last ${windowDays} days`}
          className={cns(TREND_PLOT)}
          role="img"
        >
          {days.map(day => (
            <div
              className={cns(
                TREND_BAR,
                day.count > 0 ? 'bg-uv/70' : 'bg-surface-3',
              )}
              key={day.day}
              style={{
                height:
                  day.count > 0
                    ? `${MIN_BAR_PCT + (day.count / max) * BAR_RANGE_PCT}%`
                    : `${ZERO_HEIGHT_PCT}%`,
              }}
              title={`${day.label} · ${day.count} ${
                day.count === 1 ? 'download' : 'downloads'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
