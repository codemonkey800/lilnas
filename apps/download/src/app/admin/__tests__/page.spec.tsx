import '@testing-library/jest-dom'

import type {
  AdminStatsResponse,
  AuditLogEntry,
  DownloadJob,
  DownloadPage,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'
import { useRouter } from 'next/navigation'

import AdminPage from 'src/app/admin/page'
import { NOT_AUTHORIZED_TITLE } from 'src/components/shell/not-authorized'
import type { AdminSearchParams } from 'src/lib/admin-filters'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { getViewer } from 'src/lib/viewer'

jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

jest.mock('src/lib/viewer', () => ({ getViewer: jest.fn() }))

// The history island imports the pagination action, whose module graph reaches
// `next/headers` — unavailable outside a request scope.
jest.mock('src/app/actions/load-admin-history', () => ({
  loadAdminHistoryPage: jest.fn(),
}))

jest.mock('next/navigation', () => ({ useRouter: jest.fn() }))

const JEREMY = 'jeremy@lilnas.io'
const SAM = 'sam@lilnas.io'

function job(id: string, email: string | null, title: string): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-16T11:48:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id,
    linkedDiscord: null,
    media: { id: `tmdb:${id}`, title, tmdbId: 1, type: DownloadType.Movie },
    requester: email === null ? null : { email, userId: `u_${email}` },
    status: DownloadJobStatus.Completed,
    updatedAt: '2026-09-16T11:59:00.000Z',
  }
}

const AUDIT_ENTRY: AuditLogEntry = {
  action: 'video.create',
  actor: null,
  createdAt: '2026-09-16T11:42:08.000Z',
  discordActor: null,
  id: 1,
  metadata: null,
  origin: 'service',
  targetId: 'job-1',
  targetType: 'job',
}

const STATS: AdminStatsResponse = {
  jobsPerDay: [{ count: 4, day: '2026-09-16', type: DownloadType.Movie }],
  topRequesters: [
    { count: 9, requesterEmail: JEREMY },
    { count: 4, requesterEmail: SAM },
  ],
  totalJobs: 13,
  totalsByStatus: [{ count: 13, status: DownloadJobStatus.Completed }],
  totalsByType: [{ count: 13, type: DownloadType.Movie }],
  windowDays: 30,
}

type HistoryQueryish = { requester?: string; status?: unknown; type?: unknown }

const getStats = jest.fn<Promise<AdminStatsResponse>, [unknown]>()
const getAuditLog = jest.fn<Promise<DownloadPage<AuditLogEntry>>, [unknown]>()
const getHistory = jest.fn<
  Promise<DownloadPage<DownloadJob>>,
  [HistoryQueryish | undefined]
>()

async function renderPage(searchParams: AdminSearchParams = {}) {
  return render(
    await AdminPage({ searchParams: Promise.resolve(searchParams) }),
  )
}

beforeEach(() => {
  getStats.mockResolvedValue(STATS)
  getAuditLog.mockResolvedValue({
    items: [AUDIT_ENTRY],
    nextCursor: null,
    total: 1,
  })
  getHistory.mockImplementation(async query => {
    const rows =
      query?.requester === SAM
        ? [job('s1', SAM, 'Paper Weather')]
        : [job('j1', JEREMY, 'Salt & Ceremony')]

    return { items: rows, nextCursor: null, total: rows.length }
  })

  jest.mocked(getIdentifiedDownloadClient).mockResolvedValue({
    getAuditLog,
    getHistory,
    getStats,
  } as unknown as Awaited<ReturnType<typeof getIdentifiedDownloadClient>>)
  jest.mocked(getViewer).mockResolvedValue({
    email: JEREMY,
    isAdmin: true,
    userId: `u_${JEREMY}`,
  })
  jest.mocked(useRouter).mockReturnValue({
    push: jest.fn(),
  } as unknown as ReturnType<typeof useRouter>)
})

