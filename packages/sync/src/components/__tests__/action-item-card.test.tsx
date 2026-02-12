import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ActionItem } from 'src/app/(app)/check-ins/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUpdateActionItemStatus = vi.fn()
const mockDeleteActionItem = vi.fn()

vi.mock('src/app/(app)/check-ins/action-item.actions', () => ({
  updateActionItemStatus: (...args: unknown[]) =>
    mockUpdateActionItemStatus(...args),
  deleteActionItem: (...args: unknown[]) => mockDeleteActionItem(...args),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { ActionItemCard } from 'src/components/action-item-card'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const userId = 'user-1'

function makeActionItem(overrides?: Partial<ActionItem>): ActionItem {
  return {
    id: 'ai-1',
    checkInId: 'ci-1',
    checkInQuestionId: 'q-1',
    description: 'Follow up on feedback',
    ownerType: 'individual',
    ownerId: userId,
    ownerDisplayName: null,
    createdById: userId,
    status: 'open',
    dueDate: null,
    completedAt: null,
    createdAt: new Date('2025-06-01'),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActionItemCard', () => {
  beforeEach(() => {
    mockUpdateActionItemStatus.mockResolvedValue({ success: true })
    mockDeleteActionItem.mockResolvedValue({ success: true })
  })

  it('renders description text', () => {
    render(
      <ActionItemCard
        item={makeActionItem()}
        userId={userId}
        checkInStatus="in_progress"
      />,
    )
    expect(screen.getByText('Follow up on feedback')).toBeInTheDocument()
  })

  it('shows "You" as owner label when item.ownerId === userId', () => {
    render(
      <ActionItemCard
        item={makeActionItem({ ownerId: userId })}
        userId={userId}
        checkInStatus="in_progress"
      />,
    )
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('shows partner display name when item.ownerId !== userId (individual)', () => {
    render(
      <ActionItemCard
        item={makeActionItem({
          ownerId: 'user-2',
          ownerDisplayName: 'Alice',
        })}
        userId={userId}
        checkInStatus="in_progress"
      />,
    )
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('shows "Both" when ownerType is "both"', () => {
    render(
      <ActionItemCard
        item={makeActionItem({ ownerType: 'both', ownerId: null })}
        userId={userId}
        checkInStatus="in_progress"
      />,
    )
    expect(screen.getByText('Both')).toBeInTheDocument()
  })

  it('shows "Partner" when ownerDisplayName is null and ownerId !== userId', () => {
    render(
      <ActionItemCard
        item={makeActionItem({
          ownerId: 'user-2',
          ownerDisplayName: null,
        })}
        userId={userId}
        checkInStatus="in_progress"
      />,
    )
    expect(screen.getByText('Partner')).toBeInTheDocument()
  })

  it('status toggle button has correct aria-label based on current status', () => {
    render(
      <ActionItemCard
        item={makeActionItem({ status: 'open' })}
        userId={userId}
        checkInStatus="in_progress"
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Mark as in_progress' }),
    ).toBeInTheDocument()
  })

  it('calls updateActionItemStatus with correct next status when toggle clicked', async () => {
    const user = userEvent.setup()
    render(
      <ActionItemCard
        item={makeActionItem({ status: 'open' })}
        userId={userId}
        checkInStatus="in_progress"
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

  it('delete button appears when checkInStatus is "in_progress"', () => {
    render(
      <ActionItemCard
        item={makeActionItem()}
        userId={userId}
        checkInStatus="in_progress"
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Delete action item' }),
    ).toBeInTheDocument()
  })

  it('delete button does NOT appear when checkInStatus is "completed"', () => {
    render(
      <ActionItemCard
        item={makeActionItem()}
        userId={userId}
        checkInStatus="completed"
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Delete action item' }),
    ).not.toBeInTheDocument()
  })

  it('delete button does NOT appear when checkInStatus is "draft"', () => {
    render(
      <ActionItemCard
        item={makeActionItem()}
        userId={userId}
        checkInStatus="draft"
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Delete action item' }),
    ).not.toBeInTheDocument()
  })

  it('calls deleteActionItem when delete button clicked', async () => {
    const user = userEvent.setup()
    render(
      <ActionItemCard
        item={makeActionItem()}
        userId={userId}
        checkInStatus="in_progress"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete action item' }))

    expect(mockDeleteActionItem).toHaveBeenCalledWith('ai-1')
  })

  it('toggles in_progress to completed', async () => {
    const user = userEvent.setup()
    render(
      <ActionItemCard
        item={makeActionItem({ status: 'in_progress' })}
        userId={userId}
        checkInStatus="in_progress"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Mark as completed' }))

    expect(mockUpdateActionItemStatus).toHaveBeenCalledWith('ai-1', 'completed')
  })

  it('toggles completed to open', async () => {
    const user = userEvent.setup()
    render(
      <ActionItemCard
        item={makeActionItem({ status: 'completed' })}
        userId={userId}
        checkInStatus="in_progress"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Mark as open' }))

    expect(mockUpdateActionItemStatus).toHaveBeenCalledWith('ai-1', 'open')
  })
})
