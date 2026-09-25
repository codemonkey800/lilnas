import '@testing-library/jest-dom'

import type { DownloadJob, ProfileResponse } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter } from 'next/navigation'

import ProfilePage from 'src/app/profile/page'
import { NOT_AUTHORIZED_TITLE } from 'src/components/shell/not-authorized'
import type { ProfileView } from 'src/lib/profile-data'
import {
  FOREIGN_PROFILE_DESCRIPTION,
  loadProfileView,
} from 'src/lib/profile-data'
import type { ProfileSearchParams } from 'src/lib/profile-filters'
import { PROFILE_HREF } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'

// The page's own data loading is covered in src/lib/__tests__/profile-data.spec
// against a stubbed client; what this file is about is the rendering decisions
// the page makes with whatever that returns.
jest.mock('src/lib/profile-data', () => ({
  ...jest.requireActual('src/lib/profile-data'),
  loadProfileView: jest.fn(),
}))

// `ProfileHistory` imports the pagination action, whose module graph reaches
// `next/headers` — unavailable outside a request scope.
jest.mock('src/app/actions/load-profile-history', () => ({
  loadProfileHistory: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

const mockLoadView = jest.mocked(loadProfileView)
const push = jest.fn()

const NOW = Date.parse('2026-09-11T12:00:00.000Z')

const VIEWER: Viewer = {
  email: 'jeremy@lilnas.io',
  isAdmin: false,
  userId: 'u_1',
}

/**
 * Deliberately sparse, and deliberately not 30 days: `show` never occurred, no
 * status but `completed`/`failed` ever occurred, and the API says it applied a
 * 7-day window. All three are things the page must render as-is.
 */
const PROFILE: ProfileResponse = {
  firstDownloadAt: '2025-06-14T10:00:00.000Z',
  jobsPerDay: [{ count: 2, day: '2026-09-11', type: DownloadType.Video }],
  lastDownloadAt: '2026-09-11T11:58:00.000Z',
  totalsByStatus: [
    { count: 46, status: DownloadJobStatus.Completed },
    { count: 2, status: DownloadJobStatus.Failed },
  ],
  totalsByType: [
    { count: 41, type: DownloadType.Video },
    { count: 9, type: DownloadType.Movie },
  ],
  user: { email: 'jeremy@lilnas.io' },
  windowDays: 7,
}

function job(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-11T11:58:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job_1',
    linkedDiscord: null,
    media: {
      id: 'video:abc',
      sourceUrl: 'https://youtube.com/watch?v=abc',
      title: 'Sourdough starter, day one to seven',
      type: DownloadType.Video,
    },
    requester: { email: 'jeremy@lilnas.io', userId: 'u_1' },
    status: DownloadJobStatus.Completed,
    updatedAt: '2026-09-11T11:58:00.000Z',
    ...overrides,
  }
}

function view(overrides: Partial<ProfileView> = {}): ProfileView {
  return {
    forbidden: false,
    history: { items: [job()], nextCursor: null, total: 1 },
    now: NOW,
    profile: PROFILE,
    requester: 'jeremy@lilnas.io',
    viewer: VIEWER,
    ...overrides,
  } as ProfileView
}

async function renderPage(searchParams: ProfileSearchParams = {}) {
  return render(
    await ProfilePage({ searchParams: Promise.resolve(searchParams) }),
  )
}

/** The chips in one aggregate group, by their visible text. */
function chipsIn(label: string): string[] {
  const group = screen.getByText(label).parentElement

  return [...(group?.querySelectorAll('button') ?? [])].map(
    chip => chip.textContent ?? '',
  )
}

beforeEach(() => {
  jest
    .mocked(useRouter)
    .mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)
  mockLoadView.mockResolvedValue(view())
})

describe('ProfilePage route', () => {
  // The app bar's avatar has pointed here since the shell shipped, and 404'd
  // for as long as this page did not exist. `PROFILE_HREF` is now the app's
  // only spelling of the path, so the drift this once guarded against is
  // gone; what is left to pin is that the constant still names the directory
  // `src/app/profile/page.tsx` actually routes at, which no type can check.
  it('serves the route the app bar’s account link points at', () => {
    expect(PROFILE_HREF).toBe('/profile')
  })

  it('reads the filters out of the URL rather than from client state', async () => {
    await renderPage({
      status: 'failed',
      type: 'movie,video',
      user: 'sam@lilnas.io',
    })

    expect(mockLoadView).toHaveBeenCalledWith({
      statuses: [DownloadJobStatus.Failed],
      types: [DownloadType.Video, DownloadType.Movie],
      user: 'sam@lilnas.io',
    })
  })
})

describe('ProfilePage identity header', () => {
  it('names the person, with the first and last download either side', async () => {
    await renderPage()

    expect(screen.getByText('jeremy@lilnas.io')).toBeInTheDocument()
    expect(
      screen.getByText('First download Jun 14, 2025 · last 2m ago'),
    ).toBeInTheDocument()
  })

  it('marks your own profile as yours', async () => {
    await renderPage()

    expect(screen.getByText('you')).toBeInTheDocument()
  })

  it('does not call somebody else’s profile yours', async () => {
    mockLoadView.mockResolvedValue(
      view({
        profile: { ...PROFILE, user: { email: 'sam@lilnas.io' } },
        requester: 'sam@lilnas.io',
      }),
    )

    await renderPage({ user: 'sam@lilnas.io' })

    expect(screen.queryByText('you')).not.toBeInTheDocument()
  })
})

describe('ProfilePage aggregates', () => {
  it('renders the lifetime total as the sum of a sparse breakdown', async () => {
    await renderPage()

    // 41 + 9. There is no `totalJobs` field to read.
    expect(screen.getByText('50')).toBeInTheDocument()
  })

  it('renders zero for a profile whose breakdowns are entirely absent', async () => {
    mockLoadView.mockResolvedValue(
      view({
        history: { items: [], nextCursor: null, total: 0 },
        profile: {
          ...PROFILE,
          firstDownloadAt: null,
          jobsPerDay: [],
          lastDownloadAt: null,
          totalsByStatus: [],
          totalsByType: [],
        },
      }),
    )

    await renderPage()

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('No downloads yet')).toBeInTheDocument()
    // An empty group is an em dash, not an empty row.
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('emits no chip for a type or status that never occurred', async () => {
    await renderPage()

    expect(chipsIn('by type')).toEqual(['video · 41', 'movie · 9'])
    expect(chipsIn('by status')).toEqual(['completed · 46', 'failed · 2'])
  })

  it('renders the window the API actually applied, not an assumed 30', async () => {
    await renderPage()

    expect(screen.getByText(/downloads per day · last 7/)).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: /over the last 7 days/ }),
    ).toBeInTheDocument()
  })

  it('draws one tick per day of the window, gaps included', async () => {
    await renderPage()

    const plot = screen.getByRole('img', { name: /over the last 7 days/ })

    // Seven days for a payload carrying exactly one of them.
    expect(plot.children).toHaveLength(7)
  })

  it('says so rather than drawing a flat chart when nothing happened', async () => {
    mockLoadView.mockResolvedValue(
      view({ profile: { ...PROFILE, jobsPerDay: [] } }),
    )

    await renderPage()

    expect(
      screen.getByText('No activity in the selected window.'),
    ).toBeInTheDocument()
  })
})

