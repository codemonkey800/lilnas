import '@testing-library/jest-dom'

import type { DownloadJob, Movie } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { act, render, screen, within } from '@testing-library/react'

import {
  MOVIE_STALE_LABEL,
  MOVIE_WATCH_LABEL,
} from 'src/components/detail/movie-detail'
import { MovieDetailLive } from 'src/components/detail/movie-detail-live'
import { JobEventsProvider } from 'src/components/live/job-events'
import {
  buildJobFrame,
  buildMediaFrame,
  createSocketRecorder,
  NO_JITTER,
  TEST_LOCATION,
} from 'src/lib/__tests__/helpers/job-events'

// ⚠️ Deliberately no `next/navigation` mock: nothing on this page may ask the
// router for anything. A `useRouter()` call here would throw outside an app
// router, which is the assertion.

const MOVIE_ID = 'tmdb:920'

const NOW = Date.parse('2026-09-15T12:00:00.000Z')

const WATCH_URL = 'https://emby.lilnas.io/web/index.html#!/item?id=cars'

const DOWNLOADING: Movie = {
  id: MOVIE_ID,
  queueSnapshot: { progress: 62, status: 'downloading', timeLeft: '00:04:00' },
  state: 'downloading',
  title: 'Cars',
  tmdbId: 920,
  type: DownloadType.Movie,
  year: 2006,
}

/** A job someone started from Discord — the page never server-rendered it. */
const DISCORD_JOB: DownloadJob = {
  completedAt: null,
  createdAt: '2026-09-15T11:58:00.000Z',
  discordRequester: { discordUserId: '1234', discordUsername: 'lightning' },
  hiddenAttribution: false,
  id: 'job-from-discord',
  linkedDiscord: null,
  media: DOWNLOADING,
  requester: null,
  status: DownloadJobStatus.Downloading,
  updatedAt: '2026-09-15T11:58:00.000Z',
}

function setup(jobs: readonly DownloadJob[] = []) {
  const recorder = createSocketRecorder()

  render(
    <JobEventsProvider
      createSocket={recorder.createSocket}
      getLocation={() => TEST_LOCATION}
      random={NO_JITTER}
    >
      <MovieDetailLive jobs={jobs} media={DOWNLOADING} now={NOW} />
    </JobEventsProvider>,
  )

  const send = (frame: string) =>
    act(() => recorder.latest().emitMessage(frame))

  return { recorder, send }
}

function attempts(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Attempts' })
}

function mediaStatus(): Element | null {
  return document.querySelector('div[data-state]')
}

describe('MovieDetailLive', () => {
  it('renders the served movie before any frame arrives', () => {
    setup()

    expect(mediaStatus()).toHaveAttribute('data-state', 'downloading')
    expect(attempts()).not.toBeInTheDocument()
  })

  it('lands a Discord-started attempt it never server-rendered, by media id', () => {
    const { send } = setup()

    send(buildJobFrame(DISCORD_JOB))

    const list = attempts()
    expect(list).toBeInTheDocument()
    expect(
      (list as HTMLElement).querySelector(`[data-job-id="${DISCORD_JOB.id}"]`),
    ).toBeInstanceOf(HTMLElement)
  })

  it('ignores an attempt at some other movie', () => {
    const { send } = setup()

    send(
      buildJobFrame({
        ...DISCORD_JOB,
        id: 'job-elsewhere',
        media: { ...DOWNLOADING, id: 'tmdb:1', title: 'Elsewhere' },
      }),
    )

    expect(attempts()).not.toBeInTheDocument()
  })

  it('flips the chip to "in library" off a media frame, with no server re-render', () => {
    const { send } = setup()

    send(
      buildMediaFrame({
        ...DOWNLOADING,
        embyStatus: { itemId: 'cars', state: 'indexed', watchUrl: WATCH_URL },
        filePath: '/storage/media-library/movies/Cars (2006)/cars.mkv',
        queueSnapshot: undefined,
        state: 'available',
      }),
    )

    expect(mediaStatus()).toHaveAttribute('data-state', 'available')
    expect(
      within(mediaStatus() as HTMLElement).getByText('in library'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    // The file and the Watch link ride in on the same frame.
    expect(
      screen.getByRole('link', { name: MOVIE_WATCH_LABEL }),
    ).toHaveAttribute('href', WATCH_URL)
  })

  it('shows reconnecting while a download is moving and the socket is down, not once it opens', () => {
    const { recorder } = setup()

    expect(screen.getByText(MOVIE_STALE_LABEL)).toBeInTheDocument()

    act(() => recorder.latest().emitOpen())

    expect(screen.queryByText(MOVIE_STALE_LABEL)).not.toBeInTheDocument()
  })
})
