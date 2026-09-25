import '@testing-library/jest-dom'

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { Field } from 'src/components/ui/input'
import { Menu, MenuItem, MenuTrigger } from 'src/components/ui/menu'

const SORTS = ['Relevance', 'Recently added', 'Title'] as const

function SortMenu({
  initial = 'Relevance',
  onChange,
}: {
  initial?: string
  onChange?: (value: string) => void
}) {
  const [value, setValue] = useState(initial)

  return (
    <div>
      <button type="button">before</button>
      <Menu
        data-testid="menu"
        label={value}
        value={value}
        onValueChange={next => {
          setValue(next)
          onChange?.(next)
        }}
      >
        {SORTS.map(sort => (
          <MenuItem key={sort} value={sort}>
            {sort}
          </MenuItem>
        ))}
      </Menu>
      <button type="button">after</button>
    </div>
  )
}

/** The trigger, found inside the menu root rather than by its shifting label. */
function trigger(): HTMLElement {
  return within(screen.getByTestId('menu')).getByRole('button')
}

describe('MenuTrigger', () => {
  it('renders the label, the chevron, and the closed border', () => {
    const { container } = render(<MenuTrigger label="Relevance" />)

    const button = screen.getByRole('button', { name: 'Relevance' })

    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('border-line')
    expect(button).not.toHaveClass('border-uv')
    expect(container.querySelector('use')).toHaveAttribute('href', '#i-chevron')
  })

  it('flips the chevron and lights the ring when open', () => {
    const { container } = render(<MenuTrigger open label="Relevance" />)

    expect(screen.getByRole('button')).toHaveClass(
      'border-uv',
      'shadow-[0_0_0_3px_var(--color-uv-ghost)]',
    )
    expect(container.querySelector('svg')).toHaveClass('rotate-180')
  })

  it('adopts an enclosing Field id so the label points at it', () => {
    render(
      <Field label="Sort by">
        <MenuTrigger label="Relevance" />
      </Field>,
    )

    expect(screen.getByLabelText('Sort by')).toBe(screen.getByRole('button'))
  })
})

describe('Menu', () => {
  it('starts closed with the listbox wiring on the trigger', () => {
    render(<SortMenu />)

    expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens on click and names the panel after the trigger', async () => {
    const user = userEvent.setup()

    render(<SortMenu />)

    await user.click(trigger())

    const listbox = screen.getByRole('listbox')

    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(trigger()).toHaveAttribute('aria-controls', listbox.id)
    expect(listbox).toHaveAccessibleName('Relevance')
    expect(screen.getAllByRole('option')).toHaveLength(SORTS.length)
  })

  it('opens on ArrowDown and lands on the selected option', async () => {
    const user = userEvent.setup()

    render(<SortMenu initial="Title" />)

    trigger().focus()
    await user.keyboard('{ArrowDown}')

    const option = screen.getByRole('option', { name: 'Title' })

    expect(option).toHaveFocus()
    expect(option).toHaveAttribute('aria-selected', 'true')
  })

  it('opens on ArrowUp too', async () => {
    const user = userEvent.setup()

    render(<SortMenu />)

    trigger().focus()
    await user.keyboard('{ArrowUp}')

    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('walks the options with the arrow keys, wrapping at the ends', async () => {
    const user = userEvent.setup()

    render(<SortMenu />)

    await user.click(trigger())

    expect(screen.getByRole('option', { name: 'Relevance' })).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'Recently added' })).toHaveFocus()

    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('option', { name: 'Title' })).toHaveFocus()
  })

  it('jumps to the ends with Home and End', async () => {
    const user = userEvent.setup()

    render(<SortMenu />)

    await user.click(trigger())
    await user.keyboard('{End}')

    expect(screen.getByRole('option', { name: 'Title' })).toHaveFocus()

    await user.keyboard('{Home}')

    expect(screen.getByRole('option', { name: 'Relevance' })).toHaveFocus()
  })

  it('selects with Enter, closes, and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()

    render(<SortMenu onChange={onChange} />)

    await user.click(trigger())
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('Recently added')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
    expect(trigger()).toHaveTextContent('Recently added')
  })

  it('selects with Space as well', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()

    render(<SortMenu onChange={onChange} />)

    await user.click(trigger())
    await user.keyboard('{End}[Space]')

    expect(onChange).toHaveBeenCalledWith('Title')
  })

  it('selects on click', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()

    render(<SortMenu onChange={onChange} />)

    await user.click(trigger())
    await user.click(screen.getByRole('option', { name: 'Title' }))

    expect(onChange).toHaveBeenCalledWith('Title')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()

    render(<SortMenu onChange={onChange} />)

    await user.click(trigger())
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closes when the trigger is clicked again', async () => {
    const user = userEvent.setup()

    render(<SortMenu />)

    await user.click(trigger())
    await user.click(trigger())

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes on a pointer press outside, leaving focus where it went', async () => {
    const user = userEvent.setup()

    render(<SortMenu />)

    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: 'after' }))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
  })

  it('closes when focus tabs out of the menu', async () => {
    const user = userEvent.setup()

    render(<SortMenu />)

    await user.click(trigger())
    await user.tab()

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('marks only the selected option and gives it the check', async () => {
    const user = userEvent.setup()

    render(<SortMenu initial="Recently added" />)

    await user.click(trigger())

    const options = screen.getAllByRole('option')

    expect(options.map(option => option.getAttribute('aria-selected'))).toEqual(
      ['false', 'true', 'false'],
    )
    const selected = screen.getByRole('option', { name: 'Recently added' })

    expect(selected).toHaveClass('bg-uv-ghost', 'text-uv-hi')
    expect(selected.querySelector('use')).toHaveAttribute('href', '#i-check')
    expect(
      screen.getByRole('option', { name: 'Relevance' }).querySelector('use'),
    ).toBeNull()
  })

  it('skips disabled options during keyboard navigation', async () => {
    const user = userEvent.setup()

    render(
      <Menu defaultOpen data-testid="menu" label="Pick" value="a">
        <MenuItem value="a">A</MenuItem>
        <MenuItem disabled value="b">
          B
        </MenuItem>
        <MenuItem value="c">C</MenuItem>
      </Menu>,
    )

    await user.keyboard('{ArrowDown}')

    expect(screen.getByRole('option', { name: 'C' })).toHaveFocus()
  })

  it('honours a controlled open state', async () => {
    const user = userEvent.setup()
    const onOpenChange = jest.fn()

    render(
      <Menu
        data-testid="menu"
        label="Pick"
        open={false}
        onOpenChange={onOpenChange}
      >
        <MenuItem value="a">A</MenuItem>
      </Menu>,
    )

    await user.click(trigger())

    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('refuses to render a MenuItem outside a Menu', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<MenuItem value="a">A</MenuItem>)).toThrow(
      '<MenuItem> must be rendered inside a <Menu>',
    )

    error.mockRestore()
  })
})
