import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { IncomingInviteViewProps } from 'src/app/(app)/partner/incoming-invite-view'
import type { InviteFormViewProps } from 'src/app/(app)/partner/invite-form-view'
import type { PendingOutgoingViewProps } from 'src/app/(app)/partner/pending-outgoing-view'
import type {
  IncomingInvite,
  OutgoingInvite,
} from 'src/app/(app)/partner/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}))

vi.mock('src/app/(app)/partner/incoming-invite-view', () => ({
  IncomingInviteView: (props: IncomingInviteViewProps) => (
    <div
      data-testid="incoming-invite-view"
      data-invite-id={props.invite.id}
      data-index={props.currentIndex}
      data-total={props.totalCount}
    >
      <button onClick={props.onAccepted}>accept</button>
      <button onClick={props.onDeclined}>decline</button>
    </div>
  ),
}))

vi.mock('src/app/(app)/partner/invite-form-view', () => ({
  InviteFormView: (props: InviteFormViewProps) => (
    <div data-testid="invite-form-view">
      <button
        onClick={() =>
          props.onSent({
            id: 'new-inv',
            inviteeDisplayName: '',
            inviteeEmail: 'new@example.com',
          })
        }
      >
        send
      </button>
    </div>
  ),
}))

vi.mock('src/app/(app)/partner/pending-outgoing-view', () => ({
  PendingOutgoingView: (props: PendingOutgoingViewProps) => (
    <div data-testid="pending-outgoing-view">
      <button onClick={props.onCancelled}>cancel</button>
    </div>
  ),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { PartnerConnection } from 'src/app/(app)/partner/partner-connection'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIncoming(overrides?: Partial<IncomingInvite>): IncomingInvite {
  return {
    id: 'inc-1',
    inviterDisplayName: 'Alice',
    inviterEmail: 'alice@example.com',
    createdAt: new Date('2025-06-01'),
    ...overrides,
  }
}

function makeOutgoing(overrides?: Partial<OutgoingInvite>): OutgoingInvite {
  return {
    id: 'out-1',
    inviteeDisplayName: 'Bob',
    inviteeEmail: 'bob@example.com',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PartnerConnection', () => {
  it('shows IncomingInviteView when incoming invites exist', () => {
    render(
      <PartnerConnection
        initialIncomingInvites={[makeIncoming()]}
        initialOutgoingInvite={null}
      />,
    )
    expect(screen.getByTestId('incoming-invite-view')).toBeInTheDocument()
  })

  it('shows PendingOutgoingView when outgoing invite exists and no incoming', () => {
    render(
      <PartnerConnection
        initialIncomingInvites={[]}
        initialOutgoingInvite={makeOutgoing()}
      />,
    )
    expect(screen.getByTestId('pending-outgoing-view')).toBeInTheDocument()
  })

  it('shows InviteFormView when neither incoming nor outgoing exists', () => {
    render(
      <PartnerConnection
        initialIncomingInvites={[]}
        initialOutgoingInvite={null}
      />,
    )
    expect(screen.getByTestId('invite-form-view')).toBeInTheDocument()
  })

  it('accepting invite calls router.push("/")', async () => {
    const user = userEvent.setup()

    render(
      <PartnerConnection
        initialIncomingInvites={[makeIncoming()]}
        initialOutgoingInvite={null}
      />,
    )

    await user.click(screen.getByText('accept'))

    expect(mockPush).toHaveBeenCalledWith('/')
  })

  it('declining last invite shows invite form', async () => {
    const user = userEvent.setup()

    render(
      <PartnerConnection
        initialIncomingInvites={[makeIncoming()]}
        initialOutgoingInvite={null}
      />,
    )

    await user.click(screen.getByText('decline'))

    expect(screen.getByTestId('invite-form-view')).toBeInTheDocument()
  })

  it('declining non-last invite shows next invite', async () => {
    const user = userEvent.setup()
    const invites = [
      makeIncoming({ id: 'inc-1' }),
      makeIncoming({ id: 'inc-2', inviterDisplayName: 'Carol' }),
    ]

    render(
      <PartnerConnection
        initialIncomingInvites={invites}
        initialOutgoingInvite={null}
      />,
    )

    expect(screen.getByTestId('incoming-invite-view')).toHaveAttribute(
      'data-invite-id',
      'inc-1',
    )

    await user.click(screen.getByText('decline'))

    expect(screen.getByTestId('incoming-invite-view')).toHaveAttribute(
      'data-invite-id',
      'inc-2',
    )
  })

  it('sending invite transitions to pending view', async () => {
    const user = userEvent.setup()

    render(
      <PartnerConnection
        initialIncomingInvites={[]}
        initialOutgoingInvite={null}
      />,
    )

    expect(screen.getByTestId('invite-form-view')).toBeInTheDocument()

    await user.click(screen.getByText('send'))

    expect(screen.getByTestId('pending-outgoing-view')).toBeInTheDocument()
  })

  it('cancelling outgoing invite transitions back to invite form', async () => {
    const user = userEvent.setup()

    render(
      <PartnerConnection
        initialIncomingInvites={[]}
        initialOutgoingInvite={makeOutgoing()}
      />,
    )

    expect(screen.getByTestId('pending-outgoing-view')).toBeInTheDocument()

    await user.click(screen.getByText('cancel'))

    expect(screen.getByTestId('invite-form-view')).toBeInTheDocument()
  })
})
