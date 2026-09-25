import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { ToggleChip } from 'src/components/ui/toggle-chip'

function ControlledChip({ initial = false }: { initial?: boolean }) {
  const [checked, setChecked] = useState(initial)

  return (
    <ToggleChip checked={checked} label="Comedy" onCheckedChange={setChecked} />
  )
}

describe('ToggleChip', () => {
  it('keeps a real checkbox as the accessible control', () => {
    render(<ToggleChip checked={false} label="Comedy" />)

    const checkbox = screen.getByRole('checkbox', { name: 'Comedy' })

    expect(checkbox).toHaveAttribute('type', 'checkbox')
    expect(checkbox).not.toBeChecked()
  })

  it('is controlled — a checked prop with no handler does not toggle', async () => {
    const user = userEvent.setup()
    const onCheckedChange = jest.fn()

    render(
      <ToggleChip
        checked={false}
        label="Comedy"
        onCheckedChange={onCheckedChange}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Comedy' }))

    expect(onCheckedChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('checkbox', { name: 'Comedy' })).not.toBeChecked()
  })

  it('follows its checked prop once the caller commits', async () => {
    const user = userEvent.setup()

    render(<ControlledChip />)

    const checkbox = screen.getByRole('checkbox', { name: 'Comedy' })

    await user.click(checkbox)
    expect(checkbox).toBeChecked()

    await user.click(checkbox)
    expect(checkbox).not.toBeChecked()
  })

  it('toggles from the chip body, because the label wraps the control', async () => {
    const user = userEvent.setup()

    render(<ControlledChip />)

    await user.click(screen.getByText('Comedy'))

    expect(screen.getByRole('checkbox', { name: 'Comedy' })).toBeChecked()
  })

  it('toggles from the keyboard', async () => {
    const user = userEvent.setup()

    render(<ControlledChip />)

    await user.tab()
    expect(screen.getByRole('checkbox', { name: 'Comedy' })).toHaveFocus()

    await user.keyboard('[Space]')
    expect(screen.getByRole('checkbox', { name: 'Comedy' })).toBeChecked()
  })

  it('swaps the whole tint when checked', () => {
    const { container, rerender } = render(
      <ToggleChip checked={false} label="Comedy" />,
    )

    expect(container.firstChild).toHaveClass(
      'border-line',
      'bg-surface',
      'text-ink-3',
    )

    rerender(<ToggleChip checked label="Comedy" />)

    expect(container.firstChild).toHaveClass(
      'border-uv/35',
      'bg-uv-ghost',
      'text-uv-hi',
    )
    expect(container.firstChild).not.toHaveClass('bg-surface')
  })

  it('renders children between the box and the label', () => {
    const { container } = render(
      <ToggleChip checked={false} label="Jeremy">
        <span data-testid="avatar">JA</span>
      </ToggleChip>,
    )

    const chip = container.firstChild as HTMLElement

    expect(Array.from(chip.children).map(child => child.tagName)).toEqual([
      'INPUT',
      'SPAN',
    ])
    expect(chip).toHaveTextContent('JAJeremy')
  })

  it('forwards name, value and disabled to the checkbox', () => {
    render(
      <ToggleChip
        disabled
        checked={false}
        label="Comedy"
        name="genre"
        value="comedy"
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Comedy' })

    expect(checkbox).toHaveAttribute('name', 'genre')
    expect(checkbox).toHaveAttribute('value', 'comedy')
    expect(checkbox).toBeDisabled()
  })

  it('spreads the rest of its props onto the label', () => {
    const { container } = render(
      <ToggleChip
        checked={false}
        className="shrink-0"
        label="Comedy"
        title="Filter by genre"
      />,
    )

    expect(container.firstChild).toHaveAttribute('title', 'Filter by genre')
    expect(container.firstChild).toHaveClass('shrink-0')
  })
})
