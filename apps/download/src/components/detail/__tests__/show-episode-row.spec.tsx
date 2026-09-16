import '@testing-library/jest-dom'

import type { DownloadJob, Episode } from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  episode,
  scopedJob,
  show,
  SHOW_ID,
} from 'src/components/detail/__tests__/fixtures/show'
import { SAVE_LOCAL_LABEL } from 'src/components/detail/save-local'
import {
  EPISODE_ACTIONS_HIDE_LABEL,
  EPISODE_ACTIONS_LABEL,
  ShowEpisodeRow,
} from 'src/components/detail/show-episode-row'

function renderRow(
  options: { episode?: Episode; jobs?: DownloadJob[]; open?: boolean } = {},
) {
  const onToggle = jest.fn()
  const onRequest = jest.fn().mockResolvedValue(undefined)
  const onSearch = jest.fn().mockResolvedValue({ releases: [] })

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
})