describe('AdminPage — the gate', () => {
  it('shows a regular user the not-authorized panel, not the dashboard', async () => {
    jest
      .mocked(getViewer)
      .mockResolvedValue({ email: SAM, isAdmin: false, userId: 'u_sam' })

    await renderPage()

    expect(screen.getByText(NOT_AUTHORIZED_TITLE)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('Top downloaders')).not.toBeInTheDocument()
  })

  // The gate runs before anything is fetched, so a non-admin's request never
  // even asks the backend for rows it would have to discard.
  it('fetches nothing at all for a non-admin', async () => {
    jest
      .mocked(getViewer)
      .mockResolvedValue({ email: SAM, isAdmin: false, userId: 'u_sam' })

    await renderPage()

    expect(getStats).not.toHaveBeenCalled()
    expect(getHistory).not.toHaveBeenCalled()
    expect(getAuditLog).not.toHaveBeenCalled()
  })

  // `null` is an unresolved identity, not "not an admin" — different facts,
  // same answer, because neither is one this page can act on and telling a
  // stranger which applies to them is what an access message must not do.
  it('treats an unresolved identity the same as a non-admin', async () => {
    jest.mocked(getViewer).mockResolvedValue(null)

    await renderPage()

    expect(screen.getByText(NOT_AUTHORIZED_TITLE)).toBeInTheDocument()
    expect(getStats).not.toHaveBeenCalled()
  })

  it('still titles the document for a screen reader when access is refused', async () => {
    jest.mocked(getViewer).mockResolvedValue(null)

    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Admin dashboard' }),
    ).toBeInTheDocument()
  })

  it('renders the dashboard for an admin', async () => {
    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Admin dashboard' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Top downloaders')).toBeInTheDocument()
    expect(screen.getByText('Audit log')).toBeInTheDocument()
    expect(screen.queryByText(NOT_AUTHORIZED_TITLE)).not.toBeInTheDocument()
  })

  // Never `DownloadClient.localInstance`: without the forwarded identity the
  // backend answers 401 and the admin routes would never be reached at all.
  it('reads through the identified client', async () => {
    await renderPage()

    expect(getIdentifiedDownloadClient).toHaveBeenCalled()
  })
})

