import '@testing-library/jest-dom'

import type { DownloadJob, DownloadPage } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'
import { useRouter } from 'next/navigation'

import ActivityPage from 'src/app/activity/page'
import type { ActivitySearchParams } from 'src/lib/activity-filters'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { getViewer } from 'src/lib/viewer'

jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

jest.mock('src/lib/viewer', () => ({ getViewer: jest.fn() }))

// The feed imports the pagination action, whose module graph reaches
// `next/headers` — unavailable outside a request scope.
jest.mock('src/app/actions/load-activity-page', () => ({
  loadActivityPage: jest.fn(),
}))

jest.mock('next/navigation', () => ({ useRouter: jest.fn() }))

const JOB: DownloadJob = {
  completedAt: null,
  createdAt: '2026-09-15T11:48:00.000Z',
  discordRequester: null,
  hiddenAttribution: false,
  id: 'job-1',
  linkedDiscord: null,
  media: {
    id: 'tmdb:11660',
    title: 'Following',
    tmdbId: 11660,
    type: DownloadType.Movie,
  },
  requester: { email: 'jeremy@lilnas.io', userId: 'u_jeremy' },
  status: DownloadJobStatus.Downloading,
  updatedAt: '2026-09-15T11:59:00.000Z',
}

const getActivity = jest.fn<Promise<DownloadPage<DownloadJob>>, [unknown]>()

function page(
  overrides: Partial<DownloadPage<DownloadJob>> = {},
): DownloadPage<DownloadJob> {
  return { items: [JOB], nextCursor: null, total: 1, ...overrides }
}

async function renderPage(searchParams: ActivitySearchParams = {}) {
  return render(
    await ActivityPage({ searchParams: Promise.resolve(searchParams) }),
  )
}

beforeEach(() => {
  getActivity.mockResolvedValue(page())
  jest
    .mocked(getIdentifiedDownloadClient)
    .mockResolvedValue({ getActivity } as unknown as Awaited<
      ReturnType<typeof getIdentifiedDownloadClient>
    >)
  jest.mocked(getViewer).mockResolvedValue({
    email: 'jeremy@lilnas.io',
    isAdmin: false,
    userId: 'u_jeremy',
  })
  jest.mocked(useRouter).mockReturnValue({
    push: jest.fn(),
  } as unknown as ReturnType<typeof useRouter>)
})

describe('ActivityPage', () => {
  it('reads the type filter out of the URL rather than from client state', async () => {
    await renderPage({ type: 'movie,show' })

    expect(getActivity).toHaveBeenCalledWith({
      cursor: undefined,
      type: [DownloadType.Movie, DownloadType.Show],
    })
  })

  it('asks for everything when the path carries no filter', async () => {
    await renderPage()

    expect(getActivity).toHaveBeenCalledWith({
      cursor: undefined,
      type: undefined,
    })
  })

  // Never `DownloadClient.localInstance`: without the forwarded identity the
  // backend would mask every requester as an anonymous service call.
  it('reads through the identified client', async () => {
    await renderPage()

    expect(getIdentifiedDownloadClient).toHaveBeenCalled()
  })

  it('renders the first page under a heading and a filter strip', async () => {
    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Downloads activity' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(
      within(screen.getByRole('table')).getByText('Following'),
    ).toBeVisible()
  })

  // `useJobEvents()` throws without a provider, so this rendering at all is
  // the assertion that `/activity` mounts one. It is mounted here rather than
  // in `layout.tsx` so that no other route opens a gateway socket.
  it('mounts the live-events provider the feed needs', async () => {
    await expect(renderPage()).resolves.toBeDefined()
  })

  it('shows the empty state for an idle machine', async () => {
    getActivity.mockResolvedValue(page({ items: [], total: 0 }))

    await renderPage()

    expect(screen.getByText('Nothing in flight')).toBeInTheDocument()
  })
})
