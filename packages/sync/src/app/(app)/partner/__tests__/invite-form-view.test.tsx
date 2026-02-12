import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSendPartnerInvite = vi.fn()

vi.mock('src/app/(app)/partner/actions', () => ({
  sendPartnerInvite: (...args: unknown[]) => mockSendPartnerInvite(...args),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { InviteFormView } from 'src/app/(app)/partner/invite-form-view'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InviteFormView', () => {
  it('renders email input and submit button', () => {
    render(<InviteFormView onSent={vi.fn()} />)
    expect(
      screen.getByPlaceholderText('partner@example.com'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /send invite/i }),
    ).toBeInTheDocument()
  })

  it('submit button is disabled when email is empty', () => {
    render(<InviteFormView onSent={vi.fn()} />)
    expect(screen.getByRole('button', { name: /send invite/i })).toBeDisabled()
  })

  it('calls sendPartnerInvite with email on submit', async () => {
    const user = userEvent.setup()
    mockSendPartnerInvite.mockResolvedValueOnce({
      success: true,
      partnershipId: 'p-1',
    })

    render(<InviteFormView onSent={vi.fn()} />)

    await user.type(
      screen.getByPlaceholderText('partner@example.com'),
      'bob@example.com',
    )
    await user.click(screen.getByRole('button', { name: /send invite/i }))

    expect(mockSendPartnerInvite).toHaveBeenCalledWith('bob@example.com')
  })

  it('calls onSent with constructed OutgoingInvite on success', async () => {
    const user = userEvent.setup()
    const onSent = vi.fn()
    mockSendPartnerInvite.mockResolvedValueOnce({
      success: true,
      partnershipId: 'p-1',
    })

    render(<InviteFormView onSent={onSent} />)

    await user.type(
      screen.getByPlaceholderText('partner@example.com'),
      'bob@example.com',
    )
    await user.click(screen.getByRole('button', { name: /send invite/i }))

    expect(onSent).toHaveBeenCalledWith({
      id: 'p-1',
      inviteeDisplayName: '',
      inviteeEmail: 'bob@example.com',
    })
  })

  it('shows error message on failure', async () => {
    const user = userEvent.setup()
    mockSendPartnerInvite.mockResolvedValueOnce({
      success: false,
      error: 'No account found with that email address.',
    })

    render(<InviteFormView onSent={vi.fn()} />)

    await user.type(
      screen.getByPlaceholderText('partner@example.com'),
      'nobody@example.com',
    )
    await user.click(screen.getByRole('button', { name: /send invite/i }))

    expect(
      await screen.findByText('No account found with that email address.'),
    ).toBeInTheDocument()
  })

  it('shows "Connect with your partner" heading', () => {
    render(<InviteFormView onSent={vi.fn()} />)
    expect(screen.getByText('Connect with your partner')).toBeInTheDocument()
  })
})
