import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Downloading } from 'src/components/steps/downloading'
import { makeActions } from 'src/lib/__tests__/helpers/actions'
import { makeJob, makeView } from 'src/lib/__tests__/helpers/view'
import { ApiError } from 'src/lib/api'
import type { JobView } from 'src/shared/contract'

function downloadingView(over: Partial<JobView> = {}) {
  return {
    ...makeView('downloading'),
    job: makeJob('downloading', over),
  }
}

describe('Downloading', () => {
  it('shows the count, size, current file and the live hint', () => {
    const view = downloadingView({
      totalItems: 18_532,
      downloadedItems: 1204,
      downloadedBytes: 12_400_000_000,
      currentFile: 'Camera Roll/2026/11/IMG_4821.HEIC',
    })
    render(<Downloading actions={makeActions(view)} view={view} />)

    expect(
      screen.getByRole('heading', {
        name: '1,204 of 18,532 photos and videos',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('12.4 GB')).toBeInTheDocument()
    expect(screen.getByText('so far')).toBeInTheDocument()
    const file = screen.getByTitle('Camera Roll/2026/11/IMG_4821.HEIC')
    expect(file).toHaveClass('font-mono')
    expect(file).toHaveTextContent('Camera Roll/2026/11/IMG_4821.HEIC')
    expect(
      screen.getByText('You can close this tab. Your backup keeps going.'),
    ).toBeInTheDocument()
  })

  it('gives the progress bar its values', () => {
    const view = downloadingView({ totalItems: 200, downloadedItems: 50 })
    render(<Downloading actions={makeActions(view)} view={view} />)

    const bar = screen.getByRole('progressbar', { name: 'Backup progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '25')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('counts items already on the server toward the bar', () => {
    const view = downloadingView({
      totalItems: 200,
      downloadedItems: 50,
      skippedItems: 50,
    })
    render(<Downloading actions={makeActions(view)} view={view} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
    expect(screen.getByText('50 already on the server.')).toBeInTheDocument()
  })

  it('says "Counting…" and shows an indeterminate bar without a total', () => {
    const view = downloadingView({ totalItems: null, downloadedItems: 12 })
    render(<Downloading actions={makeActions(view)} view={view} />)

    expect(
      screen.getByRole('heading', { name: 'Counting…' }),
    ).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })

  it('asks before stopping, and stops only when confirmed', async () => {
    const view = downloadingView({ totalItems: 10 })
    const actions = makeActions(view)
    render(<Downloading actions={actions} view={view} />)

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Stop this backup?')).toBeInTheDocument()
    expect(actions.cancel).not.toHaveBeenCalled()

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Keep going' }),
    )
    expect(actions.cancel).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Stop backup',
      }),
    )
    expect(actions.cancel).toHaveBeenCalledTimes(1)
  })

  it('shows why a stop failed', async () => {
    const view = downloadingView({ totalItems: 10 })
    const actions = makeActions(view)
    actions.cancel.mockRejectedValue(new ApiError(500, 'The server said no'))
    render(<Downloading actions={actions} view={view} />)

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Stop backup',
      }),
    )

    expect(await screen.findByText('The server said no')).toBeInTheDocument()
  })
})
