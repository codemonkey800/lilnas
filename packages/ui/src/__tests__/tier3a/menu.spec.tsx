import '@testing-library/jest-dom'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Menu } from '../../menu'

type Handlers = {
  onCopy?: () => void
  onRename?: () => void
  onDelete?: () => void
}

function Example({
  onCopy = jest.fn(),
  onRename = jest.fn(),
  onDelete = jest.fn(),
}: Handlers) {
  return (
    <Menu.Root>
      <Menu.Trigger>Actions</Menu.Trigger>
      <Menu.Popup>
        <Menu.Group>
          <Menu.GroupLabel>Session</Menu.GroupLabel>
          <Menu.Item shortcut="⌘C" onClick={onCopy}>
            Copy link
          </Menu.Item>
          <Menu.Item shortcut="R" onClick={onRename}>
            Rename
          </Menu.Item>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Item destructive onClick={onDelete}>
          Delete
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  )
}

describe('Menu', () => {
  it('opens from the trigger and styles the panel', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('button', { name: 'Actions' }))

    expect(await screen.findByRole('menu')).toHaveClass(
      'bg-surface',
      'border-line-loud',
      'rounded-lg',
      'shadow-lift',
      'p-1.5',
    )
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    expect(screen.getByRole('separator')).toHaveClass('bg-line')
    expect(screen.getByText('Session')).toBeInTheDocument()
  })

  it('moves through items with the arrow keys, Home and End', async () => {
    const user = userEvent.setup()
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')

    const items = await screen.findAllByRole('menuitem')
    await waitFor(() => expect(items[0]).toHaveFocus())

    await user.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(items[2]).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(items[1]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(items[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(items[2]).toHaveFocus()
  })

  it('activates the focused item with Enter and closes', async () => {
    const user = userEvent.setup()
    const onRename = jest.fn()
    render(<Example onRename={onRename} />)
    screen.getByRole('button', { name: 'Actions' }).focus()
    await user.keyboard('{ArrowDown}')
    await screen.findAllByRole('menuitem')
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onRename).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    )
  })

  it("calls each item's own onClick", async () => {
    const user = userEvent.setup()
    const handlers = {
      onCopy: jest.fn(),
      onRename: jest.fn(),
      onDelete: jest.fn(),
    }
    render(<Example {...handlers} />)

    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Copy link/ }))
    expect(handlers.onCopy).toHaveBeenCalledTimes(1)
    expect(handlers.onRename).not.toHaveBeenCalled()
    expect(handlers.onDelete).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(handlers.onDelete).toHaveBeenCalledTimes(1)
  })

  it('colours destructive items red', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('button', { name: 'Actions' }))

    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveClass(
      'text-bad',
    )
    expect(screen.getByRole('menuitem', { name: /Rename/ })).not.toHaveClass(
      'text-bad',
    )
  })

  it('styles items 32px tall and renders the shortcut in mono ink-3', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('button', { name: 'Actions' }))

    const item = await screen.findByRole('menuitem', { name: /Copy link/ })
    expect(item).toHaveClass('h-8', 'px-2.5', 'rounded-md', 'text-[13.5px]')
    const shortcut = screen.getByText('⌘C')
    expect(shortcut).toHaveClass(
      'font-mono',
      'text-mono-sm',
      'text-ink-3',
      'ml-auto',
    )
  })

  it('renders a link item with its href', async () => {
    const user = userEvent.setup()
    render(
      <Menu.Root>
        <Menu.Trigger>Go</Menu.Trigger>
        <Menu.Popup>
          <Menu.Item render={<a href="/library" />}>Library</Menu.Item>
        </Menu.Popup>
      </Menu.Root>,
    )
    await user.click(screen.getByRole('button', { name: 'Go' }))

    const link = await screen.findByRole('menuitem', { name: 'Library' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/library')
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    await user.click(trigger)
    await screen.findByRole('menu')

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    )
    expect(trigger).toHaveFocus()
  })
})
