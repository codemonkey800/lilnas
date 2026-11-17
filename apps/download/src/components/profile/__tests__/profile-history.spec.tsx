import '@testing-library/jest-dom'

import type { DownloadJob } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { loadProfileHistory } from 'src/app/actions/load-profile-history'
import ProfilePage from 'src/app/profile/page'
import { ProfileHistory } from 'src/components/profile/profile-history'
import { NOT_AUTHORIZED_TITLE } from 'src/components/shell/not-authorized'
import type { ProfileView } from 'src/lib/profile-data'
import {
  FOREIGN_PROFILE_DESCRIPTION,
  loadProfileView,
} from 'src/lib/profile-data'

jest.mock('src/lib/profile-data', () => ({
  ...jest.requireActual('src/lib/profile-data'),
  loadProfileView: jest.fn(),
}))

// The history imports the pagination action, whose module graph reaches
// `next/headers` — unavailable outside a request scope.
jest.mock('src/app/actions/load-profile-history', () => ({
  loadProfileHistory: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}))

const NOW = Date.parse('2026-09-11T12:00:00.000Z')

function job(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-11T11:58:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job_1',
    linkedDiscord: null,
    media: {
      id: 'tmdb:11660',
      title: 'Following',
      tmdbId: 11660,
      type: DownloadType.Movie,
    },
    requester: { email: 'jeremy@lilnas.io', userId: 'u_1' },
    status: DownloadJobStatus.Completed,
    updatedAt: '2026-09-11T11:58:00.000Z',
    ...overrides,
  }
}

type HistoryProps = Partial<Parameters<typeof ProfileHistory>[0]>

function renderHistory(props: HistoryProps = {}) {
  return render(
    <ProfileHistory
      filtered={false}
      initialJobs={[job()]}
      initialNextCursor={null}
      initialTotal={1}
      now={NOW}
      search=""
      you
      {...props}
    />,
  )
}

describe('ProfileHistory rows', () => {
  it('draws one DataList row per job, with the title linking to its page', () => {
    renderHistory({
      initialJobs: [
        job(),
        job({
          id: 'job_2',
          media: {
            id: 'video:abc',
            sourceUrl: 'https://youtube.com/watch?v=abc',
            title: 'Sourdough starter',
            type: DownloadType.Video,
          },
          status: DownloadJobStatus.Failed,
        }),
      ],
      initialTotal: 2,
    })

    const table = within(
      screen.getByRole('table', { name: 'Download history' }),
    )
    // The header row, then one row per job.
    expect(table.getAllByRole('row')).toHaveLength(3)
    expect(table.getByRole('link', { name: 'Following' })).toHaveAttribute(
      'href',
      '/movies/11660',
    )
    expect(
      table.getAllByRole('columnheader').map(cell => cell.textContent),
    ).toEqual(['Item', 'Type', 'Status', 'Started'])
  })

  it('names each row’s status with the app’s shared badge words', () => {
    renderHistory({
      initialJobs: [
        job({ status: DownloadJobStatus.Pending }),
        job({ id: 'job_2', status: DownloadJobStatus.Failed }),
      ],
    })
    const table = within(
      screen.getByRole('table', { name: 'Download history' }),
    )

    expect(table.getByText('Queued')).toBeInTheDocument()
    expect(table.getByText('Failed')).toBeInTheDocument()
  })

  it('renders the same rows as a card list below the table breakpoint', () => {
    renderHistory()

    const list = within(screen.getByRole('list', { name: 'Download history' }))

    expect(list.getByRole('link', { name: 'Following' })).toBeInTheDocument()
    expect(list.getByText('Completed')).toBeInTheDocument()
  })

  it('marks a row hidden from everyone else', () => {
    renderHistory({ initialJobs: [job({ hiddenAttribution: true })] })

    expect(
      screen.getAllByTitle('Hidden from other users').length,
    ).toBeGreaterThan(0)
  })

  it('appends the next page through the cursor, not the total', async () => {
    jest.mocked(loadProfileHistory).mockResolvedValue({
      items: [
        job({
          id: 'job_9',
          media: {
            id: 'tmdb:1',
            title: 'Paper Weather',
            tmdbId: 1,
            type: DownloadType.Movie,
          },
        }),
      ],
      nextCursor: null,
      total: 2,
    })

    renderHistory({
      initialNextCursor: 'cursor-1',
      initialTotal: 2,
      search: 'type=movie',
    })
    await userEvent.click(screen.getByRole('button', { name: /load more/i }))

    expect(loadProfileHistory).toHaveBeenCalledWith('type=movie', 'cursor-1')
    // One in the table and one in the card list, both in the tree under jsdom.
    expect(
      await screen.findAllByRole('link', { name: 'Paper Weather' }),
    ).toHaveLength(2)
  })
})

describe('ProfileHistory empty states', () => {
  it('tells your own empty profile it has no downloads yet', () => {
    renderHistory({ initialJobs: [], initialTotal: 0 })

    expect(
      screen.getByRole('heading', { name: 'No downloads yet' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Your downloads will show up here once you start one.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to library' }),
    ).toHaveAttribute('href', '/gallery')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('words somebody else’s empty profile in the third person', () => {
    renderHistory({ initialJobs: [], initialTotal: 0, you: false })

    expect(
      screen.getByText(
        'This person’s downloads will show up here once they start one.',
      ),
    ).toBeInTheDocument()
  })

  it('blames the filters, not the person, when a filter hid every row', () => {
    renderHistory({
      clearHref: '/profile?user=sam%40lilnas.io',
      filtered: true,
      initialJobs: [],
      initialTotal: 0,
    })

    expect(
      screen.getByRole('heading', { name: 'No downloads match these filters' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('No downloads yet')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/profile?user=sam%40lilnas.io',
    )
  })
})

describe('Profile not-authorized state', () => {
  it('renders the no-access empty state, with the library as its one way out', async () => {
    jest.mocked(loadProfileView).mockResolvedValue({
      forbidden: true,
      history: null,
      now: NOW,
      profile: null,
      requester: 'sam@lilnas.io',
      viewer: { email: 'jeremy@lilnas.io', isAdmin: false, userId: 'u_1' },
    } as unknown as ProfileView)

    render(
      await ProfilePage({
        searchParams: Promise.resolve({ user: 'sam@lilnas.io' }),
      }),
    )

    expect(
      screen.getByRole('heading', { level: 2, name: NOT_AUTHORIZED_TITLE }),
    ).toBeInTheDocument()
    expect(screen.getByText(FOREIGN_PROFILE_DESCRIPTION)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to library' }),
    ).toHaveAttribute('href', '/gallery')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
