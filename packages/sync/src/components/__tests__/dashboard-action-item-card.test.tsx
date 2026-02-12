import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DashboardActionItem } from 'src/app/(app)/check-ins/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUpdateActionItemStatus = vi.fn()

vi.mock('src/app/(app)/check-ins/action-item.actions', () => ({
  updateActionItemStatus: (...args: unknown[]) =>
    mockUpdateActionItemStatus(...args),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { DashboardActionItemCard } from 'src/components/dashboard-action-item-card'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const userId = 'user-1'

function makeItem(
  overrides?: Partial<DashboardActionItem>,
): DashboardActionItem {
  return {
    id: 'ai-1',
    checkInId: 'ci-1',
    checkInQuestionId: 'q-1',
    description: 'Buy flowers for date night',
    ownerType: 'individual',
    ownerId: userId,
    ownerDisplayName: null,
    createdById: userId,
    status: 'open',
    dueDate: null,
    completedAt: null,
    createdAt: new Date('2025-06-01'),
    checkInTitle: 'Weekly Check-in',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardActionItemCard', () => {
  beforeEach(() => {
    mockUpdateActionItemStatus.mockResolvedValue({ success: true })
  })

  it('renders description text', () => {
    render(<DashboardActionItemCard item={makeItem()} userId={userId} />)
    expect(screen.getByText('Buy flowers for date night')).toBeInTheDocument()
  })

  it('renders check-in title', () => {
    render(<DashboardActionItemCard item={makeItem()} userId={userId} />)
    expect(screen.getByText('Weekly Check-in')).toBeInTheDocument()
  })

  it('shows "You" as owner label when item.ownerId === userId', () => {
    render(
      <DashboardActionItemCard
        item={makeItem({ ownerId: userId })}
        userId={userId}
      />,
    )
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('shows partner display name when item.ownerId !== userId (individual)', () => {
    render(
      <DashboardActionItemCard
        item={makeItem({ ownerId: 'user-2', ownerDisplayName: 'Alice' })}
        userId={userId}
      />,
    )
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('shows "Both" when ownerType is "both"', () => {
    render(
      <DashboardActionItemCard
        item={makeItem({ ownerType: 'both', ownerId: null })}
        userId={userId}
      />,
    )
    expect(screen.getByText('Both')).toBeInTheDocument()
  })

  it('shows "Partner" when ownerDisplayName is null and ownerId !== userId', () => {
    render(
      <DashboardActionItemCard
        item={makeItem({ ownerId: 'user-2', ownerDisplayName: null })}
        userId={userId}
      />,
    )
    expect(screen.getByText('Partner')).toBeInTheDocument()
  })

  it('status toggle button has correct aria-label based on current status', () => {
    render(
      <DashboardActionItemCard
        item={makeItem({ status: 'open' })}
        userId={userId}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Mark as in_progress' }),
    ).toBeInTheDocument()
  })

  it('calls updateActionItemStatus with correct next status when toggle clicked', async () => {
    const user = userEvent.setup()
    render(
      <DashboardActionItemCard
        item={makeItem({ status: 'open' })}
        userId={userId}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Mark as in_progress' }),
    )

    expect(mockUpdateActionItemStatus).toHaveBeenCalledWith(
      'ai-1',
      'in_progress',
    )
  })

  it('toggles in_progress to completed', async () => {
    const user = userEvent.setup()
    render(
      <DashboardActionItemCard
        item={makeItem({ status: 'in_progress' })}
        userId={userId}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Mark as completed' }))

    expect(mockUpdateActionItemStatus).toHaveBeenCalledWith('ai-1', 'completed')
  })

  it('links to the correct check-in page', () => {
    render(
      <DashboardActionItemCard
        item={makeItem({ checkInId: 'ci-42' })}
        userId={userId}
      />,
    )

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/check-ins/ci-42')
  })
})
