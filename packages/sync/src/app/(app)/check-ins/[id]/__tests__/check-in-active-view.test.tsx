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

const mockSaveResponse = vi.fn()
const mockCompleteCheckIn = vi.fn()
const mockCreateActionItem = vi.fn()
const mockUpdateActionItemStatus = vi.fn()
const mockDeleteActionItem = vi.fn()

vi.mock('src/app/(app)/check-ins/actions', () => ({
  saveResponse: (...args: unknown[]) => mockSaveResponse(...args),
  completeCheckIn: (...args: unknown[]) => mockCompleteCheckIn(...args),
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
    scheduledFor: null,
    startedAt: new Date('2025-06-01'),
    completedAt: null,
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
})