describe('ProfilePage chips as filters', () => {
  it('keeps every chip at its lifetime count while a filter is applied', async () => {
    mockLoadView.mockResolvedValue(
      view({ history: { items: [], nextCursor: null, total: 0 } }),
    )

    await renderPage({ status: 'failed', type: 'movie' })

    // The history below is empty, and the counts have not moved an inch.
    expect(chipsIn('by type')).toEqual(['video · 41', 'movie · 9'])
    expect(chipsIn('by status')).toEqual(['completed · 46', 'failed · 2'])
  })

  it('marks an applied chip pressed, and only that one', async () => {
    await renderPage({ type: 'movie' })

    expect(screen.getByRole('button', { name: 'movie · 9' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'video · 41' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('reads an applied chip as filled rather than as its own status tone', async () => {
    await renderPage({ status: 'failed' })

    // `failed` is `bad` when idle; `active` overrides `tone` so a pressed chip
    // always reads as "applied".
    const chip = screen.getByRole('button', { name: 'failed · 2' })

    expect(chip.getAttribute('class')).toContain('bg-uv-ghost')
    expect(chip.getAttribute('class')).not.toContain('bg-bad-ghost')
  })

  it('puts the filter in the URL, so a filtered profile is a link', async () => {
    await renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'movie · 9' }))

    expect(push).toHaveBeenCalledWith('/profile?type=movie', { scroll: false })
  })

  it('multi-selects within a group rather than replacing', async () => {
    await renderPage({ type: 'video' })

    await userEvent.click(screen.getByRole('button', { name: 'movie · 9' }))

    expect(push).toHaveBeenCalledWith('/profile?type=video%2Cmovie', {
      scroll: false,
    })
  })

  it('composes type AND status across groups', async () => {
    await renderPage({ type: 'movie' })

    await userEvent.click(screen.getByRole('button', { name: 'failed · 2' }))

    expect(push).toHaveBeenCalledWith('/profile?type=movie&status=failed', {
      scroll: false,
    })
  })

  it('carries the subject of the page through a chip press', async () => {
    mockLoadView.mockResolvedValue(
      view({
        profile: { ...PROFILE, user: { email: 'sam@lilnas.io' } },
        requester: 'sam@lilnas.io',
      }),
    )

    await renderPage({ user: 'sam@lilnas.io' })
    await userEvent.click(screen.getByRole('button', { name: 'movie · 9' }))

    // Dropping `user` here would bounce an admin onto their own profile.
    expect(push).toHaveBeenCalledWith(
      '/profile?user=sam%40lilnas.io&type=movie',
      { scroll: false },
    )
  })

  it('shows what is applied as removable pills, above the table it scopes', async () => {
    await renderPage({ status: 'failed', type: 'movie' })

    const bar = screen.getByRole('group', { name: 'Active filters' })

    expect(
      within(bar).getByRole('button', { name: 'Remove movie filter' }),
    ).toBeInTheDocument()
    expect(
      within(bar).getByRole('button', { name: 'Remove failed filter' }),
    ).toBeInTheDocument()
  })

  it('has no applied-filter row at all when nothing is applied', async () => {
    await renderPage()

    expect(
      screen.queryByRole('group', { name: 'Active filters' }),
    ).not.toBeInTheDocument()
  })

  it('clears every chip without leaving the profile', async () => {
    mockLoadView.mockResolvedValue(
      view({
        profile: { ...PROFILE, user: { email: 'sam@lilnas.io' } },
        requester: 'sam@lilnas.io',
      }),
    )

    await renderPage({ status: 'failed', type: 'movie', user: 'sam@lilnas.io' })
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))

    expect(push).toHaveBeenCalledWith('/profile?user=sam%40lilnas.io', {
      scroll: false,
    })
  })
})

