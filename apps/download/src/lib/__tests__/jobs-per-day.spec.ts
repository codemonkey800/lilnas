import type { ProfileResponse } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'

import { fillJobsPerDay } from 'src/lib/jobs-per-day'

/** Noon UTC on 2026-09-11, so the day the window ends on is unambiguous. */
const NOW = Date.parse('2026-09-11T12:00:00.000Z')

type Row = ProfileResponse['jobsPerDay'][number]

function row(day: string, count: number, type = DownloadType.Video): Row {
  return { count, day, type }
}

function fill(jobsPerDay: Row[], windowDays = 30, now = NOW) {
  return fillJobsPerDay({ jobsPerDay, now, windowDays })
}

describe('fillJobsPerDay', () => {
  it('produces exactly `windowDays` contiguous days, oldest first', () => {
    const days = fill([row('2026-09-09', 3)], 7)

    expect(days).toHaveLength(7)
    expect(days.map(day => day.day)).toEqual([
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
    ])
  })

  it('puts a zero on every day the sparse payload omitted', () => {
    // This is the whole reason the helper exists: charted as it arrives, the
    // two busy days below would sit side by side and read as "downloads on
    // consecutive days".
    const days = fill([row('2026-09-05', 2), row('2026-09-11', 4)], 7)

    expect(days.map(day => day.count)).toEqual([2, 0, 0, 0, 0, 0, 4])
  })

  it('sums a day’s types into one bar', () => {
    // `jobsPerDay` is a GROUP BY over (day, type), so a day with a movie and
    // two videos is two rows, not one.
    const days = fill(
      [
        row('2026-09-11', 2, DownloadType.Video),
        row('2026-09-11', 1, DownloadType.Movie),
        row('2026-09-11', 3, DownloadType.Show),
      ],
      3,
    )

    expect(days.at(-1)?.count).toBe(6)
  })

  it('reads the window off what the API echoed, never a hardcoded 30', () => {
    expect(fill([], 7)).toHaveLength(7)
    expect(fill([], 90)).toHaveLength(90)
    expect(fill([], 1)).toHaveLength(1)
  })

  it('still fills the whole window when the payload is empty', () => {
    const days = fill([], 5)

    expect(days).toHaveLength(5)
    expect(days.every(day => day.count === 0)).toBe(true)
  })

  it('labels each day in UTC, so the label and the bucket agree', () => {
    // 23:30 UTC is already "tomorrow" in some local zones. A local-time label
    // would read `Sep 10` over a bar carrying `2026-09-11`'s count.
    const days = fill([], 2, Date.parse('2026-09-11T23:30:00.000Z'))

    expect(days.map(day => day.label)).toEqual(['Sep 10', 'Sep 11'])
  })

  it('keeps a bucket the backend counted past this process’s midnight', () => {
    // Clock skew across a day boundary: the backend has already rolled over to
    // the 12th and this process has not. Anchoring purely on `now` would drop
    // a day that was genuinely counted.
    const days = fill([row('2026-09-12', 5)], 3)

    expect(days.at(-1)).toMatchObject({ count: 5, day: '2026-09-12' })
    expect(days).toHaveLength(3)
  })

  it('drops a day that falls before the window rather than widening it', () => {
    const days = fill([row('2026-01-01', 9), row('2026-09-11', 1)], 3)

    expect(days).toHaveLength(3)
    expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(1)
  })

  it('ignores an unparseable day rather than anchoring the window on it', () => {
    const days = fill([row('not-a-date', 4), row('2026-09-11', 1)], 3)

    expect(days.map(day => day.day)).toEqual([
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
    ])
  })

  it('answers nothing for a window that is not a positive integer', () => {
    expect(fill([], 0)).toEqual([])
    expect(fill([], -1)).toEqual([])
    expect(fill([], Number.NaN)).toEqual([])
  })
})
