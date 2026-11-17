import '@testing-library/jest-dom'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { SheetSide } from '../../sheet'
import { Sheet } from '../../sheet'

function Example({ side }: { side?: SheetSide }) {
  return (
    <Sheet.Root>
      <Sheet.Trigger>Details</Sheet.Trigger>
      <Sheet.Popup side={side}>
        <Sheet.Title>Session 4f2a</Sheet.Title>
        <Sheet.Close>Close</Sheet.Close>
      </Sheet.Popup>
    </Sheet.Root>
  )
}

describe('Sheet', () => {
  it('defaults to a right-hand panel', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('button', { name: 'Details' }))

    const sheet = await screen.findByRole('dialog', { name: 'Session 4f2a' })
    expect(sheet).toHaveClass(
      'right-0',
      'w-full',
      'max-w-[480px]',
      'border-l',
      'border-line-loud',
      'bg-surface',
      'shadow-lift',
      'p-4',
      'ease-standard',
      'duration-[380ms]',
      'data-starting-style:translate-x-full',
    )
    expect(sheet.querySelector('[data-sheet-handle]')).toBeNull()
  })

  it('rounds the top, caps the height and draws a 36x4 grab handle on the bottom', async () => {
    const user = userEvent.setup()
    render(<Example side="bottom" />)
    await user.click(screen.getByRole('button', { name: 'Details' }))

    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveClass(
      'bottom-0',
      'rounded-t-xl',
      'max-h-[85vh]',
      'data-starting-style:translate-y-full',
    )
    const handle = sheet.querySelector('[data-sheet-handle]')
    expect(handle).toHaveClass('h-1', 'w-9', 'rounded-full', 'bg-line-loud')
    expect(handle).toHaveAttribute('aria-hidden', 'true')
  })

  it.each<SheetSide>(['right', 'bottom'])(
    'closes on Escape (%s)',
    async side => {
      const user = userEvent.setup()
      render(<Example side={side} />)
      const trigger = screen.getByRole('button', { name: 'Details' })
      await user.click(trigger)
      await screen.findByRole('dialog')

      await user.keyboard('{Escape}')

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      )
      await waitFor(() => expect(trigger).toHaveFocus())
    },
  )

  it('closes on a scrim press and from Close', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('button', { name: 'Details' }))
    await screen.findByRole('dialog')

    await user.click(document.querySelector('.bg-black\\/55') as Element)
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: 'Details' }))
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  it('keeps focus inside while open', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Outside</button>
        <Example />
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Details' }))
    const sheet = await screen.findByRole('dialog')

    for (let i = 0; i < 5; i++) {
      await user.tab()
      // A focus guard may hold focus for a tick before it bounces it back in.
      await waitFor(() =>
        expect(sheet).toContainElement(document.activeElement as HTMLElement),
      )
    }
  })
})
