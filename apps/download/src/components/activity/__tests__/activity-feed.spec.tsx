import '@testing-library/jest-dom'

import type { DownloadJob } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { act, render, screen, within } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import type { ComponentProps } from 'react'

import {
  ActivityFeed,
  DEPARTURE_MS,
} from 'src/components/activity/activity-feed'
import { JobEventsProvider } from 'src/components/live/job-events'
import {
  buildJobFrame,
  createSocketRecorder,
  NO_JITTER,
  TEST_LOCATION,
} from 'src/lib/__tests__/helpers/job-events'
import { EMPTY_ACTIVITY_FILTERS } from 'src/lib/activity-filters'
import type { Viewer } from 'src/lib/viewer'

// The feed imports the pagination action, whose module graph reaches
// `next/headers` — unavailable outside a request scope.
jest.mock('src/app/actions/load-activity-page', () => ({
  loadActivityPage: jest.fn(),
}))

jest.mock('next/navigation', () => ({ useRouter: jest.fn() }))

const NOW = Date.parse('2026-09-15T12:00:00.000Z')

const VIEWER: Viewer = {
  email: 'jeremy@lilnas.io',
  isAdmin: false,
  userId: 'u_jeremy',
}

function video(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-15T11:58:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-video',
    linkedDiscord: null,
    media: {
      id: 'video:v1',
      sourceUrl: 'https://example.com/v1',
      title: 'Sourdough starter',
      type: DownloadType.Video,
    },
    requester: { email: 'jeremy@lilnas.io', userId: 'u_jeremy' },
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:59:00.000Z',
    ...overrides,
  }
}

function movie(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-15T11:40:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-movie',
    linkedDiscord: null,
    media: {
      id: 'tmdb:438631',
      queueSnapshot: { progress: 31 },
      title: 'Salt & Ceremony',
      tmdbId: 438631,
      type: DownloadType.Movie,
    },
    requester: null,
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:59:00.000Z',
    ...overrides,
  }
}

/** The desktop table, which is the one layout with every column in it. */
function table(): HTMLElement {
  return screen.getByRole('table')
}

function rowTitles(): string[] {
  return within(table())
    .getAllByRole('row')
    .slice(1)
    .map(row => row.querySelector('a')?.textContent ?? '')
}

function renderFeed(props: Partial<ComponentProps<typeof ActivityFeed>> = {}) {
  const recorder = createSocketRecorder()
  const view = render(
    <JobEventsProvider
      createSocket={recorder.createSocket}
      getLocation={() => TEST_LOCATION}
      random={NO_JITTER}
    >
      <ActivityFeed
        filters={EMPTY_ACTIVITY_FILTERS}
        initialJobs={[video()]}
        initialNextCursor={null}
        initialTotal={1}
        now={NOW}
        search=""
        viewer={VIEWER}
        {...props}
      />
    </JobEventsProvider>,
  )

  return { ...view, recorder }
}

function emit(
  recorder: ReturnType<typeof createSocketRecorder>,
  job: DownloadJob,
): void {
  act(() => recorder.latest().emitMessage(buildJobFrame(job)))
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.mocked(useRouter).mockReturnValue({
    push: jest.fn(),
  } as unknown as ReturnType<typeof useRouter>)
})

afterEach(() => {
  jest.useRealTimers()
})

