import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import { StateLine, StateLineActions } from 'src/components/ui/state-line'

describe('StateLine', () => {
  it('lays out in a row by default', () => {
    render(<StateLine data-testid="line">queued</StateLine>)
    const line = screen.getByTestId('line')

    expect(line).toHaveClass('flex', 'items-center', 'gap-[14px]')
    expect(line).not.toHaveClass('flex-col')
  })

  it('stacks rather than rows when mobile', () => {
    render(
      <StateLine data-testid="line" mobile>
        queued
      </StateLine>,
    )
    const line = screen.getByTestId('line')

    expect(line).toHaveClass('flex-col', 'items-start', 'gap-[9px]')
    expect(line).not.toHaveClass('items-center')
  })

  it('draws the divider between consecutive rows from the rows themselves', () => {
    const { rerender } = render(
      <StateLine data-testid="line">queued</StateLine>,
    )
    expect(screen.getByTestId('line')).toHaveClass(
      '[&+&]:border-t',
      '[&+&]:border-line-soft',
      'px-0.5',
      'py-[13px]',
    )

    rerender(
      <StateLine data-testid="line" mobile>
        queued
      </StateLine>,
    )
    expect(screen.getByTestId('line')).toHaveClass(
      '[&+&]:border-t',
      '[&+&]:border-line-soft',
    )
  })

  it('spreads the rest of its props and does not leak mobile into the DOM', () => {
    render(
      <StateLine data-testid="line" id="failed-state" mobile>
        failed
      </StateLine>,
    )
    const line = screen.getByTestId('line')

    expect(line.tagName).toBe('DIV')
    expect(line).toHaveAttribute('id', 'failed-state')
    expect(line).not.toHaveAttribute('mobile')
  })
})

describe('StateLineActions', () => {
  it('renders a full-width span that splits its buttons evenly', () => {
    render(
      <StateLineActions data-testid="actions">
        <button type="button">Retry</button>
      </StateLineActions>,
    )
    const actions = screen.getByTestId('actions')

    expect(actions.tagName).toBe('SPAN')
    expect(actions).toHaveClass('flex', 'w-full', 'gap-2', '[&>button]:flex-1')
  })

  it('renders its children', () => {
    render(
      <StateLineActions>
        <button type="button">Cancel</button>
      </StateLineActions>,
    )

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('merges a caller className', () => {
    render(
      <StateLineActions className="mt-1" data-testid="actions">
        <button type="button">Retry</button>
      </StateLineActions>,
    )

    expect(screen.getByTestId('actions')).toHaveClass('mt-1', 'w-full')
  })
})
