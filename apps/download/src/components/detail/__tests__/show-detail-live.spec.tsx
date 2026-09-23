import '@testing-library/jest-dom'

import type { DownloadJob, Season } from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'
import { act, render, screen, within } from '@testing-library/react'

import {
  episode,
  NOW,
  scopedJob,
  season,
  show,
} from 'src/components/detail/__tests__/fixtures/show'
import { SHOW_STALE_LABEL } from 'src/components/detail/show-detail'
import { ShowDetailLive } from 'src/components/detail/show-detail-live'
import { JobEventsProvider } from 'src/components/live/job-events'
import {
  buildJobFrame,
  buildMediaFrame,
  createSocketRecorder,
  NO_JITTER,
  TEST_LOCATION,
} from 'src/lib/__tests__/helpers/job-events'

/** Season 1: E1 on disk, E2 wanted — the one the live frames move. */
const S1: Season = season({
  episodeCount: 2,
  episodeFileCount: 1,
  episodes: [
    episode({ episodeNumber: 1, hasFile: true, id: 2430, seasonNumber: 1 }),
    episode({
      episodeNumber: 2,
      id: 2431,
      seasonNumber: 1,
      title: 'The Cap Table',
    }),
  ],
  seasonNumber: 1,
})

function renderLive(jobs: DownloadJob[] = []) {
  const recorder = createSocketRecorder()

  render(
    <JobEventsProvider
      createSocket={recorder.createSocket}
      getLocation={() => TEST_LOCATION}
      random={NO_JITTER}
    >
      <ShowDetailLive jobs={jobs} media={show()} now={NOW} seasons={[S1]} />
    </JobEventsProvider>,
  )

  const send = (frame: string) =>
    act(() => recorder.latest().emitMessage(frame))

  return { recorder, send }
}

/** The episode row for Sonarr's episode id `id`. */
function row(id: number): HTMLElement {
  const element = document.querySelector(`[data-episode-id="${id}"]`)

  if (!(element instanceof HTMLElement)) {
    throw new Error(`expected the row for episode ${id}`)
  }

  return element
}

describe('ShowDetailLive', () => {
  it('⚠️ moves a row’s chip and its season tab off a media frame — no refresh', () => {
    const { send } = renderLive()

    expect(within(row(2431)).getByText('wanted')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Season 1/ })).toHaveAccessibleName(
      'Season 1',
    )

    // Sonarr grabbed E2 on its own: nothing of ours is behind it.
    send(
      buildMediaFrame(
        show({
          queueSnapshot: { progress: 40, status: 'downloading' },
          state: 'downloading',
        }),
        [
          {
            episodeId: 2431,
            queueSnapshot: { progress: 40, status: 'downloading' },
            seasonNumber: 1,
            state: 'downloading',
          },
        ],
      ),
    )

    expect(within(row(2431)).getByText('downloading')).toBeInTheDocument()
    expect(
      within(row(2431)).getByRole('progressbar', {
        name: 'S01E02 download progress',
      }),
    ).toHaveAttribute('aria-valuenow', '40')
    // One of two on disk: the season's own share, beside a live dot.
    expect(screen.getByRole('tab', { name: /Season 1/ })).toHaveAccessibleName(
      'Season 1 · 50%',
    )
  })

  it('lists an attempt this tab never rendered, off a job frame for the media id', () => {
    const { send } = renderLive()

    expect(
      screen.queryByRole('heading', { name: 'Attempts' }),
    ).not.toBeInTheDocument()

    // Started from Discord: an episode grab for this show, by media id.
    send(
      buildJobFrame(
        scopedJob(
          { episodeId: 2431, episodeNumber: 2, seasonNumber: 1 },
          { id: 'job_live', status: DownloadJobStatus.Searching },
        ),
      ),
    )

    const attempts = screen.getByRole('region', { name: 'Attempts' })

    expect(attempts.querySelector('[data-job-id="job_live"]')).not.toBeNull()
    expect(
      within(attempts).getByText('Season 1, episode 2'),
    ).toBeInTheDocument()
    // The row withdraws its Download while an attempt at it is in flight.
    expect(
      within(row(2431)).queryByRole('button', { name: 'Download' }),
    ).not.toBeInTheDocument()
  })

  it('ignores a job frame for another title', () => {
    const { send } = renderLive()

    send(
      buildJobFrame(
        scopedJob(undefined, {
          id: 'job_other',
          media: show({ id: 'tvdb:1', tvdbId: 1 }),
        }),
      ),
    )

    expect(
      screen.queryByRole('heading', { name: 'Attempts' }),
    ).not.toBeInTheDocument()
  })

  it('marks a moving series as reconnecting until the feed opens', () => {
    const { recorder } = renderLive([
      scopedJob(undefined, { status: DownloadJobStatus.Downloading }),
    ])

    expect(screen.getByText(SHOW_STALE_LABEL)).toBeInTheDocument()

    act(() => recorder.latest().emitOpen())

    expect(screen.queryByText(SHOW_STALE_LABEL)).not.toBeInTheDocument()
  })
})
