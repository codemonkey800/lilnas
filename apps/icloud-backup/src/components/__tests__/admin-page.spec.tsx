import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AdminPage } from 'src/components/admin-page'
import { ApiError, getAdminAccounts } from 'src/lib/api'
import type { AdminAccountRow, BackupState } from 'src/shared/contract'
import { BACKUP_STATES } from 'src/shared/contract'

jest.mock('src/lib/api', () => ({
  ...jest.requireActual<typeof import('src/lib/api')>('src/lib/api'),
  getAdminAccounts: jest.fn(),
}))

const mockGet = jest.mocked(getAdminAccounts)

function row(
  email: string,
  state: BackupState | null,
  over: Partial<AdminAccountRow> = {},
): AdminAccountRow {
  return {
    email,
    appleId: 'nobody@example.invalid',
    folder: 'sam-1a2b',
    state,
    lastBackupAt: null,
    totalItems: 18532,
    totalBytes: 142_000_000_000,
    hasImmich: true,
    ...over,
  }
}

// Table and card list are both in the DOM; the table is the first match.
function tableRow(email: string): HTMLElement {
  const tr = screen.getAllByText(email)[0]?.closest('tr')
  if (!tr) throw new Error(`no table row for ${email}`)
  return tr
}

const TONES: Record<BackupState, string> = {
  queued_login: 'warn',
  need_password: 'warn',
  checking_password: 'accent',
  need_code: 'warn',
  checking_code: 'accent',
  queued_download: 'warn',
  indexing_wait: 'warn',
  downloading: 'accent',
  provisioning: 'accent',
  done: 'ok',
  needs_login: 'warn',
  paused_low_disk: 'warn',
  failed: 'bad',
  cancelled: 'mute',
}

describe('AdminPage', () => {
  it('shows a skeleton while loading', () => {
    mockGet.mockReturnValue(new Promise(() => undefined))
    render(<AdminPage />)

    expect(screen.getByLabelText('Loading backups')).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('renders each row with its details', async () => {
    mockGet.mockResolvedValue([
      row('sam@example.com', 'done', {
        lastBackupAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      }),
    ])
    render(<AdminPage />)

    const tr = within(await waitFor(() => tableRow('sam@example.com')))
    expect(tr.getByText('nobody@example.invalid')).toBeInTheDocument()
    expect(tr.getByText('sam-1a2b')).toHaveClass('font-mono')
    expect(tr.getByText('2 hours ago')).toBeInTheDocument()
    expect(tr.getByText('18,532')).toBeInTheDocument()
    expect(tr.getByText('142.0 GB')).toBeInTheDocument()
    expect(tr.getByText('Linked')).toBeInTheDocument()
  })

  it('shows None for Immich and a dash for no job', async () => {
    mockGet.mockResolvedValue([
      row('lee@example.com', null, { hasImmich: false }),
    ])
    render(<AdminPage />)

    const tr = within(await waitFor(() => tableRow('lee@example.com')))
    expect(tr.getByText('None')).toBeInTheDocument()
    expect(tr.queryByText(/Up to date|Queued|Failed/)).not.toBeInTheDocument()
    expect(tr.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it.each(BACKUP_STATES)('uses the %s badge tone', async state => {
    mockGet.mockResolvedValue([row('sam@example.com', state)])
    render(<AdminPage />)

    const tr = await waitFor(() => tableRow('sam@example.com'))
    const badge = tr.querySelector('[data-tone]')
    expect(badge).not.toBeNull()
    expect(badge).toHaveAttribute('data-tone', TONES[state])
    expect(badge).toHaveClass(
      TONES[state] === 'mute' ? 'bg-surface-2' : `bg-${TONES[state]}-ghost`,
    )
  })

  it('shows the empty state', async () => {
    mockGet.mockResolvedValue([])
    render(<AdminPage />)

    expect(
      await screen.findByText('Nobody has set up a backup yet'),
    ).toBeInTheDocument()
  })

  it('shows the error and retries', async () => {
    mockGet.mockRejectedValueOnce(new ApiError(502, 'Bad Gateway'))
    mockGet.mockResolvedValueOnce([row('sam@example.com', 'done')])
    render(<AdminPage />)

    expect(await screen.findByText('Bad Gateway')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(tableRow('sam@example.com')).toBeTruthy())
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('tells a non-admin the page is for admins, with a link home', async () => {
    mockGet.mockRejectedValue(new ApiError(403, 'Forbidden'))
    render(<AdminPage />)

    expect(
      await screen.findByText('This page is for admins'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Go to my backup' }),
    ).toHaveAttribute('href', '/')
    expect(
      screen.queryByRole('button', { name: 'Refresh' }),
    ).not.toBeInTheDocument()
  })

  it('reloads on Refresh and links back home', async () => {
    mockGet.mockResolvedValueOnce([row('sam@example.com', 'queued_download')])
    mockGet.mockResolvedValueOnce([row('maya@example.com', 'downloading')])
    render(<AdminPage />)

    await waitFor(() => tableRow('sam@example.com'))
    expect(screen.getByRole('link', { name: 'My backup' })).toHaveAttribute(
      'href',
      '/',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => tableRow('maya@example.com'))
    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('sam@example.com')).not.toBeInTheDocument()
  })
})
