import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Paused } from 'src/components/steps/paused'
import { SignInAgain } from 'src/components/steps/sign-in-again'
import { makeActions } from 'src/lib/__tests__/helpers/actions'
import { makeJob, makeView } from 'src/lib/__tests__/helpers/view'
import { ApiError } from 'src/lib/api'

describe('SignInAgain', () => {
  it('starts the sign-in with the saved Apple ID', async () => {
    const view = makeView('needs_login')
    const actions = makeActions(view)
    render(<SignInAgain actions={actions} view={view} />)

    expect(
      screen.getByRole('heading', {
        name: 'Apple wants you to sign in again',
      }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }))

    expect(actions.start).toHaveBeenCalledWith('nobody@example.invalid')
  })

  it('shows why the sign-in could not start', async () => {
    const view = makeView('needs_login')
    const actions = makeActions(view)
    actions.start.mockRejectedValue(new ApiError(503, 'Try again in a minute'))
    render(<SignInAgain actions={actions} view={view} />)

    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }))

    expect(await screen.findByText('Try again in a minute')).toBeInTheDocument()
  })
})

describe('Paused', () => {
  function pausedView(lowDiskSpace: boolean) {
    return {
      ...makeView('paused_low_disk', { lowDiskSpace }),
      job: makeJob('paused_low_disk', {
        totalItems: 18_532,
        downloadedItems: 1000,
        skippedItems: 204,
      }),
    }
  }

  it('says the server is low on space and what was saved', () => {
    const view = pausedView(true)
    render(<Paused actions={makeActions(view)} view={view} />)

    expect(
      screen.getByRole('heading', { name: 'The server is low on space' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('1,204 of 18,532 photos and videos saved so far'),
    ).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '6',
    )
  })

  it('disables Sync now while the space is low', async () => {
    const view = pausedView(true)
    const actions = makeActions(view)
    render(<Paused actions={actions} view={view} />)

    const button = screen.getByRole('button', { name: 'Sync now' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(actions.sync).not.toHaveBeenCalled()
  })

  it('enables Sync now once there is room', async () => {
    const view = pausedView(false)
    const actions = makeActions(view)
    render(<Paused actions={actions} view={view} />)

    const button = screen.getByRole('button', { name: 'Sync now' })
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(actions.sync).toHaveBeenCalledTimes(1)
  })
})
