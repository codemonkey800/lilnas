import '@testing-library/jest-dom'

import type { AdminStatsResponse } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import {
  AdminStats,
  formatCount,
  runningJobTotal,
  windowJobTotal,
} from 'src/components/admin/admin-stats'

function stats(
  overrides: Partial<AdminStatsResponse> = {},
): AdminStatsResponse {
  return {
    jobsPerDay: [],
    topRequesters: [],
    totalJobs: 0,
    totalsByStatus: [],
    totalsByType: [],
    windowDays: 30,
    ...overrides,
  }
}

describe('AdminStats — windowDays', () => {
  // ⚠️ The response echoes the window that was *applied*, which can differ from
  // the one that was asked for (`AdminStatsQuerySchema` defaults an absent
  // `days` to 30 and bounds it to 1-365, and a cached response describes the
  // window it was computed for). The component is never given the filters, so
  // it can only render what came back.
  it('renders the window the response reports, not the one that was requested', () => {
    render(<AdminStats stats={stats({ windowDays: 30 })} />)

    expect(screen.getByText('last 30 days')).toBeInTheDocument()
    expect(screen.queryByText('last 365 days')).not.toBeInTheDocument()
  })

  it('follows the response when it clamps down to the schema default', () => {
    const { rerender } = render(<AdminStats stats={stats({ windowDays: 7 })} />)
    expect(screen.getByText('last 7 days')).toBeInTheDocument()

    // Same page, same URL, a response that now says a different window — the
    // tile has to move with it.
    rerender(<AdminStats stats={stats({ windowDays: 30 })} />)
    expect(screen.getByText('last 30 days')).toBeInTheDocument()
    expect(screen.queryByText('last 7 days')).not.toBeInTheDocument()
  })

  it('says day, singular, for a one-day window', () => {
    render(<AdminStats stats={stats({ windowDays: 1 })} />)

    expect(screen.getByText('last 1 day')).toBeInTheDocument()
  })
})

describe('windowJobTotal', () => {
  // ⚠️ `jobsPerDay` is sparse: a day with no jobs has no row at all, and a
  // (day, type) pair is a row rather than a day being one. Summing is the whole
  // of the gap-handling this figure needs — no densified axis to invent.
  it('sums a sparse series without inventing the missing days', () => {
    expect(
      windowJobTotal(
        stats({
          jobsPerDay: [
            { count: 3, day: '2026-09-10', type: DownloadType.Video },
            { count: 1, day: '2026-09-10', type: DownloadType.Movie },
            // 2026-09-11 through 2026-09-15 are absent, not zero.
            { count: 2, day: '2026-09-16', type: DownloadType.Show },
          ],
        }),
      ),
    ).toBe(6)
  })

  it('is zero for a window nothing happened in', () => {
    expect(windowJobTotal(stats())).toBe(0)
  })
})

describe('runningJobTotal', () => {
  // Derived through `isInProgress` — the complement of the terminal set — so a
  // status added upstream counts as running unless declared terminal.
  it('counts every non-terminal status and no terminal one', () => {
    const response = stats({
      totalsByStatus: [
        { count: 2, status: DownloadJobStatus.Downloading },
        { count: 1, status: DownloadJobStatus.Paused },
        { count: 4, status: DownloadJobStatus.Completed },
        { count: 3, status: DownloadJobStatus.Failed },
        { count: 1, status: DownloadJobStatus.Cancelled },
      ],
    })

    expect(runningJobTotal(response)).toBe(3)
  })
})

describe('AdminStats — the tiles', () => {
  it('renders the all-time total and the completed share', () => {
    render(
      <AdminStats
        stats={stats({
          totalJobs: 1842,
          totalsByStatus: [
            { count: 921, status: DownloadJobStatus.Completed },
            { count: 2, status: DownloadJobStatus.Downloading },
          ],
        })}
      />,
    )

    expect(screen.getByText('1,842')).toBeInTheDocument()
    expect(screen.getByText('921')).toBeInTheDocument()
    // The all-time totals say so: only `jobsPerDay` is windowed by `days`, so
    // every other tile has to state the scope it actually describes.
    expect(screen.getAllByText('all time').length).toBeGreaterThan(0)
    expect(screen.getByText(/of 1,842/)).toBeInTheDocument()
  })

  it('marks the running tile live only while something is running', () => {
    const { container, rerender } = render(
      <AdminStats
        stats={stats({
          totalsByStatus: [{ count: 2, status: DownloadJobStatus.Downloading }],
        })}
      />,
    )

    expect(container.querySelector('.dot-live')).not.toBeNull()

    rerender(
      <AdminStats
        stats={stats({
          totalsByStatus: [{ count: 2, status: DownloadJobStatus.Completed }],
        })}
      />,
    )

    expect(container.querySelector('.dot-live')).toBeNull()
  })

  // The bar is decoration beside a figure that already states the fact; a
  // progress bar announced next to it reads the tile twice.
  it('keeps the share bar out of the accessibility tree', () => {
    render(<AdminStats stats={stats({ totalJobs: 10 })} />)

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})

describe('formatCount', () => {
  // Locale-free on purpose: an `Intl.NumberFormat` whose ICU data differs
  // between the server render and hydration would be a mismatch on a number
  // nobody would think to suspect.
  it('groups thousands without consulting a locale', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1842)).toBe('1,842')
    expect(formatCount(1234567)).toBe('1,234,567')
  })
})
