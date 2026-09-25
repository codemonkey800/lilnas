import '@testing-library/jest-dom'

import type { DownloadJob, Season, Show } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  episode,
  NOW,
  scopedJob,
  season,
  show,
  SHOW_ID,
  specials,
} from 'src/components/detail/__tests__/fixtures/show'
import type { ImportDialogActions } from 'src/components/detail/import-dialog'
import { IMPORT_TRIGGER_LABEL } from 'src/components/detail/import-dialog'
import { LIBRARY_HREF } from 'src/components/detail/library-link'
import {
  EMBY_INDEXING_LABEL,
  METADATA_MISSING_NOTE,
  SHOW_EXTERNAL_QUEUE_NOTE,
  SHOW_STALE_LABEL,
  ShowDetail,
  WATCH_LABEL,
} from 'src/components/detail/show-detail'

const WATCH_URL = 'https://emby.lilnas.io/web/index.html#!/item?id=673'

const S1 = season({
  episodeCount: 8,
  episodeFileCount: 8,
  episodes: [episode({ hasFile: true, id: 2430, seasonNumber: 1 })],
  seasonNumber: 1,
})

const S2 = season({
  episodeCount: 16,
  episodeFileCount: 6,
  episodes: [episode({ hasFile: true, id: 2440, seasonNumber: 2 })],
  seasonNumber: 2,
})

/** The importer's three calls, as the page supplies them. */
function importActions(): ImportDialogActions & {
  commit: jest.Mock
  discard: jest.Mock
  list: jest.Mock
} {
  return {
    commit: jest.fn().mockResolvedValue({ importedCount: 1 }),
    discard: jest.fn().mockResolvedValue({ discardedCount: 1 }),
    list: jest.fn().mockResolvedValue({ candidates: [] }),
  }
}

function renderDetail(
  options: {
    imports?: ImportDialogActions
    jobs?: DownloadJob[]
    media?: Show
    onRequest?: jest.Mock
    seasons?: Season[]
  } = {},
) {
  const onDelete = jest.fn().mockResolvedValue({ deletedCount: 1 })
  const onRequest = options.onRequest ?? jest.fn().mockResolvedValue(undefined)
  const onSearch = jest.fn()

  const result = render(
    <ShowDetail
      imports={options.imports}
      jobs={options.jobs ?? []}
      media={options.media ?? show()}
      now={NOW}
      seasons={options.seasons ?? [specials(), S1, S2]}
      onDelete={onDelete}
      onFlag={jest.fn()}
      onGrab={jest.fn()}
      onReplace={jest.fn()}
      onRequest={onRequest}
      onSearch={onSearch}
      onUnflag={jest.fn()}
    />,
  )

  return { ...result, onDelete, onRequest, onSearch, user: userEvent.setup() }
}

describe('the page body', () => {
  it('⚠️ renders its own back affordance, so AppBar’s `back` stays unwired', () => {
    renderDetail()

    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute(
      'href',
      LIBRARY_HREF,
    )
  })

  it('reads year · seasons · runtime · certification under the title', () => {
    renderDetail()

    // Twice: once as the poster's fallback label, once as the heading. The art
    // 404s everywhere - Radarr and Sonarr return *relative* poster paths - so
    // the label is not a hypothetical.
    expect(screen.getAllByText('Silicon Valley')).toHaveLength(2)
    // ⚠️ `runtime` is seconds; specials are not counted as a season.
    expect(
      screen.getByText('2014 · 2 seasons · 29m · TV-MA'),
    ).toBeInTheDocument()
  })

  it('renders no cast row, because nothing on the wire carries one', () => {
    const { container } = renderDetail()

    expect(within(container).queryByTitle(/,/)).not.toBeInTheDocument()
  })
})

