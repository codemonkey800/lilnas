import '@testing-library/jest-dom'

import type { DownloadJob, Season, Show } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'
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
import { LIBRARY_HREF } from 'src/components/detail/library-link'
import {
  EMBY_INDEXING_LABEL,
  METADATA_MISSING_NOTE,
  SERIES_EMPTY_NOTE,
  SERIES_IN_LIBRARY_NOTE,
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

function renderDetail(
  options: {
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

  it('⚠️ offers no pause, resume, cancel or retry - those routes are video-only', () => {
    renderDetail({
      jobs: [scopedJob(undefined, { status: DownloadJobStatus.Downloading })],
    })

    for (const label of ['Pause', 'Resume', 'Cancel', 'Retry']) {
      expect(
        screen.queryByRole('button', { name: label }),
      ).not.toBeInTheDocument()
    }
  })
})

describe('the series lifecycle panel', () => {
  it('⚠️ aggregates across episodes rather than reporting the queue entry', () => {
    renderDetail({
      jobs: [scopedJob(undefined, { status: DownloadJobStatus.Downloading })],
    })

    // 14 of 24 across two seasons - the figure the mockup's own legend prints,
    // and the only one that is true of the whole series.
    expect(screen.getByText('14 of 24 episodes')).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Download progress' }),
    ).toHaveAttribute('aria-valuenow', String((14 / 24) * 100))
  })

  it('draws no bar at all once the series job is terminal', () => {
    renderDetail({
      jobs: [scopedJob(undefined, { status: DownloadJobStatus.Completed })],
    })

    expect(
      screen.queryByRole('progressbar', { name: 'Download progress' }),
    ).not.toBeInTheDocument()
  })

  it('⚠️ reports only whole-series jobs, never the newest episode grab', () => {
    renderDetail({
      jobs: [
        scopedJob(
          { episodeId: 2430 },
          { id: 'job_ep', status: DownloadJobStatus.Downloading },
        ),
        scopedJob(undefined, {
          id: 'job_series',
          status: DownloadJobStatus.Completed,
        }),
      ],
    })

    // A panel headed with the series' name reporting one episode's status would
    // be a quiet lie. The newest *series* job is what it reports.
    expect(screen.getAllByText('completed').length).toBeGreaterThan(0)
  })

  it('⚠️ never says "not downloaded" over a series that has files', () => {
    const { container } = renderDetail()

    // The bug this replaced: `JobLifecycle`'s empty state chips the fixed
    // string `not downloaded`, which was rendering over 14 episodes on disk
    // with `SERIES_IN_LIBRARY_NOTE` beside it saying the opposite.
    expect(screen.queryByText('not downloaded')).not.toBeInTheDocument()
    expect(container.querySelector('[data-empty="true"]')).toBeNull()
    expect(screen.getByText(SERIES_IN_LIBRARY_NOTE)).toBeInTheDocument()
  })

  it('⚠️ counts the episodes rather than claiming the series is "in library"', () => {
    renderDetail()

    // The same aggregate the progress bar prints, and the only completeness
    // claim the payload supports: 14 of 24 across two seasons, specials
    // excluded. `in library` - the movie page's chip - would be the same class
    // of untruth as `not downloaded`, pointing the other way.
    const chip = screen.getByText('14 of 24 episodes')

    expect(chip).toBeInTheDocument()
    expect(screen.queryByText('in library')).not.toBeInTheDocument()
  })

  it('withholds the count when the payload cannot support one', () => {
    // Files only in season 0. `hasFiles` is true (a `some` over every season)
    // but `seriesProgress` excludes specials, so the figure would read
    // `0 of 0 episodes` - worse than printing nothing.
    const { container } = renderDetail({
      seasons: [specials({ episodeFileCount: 2 })],
    })
    const panel = container.querySelector('[data-library="true"]')

    if (!(panel instanceof HTMLElement)) {
      throw new Error('expected the series library panel')
    }

    // Scoped to the panel: an individual *episode* row saying `not downloaded`
    // is a different claim about a different thing, and a true one.
    expect(within(panel).getByText(SERIES_IN_LIBRARY_NOTE)).toBeInTheDocument()
    expect(within(panel).queryByText(/episodes?$/)).not.toBeInTheDocument()
    expect(within(panel).queryByText('not downloaded')).not.toBeInTheDocument()
  })

  it('hands the panel back as soon as there is a real series job', () => {
    renderDetail({
      jobs: [scopedJob(undefined, { status: DownloadJobStatus.Completed })],
    })

    // A job outranks the library aggregate: the chip is the job's status, and
    // the library note has nothing left to explain.
    expect(screen.getAllByText('completed').length).toBeGreaterThan(0)
    expect(screen.queryByText(SERIES_IN_LIBRARY_NOTE)).not.toBeInTheDocument()
  })

  it('says the plainer thing when the library has nothing either', () => {
    renderDetail({ seasons: [] })

    expect(screen.getByText(SERIES_EMPTY_NOTE)).toBeInTheDocument()
    // Nothing on disk, so `not downloaded` is simply true here.
    expect(screen.getByText('not downloaded')).toBeInTheDocument()
    expect(screen.queryByText(SERIES_IN_LIBRARY_NOTE)).not.toBeInTheDocument()
  })

  it('attributes the newest series request against the pinned instant', () => {
    renderDetail({
      jobs: [scopedJob(undefined, { createdAt: '2026-09-15T11:48:00.000Z' })],
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
