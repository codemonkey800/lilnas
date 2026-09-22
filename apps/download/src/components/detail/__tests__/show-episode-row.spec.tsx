import '@testing-library/jest-dom'

import type {
  DownloadJob,
  Episode,
  Release,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  episode,
  scopedJob,
  show,
  SHOW_ID,
} from 'src/components/detail/__tests__/fixtures/show'
import {
  REPORT_LABEL,
  REPORT_PROMPT_EPISODE,
} from 'src/components/detail/bad-file-flag'
import type { ImportDialogActions } from 'src/components/detail/import-dialog'
import { IMPORT_TRIGGER_LABEL } from 'src/components/detail/import-dialog'
import {
  RELEASE_CURRENT_LABEL,
  RELEASE_REPLACE_LABEL,
} from 'src/components/detail/release-picker'
import { SAVE_LOCAL_LABEL } from 'src/components/detail/save-local'
import {
  EPISODE_ACTIONS_HIDE_LABEL,
  EPISODE_ACTIONS_LABEL,
  ShowEpisodeRow,
} from 'src/components/detail/show-episode-row'
import type { DeleteCascade } from 'src/components/detail/show-state'

/** The guid `listSeasons` stamps onto an episode whose file it could trace. */
const CURRENT_GUID = 'guid-s01e01'

/**
 * The row the backend **prepends** when today's indexer sweep no longer returns
 * the release that was grabbed months ago. It is built from the cached record,
 * so `indexerId` is `0` and there is no `quality` at all - which is why the
 * title is what this row renders. Expected, not a defect.
 */
const CURRENT_RELEASE: Release = {
  downloadAllowed: true,
  flaggedBad: false,
  guid: CURRENT_GUID,
  indexerId: 0,
  rejected: false,
  title: 'Silicon.Valley.S01E01.1080p.WEB-DL.x264',
}

const ALTERNATIVE: Release = {
  downloadAllowed: true,
  flaggedBad: false,
  guid: 'guid-2160',
  indexer: 'nyaa-hd',
  indexerId: 4,
  quality: { name: '2160p WEB-DL', resolution: 2160 },
  rejected: false,
  size: 5.8 * 1024 ** 3,
  title: 'Silicon.Valley.S01E01.2160p.WEB-DL.HDR',
}

/**
 * The three importer calls, typed as the page passes them rather than as bare
 * `jest.fn()`s — the same reason `job-lifecycle.spec.tsx` types its own.
 * `candidates: []` is enough: this suite asserts what the row *asks*, and the
 * dialog's own rendering is already covered by `import-dialog.spec.tsx`.
 */
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

function renderRow(
  options: {
    cascadesTo?: DeleteCascade
    episode?: Episode
    imports?: ImportDialogActions
    jobs?: DownloadJob[]
    open?: boolean
    releases?: Release[]
  } = {},
) {
  const onToggle = jest.fn()
  const onRequest = jest.fn().mockResolvedValue(undefined)
  const onSearch = jest
    .fn()
    .mockResolvedValue({ releases: options.releases ?? [] })

  const result = render(
    <ShowEpisodeRow
      cascadesTo={options.cascadesTo}
      episode={options.episode ?? episode()}
      imports={options.imports}
      jobs={options.jobs ?? []}
      media={show()}
      open={options.open ?? false}
      onDelete={jest.fn()}
      onFlag={jest.fn()}
      onGrab={jest.fn()}
      onReplace={jest.fn()}
      onRequest={onRequest}
      onSearch={onSearch}
      onToggle={onToggle}
      onUnflag={jest.fn()}
    />,
  )

  return { ...result, onRequest, onSearch, onToggle, user: userEvent.setup() }
}

