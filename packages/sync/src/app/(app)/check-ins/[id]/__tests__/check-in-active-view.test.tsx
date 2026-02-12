import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionItem, CheckInDetail } from 'src/app/(app)/check-ins/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}))

const mockSaveResponse = vi.fn()
const mockCompleteCheckIn = vi.fn()
const mockCreateActionItem = vi.fn()
const mockUpdateActionItemStatus = vi.fn()
const mockDeleteActionItem = vi.fn()

const mockConfirmTransition = vi.fn()
const mockCancelTransition = vi.fn()

vi.mock('src/app/(app)/check-ins/check-in.actions', () => ({
  saveResponse: (...args: unknown[]) => mockSaveResponse(...args),
  completeCheckIn: (...args: unknown[]) => mockCompleteCheckIn(...args),
  confirmTransition: (...args: unknown[]) => mockConfirmTransition(...args),
  cancelTransition: (...args: unknown[]) => mockCancelTransition(...args),
}))

vi.mock('src/app/(app)/check-ins/action-item.actions', () => ({
  createActionItem: (...args: unknown[]) => mockCreateActionItem(...args),
  updateActionItemStatus: (...args: unknown[]) =>
    mockUpdateActionItemStatus(...args),
  deleteActionItem: (...args: unknown[]) => mockDeleteActionItem(...args),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { CheckInActiveView } from 'src/app/(app)/check-ins/[id]/check-in-active-view'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const userId = 'user-1'
const partnerId = 'user-2'

function makeActiveCheckIn(overrides?: Partial<CheckInDetail>): CheckInDetail {
  return {
    id: 'ci-1',
    title: 'Weekly Sync',
    status: 'in_progress',
    templateId: 'tpl-1',
    partnershipId: 'p-1',
    startedAt: new Date('2025-06-01'),
    completedAt: null,
    pendingTransition: null,
    pendingTransitionById: null,
    pendingTransitionByName: null,
    partnerDisplayName: 'Bob',
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
        responseText: '',
      },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CheckInActiveView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders check-in title and "In Progress" status badge', () => {
    render(
      <CheckInActiveView
        checkIn={makeActiveCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )
    expect(screen.getByText('Weekly Sync')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
  })

  it('renders questions', () => {
    render(
      <CheckInActiveView
        checkIn={makeActiveCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )
    expect(screen.getByText('How are you feeling?')).toBeInTheDocument()
    expect(screen.getByText('What do you need?')).toBeInTheDocument()
  })

  it('opens complete confirmation dialog on button click', async () => {
    const user = userEvent.setup()
    render(
      <CheckInActiveView
        checkIn={makeActiveCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /complete check-in/i }))

    expect(screen.getByText('Complete check-in?')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Completing this check-in will make all answers read-only/,
      ),
    ).toBeInTheDocument()
  })

  it('calls completeCheckIn action on confirm', async () => {
    const user = userEvent.setup()
    mockCompleteCheckIn.mockResolvedValueOnce({
      success: true,
      checkInId: 'ci-1',
    })
    render(
      <CheckInActiveView
        checkIn={makeActiveCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /complete check-in/i }))
    await user.click(screen.getByRole('button', { name: 'Complete' }))

    expect(mockCompleteCheckIn).toHaveBeenCalledWith('ci-1')
  })

  it('shows error message on failed completion', async () => {
    const user = userEvent.setup()
    mockCompleteCheckIn.mockResolvedValueOnce({
      success: false,
      error: 'This check-in is not currently in progress.',
    })
    render(
      <CheckInActiveView
        checkIn={makeActiveCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /complete check-in/i }))
    await user.click(screen.getByRole('button', { name: 'Complete' }))

    // Error displays in both the page and dialog
    const errors = await screen.findAllByText(
      'This check-in is not currently in progress.',
    )
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  it('renders action items for a question when provided', () => {
    const actionItem: ActionItem = {
      id: 'ai-1',
      checkInId: 'ci-1',
      checkInQuestionId: 'q-1',
      description: 'Buy flowers',
      ownerType: 'individual',
      ownerId: userId,
      ownerDisplayName: null,
      createdById: userId,
      status: 'open',
      dueDate: null,
      completedAt: null,
      createdAt: new Date('2025-06-01'),
    }

    render(
      <CheckInActiveView
        checkIn={makeActiveCheckIn()}
        userId={userId}
        actionItems={[actionItem]}
      />,
    )

    expect(screen.getByText('Buy flowers')).toBeInTheDocument()
    expect(screen.getByText('Action items')).toBeInTheDocument()
  })

  it('renders ActionItemForm per question when partner info is available', () => {
    render(
      <CheckInActiveView
        checkIn={makeActiveCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )

    // The fixture includes a partner response (userId: partnerId, displayName: 'Bob')
    // so ActionItemForm should render per-question with "Add action item" buttons.
    // The fixture has 2 questions.
    const addButtons = screen.getAllByText('Add action item')
    expect(addButtons).toHaveLength(2)
  })

  it('cancel button in complete dialog closes it without calling completeCheckIn', async () => {
    const user = userEvent.setup()
    render(
      <CheckInActiveView
        checkIn={makeActiveCheckIn()}
        userId={userId}
        actionItems={[]}
      />,
    )

    // Open dialog
    await user.click(screen.getByRole('button', { name: /complete check-in/i }))
    expect(screen.getByText('Complete check-in?')).toBeInTheDocument()

    // Click cancel
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    // Dialog should be gone
    expect(screen.queryByText('Complete check-in?')).not.toBeInTheDocument()
    expect(mockCompleteCheckIn).not.toHaveBeenCalled()
  })

  it('shows initiator banner with partner name and disables complete button when user initiated pending complete', () => {
    render(
      <CheckInActiveView
        checkIn={makeActiveCheckIn({
          pendingTransition: 'complete',
          pendingTransitionById: userId,
          pendingTransitionByName: 'Alice',
          partnerDisplayName: 'Bob',
        })}
        userId={userId}
        actionItems={[]}
      />,
    )

    expect(screen.getByText(/Waiting for Bob to confirm/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /complete check-in/i }),
    ).toBeDisabled()
  })

  it('shows partner banner when partner initiated pending complete', () => {
    render(
      <CheckInActiveView
        checkIn={makeActiveCheckIn({
          pendingTransition: 'complete',
          pendingTransitionById: partnerId,
          pendingTransitionByName: 'Bob',
        })}
        userId={userId}
        actionItems={[]}
      />,
    )

    expect(
      screen.getByText(/Bob wants to complete this check-in/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
  })
})
