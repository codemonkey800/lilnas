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
const mockStartCheckIn = vi.fn()
const mockConfirmTransition = vi.fn()
const mockCancelTransition = vi.fn()

vi.mock('src/app/(app)/check-ins/check-in.actions', () => ({
  saveResponse: (...args: unknown[]) => mockSaveResponse(...args),
  startCheckIn: (...args: unknown[]) => mockStartCheckIn(...args),
  confirmTransition: (...args: unknown[]) => mockConfirmTransition(...args),
  cancelTransition: (...args: unknown[]) => mockCancelTransition(...args),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { CheckInDraftView } from 'src/app/(app)/check-ins/[id]/check-in-draft-view'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const userId = 'user-1'

function makeDraftCheckIn(overrides?: Partial<CheckInDetail>): CheckInDetail {
  return {
    id: 'ci-1',
    title: 'Weekly Sync',
    status: 'draft',
    templateId: 'tpl-1',
    partnershipId: 'p-1',
    startedAt: null,
    completedAt: null,
    pendingTransition: null,
    pendingTransitionById: null,
    pendingTransitionByName: null,
    partnerDisplayName: 'Bob',
    createdById: userId,
    createdAt: new Date('2025-06-01'),
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
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CheckInDraftView', () => {
  it('renders check-in title and status badge', () => {
    render(<CheckInDraftView checkIn={makeDraftCheckIn()} userId={userId} />)
    expect(screen.getByText('Weekly Sync')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('renders all questions in order with numbered labels', () => {
    render(<CheckInDraftView checkIn={makeDraftCheckIn()} userId={userId} />)
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByText('How are you feeling?')).toBeInTheDocument()
    expect(screen.getByText('2.')).toBeInTheDocument()
    expect(screen.getByText('What do you need?')).toBeInTheDocument()
  })

  it('shows progress indicator with correct answered count', () => {
    render(<CheckInDraftView checkIn={makeDraftCheckIn()} userId={userId} />)
    // User has 1 non-empty response out of 2 questions
    expect(screen.getByText('You: 1/2 answered')).toBeInTheDocument()
  })

  it('opens start confirmation dialog on button click', async () => {
    const user = userEvent.setup()
    render(<CheckInDraftView checkIn={makeDraftCheckIn()} userId={userId} />)

    await user.click(screen.getByRole('button', { name: /start check-in/i }))

    expect(screen.getByText('Start check-in?')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Starting this check-in will allow both partners to finalize/,
      ),
    ).toBeInTheDocument()
  })

  it('calls startCheckIn action when dialog is confirmed', async () => {
    const user = userEvent.setup()
    mockStartCheckIn.mockResolvedValueOnce({ success: true, checkInId: 'ci-1' })
    render(<CheckInDraftView checkIn={makeDraftCheckIn()} userId={userId} />)

    await user.click(screen.getByRole('button', { name: /start check-in/i }))
    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(mockStartCheckIn).toHaveBeenCalledWith('ci-1')
  })

  it('shows error message on failed start', async () => {
    const user = userEvent.setup()
    mockStartCheckIn.mockResolvedValueOnce({
      success: false,
      error: 'This check-in can no longer be modified.',
    })
    render(<CheckInDraftView checkIn={makeDraftCheckIn()} userId={userId} />)

    await user.click(screen.getByRole('button', { name: /start check-in/i }))
    await user.click(screen.getByRole('button', { name: 'Start' }))

    // Error displays in both the page and dialog, so use getAllByText
    const errors = await screen.findAllByText(
      'This check-in can no longer be modified.',
    )
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  it('shows initiator banner with partner name and disables start button when user initiated pending start', () => {
    render(
      <CheckInDraftView
        checkIn={makeDraftCheckIn({
          pendingTransition: 'start',
          pendingTransitionById: userId,
          pendingTransitionByName: 'Alice',
          partnerDisplayName: 'Bob',
        })}
        userId={userId}
      />,
    )

    expect(screen.getByText(/Waiting for Bob to confirm/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /start check-in/i }),
    ).toBeDisabled()
  })

  it('shows partner banner when partner initiated pending start', () => {
    render(
      <CheckInDraftView
        checkIn={makeDraftCheckIn({
          pendingTransition: 'start',
          pendingTransitionById: 'user-2',
          pendingTransitionByName: 'Bob',
        })}
        userId={userId}
      />,
    )

    expect(
      screen.getByText(/Bob wants to start this check-in/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
  })
})
