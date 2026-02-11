import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { CheckInDetail } from 'src/app/(app)/check-ins/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}))

const mockReopenCheckIn = vi.fn()
const mockUpdateActionItemStatus = vi.fn()
const mockDeleteActionItem = vi.fn()

vi.mock('src/app/(app)/check-ins/actions', () => ({
  reopenCheckIn: (...args: unknown[]) => mockReopenCheckIn(...args),
  updateActionItemStatus: (...args: unknown[]) =>
    mockUpdateActionItemStatus(...args),
  deleteActionItem: (...args: unknown[]) => mockDeleteActionItem(...args),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { CheckInResultsView } from 'src/app/(app)/check-ins/[id]/check-in-results-view'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const userId = 'user-1'
const partnerId = 'user-2'

function makeCompletedCheckIn(
  overrides?: Partial<CheckInDetail>,
): CheckInDetail {
  return {
    id: 'ci-1',
    title: 'Weekly Sync',
    status: 'completed',
    templateId: 'tpl-1',
    partnershipId: 'p-1',
    scheduledFor: null,
    startedAt: new Date('2025-06-01'),
    completedAt: new Date('2025-06-05'),
    createdById: userId,
    createdAt: new Date('2025-05-30'),
    questions: [
      { id: 'q-1', questionText: 'How are you feeling?', orderIndex: 0 },
      { id: 'q-2', questionText: 'What do you need?', orderIndex: 1 },
    ],
    responses: [
      {
        id: 'r-1',
        checkInQuestionId: 'q-1',
        userId,
        displayName: 'Alice',
        responseText: 'Doing great!',
      },
      {
        id: 'r-2',
        checkInQuestionId: 'q-1',
        userId: partnerId,
        displayName: 'Bob',
        responseText: 'Feeling good.',
      },
      {
        id: 'r-3',
        checkInQuestionId: 'q-2',
        userId,
        displayName: 'Alice',
        responseText: 'More quality time.',
      },
      {
        id: 'r-4',
        checkInQuestionId: 'q-2',
        userId: partnerId,
        displayName: 'Bob',
        responseText: '',
      },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CheckInResultsView', () => {
  it('renders check-in title and "Completed" status badge', () => {
    render(
      <CheckInResultsView
        checkIn={makeCompletedCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )
    expect(screen.getByText('Weekly Sync')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('renders completion date', () => {
    const completedAt = new Date('2025-06-05T12:00:00')
    render(
      <CheckInResultsView
        checkIn={makeCompletedCheckIn({ completedAt })}
        userId={userId}
        actionItems={[]}
      />,
    )
    // The completion date paragraph contains both "Completed" and the date
    expect(screen.getByText(/Completed\s+June 5, 2025/)).toBeInTheDocument()
  })

  it("shows both partners' answers", () => {
    render(
      <CheckInResultsView
        checkIn={makeCompletedCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )
    // Partner answers are displayed
    expect(screen.getByText('Feeling good.')).toBeInTheDocument()
    // User's own answers are also displayed
    expect(screen.getByText('Doing great!')).toBeInTheDocument()
    expect(screen.getByText('More quality time.')).toBeInTheDocument()
  })

  it('shows "No response" for empty partner answers', () => {
    render(
      <CheckInResultsView
        checkIn={makeCompletedCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )
    // Bob's response for q-2 is empty string
    expect(screen.getByText('No response')).toBeInTheDocument()
  })

  it('"Summarize with AI" button is disabled', () => {
    render(
      <CheckInResultsView
        checkIn={makeCompletedCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )
    expect(
      screen.getByRole('button', { name: /summarize with ai/i }),
    ).toBeDisabled()
  })

  it('opens re-open confirmation dialog on button click', async () => {
    const user = userEvent.setup()
    render(
      <CheckInResultsView
        checkIn={makeCompletedCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /re-open/i }))

    expect(screen.getByText('Re-open check-in?')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Re-opening this check-in will make answers editable again/,
      ),
    ).toBeInTheDocument()
  })

  it('calls reopenCheckIn action on confirm', async () => {
    const user = userEvent.setup()
    mockReopenCheckIn.mockResolvedValueOnce({
      success: true,
      checkInId: 'ci-1',
    })
    render(
      <CheckInResultsView
        checkIn={makeCompletedCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /re-open/i }))
    // Click the confirmation button inside the dialog
    const buttons = screen.getAllByRole('button', { name: /re-open/i })
    // The dialog confirm button is the second "Re-open" button
    await user.click(buttons[buttons.length - 1]!)

    expect(mockReopenCheckIn).toHaveBeenCalledWith('ci-1')
  })

  it('shows error message on failed re-open', async () => {
    const user = userEvent.setup()
    mockReopenCheckIn.mockResolvedValueOnce({
      success: false,
      error: 'This check-in is not completed.',
    })
    render(
      <CheckInResultsView
        checkIn={makeCompletedCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /re-open/i }))
    const buttons = screen.getAllByRole('button', { name: /re-open/i })
    await user.click(buttons[buttons.length - 1]!)

    // Error may display in both the page and dialog
    const errors = await screen.findAllByText('This check-in is not completed.')
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })
})