describe('ActivityFeed', () => {
  it('renders the server-rendered first page before any frame arrives', () => {
    renderFeed()

    expect(rowTitles()).toEqual(['Sourdough starter'])
  })

  it('opens exactly one socket for the whole page', () => {
    const { recorder } = renderFeed()

    expect(recorder.sockets).toHaveLength(1)
  })

  // The hook upserts and never evicts; taking a finished job off the feed is
  // this component's job, and it is the whole point of the page.
  it.each([
    DownloadJobStatus.Completed,
    DownloadJobStatus.Failed,
    DownloadJobStatus.Cancelled,
  ])('removes a row when the job reaches %s', status => {
    const { recorder } = renderFeed()

    emit(recorder, video({ status }))

    // First it stays, wearing the status that ended it — a row that blinked
    // out the instant the frame landed would read as a rendering fault.
    const departing = within(table()).getAllByRole('row')[1]
    expect(departing).toHaveAttribute('data-departing', 'true')
    expect(within(departing as HTMLElement).getByText(status)).toBeVisible()

    act(() => jest.advanceTimersByTime(DEPARTURE_MS))

    expect(screen.queryByText('Sourdough starter')).not.toBeInTheDocument()
  })

  // `paused`/`pausing` are in-progress by being absent from the terminal set.
  it.each([DownloadJobStatus.Paused, DownloadJobStatus.Pausing])(
    'keeps a row when the job reaches %s',
    status => {
      const { recorder } = renderFeed()

      emit(recorder, video({ status }))
      act(() => jest.advanceTimersByTime(DEPARTURE_MS * 2))

      expect(rowTitles()).toEqual(['Sourdough starter'])
      expect(within(table()).getByText(status)).toBeVisible()
    },
  )

  it('adds a job the gateway announces that the server page never had', () => {
    const { recorder } = renderFeed()

    emit(recorder, movie())

    expect(rowTitles()).toEqual(['Sourdough starter', 'Salt & Ceremony'])
  })

  it('applies the URL’s type filter to live jobs too', () => {
    const { recorder } = renderFeed({
      filters: { types: [DownloadType.Video] },
      search: 'type=video',
    })

    emit(recorder, movie())

    expect(rowTitles()).toEqual(['Sourdough starter'])
  })

  it('shows the idle empty state when nothing is in flight', () => {
    renderFeed({ initialJobs: [], initialTotal: 0 })

    expect(screen.getByText('Nothing in flight')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('blames the filter, not the machine, for a filtered empty feed', () => {
    renderFeed({
      filters: { types: [DownloadType.Show] },
      initialJobs: [],
      initialTotal: 0,
      search: 'type=show',
    })

    expect(
      screen.getByText('Nothing of this kind is downloading'),
    ).toBeInTheDocument()
  })

  it('falls back to the empty state once the last row has departed', () => {
    const { recorder } = renderFeed()

    emit(recorder, video({ status: DownloadJobStatus.Completed }))
    act(() => jest.advanceTimersByTime(DEPARTURE_MS))

    expect(screen.getByText('Nothing in flight')).toBeInTheDocument()
  })

  it('says it is reconnecting until a socket is actually open', () => {
    const { recorder } = renderFeed()

    expect(screen.getByText('reconnecting…')).toBeInTheDocument()

    act(() => recorder.latest().emitOpen())
    expect(screen.getByText(/in flight/)).toBeInTheDocument()

    act(() => recorder.latest().emitClose())
    expect(screen.getByText('reconnecting…')).toBeInTheDocument()
  })

  it('counts only the rows that are still in flight', () => {
    const { recorder } = renderFeed()

    act(() => recorder.latest().emitOpen())
    emit(recorder, movie())
    expect(screen.getByText(/2 in flight/)).toBeInTheDocument()

    emit(recorder, movie({ status: DownloadJobStatus.Completed }))
    expect(screen.getByText(/1 in flight/)).toBeInTheDocument()
  })

  it('announces a departure for anyone not watching the screen', () => {
    const { recorder } = renderFeed()

    emit(recorder, video({ status: DownloadJobStatus.Failed }))

    expect(screen.getByText('Sourdough starter — failed')).toBeInTheDocument()
  })

  // The filter is the URL's, not the component's — a filtered feed is a link
  // and the back button steps through filter changes.
  it('pushes the filter into the address bar rather than holding it', async () => {
    const push = jest.fn()
    jest
      .mocked(useRouter)
      .mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)

    renderFeed()
    await act(async () => {
      screen.getByRole('tab', { name: 'Movies' }).click()
    })

    expect(push).toHaveBeenCalledWith('/activity?type=movie', { scroll: false })
  })

  it('drops the filter again when All is chosen', async () => {
    const push = jest.fn()
    jest
      .mocked(useRouter)
      .mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)

    renderFeed({
      filters: { types: [DownloadType.Movie] },
      search: 'type=movie',
    })
    await act(async () => {
      screen.getByRole('tab', { name: 'All' }).click()
    })

    expect(push).toHaveBeenCalledWith('/activity', { scroll: false })
  })

  it('masks the attribution the server masked, and never links it', () => {
    const { recorder } = renderFeed({ initialJobs: [] })

    emit(recorder, movie())

    const row = within(table()).getAllByRole('row')[1] as HTMLElement
    expect(within(row).getByText('hidden')).toBeInTheDocument()
    expect(within(row).queryByRole('link', { name: /@/ })).toBeNull()
  })

  // Plan 022: the same nulls, adopted from Radarr's own UI rather than masked.
  it('credits an adopted download to Radarr on both layouts, never hidden', () => {
    const { recorder } = renderFeed({ initialJobs: [] })

    emit(recorder, movie({ startedUpstream: true }))

    const row = within(table()).getAllByRole('row')[1] as HTMLElement
    expect(within(row).getByText('Radarr')).toBeInTheDocument()
    // The table and the stacked mobile list, both in the tree under jsdom.
    expect(screen.getAllByText('Radarr')).toHaveLength(2)
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
  })
})
