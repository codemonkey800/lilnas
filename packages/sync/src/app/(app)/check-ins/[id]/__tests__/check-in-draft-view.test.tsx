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

vi.mock('src/app/(app)/check-ins/actions', () => ({
  saveResponse: (...args: unknown[]) => mockSaveResponse(...args),
  startCheckIn: (...args: unknown[]) => mockStartCheckIn(...args),
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
    scheduledFor: null,
    startedAt: null,
    completedAt: null,
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

  it('shows "Scheduled for ..." text for scheduled check-ins', () => {
    const checkIn = makeDraftCheckIn({
      status: 'scheduled',
      scheduledFor: new Date('2025-12-25'),
    })
    render(<CheckInDraftView checkIn={checkIn} userId={userId} />)
    expect(screen.getByText(/Scheduled for/)).toBeInTheDocument()
    expect(screen.getByText('Scheduled')).toBeInTheDocument()
  })

  it('opens start confirmation dialog on button click', async () => {
    const user = userEvent.setup()
    render(<CheckInDraftView checkIn={makeDraftCheckIn()} userId={userId} />)

    await user.click(screen.getByRole('button', { name: /start check-in/i }))

    expect(screen.getByText('Start check-in?')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Starting this check-in will make all drafted answers visible/,
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
})