describe('AdminPage — the requester filter', () => {
  // Per-user history is a filter on this view, not a page of its own.
  it('scopes the history to one requester when the URL names one', async () => {
    await renderPage({ requester: SAM })

    expect(getHistory).toHaveBeenCalledTimes(1)
    expect(getHistory).toHaveBeenCalledWith(
      expect.objectContaining({ requester: SAM }),
    )
    expect(
      within(screen.getByRole('table')).getByText('Paper Weather'),
    ).toBeVisible()
    expect(
      within(screen.getByRole('table')).queryByText('Salt & Ceremony'),
    ).not.toBeInTheDocument()
  })

  // One call, not one per known requester: `?scope=all` is the backend's own
  // every-requester scope. ⚠️ Omitting `requester` would *not* do this — it
  // means the caller's own history, so the admin would be shown their own rows
  // under a heading claiming to be the whole system's.
  it('asks for the every-requester scope by name when the URL names none', async () => {
    await renderPage()

    expect(getHistory).toHaveBeenCalledTimes(1)
    expect(getHistory).toHaveBeenCalledWith(
      expect.objectContaining({ requester: undefined, scope: 'all' }),
    )
  })

  it('scopes the audit log to the same person', async () => {
    await renderPage({ requester: SAM })

    expect(getAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actor: SAM }),
    )
  })

  it('leaves the audit log unscoped when no requester is named', async () => {
    await renderPage()

    expect(getAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actor: undefined }),
    )
  })

  it('offers a chip that removes the requester filter', async () => {
    await renderPage({ requester: SAM })

    expect(
      screen.getByRole('button', { name: `Remove requester filter ${SAM}` }),
    ).toBeInTheDocument()
  })

  it('draws no filter chips when nothing is applied', async () => {
    await renderPage()

    expect(screen.queryByLabelText('Active filters')).not.toBeInTheDocument()
  })

  // The leaderboard is the page's requester picker: a per-user history is this
  // same view with `?requester=` set, so a row links here rather than to a
  // profile route that would answer a different question.
  it('links every leaderboard row into its own filtered view', async () => {
    await renderPage()
    const board = within(screen.getByRole('list', { name: 'Top downloaders' }))

    expect(
      board.getAllByRole('link').map(link => link.getAttribute('href')),
    ).toEqual(
      expect.arrayContaining([
        '/admin?requester=jeremy%40lilnas.io',
        '/admin?requester=sam%40lilnas.io',
      ]),
    )
    expect(board.getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('AdminPage — the stats window', () => {
  it('passes a requested window through to the backend', async () => {
    await renderPage({ days: '90' })

    expect(getStats).toHaveBeenCalledWith({ days: 90 })
  })

  it('omits an out-of-range window rather than sending a 400', async () => {
    await renderPage({ days: '9999' })

    expect(getStats).toHaveBeenCalledWith({ days: undefined })
  })

  // ⚠️ The page renders the window the response *applied*, never the one the
  // URL asked for — that is the whole contract of `windowDays`.
  it('renders the applied window, not the requested one', async () => {
    getStats.mockResolvedValue({ ...STATS, windowDays: 30 })

    await renderPage({ days: '365' })

    expect(screen.getByText('last 30 days')).toBeInTheDocument()
    expect(screen.queryByText('last 365 days')).not.toBeInTheDocument()
  })
})

describe('AdminPage — attribution', () => {
  // The hidden-attribution mask never applies here: `AdminGuard` is what makes
  // true attribution safe, so a video hidden from everyone else is named, and
  // marked as such.
  it('names the requester of a video hidden from everyone else', async () => {
    getHistory.mockResolvedValue({
      items: [
        {
          ...job('v1', SAM, 'the only kettlebell move'),
          hiddenAttribution: true,
        },
      ],
      nextCursor: null,
      total: 1,
    })

    await renderPage({ requester: SAM })
    const table = within(screen.getByRole('table'))

    expect(table.getByText(SAM)).toBeInTheDocument()
    expect(table.queryByText('hidden')).not.toBeInTheDocument()
    expect(table.getByLabelText('Hidden from other users')).toBeInTheDocument()
  })

  // The other `null`: a service-created job has no requester at all, and the
  // masked-avatar branch other pages use would name a person who does not exist.
  it('renders a service-created job as the service', async () => {
    getHistory.mockResolvedValue({
      items: [job('v2', null, 'A service job')],
      nextCursor: null,
      total: 1,
    })

    await renderPage({ requester: SAM })
    const table = within(screen.getByRole('table'))

    expect(table.getByText('service')).toBeInTheDocument()
    expect(table.queryByText('hidden')).not.toBeInTheDocument()
  })
})

describe('AdminPage — the history table', () => {
  // Not `/activity` reused: that feed is in-progress-only and evicts a row
  // seconds after it finishes.
  it('shows terminal rows, which the activity feed never does', async () => {
    getHistory.mockResolvedValue({
      items: [
        {
          ...job('c1', JEREMY, 'Completed thing'),
          status: DownloadJobStatus.Completed,
        },
        {
          ...job('f1', JEREMY, 'Failed thing'),
          status: DownloadJobStatus.Failed,
        },
        {
          ...job('x1', JEREMY, 'Cancelled thing'),
          status: DownloadJobStatus.Cancelled,
        },
      ],
      nextCursor: null,
      total: 3,
    })

    await renderPage({ requester: JEREMY })
    const table = within(screen.getByRole('table'))

    expect(table.getByText('completed')).toBeInTheDocument()
    expect(table.getByText('failed')).toBeInTheDocument()
    expect(table.getByText('cancelled')).toBeInTheDocument()
  })

  it('has its own empty state, split by whether anything is filtered', async () => {
    getHistory.mockResolvedValue({ items: [], nextCursor: null, total: 0 })

    const { unmount } = await renderPage({ requester: SAM })
    expect(
      screen.getByText('Nothing matches these filters'),
    ).toBeInTheDocument()
    unmount()

    getStats.mockResolvedValue({ ...STATS, topRequesters: [] })
    await renderPage()
    expect(screen.getByText('No downloads yet')).toBeInTheDocument()
  })
})
