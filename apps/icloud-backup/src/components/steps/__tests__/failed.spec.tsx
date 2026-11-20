import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Failed } from 'src/components/steps/failed'
import { makeActions } from 'src/lib/__tests__/helpers/actions'
import { makeJob, makeView } from 'src/lib/__tests__/helpers/view'
import { ApiError } from 'src/lib/api'
import { ERROR_CODES, type ErrorCode } from 'src/shared/contract'

function failedView(errorCode: ErrorCode | null, sessionMayExist = false) {
  const base = makeView(
    'failed',
    {},
    sessionMayExist ? '2026-11-18T10:00:00.000Z' : null,
  )
  return {
    ...base,
    account: base.account && {
      ...base.account,
      appleIdLocked: sessionMayExist,
    },
    job: makeJob('failed', { errorCode }),
  }
}

const EXPECTED: Record<ErrorCode, { message: RegExp; button: string }> = {
  apple_access_denied: { message: /Apple refused access/, button: 'Try again' },
  wrong_password: {
    message: /That password didn't work/,
    button: 'Sign in again',
  },
  login_timeout: { message: /Sign-in timed out/, button: 'Sign in again' },
  interrupted_login: {
    message: /The sign-in was interrupted/,
    button: 'Sign in again',
  },
  apple_indexing: { message: /Try again later/, button: 'Try again' },
  immich_error: { message: /Something went wrong/, button: 'Try again' },
  icloudpd_error: { message: /Something went wrong/, button: 'Try again' },
  internal: { message: /Something went wrong/, button: 'Try again' },
}

describe('Failed', () => {
  it('has a message and a button for every error code', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ERROR_CODES].sort())

    for (const code of ERROR_CODES) {
      const view = failedView(code)
      const { unmount } = render(
        <Failed actions={makeActions(view)} view={view} />,
      )

      expect(screen.getByRole('alert')).toHaveTextContent(
        EXPECTED[code].message,
      )
      expect(
        screen.getByRole('button', { name: EXPECTED[code].button }),
      ).toBeInTheDocument()
      unmount()
    }
  })

  it('shows the two Apple settings when access was denied', () => {
    const view = failedView('apple_access_denied')
    render(<Failed actions={makeActions(view)} view={view} />)

    expect(
      screen.getByText('Advanced Data Protection must be off'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Access iCloud Data on the Web must be on'),
    ).toBeInTheDocument()
  })

  it('shows the machine code only for the generic failures', () => {
    const view = failedView('icloudpd_error')
    const { unmount } = render(
      <Failed actions={makeActions(view)} view={view} />,
    )
    expect(screen.getByText('icloudpd_error')).toHaveClass('font-mono')
    unmount()

    const denied = failedView('apple_access_denied')
    render(<Failed actions={makeActions(denied)} view={denied} />)
    expect(screen.queryByText('apple_access_denied')).not.toBeInTheDocument()
  })

  it('treats a job with no error code as generic', () => {
    const view = failedView(null)
    render(<Failed actions={makeActions(view)} view={view} />)

    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
  })

  describe('a job the person stopped', () => {
    function cancelledView(sessionMayExist: boolean) {
      const base = failedView(null, sessionMayExist)
      return { ...base, job: makeJob('cancelled', { errorCode: null }) }
    }

    it('says they stopped it instead of reporting a failure', () => {
      const view = cancelledView(true)
      render(<Failed actions={makeActions(view)} view={view} />)

      expect(screen.getByText(/You stopped this backup/)).toBeInTheDocument()
      expect(screen.getByText(/already saved are safe/)).toBeInTheDocument()
      expect(screen.queryByText('Failed')).not.toBeInTheDocument()
      expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument()
      expect(screen.queryByText(/tell Jeremy/)).not.toBeInTheDocument()
    })

    it('syncs on Sync now when a session may exist', async () => {
      const view = cancelledView(true)
      const actions = makeActions(view)
      render(<Failed actions={actions} view={view} />)

      await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))

      expect(actions.sync).toHaveBeenCalledTimes(1)
      expect(actions.start).not.toHaveBeenCalled()
    })

    it('starts on Try again when no session can exist', async () => {
      const view = cancelledView(false)
      const actions = makeActions(view)
      render(<Failed actions={actions} view={view} />)

      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

      expect(actions.start).toHaveBeenCalledWith('nobody@example.invalid')
      expect(actions.sync).not.toHaveBeenCalled()
    })
  })

  it.each(['wrong_password', 'login_timeout', 'interrupted_login'] as const)(
    'starts a new sign-in for %s even when a session may exist',
    async code => {
      const view = failedView(code, true)
      const actions = makeActions(view)
      render(<Failed actions={actions} view={view} />)

      await userEvent.click(
        screen.getByRole('button', { name: 'Sign in again' }),
      )

      expect(actions.start).toHaveBeenCalledWith('nobody@example.invalid')
      expect(actions.sync).not.toHaveBeenCalled()
    },
  )

  it('syncs on Try again when a session may exist', async () => {
    const view = failedView('apple_indexing', true)
    const actions = makeActions(view)
    render(<Failed actions={actions} view={view} />)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(actions.sync).toHaveBeenCalledTimes(1)
    expect(actions.start).not.toHaveBeenCalled()
  })

  it('starts on Try again when no session can exist', async () => {
    const view = failedView('internal', false)
    const actions = makeActions(view)
    render(<Failed actions={actions} view={view} />)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(actions.start).toHaveBeenCalledWith('nobody@example.invalid')
    expect(actions.sync).not.toHaveBeenCalled()
  })

  it('shows why Try again failed', async () => {
    const view = failedView('internal', true)
    const actions = makeActions(view)
    actions.sync.mockRejectedValue(new ApiError(409, 'Already running'))
    render(<Failed actions={actions} view={view} />)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Already running')).toBeInTheDocument()
  })
})
