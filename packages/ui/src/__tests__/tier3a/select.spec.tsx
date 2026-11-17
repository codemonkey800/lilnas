import '@testing-library/jest-dom'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Select } from '../../select'

const ITEMS = { sd: 'Standard', hd: 'High', uhd: 'Ultra' }

function Example({
  value,
  defaultValue,
  onValueChange,
}: {
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string | null) => void
}) {
  return (
    <Select.Root
      defaultValue={defaultValue}
      items={ITEMS}
      value={value}
      onValueChange={onValueChange}
    >
      <Select.Trigger aria-label="Quality">
        <Select.Value placeholder="Pick a quality" />
      </Select.Trigger>
      <Select.Popup>
        <Select.Group>
          <Select.GroupLabel>Presets</Select.GroupLabel>
          <Select.Item value="sd">Standard</Select.Item>
          <Select.Item value="hd">High</Select.Item>
          <Select.Item value="uhd">Ultra</Select.Item>
        </Select.Group>
      </Select.Popup>
    </Select.Root>
  )
}

describe('Select', () => {
  it('shows the placeholder in ink-3 for a null value', () => {
    render(<Example value={null} />)

    const placeholder = screen.getByText('Pick a quality')
    expect(placeholder).toHaveClass('truncate')
    expect(placeholder).toHaveAttribute('data-placeholder')
    expect(placeholder.className).toContain('data-placeholder:text-ink-3')
  })

  it('shows the chosen label instead of the placeholder', () => {
    render(<Example defaultValue="hd" />)

    const value = screen.getByText('High')
    expect(value).not.toHaveAttribute('data-placeholder')
    expect(screen.queryByText('Pick a quality')).not.toBeInTheDocument()
  })

  it('matches Input in height, border and well fill, with a chevron', () => {
    render(<Example />)

    const trigger = screen.getByRole('combobox', { name: 'Quality' })
    expect(trigger).toHaveClass(
      'h-(--control-h)',
      'rounded-md',
      'border',
      'border-line-control',
      'bg-bg-sunk',
      'px-3',
    )
    expect(trigger.querySelector('svg')).toBeInTheDocument()
  })

  it('opens on click and lists the items in a styled panel', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('combobox', { name: 'Quality' }))

    const listbox = await screen.findByRole('listbox')
    expect(listbox.closest('[class*="shadow-lift"]')).toHaveClass(
      'bg-surface',
      'border-line-loud',
      'rounded-lg',
      'p-1.5',
    )
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByText('Presets')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Standard' })).toHaveClass(
      'h-8',
      'px-2.5',
      'text-[13.5px]',
    )
  })

  it('selects with the keyboard and reports onValueChange', async () => {
    const user = userEvent.setup()
    const onValueChange = jest.fn()
    render(<Example onValueChange={onValueChange} />)
    screen.getByRole('combobox', { name: 'Quality' }).focus()

    await user.keyboard('{ArrowDown}')
    await screen.findByRole('listbox')
    // Base UI applies the initial highlight a frame after opening; wait for
    // it so the next ArrowDown isn't overwritten under a loaded runner.
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Standard' })).toHaveAttribute(
        'data-highlighted',
      ),
    )
    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'High' })).toHaveAttribute(
        'data-highlighted',
      ),
    )
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onValueChange).toHaveBeenCalledTimes(1))
    expect(onValueChange.mock.calls[0]?.[0]).toBe('hd')
    await waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('combobox', { name: 'Quality' })).toHaveTextContent(
      'High',
    )
  })

  it('selects with a click', async () => {
    const user = userEvent.setup()
    const onValueChange = jest.fn()
    render(<Example onValueChange={onValueChange} />)

    await user.click(screen.getByRole('combobox', { name: 'Quality' }))
    await user.click(await screen.findByRole('option', { name: 'Ultra' }))

    expect(onValueChange.mock.calls[0]?.[0]).toBe('uhd')
  })

  it('marks the chosen item with a trailing accent-hi check', async () => {
    const user = userEvent.setup()
    render(<Example defaultValue="hd" />)
    await user.click(screen.getByRole('combobox', { name: 'Quality' }))

    const chosen = await screen.findByRole('option', { name: 'High' })
    expect(chosen).toHaveAttribute('aria-selected', 'true')
    const check = chosen.querySelector('svg')
    expect(check).toBeInTheDocument()
    expect(check?.parentElement).toHaveClass('text-accent-hi')
    expect(
      screen.getByRole('option', { name: 'Standard' }).querySelector('svg'),
    ).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('combobox', { name: 'Quality' }))
    await screen.findByRole('listbox')

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    )
  })
})
