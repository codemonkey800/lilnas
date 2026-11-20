import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { BackupApp } from 'src/components/backup-app'
import { makeView } from 'src/lib/__tests__/helpers/view'
import { ApiError } from 'src/lib/api'
import { type UseBackup, useBackup } from 'src/lib/use-backup'

jest.mock('src/lib/use-backup')

const mockUseBackup = jest.mocked(useBackup)

function state(over: Partial<UseBackup> = {}): UseBackup {
  return {
    view: null,
    live: true,
    error: null,
    actions: {
      start: jest.fn(),
      sync: jest.fn(),
      submitPassword: jest.fn(),
      submitCode: jest.fn(),
      cancel: jest.fn(),
      resetImmichPassword: jest.fn(),
      reload: jest.fn(),
    },
    ...over,
  }
}

describe('BackupApp', () => {
  it('shows a skeleton while loading', () => {
    mockUseBackup.mockReturnValue(state())
    render(<BackupApp />)

    expect(screen.getByLabelText('Loading your backup')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.queryByText('Try again')).not.toBeInTheDocument()
  })

  it('shows the load error and retries', async () => {
    const current = state({
      error: new ApiError(502, 'Bad Gateway'),
    })
    mockUseBackup.mockReturnValue(current)
    render(<BackupApp />)

    expect(screen.getByText('Bad Gateway')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(current.actions.reload).toHaveBeenCalledTimes(1)
  })

  it('shows the reconnecting banner only when not live', () => {
    mockUseBackup.mockReturnValue(
      state({ view: makeView('downloading'), live: false }),
    )
    const { rerender } = render(<BackupApp />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Lost the live connection.',
    )

    mockUseBackup.mockReturnValue(
      state({ view: makeView('downloading'), live: true }),
    )
    rerender(<BackupApp />)
    expect(
      screen.queryByText(/Lost the live connection/),
    ).not.toBeInTheDocument()
  })

  it('shows the Admin link only for an admin', () => {
    mockUseBackup.mockReturnValue(
      state({ view: makeView('downloading', { isAdmin: true }) }),
    )
    const { rerender } = render(<BackupApp />)
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/admin',
    )

    mockUseBackup.mockReturnValue(
      state({ view: makeView('downloading', { isAdmin: false }) }),
    )
    rerender(<BackupApp />)
    expect(
      screen.queryByRole('link', { name: 'Admin' }),
    ).not.toBeInTheDocument()
  })

  it.each([
    ['need_password', 'sign_in'],
    ['queued_login', 'waiting_turn'],
    ['need_code', 'code'],
    ['downloading', 'downloading'],
    ['failed', 'failed'],
  ] as const)('renders the %s state as the %s step', (jobState, step) => {
    mockUseBackup.mockReturnValue(state({ view: makeView(jobState) }))
    const { container } = render(<BackupApp />)

    expect(container.querySelector(`[data-step="${step}"]`)).toBeInTheDocument()
  })

  it('renders the preflight step when there is no account', () => {
    mockUseBackup.mockReturnValue(
      state({ view: makeView(null, { account: null }) }),
    )
    const { container } = render(<BackupApp />)

    expect(
      container.querySelector('[data-step="preflight"]'),
    ).toBeInTheDocument()
  })
})
