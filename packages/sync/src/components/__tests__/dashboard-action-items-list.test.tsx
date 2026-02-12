import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DashboardActionItem } from 'src/app/(app)/check-ins/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('src/app/(app)/check-ins/action-item.actions', () => ({
  updateActionItemStatus: vi.fn().mockResolvedValue({ success: true }),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { DashboardActionItemsList } from 'src/components/dashboard-action-items-list'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const userId = 'user-1'
const partnerId = 'user-2'

function makeItem(
  overrides?: Partial<DashboardActionItem> & { id?: string },
): DashboardActionItem {
  return {
    id: 'ai-1',
    checkInId: 'ci-1',
    checkInQuestionId: 'q-1',
    description: 'Default action item',
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

function makeItems(): DashboardActionItem[] {
  return [
    makeItem({
      id: 'mine-open',
      description: 'My open task',
      ownerType: 'individual',
      ownerId: userId,
      status: 'open',
    }),
    makeItem({
      id: 'mine-completed',
      description: 'My completed task',
      ownerType: 'individual',
      ownerId: userId,
      status: 'completed',
    }),
    makeItem({
      id: 'partner-open',
      description: "Partner's open task",
      ownerType: 'individual',
      ownerId: partnerId,
      ownerDisplayName: 'Alice',
      status: 'open',
    }),
    makeItem({
      id: 'partner-completed',
      description: "Partner's completed task",
      ownerType: 'individual',
      ownerId: partnerId,
      ownerDisplayName: 'Alice',
      status: 'completed',
    }),
    makeItem({
      id: 'shared-open',
      description: 'Shared open task',
      ownerType: 'both',
      ownerId: null,
      ownerDisplayName: null,
      status: 'open',
    }),
    makeItem({
      id: 'shared-in-progress',
      description: 'Shared in-progress task',
      ownerType: 'both',
      ownerId: null,
      ownerDisplayName: null,
      status: 'in_progress',
    }),
    makeItem({
      id: 'shared-completed',
      description: 'Shared completed task',
      ownerType: 'both',
      ownerId: null,
      ownerDisplayName: null,
      status: 'completed',
    }),
  ]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardActionItemsList', () => {
  // -----------------------------------------------------------------------
  // Default state
  // -----------------------------------------------------------------------

  describe('default filter (All + Open)', () => {
    it('shows all open and in-progress items by default', () => {
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      expect(screen.getByText('My open task')).toBeInTheDocument()
      expect(screen.getByText("Partner's open task")).toBeInTheDocument()
      expect(screen.getByText('Shared open task')).toBeInTheDocument()
      expect(screen.getByText('Shared in-progress task')).toBeInTheDocument()

      // Completed items should be hidden by default
      expect(screen.queryByText('My completed task')).not.toBeInTheDocument()
      expect(
        screen.queryByText("Partner's completed task"),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText('Shared completed task'),
      ).not.toBeInTheDocument()
    })

    it('marks "All" owner filter and "Open" status filter as pressed', () => {
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      const ownerGroup = screen.getByRole('group', {
        name: 'Filter by owner',
      })
      expect(
        within(ownerGroup).getByRole('button', { name: 'All' }),
      ).toHaveAttribute('aria-pressed', 'true')
      expect(
        within(ownerGroup).getByRole('button', { name: 'Mine' }),
      ).toHaveAttribute('aria-pressed', 'false')

      const statusGroup = screen.getByRole('group', {
        name: 'Filter by status',
      })
      expect(
        within(statusGroup).getByRole('button', { name: 'Open' }),
      ).toHaveAttribute('aria-pressed', 'true')
      expect(
        within(statusGroup).getByRole('button', { name: 'Completed' }),
      ).toHaveAttribute('aria-pressed', 'false')
    })
  })

  // -----------------------------------------------------------------------
  // Owner filter
  // -----------------------------------------------------------------------

  describe('owner filter', () => {
    it('filters to "Mine" -- only shows items assigned to current user', async () => {
      const user = userEvent.setup()
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      await user.click(screen.getByRole('button', { name: 'Mine' }))

      expect(screen.getByText('My open task')).toBeInTheDocument()
      expect(screen.queryByText("Partner's open task")).not.toBeInTheDocument()
      expect(screen.queryByText('Shared open task')).not.toBeInTheDocument()
    })

    it('filters to "Partner\'s" -- only shows items assigned to partner', async () => {
      const user = userEvent.setup()
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      await user.click(screen.getByRole('button', { name: "Partner's" }))

      expect(screen.getByText("Partner's open task")).toBeInTheDocument()
      expect(screen.queryByText('My open task')).not.toBeInTheDocument()
      expect(screen.queryByText('Shared open task')).not.toBeInTheDocument()
    })

    it('filters to "Shared" -- only shows both-type items', async () => {
      const user = userEvent.setup()
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      await user.click(screen.getByRole('button', { name: 'Shared' }))

      expect(screen.getByText('Shared open task')).toBeInTheDocument()
      expect(screen.getByText('Shared in-progress task')).toBeInTheDocument()
      expect(screen.queryByText('My open task')).not.toBeInTheDocument()
      expect(screen.queryByText("Partner's open task")).not.toBeInTheDocument()
    })

    it('switching back to "All" shows all open items again', async () => {
      const user = userEvent.setup()
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      await user.click(screen.getByRole('button', { name: 'Mine' }))
      await user.click(screen.getByRole('button', { name: 'All' }))

      expect(screen.getByText('My open task')).toBeInTheDocument()
      expect(screen.getByText("Partner's open task")).toBeInTheDocument()
      expect(screen.getByText('Shared open task')).toBeInTheDocument()
    })
  })

  // -----------------------------------------------------------------------
  // Status filter
  // -----------------------------------------------------------------------

  describe('status filter', () => {
    it('switching to "Completed" shows only completed items', async () => {
      const user = userEvent.setup()
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      await user.click(screen.getByRole('button', { name: 'Completed' }))

      expect(screen.getByText('My completed task')).toBeInTheDocument()
      expect(screen.getByText("Partner's completed task")).toBeInTheDocument()
      expect(screen.getByText('Shared completed task')).toBeInTheDocument()

      // Open items should be hidden
      expect(screen.queryByText('My open task')).not.toBeInTheDocument()
      expect(screen.queryByText("Partner's open task")).not.toBeInTheDocument()
    })

    it('switching back to "Open" hides completed items again', async () => {
      const user = userEvent.setup()
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      await user.click(screen.getByRole('button', { name: 'Completed' }))
      await user.click(screen.getByRole('button', { name: 'Open' }))

      expect(screen.getByText('My open task')).toBeInTheDocument()
      expect(screen.queryByText('My completed task')).not.toBeInTheDocument()
    })
  })

  // -----------------------------------------------------------------------
  // Combined filters
  // -----------------------------------------------------------------------

  describe('combined owner + status filters', () => {
    it('"Mine" + "Completed" shows only my completed items', async () => {
      const user = userEvent.setup()
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      await user.click(screen.getByRole('button', { name: 'Mine' }))
      await user.click(screen.getByRole('button', { name: 'Completed' }))

      expect(screen.getByText('My completed task')).toBeInTheDocument()
      expect(
        screen.queryByText("Partner's completed task"),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText('Shared completed task'),
      ).not.toBeInTheDocument()
      expect(screen.queryByText('My open task')).not.toBeInTheDocument()
    })

    it('"Shared" + "Completed" shows only shared completed items', async () => {
      const user = userEvent.setup()
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      await user.click(screen.getByRole('button', { name: 'Shared' }))
      await user.click(screen.getByRole('button', { name: 'Completed' }))

      expect(screen.getByText('Shared completed task')).toBeInTheDocument()
      expect(screen.queryByText('Shared open task')).not.toBeInTheDocument()
      expect(screen.queryByText('My completed task')).not.toBeInTheDocument()
    })
  })

  // -----------------------------------------------------------------------
  // Empty states
  // -----------------------------------------------------------------------

  describe('empty state', () => {
    it('shows empty message when no items match the filter', () => {
      render(<DashboardActionItemsList items={[]} userId={userId} />)

      expect(screen.getByText('No open action items')).toBeInTheDocument()
    })

    it('shows filter-aware empty message for "Mine" + "Open"', async () => {
      const user = userEvent.setup()
      render(<DashboardActionItemsList items={[]} userId={userId} />)

      await user.click(screen.getByRole('button', { name: 'Mine' }))

      expect(
        screen.getByText('No open action items assigned to you'),
      ).toBeInTheDocument()
    })

    it('shows filter-aware empty message for "Partner\'s" + "Completed"', async () => {
      const user = userEvent.setup()
      render(<DashboardActionItemsList items={[]} userId={userId} />)

      await user.click(screen.getByRole('button', { name: "Partner's" }))
      await user.click(screen.getByRole('button', { name: 'Completed' }))

      expect(
        screen.getByText('No completed action items assigned to your partner'),
      ).toBeInTheDocument()
    })

    it('shows filter-aware empty message for "Shared" + "Open"', async () => {
      const user = userEvent.setup()
      render(<DashboardActionItemsList items={[]} userId={userId} />)

      await user.click(screen.getByRole('button', { name: 'Shared' }))

      expect(
        screen.getByText('No open shared action items'),
      ).toBeInTheDocument()
    })
  })

  // -----------------------------------------------------------------------
  // Accessibility
  // -----------------------------------------------------------------------

  describe('accessibility', () => {
    it('renders owner filter group with accessible role and label', () => {
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      expect(
        screen.getByRole('group', { name: 'Filter by owner' }),
      ).toBeInTheDocument()
    })

    it('renders status filter group with accessible role and label', () => {
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      expect(
        screen.getByRole('group', { name: 'Filter by status' }),
      ).toBeInTheDocument()
    })

    it('sets aria-pressed on the active filter buttons', async () => {
      const user = userEvent.setup()
      render(<DashboardActionItemsList items={makeItems()} userId={userId} />)

      const ownerGroup = screen.getByRole('group', {
        name: 'Filter by owner',
      })
      const mineButton = within(ownerGroup).getByRole('button', {
        name: 'Mine',
      })

      expect(mineButton).toHaveAttribute('aria-pressed', 'false')
      await user.click(mineButton)
      expect(mineButton).toHaveAttribute('aria-pressed', 'true')

      // "All" should now be unpressed
      expect(
        within(ownerGroup).getByRole('button', { name: 'All' }),
      ).toHaveAttribute('aria-pressed', 'false')
    })
  })
})
