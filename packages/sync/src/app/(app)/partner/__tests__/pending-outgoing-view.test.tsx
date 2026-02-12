import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OutgoingInvite } from 'src/app/(app)/partner/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}))

const mockCancelInvite = vi.fn()

vi.mock('src/app/(app)/partner/actions', () => ({
  cancelInvite: (...args: unknown[]) => mockCancelInvite(...args),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { PendingOutgoingView } from 'src/app/(app)/partner/pending-outgoing-view'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeInvite(overrides?: Partial<OutgoingInvite>): OutgoingInvite {
  return {
    id: 'inv-1',
    inviteeDisplayName: 'Bob',
    inviteeEmail: 'bob@example.com',
    ...overrides,
  }
}

const defaultProps = {
  invite: makeInvite(),
  onCancelled: vi.fn(),
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PendingOutgoingView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders invitee email', () => {
    render(<PendingOutgoingView {...defaultProps} />)
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
  })

  it('renders "Invite sent" heading', () => {
    render(<PendingOutgoingView {...defaultProps} />)
    expect(screen.getByText('Invite sent')).toBeInTheDocument()
  })

  it('cancel button calls cancelInvite with invite id, then calls onCancelled on success', async () => {
    const user = userEvent.setup()
    const onCancelled = vi.fn()
    mockCancelInvite.mockResolvedValueOnce({ success: true })

    render(
      <PendingOutgoingView invite={makeInvite()} onCancelled={onCancelled} />,
    )

    await user.click(screen.getByRole('button', { name: /cancel invite/i }))

    expect(mockCancelInvite).toHaveBeenCalledWith('inv-1')
    expect(onCancelled).toHaveBeenCalled()
  })

  it('cancel with empty invite.id calls onCancelled directly without server call', async () => {
    const user = userEvent.setup()
    const onCancelled = vi.fn()

    render(
      <PendingOutgoingView
        invite={makeInvite({ id: '' })}
        onCancelled={onCancelled}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel invite/i }))

    expect(mockCancelInvite).not.toHaveBeenCalled()
    expect(onCancelled).toHaveBeenCalled()
  })

  it('shows error on cancel failure', async () => {
    const user = userEvent.setup()
    mockCancelInvite.mockResolvedValueOnce({
      success: false,
      error: 'Invite not found.',
    })

    render(<PendingOutgoingView {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /cancel invite/i }))

    expect(await screen.findByText('Invite not found.')).toBeInTheDocument()
  })

  it('sets up polling interval that calls router.refresh', () => {
    vi.useFakeTimers()

    render(<PendingOutgoingView {...defaultProps} />)

    expect(mockRefresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5000)
    expect(mockRefresh).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5000)
    expect(mockRefresh).toHaveBeenCalledTimes(2)
  })

  it('cleans up interval on unmount', () => {
    vi.useFakeTimers()

    const { unmount } = render(<PendingOutgoingView {...defaultProps} />)

    vi.advanceTimersByTime(5000)
    expect(mockRefresh).toHaveBeenCalledTimes(1)

    unmount()

    vi.advanceTimersByTime(10000)
    // Should still be 1 -- no new calls after unmount
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })
})
