import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Done } from 'src/components/steps/done'
import { makeActions } from 'src/lib/__tests__/helpers/actions'
import { makeView } from 'src/lib/__tests__/helpers/view'
import { ApiError } from 'src/lib/api'
import type { BackupView } from 'src/shared/contract'

const IMMICH_URL = 'https://immich.example.com'

function doneView(
  immich: { createdByUs: boolean } | null,
  over: Partial<BackupView> = {},
): BackupView {
  const base = makeView('done', over, new Date().toISOString())
  return {
    ...base,
    account: base.account && {
      ...base.account,
      totalItems: 18_532,
      totalBytes: 142_000_000_000,
      immich: immich && {
        email: 'sam@example.com',
        url: IMMICH_URL,
        ...immich,
      },
    },
  }
}

describe('Done', () => {
  it('shows the last backup, the items and the size', () => {
    const view = doneView({ createdByUs: true })
    render(<Done actions={makeActions(view)} view={view} />)

    expect(
      screen.getByRole('heading', { name: 'Your photos are backed up' }),
    ).toBeInTheDocument()
    expect(screen.getByText('just now')).toBeInTheDocument()
    expect(screen.getByText('18,532')).toBeInTheDocument()
    expect(screen.getByText('142.0 GB')).toBeInTheDocument()
  })

  it('opens Immich in a new tab and shows the sign-in email', () => {
    const view = doneView({ createdByUs: true })
    render(<Done actions={makeActions(view)} view={view} />)

    const link = screen.getByRole('link', { name: 'Open my photos' })
    expect(link).toHaveAttribute('href', IMMICH_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('sam@example.com')).toBeInTheDocument()
  })

  describe('a temporary password', () => {
    it('is shown once, copied, and replaced only after a confirm', async () => {
      const user = userEvent.setup()
      const view = doneView({ createdByUs: true })
      const actions = makeActions(view)
      actions.resetImmichPassword
        .mockResolvedValueOnce('first-sample-phrase')
        .mockResolvedValueOnce('second-sample-phrase')
      render(<Done actions={actions} view={view} />)

      expect(screen.queryByLabelText('Temporary password')).toBeNull()
      await user.click(
        screen.getByRole('button', { name: 'Create a temporary password' }),
      )

      const shown = await screen.findByLabelText('Temporary password')
      expect(shown).toHaveTextContent('first-sample-phrase')
      expect(shown.tagName).toBe('CODE')
      expect(
        screen.getByText('Shown once. Immich will ask you to change it.'),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Copy' }))
      await expect(navigator.clipboard.readText()).resolves.toBe(
        'first-sample-phrase',
      )
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()

      // A second press asks first, because it replaces the old one.
      await user.click(
        screen.getByRole('button', { name: 'Create a new password' }),
      )
      const dialog = await screen.findByRole('dialog')
      expect(
        within(dialog).getByText('Replace the temporary password?'),
      ).toBeInTheDocument()
      expect(actions.resetImmichPassword).toHaveBeenCalledTimes(1)

      await user.click(within(dialog).getByRole('button', { name: 'Keep it' }))
      expect(actions.resetImmichPassword).toHaveBeenCalledTimes(1)
      expect(screen.getByLabelText('Temporary password')).toHaveTextContent(
        'first-sample-phrase',
      )

      await user.click(
        screen.getByRole('button', { name: 'Create a new password' }),
      )
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Replace it',
        }),
      )
      expect(actions.resetImmichPassword).toHaveBeenCalledTimes(2)
      expect(
        await screen.findByLabelText('Temporary password'),
      ).toHaveTextContent('second-sample-phrase')
      expect(screen.queryByText('first-sample-phrase')).toBeNull()
    })

    it('is gone once the screen is shown again', async () => {
      const view = doneView({ createdByUs: true })
      const actions = makeActions(view)
      const first = render(<Done actions={actions} view={view} />)
      await userEvent.click(
        screen.getByRole('button', { name: 'Create a temporary password' }),
      )
      expect(await screen.findByLabelText('Temporary password')).toBeVisible()
      first.unmount()

      render(<Done actions={actions} view={view} />)
      expect(screen.queryByLabelText('Temporary password')).toBeNull()
      expect(
        screen.getByRole('button', { name: 'Create a temporary password' }),
      ).toBeInTheDocument()
    })

    it('shows why creating one failed', async () => {
      const view = doneView({ createdByUs: true })
      const actions = makeActions(view)
      actions.resetImmichPassword.mockRejectedValue(
        new ApiError(502, 'Immich is not answering'),
      )
      render(<Done actions={actions} view={view} />)

      await userEvent.click(
        screen.getByRole('button', { name: 'Create a temporary password' }),
      )

      expect(
        await screen.findByText('Immich is not answering'),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText('Temporary password')).toBeNull()
    })
  })

  it('has no password button for an Immich user that already existed', () => {
    const view = doneView({ createdByUs: false })
    render(<Done actions={makeActions(view)} view={view} />)

    expect(
      screen.queryByRole('button', { name: /password/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Sign in with your existing Immich account/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open my photos' })).toBeVisible()
  })

  it('says the photos are safe when Immich failed, and Sync now retries', async () => {
    const view = doneView(null)
    const actions = makeActions(view)
    render(<Done actions={actions} view={view} />)

    expect(
      screen.getByText('Your photos are safe on the server.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Sync now will try again/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open my photos' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(actions.sync).toHaveBeenCalledTimes(1)
  })

  it('syncs when Sync now is pressed', async () => {
    const view = doneView({ createdByUs: true })
    const actions = makeActions(view)
    render(<Done actions={actions} view={view} />)

    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))

    expect(actions.sync).toHaveBeenCalledTimes(1)
  })

  it('disables Sync now, with the reason, when the server is low on space', async () => {
    const view = doneView({ createdByUs: true }, { lowDiskSpace: true })
    const actions = makeActions(view)
    render(<Done actions={actions} view={view} />)

    const button = screen.getByRole('button', { name: 'Sync now' })
    expect(button).toBeDisabled()
    expect(screen.getByText(/The server is low on space/)).toBeInTheDocument()

    await userEvent.click(button)
    expect(actions.sync).not.toHaveBeenCalled()
  })
})