describe('ProfilePage history', () => {
  it('renders the rows without a requester column', async () => {
    await renderPage()

    expect(
      screen.getByText('Sourdough starter, day one to seven'),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('columnheader').map(cell => cell.textContent),
    ).toEqual(['item', 'type', 'status', 'progress', 'started'])
    // The page is already scoped to one person; the email appears once, in the
    // header, and never once per row.
    expect(screen.getAllByText('jeremy@lilnas.io')).toHaveLength(1)
  })

  it('still marks a row hidden from everyone else', async () => {
    mockLoadView.mockResolvedValue(
      view({
        history: {
          items: [job({ hiddenAttribution: true })],
          nextCursor: null,
          total: 1,
        },
      }),
    )

    await renderPage()

    expect(screen.getByTitle('Hidden from other users')).toBeInTheDocument()
  })

  // The two empty states are different facts and must never share copy.
  it('distinguishes "nothing matches these filters" from an empty profile', async () => {
    mockLoadView.mockResolvedValue(
      view({ history: { items: [], nextCursor: null, total: 0 } }),
    )

    await renderPage({ status: 'failed', type: 'movie' })

    expect(
      screen.getByText('No downloads match these filters.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('No downloads yet.')).not.toBeInTheDocument()
  })

  it('tells a profile with no jobs at all that it has none, not that a filter hid them', async () => {
    mockLoadView.mockResolvedValue(
      view({
        history: { items: [], nextCursor: null, total: 0 },
        profile: {
          ...PROFILE,
          firstDownloadAt: null,
          jobsPerDay: [],
          lastDownloadAt: null,
          totalsByStatus: [],
          totalsByType: [],
        },
      }),
    )

    await renderPage()

    expect(screen.getByText('No downloads yet.')).toBeInTheDocument()
    expect(
      screen.queryByText('No downloads match these filters.'),
    ).not.toBeInTheDocument()
  })
})

describe('ProfilePage access', () => {
  it('renders the not-authorized panel for a profile this viewer may not see', async () => {
    mockLoadView.mockResolvedValue(
      view({
        forbidden: true,
        history: null,
        profile: null,
        requester: 'sam@lilnas.io',
      }),
    )

    await renderPage({ user: 'sam@lilnas.io' })

    expect(
      screen.getByRole('heading', { level: 2, name: NOT_AUTHORIZED_TITLE }),
    ).toBeInTheDocument()
    expect(screen.getByText(FOREIGN_PROFILE_DESCRIPTION)).toBeInTheDocument()
  })

  it('leaks nothing about the profile it refused', async () => {
    mockLoadView.mockResolvedValue(
      view({
        forbidden: true,
        history: null,
        profile: null,
        requester: 'sam@lilnas.io',
      }),
    )

    await renderPage({ user: 'sam@lilnas.io' })

    expect(screen.queryByText('sam@lilnas.io')).not.toBeInTheDocument()
    expect(screen.queryByText(/lifetime downloads/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('still gives the refused page a heading of its own', async () => {
    mockLoadView.mockResolvedValue(
      view({ forbidden: true, history: null, profile: null }),
    )

    await renderPage({ user: 'sam@lilnas.io' })

    expect(
      screen.getByRole('heading', { level: 1, name: 'User profile' }),
    ).toHaveClass('sr-only')
  })
})
