import '@testing-library/jest-dom'

import type { DownloadJob, Season, Show } from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'
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
import { RELEASE_SEARCH_LABEL } from 'src/components/detail/release-picker'
import { EPISODE_ACTIONS_LABEL } from 'src/components/detail/show-episode-row'
import {
  SEASONS_EMPTY_NOTE,
  ShowSeasons,
} from 'src/components/detail/show-seasons'

/** Season 1: two episodes, one of them already on disk. */
const S1 = season({
  episodeCount: 2,
  episodeFileCount: 1,
  episodes: [
    episode({ episodeNumber: 1, hasFile: true, id: 2430, seasonNumber: 1 }),
    episode({
      episodeNumber: 2,
      hasFile: false,
      id: 2431,
      seasonNumber: 1,
      title: 'The Cap Table',
    }),
  ],
  seasonNumber: 1,
})

/** Season 2: ten episodes by Sonarr's count, six of them downloaded. */
const S2 = season({
  episodeCount: 10,
  episodeFileCount: 6,
  episodes: [
    episode({ episodeNumber: 1, hasFile: true, id: 2440, seasonNumber: 2 }),
  ],
  seasonNumber: 2,
})

type Handlers = {
  onDelete: jest.Mock
  onRequest: jest.Mock
  onSearch: jest.Mock
}

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

function renderSeasons(
  options: {
    imports?: ImportDialogActions
    jobs?: DownloadJob[]
    media?: Show
    onRetry?: jest.Mock
    seasons?: Season[]
  } = {},
): Handlers & { user: ReturnType<typeof userEvent.setup> } {
  const handlers: Handlers = {
    onDelete: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    onRequest: jest.fn().mockResolvedValue({ job: scopedJob(undefined) }),
    onSearch: jest.fn().mockResolvedValue({ releases: [] }),
  }

  render(
    <ShowSeasons
      imports={options.imports}
      jobs={options.jobs ?? []}
      media={options.media ?? show()}
      now={NOW}
      seasons={options.seasons ?? [specials(), S1, S2]}
      onDelete={handlers.onDelete}
      onFlag={jest.fn()}
      onGrab={jest.fn()}
      onReplace={jest.fn()}
      onRequest={handlers.onRequest}
      onRetry={options.onRetry}
      onSearch={handlers.onSearch}
      onUnflag={jest.fn()}
    />,
  )

  return { ...handlers, user: userEvent.setup() }
}

