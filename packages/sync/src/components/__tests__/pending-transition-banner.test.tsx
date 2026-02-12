import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PendingTransitionBannerProps } from 'src/components/pending-transition-banner'
// ---------------------------------------------------------------------------
// Import (no mocks needed — component is pure)
// ---------------------------------------------------------------------------
import { PendingTransitionBanner } from 'src/components/pending-transition-banner'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProps(
  overrides?: Partial<PendingTransitionBannerProps>,
): PendingTransitionBannerProps {
  return {
    pendingTransition: 'start',
    isInitiator: false,
    partnerName: 'Alice',
    onConfirm: vi.fn().mockResolvedValue({ success: true }),
    onCancel: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PendingTransitionBanner', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Initiator vs non-initiator rendering
  // -------------------------------------------------------------------------

  it('initiator view: renders waiting text and Cancel button, no Confirm button', () => {
    render(
      <PendingTransitionBanner
        {...makeProps({ isInitiator: true, partnerName: 'Bob' })}
      />,
    )

    expect(screen.getByText('Waiting for Bob to confirm')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /cancel request/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /confirm/i }),
    ).not.toBeInTheDocument()
  })

  it('non-initiator view: renders partner wants text and Confirm button, no Cancel button', () => {
    render(
      <PendingTransitionBanner
        {...makeProps({ isInitiator: false, partnerName: 'Bob' })}
      />,
    )

    expect(
      screen.getByText('Bob wants to start this check-in'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /cancel request/i }),
    ).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Transition labels
  // -------------------------------------------------------------------------

  it('uses "start" label for start transition', () => {
    render(
      <PendingTransitionBanner
        {...makeProps({ pendingTransition: 'start' })}
      />,
    )

    expect(
      screen.getByText('Alice wants to start this check-in'),
    ).toBeInTheDocument()
  })

  it('uses "complete" label for complete transition', () => {
    render(
      <PendingTransitionBanner
        {...makeProps({ pendingTransition: 'complete' })}
      />,
    )

    expect(
      screen.getByText('Alice wants to complete this check-in'),
    ).toBeInTheDocument()
  })

  it('uses "re-open" label for reopen transition', () => {
    render(
      <PendingTransitionBanner
        {...makeProps({ pendingTransition: 'reopen' })}
      />,
    )

    expect(
      screen.getByText('Alice wants to re-open this check-in'),
    ).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Confirm (non-initiator)
  // -------------------------------------------------------------------------

  it('confirm calls onConfirm and shows loading state while in flight', async () => {
    const user = userEvent.setup()
    let resolve!: (v: { success: boolean }) => void
    const onConfirm = vi.fn().mockReturnValueOnce(
      new Promise<{ success: boolean }>(r => {
        resolve = r
      }),
    )

    render(<PendingTransitionBanner {...makeProps({ onConfirm })} />)

    await user.click(screen.getByRole('button', { name: /confirm/i }))

    expect(onConfirm).toHaveBeenCalled()
    // Button should be in loading/disabled state
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()

    await act(async () => resolve({ success: true }))
  })

  it('confirm failure displays error message', async () => {
    const user = userEvent.setup()
    const onConfirm = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'Transition expired.' })

    render(<PendingTransitionBanner {...makeProps({ onConfirm })} />)

    await user.click(screen.getByRole('button', { name: /confirm/i }))

    expect(await screen.findByText('Transition expired.')).toBeInTheDocument()
    // Button should be re-enabled after error
    expect(screen.getByRole('button', { name: /confirm/i })).toBeEnabled()
  })

  it('confirm failure with missing error field shows fallback message', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValueOnce({ success: false })

    render(<PendingTransitionBanner {...makeProps({ onConfirm })} />)

    await user.click(screen.getByRole('button', { name: /confirm/i }))

    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Cancel (initiator)
  // -------------------------------------------------------------------------

  it('cancel calls onCancel and shows loading state while in flight', async () => {
    const user = userEvent.setup()
    let resolve!: (v: { success: boolean }) => void
    const onCancel = vi.fn().mockReturnValueOnce(
      new Promise<{ success: boolean }>(r => {
        resolve = r
      }),
    )

    render(
      <PendingTransitionBanner
        {...makeProps({ isInitiator: true, onCancel })}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel request/i }))

    expect(onCancel).toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /cancel request/i }),
    ).toBeDisabled()

    await act(async () => resolve({ success: true }))
  })

  it('cancel failure displays error message', async () => {
    const user = userEvent.setup()
    const onCancel = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'Network error.' })

    render(
      <PendingTransitionBanner
        {...makeProps({ isInitiator: true, onCancel })}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel request/i }))

    expect(await screen.findByText('Network error.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /cancel request/i }),
    ).toBeEnabled()
  })

  // -------------------------------------------------------------------------
  // Accessibility roles
  // -------------------------------------------------------------------------

  it('initiator view has role="status"', () => {
    render(<PendingTransitionBanner {...makeProps({ isInitiator: true })} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('non-initiator view has role="alert"', () => {
    render(<PendingTransitionBanner {...makeProps({ isInitiator: false })} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
