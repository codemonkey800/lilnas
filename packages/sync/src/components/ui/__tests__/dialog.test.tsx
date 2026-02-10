import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Dialog } from 'src/components/ui/dialog'

describe('Dialog', () => {
  it('calls showModal when open is true', () => {
    const showModal = vi.fn()
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(
      showModal,
    )

    render(
      <Dialog open onClose={vi.fn()}>
        Content
      </Dialog>,
    )

    expect(showModal).toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('calls close when open transitions to false', () => {
    const closeFn = vi.fn()
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(closeFn)

    const { rerender } = render(
      <Dialog open onClose={vi.fn()}>
        Content
      </Dialog>,
    )

    closeFn.mockClear()

    rerender(
      <Dialog open={false} onClose={vi.fn()}>
        Content
      </Dialog>,
    )

    expect(closeFn).toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('calls onClose when the dialog emits a native close event', () => {
    const onClose = vi.fn()

    render(
      <Dialog open onClose={onClose}>
        Content
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog', { hidden: true })
    dialog.dispatchEvent(new Event('close'))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('prevents cancel when loading is true', () => {
    render(
      <Dialog open loading onClose={vi.fn()}>
        Content
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog', { hidden: true })
    const cancelEvent = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancelEvent)

    expect(cancelEvent.defaultPrevented).toBe(true)
  })

  it('does not prevent cancel when loading is false', () => {
    render(
      <Dialog open onClose={vi.fn()}>
        Content
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog', { hidden: true })
    const cancelEvent = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancelEvent)

    expect(cancelEvent.defaultPrevented).toBe(false)
  })

  it('renders children', () => {
    render(
      <Dialog open onClose={vi.fn()}>
        <p>Hello dialog</p>
      </Dialog>,
    )

    expect(screen.getByText('Hello dialog')).toBeInTheDocument()
  })
})
