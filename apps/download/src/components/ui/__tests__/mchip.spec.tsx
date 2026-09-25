import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import { iconSymbolId } from 'src/components/ui/icon'
import { MChip } from 'src/components/ui/mchip'

describe('MChip', () => {
  it('renders an icon and its label as one inline run', () => {
    render(<MChip data-testid="chip" icon="film" label="Movie" />)
    const chip = screen.getByTestId('chip')

    expect(chip.tagName).toBe('SPAN')
    expect(chip).toHaveClass('inline-flex', 'items-center', 'gap-[5px]')
    expect(chip).toHaveTextContent('Movie')
    expect(chip.querySelector('svg use')).toHaveAttribute(
      'href',
      `#${iconSymbolId('film')}`,
    )
  })

  it('sizes the icon at the call site rather than leaving it intrinsic', () => {
    render(<MChip data-testid="chip" icon="tv" label="Show" />)

    expect(screen.getByTestId('chip').querySelector('svg')).toHaveClass(
      'h-[11px]',
      'w-[11px]',
      'shrink-0',
    )
  })

  it('omits the icon when it is null', () => {
    render(<MChip data-testid="chip" icon={null} label="Movie · 2019" />)
    const chip = screen.getByTestId('chip')

    expect(chip.querySelector('svg')).toBeNull()
    expect(chip).toHaveTextContent('Movie · 2019')
  })

  it('omits the icon when it is not given at all', () => {
    render(<MChip data-testid="chip" label="1h 52m" />)

    expect(screen.getByTestId('chip').querySelector('svg')).toBeNull()
  })

  it('accepts a rich label', () => {
    render(<MChip data-testid="chip" label={<em>Movie</em>} />)

    expect(screen.getByTestId('chip').querySelector('em')).toHaveTextContent(
      'Movie',
    )
  })

  it('spreads the rest of its props and merges a caller className', () => {
    render(
      <MChip
        className="text-ink-3"
        data-testid="chip"
        id="kind"
        label="Movie"
      />,
    )
    const chip = screen.getByTestId('chip')

    expect(chip).toHaveAttribute('id', 'kind')
    expect(chip).toHaveClass('text-ink-3', 'inline-flex')
  })
})
