import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateActionItem = vi.fn()

vi.mock('src/app/(app)/check-ins/action-item.actions', () => ({
  createActionItem: (...args: unknown[]) => mockCreateActionItem(...args),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { ActionItemForm } from 'src/components/action-item-form'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const defaultProps = {
  checkInId: 'ci-1',
  questionId: 'q-1',
  userId: 'user-1',
  partnerName: 'Alice',
  partnerId: 'user-2',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActionItemForm', () => {
  beforeEach(() => {
    mockCreateActionItem.mockResolvedValue({ success: true })
  })

  it('initially shows "Add action item" button', () => {
    render(<ActionItemForm {...defaultProps} />)
    expect(screen.getByText('Add action item')).toBeInTheDocument()
  })

  it('does NOT show form inputs initially', () => {
    render(<ActionItemForm {...defaultProps} />)
    expect(
      screen.queryByPlaceholderText('What needs to be done?'),
    ).not.toBeInTheDocument()
  })

  it('clicking "Add action item" expands the form', async () => {
    const user = userEvent.setup()
    render(<ActionItemForm {...defaultProps} />)

    await user.click(screen.getByText('Add action item'))

    expect(
      screen.getByPlaceholderText('What needs to be done?'),
    ).toBeInTheDocument()
    expect(screen.getByText('Assign to')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.getByText('Add')).toBeInTheDocument()
  })

  it('shows owner options: "Me", partner name, "Both of us"', async () => {
    const user = userEvent.setup()
    render(<ActionItemForm {...defaultProps} />)

    await user.click(screen.getByText('Add action item'))

    expect(screen.getByText('Me')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Both of us')).toBeInTheDocument()
  })

  it('validates empty description', async () => {
    const user = userEvent.setup()
    render(<ActionItemForm {...defaultProps} />)

    await user.click(screen.getByText('Add action item'))
    await user.click(screen.getByText('Add'))

    expect(screen.getByText('Description is required.')).toBeInTheDocument()
    expect(mockCreateActionItem).not.toHaveBeenCalled()
  })

  it('calls createActionItem with correct payload on submit', async () => {
    const user = userEvent.setup()
    render(<ActionItemForm {...defaultProps} />)

    await user.click(screen.getByText('Add action item'))
    await user.type(
      screen.getByPlaceholderText('What needs to be done?'),
      'Write tests',
    )
    await user.click(screen.getByText('Add'))

    expect(mockCreateActionItem).toHaveBeenCalledWith({
      checkInId: 'ci-1',
      checkInQuestionId: 'q-1',
      description: 'Write tests',
      ownerType: 'individual',
      ownerId: 'user-1',
    })
  })

  it('resets form and collapses on success', async () => {
    const user = userEvent.setup()
    render(<ActionItemForm {...defaultProps} />)

    await user.click(screen.getByText('Add action item'))
    await user.type(
      screen.getByPlaceholderText('What needs to be done?'),
      'Write tests',
    )
    await user.click(screen.getByText('Add'))

    // Form should collapse back to the "Add action item" button
    await screen.findByText('Add action item')
    expect(
      screen.queryByPlaceholderText('What needs to be done?'),
    ).not.toBeInTheDocument()
  })

  it('shows error message on failure', async () => {
    mockCreateActionItem.mockResolvedValueOnce({
      success: false,
      error: 'Something went wrong',
    })
    const user = userEvent.setup()
    render(<ActionItemForm {...defaultProps} />)

    await user.click(screen.getByText('Add action item'))
    await user.type(
      screen.getByPlaceholderText('What needs to be done?'),
      'Write tests',
    )
    await user.click(screen.getByText('Add'))

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
  })

  it('cancel button collapses form', async () => {
    const user = userEvent.setup()
    render(<ActionItemForm {...defaultProps} />)

    await user.click(screen.getByText('Add action item'))
    expect(
      screen.getByPlaceholderText('What needs to be done?'),
    ).toBeInTheDocument()

    await user.click(screen.getByText('Cancel'))

    expect(
      screen.queryByPlaceholderText('What needs to be done?'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Add action item')).toBeInTheDocument()
  })

  it('can select a different owner before submitting', async () => {
    const user = userEvent.setup()
    render(<ActionItemForm {...defaultProps} />)

    await user.click(screen.getByText('Add action item'))
    await user.type(
      screen.getByPlaceholderText('What needs to be done?'),
      'Partner task',
    )
    await user.click(screen.getByText('Alice'))
    await user.click(screen.getByText('Add'))

    expect(mockCreateActionItem).toHaveBeenCalledWith({
      checkInId: 'ci-1',
      checkInQuestionId: 'q-1',
      description: 'Partner task',
      ownerType: 'individual',
      ownerId: 'user-2',
    })
  })

  it('selecting "Both of us" submits with ownerType "both" and no ownerId', async () => {
    const user = userEvent.setup()
    render(<ActionItemForm {...defaultProps} />)

    await user.click(screen.getByText('Add action item'))
    await user.type(
      screen.getByPlaceholderText('What needs to be done?'),
      'Shared task',
    )
    await user.click(screen.getByText('Both of us'))
    await user.click(screen.getByText('Add'))

    expect(mockCreateActionItem).toHaveBeenCalledWith({
      checkInId: 'ci-1',
      checkInQuestionId: 'q-1',
      description: 'Shared task',
      ownerType: 'both',
    })
  })

  it('cancel resets description so re-opening shows an empty input', async () => {
    const user = userEvent.setup()
    render(<ActionItemForm {...defaultProps} />)

    // Expand form and type something
    await user.click(screen.getByText('Add action item'))
    await user.type(
      screen.getByPlaceholderText('What needs to be done?'),
      'Partial text',
    )

    // Cancel
    await user.click(screen.getByText('Cancel'))

    // Re-expand -- the input should be empty
    await user.click(screen.getByText('Add action item'))
    expect(screen.getByPlaceholderText('What needs to be done?')).toHaveValue(
      '',
    )
  })
})