describe('⚠️ season 0 is specials, and is present', () => {
  it('gives specials a tab of their own rather than filtering them out', () => {
    renderSeasons()

    expect(screen.getByRole('tab', { name: /Specials/ })).toBeInTheDocument()
  })

  it('opens on a season with files rather than on specials', () => {
    renderSeasons()

    expect(screen.getByRole('tab', { name: /Season 1/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('lists the specials’ own episodes, and heads them with the listed count', async () => {
    const { user } = renderSeasons()

    await user.click(screen.getByRole('tab', { name: /Specials/ }))

    // ⚠️ Sonarr reports `episodeCount: 0` for specials while listing two.
    expect(
      screen.getByRole('heading', { name: 'Specials · 2 episodes' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Inside the Episode')).toBeInTheDocument()
  })

  it('offers specials the same scoped download as any other season', async () => {
    const { onRequest, user } = renderSeasons()

    await user.click(screen.getByRole('tab', { name: /Specials/ }))
    await user.click(screen.getByRole('button', { name: /Download specials/ }))

    // `seasonNumber: 0` - which is exactly why nothing tests it for truthiness.
    expect(onRequest).toHaveBeenCalledWith(SHOW_ID, { seasonNumber: 0 })
  })
})

describe('⚠️ scope travels as episodeId/seasonNumber, never in the media id', () => {
  it('requests a season by its number, against the unchanged media key', async () => {
    const { onRequest, user } = renderSeasons()

    await user.click(screen.getByRole('button', { name: /Download season 1/ }))

    expect(onRequest).toHaveBeenCalledWith('tvdb:277165', { seasonNumber: 1 })
  })

  it("requests an episode by Sonarr's episode id, against the unchanged media key", async () => {
    const { onRequest, user } = renderSeasons()

    // E2 has no file, so it carries the direct download control.
    await user.click(screen.getByRole('button', { name: 'Download' }))

    expect(onRequest).toHaveBeenCalledWith('tvdb:277165', { episodeId: 2431 })
  })

  it('never mints a scoped media key', async () => {
    const { onRequest, user } = renderSeasons()

    await user.click(screen.getByRole('button', { name: /Download season 1/ }))
    await user.click(screen.getByRole('button', { name: 'Download' }))

    for (const [mediaId] of onRequest.mock.calls) {
      expect(mediaId).toBe(SHOW_ID)
      expect(mediaId).not.toMatch(/tvdb:277165[:/]/)
    }
  })

  it('deletes a season by its number only', async () => {
    const { onDelete, user } = renderSeasons()

    await user.click(screen.getByRole('button', { name: 'Delete season' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    )

    expect(onDelete).toHaveBeenCalledWith(SHOW_ID, { seasonNumber: 1 })
  })

  it("deletes an episode by Sonarr's episode id only", async () => {
    const { onDelete, user } = renderSeasons()

    // E1 has a file, so its drawer carries Save and Delete.
    await user.click(
      screen.getAllByRole('button', { name: EPISODE_ACTIONS_LABEL })[0]!,
    )
    await user.click(screen.getByRole('button', { name: 'Delete episode' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    )

    expect(onDelete).toHaveBeenCalledWith(SHOW_ID, { episodeId: 2430 })
  })
})

describe('⚠️ a repeat delete is a success, not an error', () => {
  it('closes the dialog and reports nothing wrong for deletedCount: 0', async () => {
    const { onDelete, user } = renderSeasons()

    // Deleting already-deleted files answers 200 with `deletedCount: 0` - the
    // caller asked for a state and that state already held. A 404 it is not.
    onDelete.mockResolvedValue({ deletedCount: 0 })

    await user.click(screen.getByRole('button', { name: 'Delete season' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does report a genuine failure, in place', async () => {
    const { onDelete, user } = renderSeasons()

    onDelete.mockResolvedValue({ error: 'Could not delete those files' })

    await user.click(screen.getByRole('button', { name: 'Delete season' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not delete those files',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('season-level progress aggregates across episodes', () => {
  const seasonJob = scopedJob(
    { seasonNumber: 2 },
    { id: 'job_s2', status: DownloadJobStatus.Downloading },
  )
  // What the seasons route serves while that job runs: one of season 2's
  // episodes in Sonarr's queue. The tab dot and the bar follow the episodes'
  // rolled-up state, not the job.
  const downloadingSeasons = [
    specials(),
    S1,
    season({
      ...S2,
      episodes: [
        ...S2.episodes,
        episode({
          episodeNumber: 2,
          id: 2441,
          seasonNumber: 2,
          state: 'downloading',
        }),
      ],
    }),
  ]

  it('reports the season’s own file count, not the queue entry', async () => {
    const { user } = renderSeasons({
      jobs: [seasonJob],
      seasons: downloadingSeasons,
    })

    await user.click(screen.getByRole('tab', { name: /Season 2/ }))

    // ⚠️ A season job does not reach `completed` until the LAST episode leaves
    // Sonarr's queue; six landing one at a time is normal progress.
    expect(screen.getByText('6 of 10 episodes')).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Download progress' }),
    ).toHaveAttribute('aria-valuenow', '60')
  })

  it('marks the season’s own tab as live, and leaves the others alone', () => {
    renderSeasons({ jobs: [seasonJob], seasons: downloadingSeasons })

    expect(screen.getByRole('tab', { name: /Season 2/ })).toHaveTextContent(
      '60%',
    )
    expect(screen.getByRole('tab', { name: /Season 1/ })).not.toHaveTextContent(
      '%',
    )
  })

  it('⚠️ separates the season name from the percentage, rather than running them together', () => {
    // Observed live as `Season 24100%`. The `gap-1.5` and the `Dot` between
    // them are both purely visual — the dot is `aria-hidden` — so the tab's
    // accessible name concatenated. `·` is the separator this app already
    // uses for exactly this (`Season 2 · 10 episodes`, `1080p WEB-DL · 2.1
    // GB`, `paused · 62%`).
    renderSeasons({ jobs: [seasonJob], seasons: downloadingSeasons })

    const tab = screen.getByRole('tab', { name: /Season 2/ })

    expect(tab).toHaveAccessibleName('Season 2 · 60%')
    expect(tab.textContent).not.toMatch(/Season 260%/u)
  })

  it('⚠️ does not light every tab for a whole-series download', () => {
    renderSeasons({
      jobs: [scopedJob(undefined, { status: DownloadJobStatus.Downloading })],
    })

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).not.toHaveTextContent('%')
    }
  })

  it('hands the importer through for a stuck season pack', async () => {
    const imports = importActions()
    const { user } = renderSeasons({
      imports,
      jobs: [
        scopedJob(
          { seasonNumber: 2 },
          { id: 'job_s2', status: DownloadJobStatus.NeedsAttention },
        ),
      ],
    })

    await user.click(screen.getByRole('tab', { name: /Season 2/ }))
    await user.click(screen.getByRole('button', { name: IMPORT_TRIGGER_LABEL }))

    // ⚠️ The season travels as `seasonNumber` on the unchanged media key, the
    // same way every other scoped call on this page addresses a season.
    await waitFor(() =>
      expect(imports.list).toHaveBeenCalledWith(SHOW_ID, {
        episodeId: undefined,
        seasonNumber: 2,
      }),
    )
  })

  it('offers no season Import control when the page wired no importer', async () => {
    const { user } = renderSeasons({
      jobs: [
        scopedJob(
          { seasonNumber: 2 },
          { id: 'job_s2', status: DownloadJobStatus.NeedsAttention },
        ),
      ],
    })

    await user.click(screen.getByRole('tab', { name: /Season 2/ }))

    expect(
      screen.queryByRole('button', { name: IMPORT_TRIGGER_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('draws no season bar once the job is terminal', async () => {
    const { user } = renderSeasons({
      jobs: [
        scopedJob({ seasonNumber: 2 }, { status: DownloadJobStatus.Completed }),
      ],
    })

    await user.click(screen.getByRole('tab', { name: /Season 2/ }))

    expect(
      screen.queryByRole('progressbar', { name: 'Download progress' }),
    ).not.toBeInTheDocument()
  })
})

/** The open season's own status block — not the series'. */
function seasonStatus(): HTMLElement {
  const status = document.querySelector('[data-scope="season"]')

  if (!(status instanceof HTMLElement)) {
    throw new Error('expected the season status')
  }

  return status
}

describe('the season status reads its episodes, never a job', () => {
  it('reads "in library" with the season’s own count once it settles', () => {
    renderSeasons()

    // Season 1 is the default tab: one of two episodes on disk rolls up to
    // `available` — the wanted one is outranked, as it is at series level.
    expect(within(seasonStatus()).getByText('in library')).toBeInTheDocument()
    expect(
      within(seasonStatus()).getByText('1 of 2 episodes'),
    ).toBeInTheDocument()
  })

  it('reads "needs your decision" when one of its episodes does, with the reason', async () => {
    const reason = 'No files found are eligible for import'
    const { user } = renderSeasons({
      media: show({ state: 'needs_attention', stateReason: reason }),
      seasons: [
        S1,
        season({
          ...S2,
          episodes: [
            ...S2.episodes,
            episode({ id: 2441, seasonNumber: 2, state: 'needs_attention' }),
          ],
        }),
      ],
    })

    await user.click(screen.getByRole('tab', { name: /Season 2/ }))

    expect(
      within(seasonStatus()).getByText('needs your decision'),
    ).toBeInTheDocument()
    expect(within(seasonStatus()).getByText(reason)).toBeInTheDocument()
  })

  it('⚠️ never borrows the series’ queue bar or reason for a settled season', () => {
    renderSeasons({
      media: show({
        queueSnapshot: { progress: 35, status: 'downloading' },
        state: 'needs_attention',
        stateReason: 'Something about another season',
      }),
    })

    // The show's snapshot is the whole series' grab; season 1 has nothing
    // moving and nothing stuck.
    expect(
      within(seasonStatus()).queryByRole('progressbar'),
    ).not.toBeInTheDocument()
    expect(
      within(seasonStatus()).queryByText('Something about another season'),
    ).not.toBeInTheDocument()
  })

  it('lists the season’s own attempts, and a whole-series one on no tab', () => {
    renderSeasons({
      jobs: [
        scopedJob(
          { seasonNumber: 1 },
          { id: 'job_s1', status: DownloadJobStatus.Failed },
        ),
        scopedJob(undefined, {
          id: 'job_series',
          status: DownloadJobStatus.Completed,
        }),
      ],
    })

    const list = screen.getByRole('region', { name: 'Season 1 attempts' })

    expect(list.querySelector('[data-job-id="job_s1"]')).not.toBeNull()
    expect(list.querySelector('[data-job-id="job_series"]')).toBeNull()
  })

  it('renders no season Attempts when none is scoped to it', () => {
    renderSeasons()

    expect(
      screen.queryByRole('region', { name: /attempts$/ }),
    ).not.toBeInTheDocument()
  })

  it('offers Retry on a failed season attempt only while the season is downloadable', async () => {
    const onRetry = jest.fn()
    const { user } = renderSeasons({
      jobs: [
        scopedJob(
          { seasonNumber: 0 },
          { id: 'job_s0', status: DownloadJobStatus.Failed },
        ),
        scopedJob(
          { seasonNumber: 1 },
          { id: 'job_s1', status: DownloadJobStatus.Failed },
        ),
      ],
      onRetry,
    })

    // Season 1 has a file on disk: a retry would grab what is already there.
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument()

    // Specials: nothing on disk, nothing queued.
    await user.click(screen.getByRole('tab', { name: /Specials/ }))
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(onRetry).toHaveBeenCalledWith('job_s0')
  })
})

describe('the season tab strip', () => {
  it('⚠️ activates on arrow keys, because switching seasons loads nothing', async () => {
    // `listSeasons` returns every season with every episode in one payload, so
    // this strip swaps content in place - no push, no fetch, nothing to pay for
    // per key. That is why it keeps `Tabs`' automatic activation where
    // `gallery-controls` and `activity-tabs` both opted into `manual`.
    const { user } = renderSeasons()

    await user.click(screen.getByRole('tab', { name: /Season 1/ }))
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: /Season 2/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(
      screen.getByRole('heading', { name: 'Season 2 · 10 episodes' }),
    ).toBeInTheDocument()
  })

  it('marks a season that needs a decision with a warn dot, spelled out for AT', () => {
    renderSeasons({
      seasons: [
        S1,
        season({
          ...S2,
          episodes: [
            episode({ id: 2441, seasonNumber: 2, state: 'needs_attention' }),
          ],
        }),
      ],
    })

    const tab = screen.getByRole('tab', { name: /Season 2/ })

    // No percentage: nothing is moving, somebody has to act.
    expect(tab).toHaveAccessibleName('Season 2 · needs your decision')
    expect(tab.querySelector('.bg-warn')).not.toBeNull()
    expect(tab).not.toHaveTextContent('%')
  })

  it('marks a paused season with the same warn dot', () => {
    renderSeasons({
      seasons: [
        S1,
        season({
          ...S2,
          episodes: [episode({ id: 2441, seasonNumber: 2, state: 'paused' })],
        }),
      ],
    })

    expect(screen.getByRole('tab', { name: /Season 2/ })).toHaveAccessibleName(
      'Season 2 · paused',
    )
  })

  it('leaves a settled season’s tab bare', () => {
    renderSeasons()

    expect(screen.getByRole('tab', { name: /Season 1/ })).toHaveAccessibleName(
      'Season 1',
    )
  })

  it('names the whole strip for assistive technology', () => {
    renderSeasons()

    expect(screen.getByRole('tablist', { name: 'Season' })).toBeInTheDocument()
  })
})

describe('⚠️ the release search never fires on its own', () => {
  it('is not called on mount', () => {
    const { onSearch } = renderSeasons()

    expect(onSearch).not.toHaveBeenCalled()
  })

  it('is not called by opening an episode’s drawer', async () => {
    const { onSearch, user } = renderSeasons()

    await user.click(
      screen.getAllByRole('button', { name: EPISODE_ACTIONS_LABEL })[0]!,
    )

    expect(screen.getByRole('button', { name: /Find releases/ })).toBeVisible()
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('is called only from the picker’s own trigger, scoped to the episode', async () => {
    const { onSearch, user } = renderSeasons()

    await user.click(
      screen.getAllByRole('button', { name: EPISODE_ACTIONS_LABEL })[0]!,
    )
    await user.click(screen.getByRole('button', { name: RELEASE_SEARCH_LABEL }))

    expect(onSearch).toHaveBeenCalledWith(SHOW_ID, {
      episodeId: 2430,
      seasonNumber: 1,
    })
  })

  it('keeps one drawer open at a time', async () => {
    const { user } = renderSeasons()

    const triggers = screen.getAllByRole('button', {
      name: EPISODE_ACTIONS_LABEL,
    })

    await user.click(triggers[0]!)
    expect(
      screen.getAllByRole('button', { name: RELEASE_SEARCH_LABEL }),
    ).toHaveLength(1)

    await user.click(
      screen.getAllByRole('button', { name: EPISODE_ACTIONS_LABEL })[0]!,
    )
    expect(
      screen.getAllByRole('button', { name: RELEASE_SEARCH_LABEL }),
    ).toHaveLength(1)
  })
})

describe('a series that is not in the library yet', () => {
  it('⚠️ explains the 404 rather than rendering an empty list', () => {
    // `GET /media/:id/seasons` answers 404 for a series Sonarr has never seen,
    // which is an ordinary state for a show reached from /discover.
    renderSeasons({ seasons: [] })

    expect(screen.getByText(SEASONS_EMPTY_NOTE)).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })
})

describe('the delete control', () => {
  it('is not offered for a season with nothing on disk', async () => {
    const { user } = renderSeasons()

    await user.click(screen.getByRole('tab', { name: /Specials/ }))

    expect(
      screen.queryByRole('button', { name: 'Delete season' }),
    ).not.toBeInTheDocument()
  })

  it('names what it frees when Sonarr reported a size', async () => {
    const { user } = renderSeasons({
      seasons: [season({ ...S1, sizeOnDisk: 6165688593 })],
    })

    await user.click(screen.getByRole('button', { name: 'Delete season' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('frees 5.7 GB')
  })

  it('⚠️ reaches its trigger through the wrapper, since `full` has no `sm:` half', async () => {
    const { user } = renderSeasons()

    // `DeleteConfirm` stretches BOTH its `<div>` root and the trigger
    // unconditionally. The desktop width is a call-site fix, and it measures
    // 128x30 against the mockup's own 127x38 header button.
    const trigger = screen.getByRole('button', { name: 'Delete season' })

    expect(trigger.getAttribute('class')).toContain('w-full')
    expect(trigger.parentElement?.getAttribute('class')).toContain(
      'sm:[&>button]:w-auto',
    )

    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('names the SCOPE in the heading, so the blast radius is never ambiguous', async () => {
    const { user } = renderSeasons()

    await user.click(screen.getByRole('button', { name: 'Delete season' }))

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Delete season 1 of "Silicon Valley"?',
    )
  })
})

/**
 * ⚠️ `DELETE /download/media/:id/files` cascades *upwards* - the last
 * downloaded episode of a season unmonitors it, and the last downloaded season
 * removes the series from Sonarr. This panel is the only place on the page
 * holding both every season and every job, so it is where the prediction is
 * made; a row cannot work it out from the one episode it was handed.
 *
 * Asserted on the rendered dialog rather than on a prop, because the sentence
 * reaching the user is the whole point of computing it.
 */
describe('⚠️ the dialog warns about the delete cascade before the press', () => {
  /** Season 1 with BOTH episodes on disk, so neither is the last one. */
  const S1_FULL = season({
    ...S1,
    episodeFileCount: 2,
    episodes: [
      episode({ episodeNumber: 1, hasFile: true, id: 2430, seasonNumber: 1 }),
      episode({ episodeNumber: 2, hasFile: true, id: 2431, seasonNumber: 1 }),
    ],
  })

  async function openEpisodeDelete(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<HTMLElement> {
    await user.click(
      screen.getAllByRole('button', { name: EPISODE_ACTIONS_LABEL })[0]!,
    )
    await user.click(screen.getByRole('button', { name: 'Delete episode' }))

    return screen.getByRole('dialog')
  }

  it('says a season delete removes the series when no other season has files', async () => {
    const { user } = renderSeasons({ seasons: [S1] })

    await user.click(screen.getByRole('button', { name: 'Delete season' }))

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'the series is removed from Sonarr',
    )
  })

  it('says nothing extra while another season still has files', async () => {
    // The default list keeps season 2 at six files.
    const { user } = renderSeasons()

    await user.click(screen.getByRole('button', { name: 'Delete season' }))

    expect(screen.getByRole('dialog')).not.toHaveTextContent(
      /Sonarr|unmonitored/,
    )
  })

  it('⚠️ says nothing extra while another season is only DOWNLOADING', async () => {
    const { user } = renderSeasons({
      jobs: [
        scopedJob(
          { seasonNumber: 2 },
          { status: DownloadJobStatus.Downloading },
        ),
      ],
      seasons: [S1, season({ ...S2, episodeFileCount: 0 })],
    })

    await user.click(screen.getByRole('button', { name: 'Delete season' }))

    expect(screen.getByRole('dialog')).not.toHaveTextContent(
      /Sonarr|unmonitored/,
    )
  })

  it('hands each episode row its own cascade - here, the last file in the season', async () => {
    // E1 is the only file in season 1; season 2's six files keep the series.
    const { user } = renderSeasons()

    expect(await openEpisodeDelete(user)).toHaveTextContent(
      'the season is unmonitored too',
    )
  })

  it('escalates the row’s warning to the series when the season is all there is', async () => {
    const { user } = renderSeasons({ seasons: [S1] })

    expect(await openEpisodeDelete(user)).toHaveTextContent(
      'the series is removed from Sonarr',
    )
  })

  it('leaves a row alone when a sibling episode still has a file', async () => {
    const { user } = renderSeasons({ seasons: [S1_FULL] })

    expect(await openEpisodeDelete(user)).not.toHaveTextContent(
      /Sonarr|unmonitored/,
    )
  })
})
