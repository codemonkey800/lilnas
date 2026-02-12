import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { IncomingInviteViewProps } from 'src/app/(app)/partner/incoming-invite-view'
import type { ActionResult, IncomingInvite } from 'src/app/(app)/partner/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAcceptInvite = vi.fn()
const mockDeclineInvite = vi.fn()

vi.mock('src/app/(app)/partner/actions', () => ({
  acceptInvite: (...args: unknown[]) => mockAcceptInvite(...args),
  declineInvite: (...args: unknown[]) => mockDeclineInvite(...args),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { IncomingInviteView } from 'src/app/(app)/partner/incoming-invite-view'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeInvite(overrides?: Partial<IncomingInvite>): IncomingInvite {
  return {
    id: 'inv-1',
    inviterDisplayName: 'Alice',
    inviterEmail: 'alice@example.com',
    createdAt: new Date('2025-06-01'),
    ...overrides,
  }
}

function makeProps(
  overrides?: Partial<IncomingInviteViewProps>,
): IncomingInviteViewProps {
  return {
    invite: makeInvite(),
    currentIndex: 0,
    totalCount: 1,
    onAccepted: vi.fn(),
    onDeclined: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IncomingInviteView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders heading, inviter name, and email', () => {
    render(<IncomingInviteView {...makeProps()} />)

    expect(
      screen.getByText('You have a connection request'),
    ).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
  })

  it('renders without crashing when inviterEmail is null', () => {
    render(
      <IncomingInviteView
        {...makeProps({ invite: makeInvite({ inviterEmail: null }) })}
      />,
    )

    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('accept button calls acceptInvite with invite id, then calls onAccepted on success', async () => {
    const user = userEvent.setup()
    const onAccepted = vi.fn()
    mockAcceptInvite.mockResolvedValueOnce({ success: true })

    render(<IncomingInviteView {...makeProps({ onAccepted })} />)

    await user.click(screen.getByRole('button', { name: /accept/i }))

    expect(mockAcceptInvite).toHaveBeenCalledWith('inv-1')
    expect(onAccepted).toHaveBeenCalled()
  })

  it('accept failure shows error, does NOT call onAccepted', async () => {
    const user = userEvent.setup()
    const onAccepted = vi.fn()
    mockAcceptInvite.mockResolvedValueOnce({
      success: false,
      error: 'Invite not found.',
    })

    render(<IncomingInviteView {...makeProps({ onAccepted })} />)

    await user.click(screen.getByRole('button', { name: /accept/i }))

    expect(await screen.findByText('Invite not found.')).toBeInTheDocument()
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it('disables both buttons while accept is in flight', async () => {
    const user = userEvent.setup()
    let resolve!: (v: ActionResult) => void
    mockAcceptInvite.mockReturnValueOnce(
      new Promise<ActionResult>(r => {
        resolve = r
      }),
    )

    render(<IncomingInviteView {...makeProps()} />)
    await user.click(screen.getByRole('button', { name: /accept/i }))

    expect(screen.getByRole('button', { name: /accepting/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /decline/i })).toBeDisabled()

    await act(async () => resolve({ success: true }))
  })

  it('decline button calls declineInvite with invite id, then calls onDeclined on success', async () => {
    const user = userEvent.setup()
    const onDeclined = vi.fn()
    mockDeclineInvite.mockResolvedValueOnce({ success: true })

    render(<IncomingInviteView {...makeProps({ onDeclined })} />)

    await user.click(screen.getByRole('button', { name: /decline/i }))

    expect(mockDeclineInvite).toHaveBeenCalledWith('inv-1')
    expect(onDeclined).toHaveBeenCalled()
  })

  it('decline failure shows error, does NOT call onDeclined', async () => {
    const user = userEvent.setup()
    const onDeclined = vi.fn()
    mockDeclineInvite.mockResolvedValueOnce({
      success: false,
      error: 'Something went wrong.',
    })

    render(<IncomingInviteView {...makeProps({ onDeclined })} />)

    await user.click(screen.getByRole('button', { name: /decline/i }))

    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument()
    expect(onDeclined).not.toHaveBeenCalled()
  })

  it('disables both buttons while decline is in flight', async () => {
    const user = userEvent.setup()
    let resolve!: (v: ActionResult) => void
    mockDeclineInvite.mockReturnValueOnce(
      new Promise<ActionResult>(r => {
        resolve = r
      }),
    )

    render(<IncomingInviteView {...makeProps()} />)
    await user.click(screen.getByRole('button', { name: /decline/i }))

    expect(screen.getByRole('button', { name: /declining/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /accept/i })).toBeDisabled()

    await act(async () => resolve({ success: true }))
  })

  it('clears previous error when retrying', async () => {
    const user = userEvent.setup()
    mockAcceptInvite.mockResolvedValueOnce({
      success: false,
      error: 'Network error',
    })
    mockAcceptInvite.mockResolvedValueOnce({ success: true })

    render(<IncomingInviteView {...makeProps()} />)

    await user.click(screen.getByRole('button', { name: /accept/i }))
    expect(await screen.findByText('Network error')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /accept/i }))
    expect(screen.queryByText('Network error')).not.toBeInTheDocument()
  })

  it('counter shows "Request 1 of 3" when totalCount > 1', () => {
    render(
      <IncomingInviteView {...makeProps({ currentIndex: 0, totalCount: 3 })} />,
    )

    expect(screen.getByText('Request 1 of 3')).toBeInTheDocument()
  })

  it('counter hidden when totalCount is 1', () => {
    render(
      <IncomingInviteView {...makeProps({ currentIndex: 0, totalCount: 1 })} />,
    )

    expect(screen.queryByText(/Request \d+ of \d+/)).not.toBeInTheDocument()
  })
})