describe('the Emby handoff', () => {
  it('⚠️ links the browser-reachable watchUrl, never a constructed one', () => {
    renderDetail({
      media: show({
        embyStatus: { itemId: '673', state: 'indexed', watchUrl: WATCH_URL },
      }),
    })

    const watch = screen.getByRole('link', { name: WATCH_LABEL })

    expect(watch).toHaveAttribute('href', WATCH_URL)
    expect(watch).toHaveAttribute('target', '_blank')
    expect(watch).toHaveAttribute('rel', 'noreferrer')
  })

  it('offers no Watch action while Emby is still indexing', () => {
    renderDetail({ media: show({ embyStatus: { state: 'indexing' } }) })

    expect(screen.getByText(EMBY_INDEXING_LABEL)).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: WATCH_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('offers neither when Emby was never consulted', () => {
    renderDetail({ media: show({ embyStatus: undefined }) })

    expect(
      screen.queryByRole('link', { name: WATCH_LABEL }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(EMBY_INDEXING_LABEL)).not.toBeInTheDocument()
  })

  it('offers neither for an indexed item Emby gave no URL for', () => {
    renderDetail({ media: show({ embyStatus: { state: 'indexed' } }) })

    expect(
      screen.queryByRole('link', { name: WATCH_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('⚠️ never puts a Watch control on an episode row', async () => {
    const { user } = renderDetail({
      media: show({
        embyStatus: { itemId: '673', state: 'indexed', watchUrl: WATCH_URL },
      }),
    })

    // Emby's `Path` for a show is the series folder, so there is no per-episode
    // item to open.
    await user.click(screen.getByRole('button', { name: 'Manage' }))

    expect(screen.getAllByRole('link', { name: WATCH_LABEL })).toHaveLength(1)
  })
})

describe('the series-scoped controls', () => {
  it('⚠️ requests the whole series with the EMPTY scope on the unchanged key', async () => {
    const { onRequest, user } = renderDetail()

    await user.click(screen.getByRole('button', { name: 'Download series' }))

    expect(onRequest).toHaveBeenCalledWith(SHOW_ID, {})
  })

  it('⚠️ deletes the whole series with the EMPTY query on the unchanged key', async () => {
    const { onDelete, user } = renderDetail()

    await user.click(screen.getByRole('button', { name: 'Delete series' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    )

    expect(onDelete).toHaveBeenCalledWith(SHOW_ID, {})
  })

  it('offers no series delete when nothing is on disk', () => {
    renderDetail({ seasons: [season({ episodeFileCount: 0 })] })

    expect(
      screen.queryByRole('button', { name: 'Delete series' }),
    ).not.toBeInTheDocument()
  })

  it('offers no pause, resume, cancel or retry when none is passed', () => {
    renderDetail({
      jobs: [scopedJob(undefined, { status: DownloadJobStatus.Downloading })],
    })

    for (const label of ['Pause', 'Resume', 'Cancel', 'Retry']) {
      expect(
        screen.queryByRole('button', { name: label }),
      ).not.toBeInTheDocument()
    }
  })

  it('threads onCancel down to the episode row an in-flight attempt is scoped to', async () => {
    const onCancel = jest.fn()
    const user = userEvent.setup()
    render(
      <ShowDetail
        jobs={[
          scopedJob(
            { episodeId: 2430, seasonNumber: 1 },
            { id: 'job_e1', status: DownloadJobStatus.Downloading },
          ),
        ]}
        media={show()}
        now={NOW}
        seasons={[S1]}
        onCancel={onCancel}
      />,
    )

    const row = document.querySelector('[data-episode-id="2430"]')
    expect(row).toBeInstanceOf(HTMLElement)

    await user.click(
      within(row as HTMLElement).getByRole('button', { name: 'Cancel' }),
    )

    expect(onCancel).toHaveBeenCalledWith('job_e1')
  })
})

/** The series' own status block in the header — not a season's. */
function seriesStatus(container: HTMLElement): HTMLElement {
  const status = container.querySelector('[data-scope="series"]')

  if (!(status instanceof HTMLElement)) {
    throw new Error('expected the series status')
  }

  return status
}

/** The series-wide Attempts section. */
function seriesAttempts(): HTMLElement {
  return screen.getByRole('region', { name: 'Attempts' })
}

/** Season 2 with one more episode, in whatever state the test needs. */
function s2With(extra: Parameters<typeof episode>[0]): Season {
  return season({
    ...S2,
    episodes: [
      ...S2.episodes,
      episode({ episodeNumber: 2, id: 2441, seasonNumber: 2, ...extra }),
    ],
  })
}

describe('the series status reads the media, never a job', () => {
  it('reads "in library" with the episode count beside it for a settled series', () => {
    const { container } = renderDetail()
    const status = seriesStatus(container)

    // `show-detail.pug`'s `episodeInfo`: 14 of 24 across two seasons, specials
    // excluded — the prose that used to be a second chip.
    expect(within(status).getByText('in library')).toBeInTheDocument()
    expect(within(status).getByText('14 of 24 episodes')).toBeInTheDocument()
    expect(status).toHaveAttribute('data-state', 'available')
  })

  it('renders no Attempts section for a series nobody downloaded through this app', () => {
    renderDetail()

    // The mockup's empty state: the chip above is the only signal.
    expect(
      screen.queryByRole('heading', { name: 'Attempts' }),
    ).not.toBeInTheDocument()
  })

  it('⚠️ reads "in library" over a failed newest attempt — the Cars bug', () => {
    const { container } = renderDetail({
      jobs: [
        scopedJob(undefined, {
          error: 'Indexer timed out after 3 retries',
          status: DownloadJobStatus.Failed,
        }),
      ],
    })

    // The failure is an attempt, listed under the chip — not the chip.
    expect(
      within(seriesStatus(container)).getByText('in library'),
    ).toBeInTheDocument()
    expect(within(seriesAttempts()).getByText('failed')).toBeInTheDocument()
    expect(
      within(seriesAttempts()).getByText('Indexer timed out after 3 retries'),
    ).toBeInTheDocument()
  })

  it('reads "needs your decision" when one episode needs one, with the server’s reason', () => {
    const reason = 'No files found are eligible for import'
    const { container } = renderDetail({
      media: show({ state: 'needs_attention', stateReason: reason }),
      seasons: [specials(), S1, s2With({ state: 'needs_attention' })],
    })
    const status = seriesStatus(container)

    // One episode waiting on a human outranks thirteen on disk.
    expect(within(status).getByText('needs your decision')).toBeInTheDocument()
    expect(within(status).getByText(reason)).toBeInTheDocument()
  })

  it('says "not downloaded" and nothing more when the library has nothing', () => {
    const { container } = renderDetail({ seasons: [] })
    const status = seriesStatus(container)

    expect(within(status).getByText('not downloaded')).toBeInTheDocument()
    // `0 of 0 episodes` would be worse than nothing.
    expect(within(status).queryByText(/episodes?$/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Attempts' }),
    ).not.toBeInTheDocument()
  })

  it('withholds the count when the only files are specials', () => {
    // `seriesProgress` excludes specials, so the figure would read `0 of 0`.
    const { container } = renderDetail({
      seasons: [specials({ episodeFileCount: 2 })],
    })

    expect(
      within(seriesStatus(container)).queryByText(/episodes?$/),
    ).not.toBeInTheDocument()
  })
})

/**
 * Sonarr's queue moving with no attempt behind it: since plan 022, an upgrade
 * of an episode already on disk (never adopted), or a fresh grab from Sonarr's
 * own UI in the one poller tick before it is adopted as an attempt.
 */
describe('⚠️ Sonarr running a download with no attempt behind it', () => {
  const grabbed = () => ({
    media: show({
      queueSnapshot: {
        progress: 35,
        status: 'downloading',
        timeLeft: '00:12:00',
      },
      state: 'downloading' as const,
    }),
    seasons: [
      specials(),
      S1,
      s2With({
        queueSnapshot: { progress: 35, status: 'downloading' },
        state: 'downloading',
      }),
    ],
  })

  it('draws the series chip and the queue’s bar, and explains the missing attempt', () => {
    const { container } = renderDetail(grabbed())
    const status = seriesStatus(container)

    // Twice: the chip, and the queue's own status over the bar.
    expect(status).toHaveAttribute('data-state', 'downloading')
    expect(within(status).getAllByText('downloading')).toHaveLength(2)
    expect(
      within(status).getByRole('progressbar', { name: 'Download progress' }),
    ).toHaveAttribute('aria-valuenow', '35')
    expect(
      within(status).getByText(SHOW_EXTERNAL_QUEUE_NOTE),
    ).toBeInTheDocument()
    // The count moves under the bar, beside the queue's own estimate.
    expect(
      within(status).getByText('14 of 24 episodes · ~00:12:00 left'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Attempts' }),
    ).not.toBeInTheDocument()
  })

  it('shows the episode’s own progress on its row and a live dot on its season tab', async () => {
    const { user } = renderDetail(grabbed())

    // The tab reads live before it is even opened — with the season's own
    // six of sixteen on disk, not the queue item's percentage.
    expect(screen.getByRole('tab', { name: /Season 2/ })).toHaveAccessibleName(
      'Season 2 · 38%',
    )

    await user.click(screen.getByRole('tab', { name: /Season 2/ }))

    expect(
      screen.getByRole('progressbar', { name: 'S02E02 download progress' }),
    ).toHaveAttribute('aria-valuenow', '35')
  })

  it('says the upgrade can’t be cancelled here, in the mockup’s words', () => {
    const { container } = renderDetail(grabbed())

    expect(
      within(seriesStatus(container)).getByText(
        "Sonarr is upgrading an episode already on disk — it can't be cancelled here.",
      ),
    ).toBeInTheDocument()
  })

  it('credits an adopted attempt to Sonarr, offers Cancel and drops the note', async () => {
    const onCancel = jest.fn()
    const user = userEvent.setup()
    const adopted = scopedJob(
      { episodeId: 2441, episodeNumber: 2, seasonNumber: 2 },
      {
        createdAt: '2026-09-15T11:00:00.000Z',
        id: 'job_adopted',
        requester: null,
        startedUpstream: true,
        status: DownloadJobStatus.Downloading,
      },
    )
    const { container } = render(
      <ShowDetail
        jobs={[adopted]}
        now={NOW}
        onCancel={onCancel}
        {...grabbed()}
      />,
    )

    // `show-detail.pug`'s "Started from Sonarr": a plain label, no prefix.
    expect(screen.getByText('Sonarr · 1h ago')).toBeInTheDocument()
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument()
    expect(
      within(seriesStatus(container)).queryByText(SHOW_EXTERNAL_QUEUE_NOTE),
    ).not.toBeInTheDocument()

    await user.click(
      within(seriesAttempts()).getByRole('button', { name: 'Cancel' }),
    )

    expect(onCancel).toHaveBeenCalledWith('job_adopted')
  })

  it('drops the note once an attempt of ours is in flight', () => {
    const { container } = renderDetail({
      ...grabbed(),
      jobs: [scopedJob({ seasonNumber: 2 })],
    })

    expect(
      within(seriesStatus(container)).queryByText(SHOW_EXTERNAL_QUEUE_NOTE),
    ).not.toBeInTheDocument()
  })

  it('falls back to the files-on-disk rollup while episodes move and the show has no snapshot', () => {
    const { container } = renderDetail({
      seasons: [specials(), S1, s2With({ state: 'downloading' })],
    })

    expect(
      within(seriesStatus(container)).getByRole('progressbar', {
        name: 'Download progress',
      }),
    ).toHaveAttribute('aria-valuenow', String((14 / 24) * 100))
  })

  it('marks a moving series as reconnecting while the live feed is down', () => {
    render(
      <ShowDetail
        jobs={[]}
        media={grabbed().media}
        now={NOW}
        seasons={grabbed().seasons}
        stale
      />,
    )

    expect(screen.getByText(SHOW_STALE_LABEL)).toBeInTheDocument()
  })

  it('says nothing about the feed while the series is settled', () => {
    render(
      <ShowDetail jobs={[]} media={show()} now={NOW} seasons={[S1]} stale />,
    )

    expect(screen.queryByText(SHOW_STALE_LABEL)).not.toBeInTheDocument()
  })
})

describe('the series Attempts', () => {
  it('⚠️ lists an episode grab with its scope, and again under its own season', () => {
    const { container } = renderDetail({
      jobs: [
        scopedJob(
          { episodeId: 2430, episodeNumber: 1, seasonNumber: 1 },
          { id: 'job_ep', status: DownloadJobStatus.Downloading },
        ),
      ],
    })

    // An episode grab is an attempt on this show.
    const series = seriesAttempts()
    expect(within(series).getByText('Season 1, episode 1')).toBeInTheDocument()
    expect(series.querySelector('[data-job-id="job_ep"]')).not.toBeNull()

    // Season 1 is the default tab, and lists it too.
    const seasonList = screen.getByRole('region', { name: 'Season 1 attempts' })
    expect(seasonList.querySelector('[data-job-id="job_ep"]')).not.toBeNull()

    // A search has not queued anything, so the chip still reads the disk.
    expect(
      within(seriesStatus(container)).getByText('in library'),
    ).toBeInTheDocument()
  })

  it('hands the importer through for a stuck series attempt', async () => {
    const imports = importActions()
    const { user } = renderDetail({
      imports,
      jobs: [
        scopedJob(undefined, { status: DownloadJobStatus.NeedsAttention }),
      ],
    })

    await user.click(
      within(seriesAttempts()).getByRole('button', {
        name: IMPORT_TRIGGER_LABEL,
      }),
    )

    // ⚠️ The unchanged media key and an empty scope: a series-wide job names
    // neither a season nor an episode, so the whole title's queue is in scope.
    await waitFor(() =>
      expect(imports.list).toHaveBeenCalledWith(SHOW_ID, {
        episodeId: undefined,
        seasonNumber: undefined,
      }),
    )
  })

  it('offers no Import control when the page wired no importer', () => {
    renderDetail({
      jobs: [
        scopedJob(undefined, { status: DownloadJobStatus.NeedsAttention }),
      ],
    })

    expect(
      screen.queryByRole('button', { name: IMPORT_TRIGGER_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('offers Retry on a failed newest attempt only while the series is downloadable', () => {
    const failed = scopedJob(undefined, { status: DownloadJobStatus.Failed })
    const onRetry = jest.fn()

    const { unmount } = render(
      <ShowDetail
        jobs={[failed]}
        media={show({ state: 'wanted' })}
        now={NOW}
        seasons={[]}
        onRetry={onRetry}
      />,
    )
    expect(
      within(seriesAttempts()).getByRole('button', { name: 'Retry' }),
    ).toBeInTheDocument()
    unmount()

    // Files on disk: a retry would re-grab what is already there.
    render(
      <ShowDetail
        jobs={[failed]}
        media={show()}
        now={NOW}
        seasons={[S1]}
        onRetry={onRetry}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument()
  })

  it('attributes the newest request at any scope against the pinned instant', () => {
    renderDetail({
      jobs: [
        scopedJob(
          { episodeId: 2430, seasonNumber: 1 },
          { createdAt: '2026-09-15T11:48:00.000Z' },
        ),
      ],
    })

    expect(
      screen.getByText('requested by jeremy.asuncion · 12m ago'),
    ).toBeInTheDocument()
  })

  it('⚠️ renders a masked requester as hidden, never re-deriving the rule', () => {
    renderDetail({ jobs: [scopedJob(undefined, { requester: null })] })

    // `projectJobForViewer` already applied the mask server-side.
    expect(screen.getByText(/^requested by hidden · /)).toBeInTheDocument()
  })
})

describe('a failed metadata lookup', () => {
  const PLACEHOLDER: Show = {
    id: 'tvdb:99999999',
    title: 'tvdb:99999999',
    tvdbId: 99999999,
    type: DownloadType.Show,
  }

  it('⚠️ explains itself rather than pretending to be a 404', () => {
    renderDetail({ media: PLACEHOLDER, seasons: [] })

    // A `tvdb:` key always resolves, so an unknown show is a metadata lookup
    // that did not land - not a missing page.
    expect(screen.getByText(METADATA_MISSING_NOTE)).toBeInTheDocument()
  })

  it('still renders the rest of the page under it', () => {
    renderDetail({ media: PLACEHOLDER })

    expect(screen.getByRole('tablist', { name: 'Season' })).toBeInTheDocument()
  })

  it('says nothing for a show whose metadata is fine', () => {
    renderDetail()

    expect(screen.queryByText(METADATA_MISSING_NOTE)).not.toBeInTheDocument()
  })
})