describe('the row itself', () => {
  it('shows the episode NUMBER as the label and never the id', () => {
    renderRow({ episode: episode({ episodeNumber: 5, id: 4823 }) })

    expect(screen.getByText('E5')).toBeInTheDocument()
    expect(screen.queryByText('E4823')).not.toBeInTheDocument()
  })

  it('renders the runtime in hours-and-minutes from SECONDS', () => {
    renderRow({ episode: episode({ runtime: 1740 }) })

    expect(screen.getByText('29m')).toBeInTheDocument()
  })

  it('renders an em dash for a runtime upstream does not know', () => {
    // `0` is upstream for "unknown"; `0m` would read as a fact.
    renderRow({ episode: episode({ runtime: 0 }) })

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('reads "downloaded" when the file is on disk', () => {
    renderRow({ episode: episode({ hasFile: true }) })

    expect(screen.getByText('downloaded')).toBeInTheDocument()
  })
})

describe('the scoped download control', () => {
  it('⚠️ requests by Sonarr’s episode id, against the unchanged media key', async () => {
    const { onRequest, user } = renderRow({
      episode: episode({ episodeNumber: 5, id: 4823 }),
    })

    await user.click(screen.getByRole('button', { name: 'Download' }))

    expect(onRequest).toHaveBeenCalledWith(SHOW_ID, { episodeId: 4823 })
  })

  it('⚠️ keeps its trigger inside the row rather than stretching the group', () => {
    renderRow()

    // Regression, found by measuring: `ShowRequestButton`'s `full` puts
    // `w-full` on its `<div>` root too, and inside an `sm:w-auto` action group
    // that resolves against a shrink-to-fit container and pushed the disclosure
    // clean outside the card. The trigger is reached through the wrapper
    // instead. The rendered class attribute, never the string handed to `cns`.
    const root = screen.getByRole('button', { name: 'Download' }).parentElement
    const classes = (root?.getAttribute('class') ?? '').split(/\s+/)

    expect(classes).toContain('sm:flex-none')
    expect(classes).toContain('[&>button]:w-full')
    // The bare utility is what blew the group out; the variant is the fix.
    expect(classes).not.toContain('w-full')
  })

  it('is withdrawn once there is a file', () => {
    renderRow({ episode: episode({ hasFile: true }) })

    expect(
      screen.queryByRole('button', { name: 'Download' }),
    ).not.toBeInTheDocument()
  })

  it('is withdrawn while a job for this episode is open', () => {
    renderRow({
      jobs: [
        scopedJob({ episodeId: 2430 }, { status: DownloadJobStatus.Searching }),
      ],
    })

    expect(
      screen.queryByRole('button', { name: 'Download' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('searching')).toBeInTheDocument()
  })
})

describe('the actions drawer', () => {
  it('is closed by default, so no picker is mounted', () => {
    const { onSearch } = renderRow()

    expect(
      screen.queryByRole('button', { name: /Find releases/ }),
    ).not.toBeInTheDocument()
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('announces its own state', async () => {
    const { onToggle, user } = renderRow()

    const trigger = screen.getByRole('button', { name: EPISODE_ACTIONS_LABEL })

    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)

    expect(onToggle).toHaveBeenCalledWith(2430)
  })

  it('names itself Close while it is open', () => {
    renderRow({ open: true })

    expect(
      screen.getByRole('button', { name: EPISODE_ACTIONS_HIDE_LABEL }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('offers Save to device and Delete episode only when there is a file', () => {
    renderRow({ episode: episode({ hasFile: true }), open: true })

    expect(
      screen.getByRole('link', { name: SAVE_LOCAL_LABEL }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete episode' }),
    ).toBeInTheDocument()
  })

  it('⚠️ offers neither when there is no file - a save would 404 and a delete deletes nothing', () => {
    renderRow({ episode: episode({ hasFile: false }), open: true })

    expect(
      screen.queryByRole('link', { name: SAVE_LOCAL_LABEL }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Delete episode' }),
    ).not.toBeInTheDocument()
  })

  it('⚠️ scopes the local save with episodeId - a show with none is a 400, not a folder', () => {
    renderRow({
      episode: episode({ hasFile: true, id: 4823 }),
      open: true,
    })

    expect(
      screen.getByRole('link', { name: SAVE_LOCAL_LABEL }),
    ).toHaveAttribute('href', expect.stringContaining('episodeId=4823'))
  })

  it('⚠️ stretches DeleteConfirm inside StateLineActions, which cannot reach through its div root', () => {
    renderRow({ episode: episode({ hasFile: true }), open: true })

    // `[&>button]:flex-1` selects a direct `<button>` child; `DeleteConfirm`
    // renders a `<div>`, so `full` is what makes the trigger fill the slot.
    expect(
      screen
        .getByRole('button', { name: 'Delete episode' })
        .getAttribute('class'),
    ).toContain('w-full')
  })

  /**
   * ⚠️ A prop, not a derivation. `deleteCascade` needs every season and every
   * job for the title; this row has one episode and its own jobs, so the
   * season panel computes it and hands it over. These assert the value reaches
   * the sentence the user reads.
   */
  describe('the cascade warning the season panel computed', () => {
    async function openDelete(
      user: ReturnType<typeof userEvent.setup>,
    ): Promise<HTMLElement> {
      await user.click(screen.getByRole('button', { name: 'Delete episode' }))

      return screen.getByRole('dialog')
    }

    it('says the season is unmonitored too', async () => {
      const { user } = renderRow({
        cascadesTo: 'season',
        episode: episode({ hasFile: true }),
        open: true,
      })

      expect(await openDelete(user)).toHaveTextContent(
        'the season is unmonitored too',
      )
    })

    it('says the series is removed from Sonarr', async () => {
      const { user } = renderRow({
        cascadesTo: 'series',
        episode: episode({ hasFile: true }),
        open: true,
      })

      expect(await openDelete(user)).toHaveTextContent(
        'the series is removed from Sonarr',
      )
    })

    it.each([['omitted', undefined], ['none', 'none'] as const])(
      'says nothing extra when it is %s',
      async (_name, cascadesTo) => {
        const { user } = renderRow({
          cascadesTo,
          episode: episode({ hasFile: true }),
          open: true,
        })

        expect(await openDelete(user)).not.toHaveTextContent(
          /Sonarr|unmonitored/,
        )
      },
    )
  })

  it('reports the episode with the episode-flavoured prompt and reasons', async () => {
    const { user } = renderRow({
      episode: episode({ hasFile: true }),
      open: true,
    })

    // Reaching the report control means searching first, which is a press.
    await user.click(screen.getByRole('button', { name: /Find releases/ }))

    expect(screen.getByText(/No indexer had anything/)).toBeInTheDocument()
  })

  it('⚠️ opening the drawer searches nothing - the picker waits for its own press', () => {
    const { onSearch } = renderRow({
      episode: episode({ currentReleaseGuid: CURRENT_GUID, hasFile: true }),
      open: true,
      releases: [CURRENT_RELEASE, ALTERNATIVE],
    })

    // A season is twenty-five of these. The drawer mounts the picker; only the
    // picker's own trigger may ask an indexer anything.
    expect(onSearch).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /Find releases/ }),
    ).toBeInTheDocument()
  })
})

describe('the release currently on disk', () => {
  it('chips the matching row and offers the report control on it', async () => {
    const { user } = renderRow({
      episode: episode({ currentReleaseGuid: CURRENT_GUID, hasFile: true }),
      open: true,
      releases: [CURRENT_RELEASE, ALTERNATIVE],
    })

    await user.click(screen.getByRole('button', { name: /Find releases/ }))

    expect(await screen.findByText(RELEASE_CURRENT_LABEL)).toBeInTheDocument()

    // Every row can be reported — flagging a release you have *not* taken is
    // a valid thing to want to do. What the current row does not offer is a
    // replace: it is already the file on disk.
    expect(screen.getAllByRole('button', { name: REPORT_LABEL })).toHaveLength(
      2,
    )
    expect(
      screen.getAllByRole('button', { name: RELEASE_REPLACE_LABEL }),
    ).toHaveLength(1)
  })

  it('asks the episode’s own question when that control is opened', async () => {
    const { user } = renderRow({
      episode: episode({ currentReleaseGuid: CURRENT_GUID, hasFile: true }),
      open: true,
      releases: [CURRENT_RELEASE],
    })

    await user.click(screen.getByRole('button', { name: /Find releases/ }))
    await user.click(await screen.findByRole('button', { name: REPORT_LABEL }))

    expect(screen.getByText(REPORT_PROMPT_EPISODE)).toBeInTheDocument()
  })

  it('⚠️ renders exactly as before when the file traces back to no release', async () => {
    // A manual import, a pruned history, a degraded resolver: the guid is
    // absent, and absent must be indistinguishable from the old behaviour.
    const { user } = renderRow({
      episode: episode({ hasFile: true }),
      open: true,
      releases: [CURRENT_RELEASE, ALTERNATIVE],
    })

    await user.click(screen.getByRole('button', { name: /Find releases/ }))

    expect(
      await screen.findByText(CURRENT_RELEASE.title, { selector: 'span' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(RELEASE_CURRENT_LABEL)).not.toBeInTheDocument()
    // Present on both rows, as it is on every row — its presence no longer
    // says anything about which release is the current one.
    expect(screen.getAllByRole('button', { name: REPORT_LABEL })).toHaveLength(
      2,
    )
    // `hasFile` still decides the verb, so both rows stay replaces.
    expect(
      screen.getAllByRole('button', { name: RELEASE_REPLACE_LABEL }),
    ).toHaveLength(2)
  })
})

/**
 * The last of the four surfaces a stuck import can be resolved from - the other
 * three are the movie panel, the series panel and the season panel, all three
 * through `JobLifecycle`. This one is a row whose *own* episode-scoped job is
 * the one waiting on a decision.
 */
describe('the import control', () => {
  const needsAttention = () =>
    scopedJob(
      { episodeId: 2430, seasonNumber: 1 },
      { status: DownloadJobStatus.NeedsAttention },
    )

  it('offers it when this episode’s own job is waiting on a decision', () => {
    renderRow({ imports: importActions(), jobs: [needsAttention()] })

    expect(
      screen.getByRole('button', { name: IMPORT_TRIGGER_LABEL }),
    ).toBeInTheDocument()
    expect(screen.getByText('needs your decision')).toBeInTheDocument()
  })

  it('⚠️ asks about this episode, not the whole series', async () => {
    const imports = importActions()
    const { user } = renderRow({
      episode: episode({ episodeNumber: 5, id: 4823, seasonNumber: 2 }),
      imports,
      jobs: [
        scopedJob(
          { episodeId: 4823, seasonNumber: 2 },
          { status: DownloadJobStatus.NeedsAttention },
        ),
      ],
    })

    await user.click(screen.getByRole('button', { name: IMPORT_TRIGGER_LABEL }))

    // The media key is unchanged - every scope for a show is `tvdb:277165` -
    // and the narrowing is entirely in the scope, which carries both keys.
    await waitFor(() =>
      expect(imports.list).toHaveBeenCalledWith(SHOW_ID, {
        episodeId: 4823,
        seasonNumber: 2,
      }),
    )
  })

  it('names the dialog after the episode rather than the series alone', async () => {
    const { user } = renderRow({
      episode: episode({ episodeNumber: 5, id: 4823, seasonNumber: 2 }),
      imports: importActions(),
      jobs: [
        scopedJob(
          { episodeId: 4823, seasonNumber: 2 },
          { status: DownloadJobStatus.NeedsAttention },
        ),
      ],
    })

    await user.click(screen.getByRole('button', { name: IMPORT_TRIGGER_LABEL }))

    expect(
      await screen.findByText('Import "Silicon Valley S02E05"'),
    ).toBeInTheDocument()
  })

  it('offers it on no other status', () => {
    for (const status of Object.values(DownloadJobStatus)) {
      if (status === DownloadJobStatus.NeedsAttention) {
        continue
      }

      const { unmount } = renderRow({
        imports: importActions(),
        jobs: [scopedJob({ episodeId: 2430, seasonNumber: 1 }, { status })],
      })

      expect(
        screen.queryByRole('button', { name: IMPORT_TRIGGER_LABEL }),
      ).not.toBeInTheDocument()
      unmount()
    }
  })

  it('renders nothing when the page wired no importer', () => {
    renderRow({ jobs: [needsAttention()] })

    expect(
      screen.queryByRole('button', { name: IMPORT_TRIGGER_LABEL }),
    ).not.toBeInTheDocument()
    // The chip still says why the row is stuck - only the control is absent.
    expect(screen.getByText('needs your decision')).toBeInTheDocument()
  })

  it('⚠️ leaves the request branch alone - a stuck job is still a job', () => {
    renderRow({ imports: importActions(), jobs: [needsAttention()] })

    expect(
      screen.queryByRole('button', { name: 'Download' }),
    ).not.toBeInTheDocument()
  })
})
