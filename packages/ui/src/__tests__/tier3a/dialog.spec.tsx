import '@testing-library/jest-dom'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { Button } from '../../button'
import { ConfirmDialog, Dialog } from '../../dialog'

function Example() {
  return (
    <Dialog.Root>
      <Dialog.Trigger>Report</Dialog.Trigger>
      <Dialog.Popup>
        <Dialog.Title>Report a problem</Dialog.Title>
        <Dialog.Description>What went wrong?</Dialog.Description>
        <input aria-label="Details" />
        <Dialog.Actions>
          <Dialog.Close render={<Button variant="ghost" />}>
            Cancel
          </Dialog.Close>
          <Button variant="accent">Send</Button>
        </Dialog.Actions>
      </Dialog.Popup>
    </Dialog.Root>
  )
}

const scrims = () => document.querySelectorAll('.bg-black\\/55')

describe('Dialog', () => {
  it('opens from the trigger and closes from Close', async () => {
    const user = userEvent.setup()
    render(<Example />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Report' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Report a problem',
    })
    expect(dialog).toHaveAccessibleDescription('What went wrong?')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  it('styles the panel, title, description and actions', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('button', { name: 'Report' }))

    expect(await screen.findByRole('dialog')).toHaveClass(
      'max-w-[440px]',
      'bg-surface',
      'border-line-loud',
      'rounded-lg',
      'shadow-lift',
      'p-5',
    )
    expect(
      screen.getByRole('heading', { name: 'Report a problem' }),
    ).toHaveClass('text-h3')
    expect(screen.getByText('What went wrong?')).toHaveClass(
      'text-sm',
      'text-ink-2',
    )
    expect(
      screen.getByRole('button', { name: 'Send' }).parentElement,
    ).toHaveClass('justify-end')
    expect(scrims()).toHaveLength(1)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('button', { name: 'Report' }))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  it('closes when the scrim is pressed', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('button', { name: 'Report' }))
    await screen.findByRole('dialog')

    await user.click(scrims()[0] as Element)

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  it('moves focus in, traps Tab, and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Before</button>
        <Example />
        <button type="button">After</button>
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'Report' })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(dialog).toContainElement(document.activeElement as HTMLElement),
    )

    for (let i = 0; i < 8; i++) {
      await user.tab()
      // A focus guard may hold focus for a tick before it bounces it back in.
      await waitFor(() =>
        expect(dialog).toContainElement(document.activeElement as HTMLElement),
      )
    }

    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('draws one scrim for nested dialogs and marks the inner popup', async () => {
    const user = userEvent.setup()
    render(
      <Dialog.Root>
        <Dialog.Trigger>Outer</Dialog.Trigger>
        <Dialog.Popup>
          <Dialog.Title>Outer title</Dialog.Title>
          <Dialog.Root>
            <Dialog.Trigger>Inner</Dialog.Trigger>
            <Dialog.Popup>
              <Dialog.Title>Inner title</Dialog.Title>
              <Dialog.Close>Done</Dialog.Close>
            </Dialog.Popup>
          </Dialog.Root>
        </Dialog.Popup>
      </Dialog.Root>,
    )
    await user.click(screen.getByRole('button', { name: 'Outer' }))
    await user.click(await screen.findByRole('button', { name: 'Inner' }))

    const inner = await screen.findByRole('dialog', { name: 'Inner title' })
    expect(inner).toHaveAttribute('data-nested')
    expect(scrims()).toHaveLength(1)
  })
})

function Confirm({
  onConfirm,
  pending = false,
  tone,
}: {
  onConfirm: () => void
  pending?: boolean
  tone?: 'bad' | 'accent'
}) {
  const [open, setOpen] = useState(true)
  return (
    <ConfirmDialog
      body="The 38.4 GB comes off the disk."
      confirmLabel="Delete"
      open={open}
      pending={pending}
      title={'Delete "Dune: Part Two"?'}
      tone={tone}
      onConfirm={onConfirm}
      onOpenChange={setOpen}
    />
  )
}

describe('ConfirmDialog', () => {
  it('names the object and the consequence, with Keep it as the default cancel', async () => {
    render(<Confirm onConfirm={jest.fn()} />)

    const dialog = await screen.findByRole('dialog', {
      name: 'Delete "Dune: Part Two"?',
    })
    expect(dialog).toHaveAccessibleDescription(
      'The 38.4 GB comes off the disk.',
    )
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument()
  })

  it('fills the confirm red for the bad tone', async () => {
    render(<Confirm onConfirm={jest.fn()} />)

    const confirm = await screen.findByRole('button', { name: 'Delete' })
    expect(confirm).toHaveClass('bg-bad', 'text-bg-sunk')
    expect(confirm).not.toHaveClass('bg-accent')
  })

  it('keeps the accent fill for the accent tone', async () => {
    render(<Confirm tone="accent" onConfirm={jest.fn()} />)

    const confirm = await screen.findByRole('button', { name: 'Delete' })
    expect(confirm).toHaveClass('bg-accent', 'text-accent-ink')
  })

  it('calls onConfirm once per press', async () => {
    const user = userEvent.setup()
    const onConfirm = jest.fn()
    render(<Confirm onConfirm={onConfirm} />)

    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('closes from Keep it without confirming', async () => {
    const user = userEvent.setup()
    const onConfirm = jest.fn()
    render(<Confirm onConfirm={onConfirm} />)

    await user.click(await screen.findByRole('button', { name: 'Keep it' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('disables both buttons and ignores Escape while pending', async () => {
    const user = userEvent.setup()
    const onConfirm = jest.fn()
    render(<Confirm pending onConfirm={onConfirm} />)

    const confirm = await screen.findByRole('button', { name: 'Delete' })
    expect(confirm).toHaveAttribute('aria-busy', 'true')
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeDisabled()

    await user.click(confirm)
    await user.keyboard('{Escape}')

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
