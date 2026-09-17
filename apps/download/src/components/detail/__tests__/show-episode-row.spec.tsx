import '@testing-library/jest-dom'

import type {
  DownloadJob,
  Episode,
  Release,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
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

function renderRow(
  options: {
    episode?: Episode
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
      episode={options.episode ?? episode()}
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

    // The current row reports; every other row is one you take instead.
    expect(
      screen.getByRole('button', { name: REPORT_LABEL }),
    ).toBeInTheDocument()
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
    expect(
      screen.queryByRole('button', { name: REPORT_LABEL }),
    ).not.toBeInTheDocument()
    // `hasFile` still decides the verb, so both rows stay replaces.
    expect(
      screen.getAllByRole('button', { name: RELEASE_REPLACE_LABEL }),
    ).toHaveLength(2)
  })
})
