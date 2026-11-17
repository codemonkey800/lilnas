import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import {
  clampPct,
  PCT_MAX,
  PCT_MIN,
  SettlingProgress,
} from 'src/components/ui/settling-progress'

describe('clampPct', () => {
  it.each([
    [0, 0],
    [42, 42],
    [100, 100],
    [-1, 0],
    [-9999, 0],
    [101, 100],
    [1e6, 100],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [Number.NEGATIVE_INFINITY, 0],
  ])('clamps %p to %p', (input, expected) => {
    expect(clampPct(input)).toBe(expected)
  })

  it('exposes the bounds it clamps to', () => {
    expect([PCT_MIN, PCT_MAX]).toEqual([0, 100])
  })
})

describe('SettlingProgress', () => {
  function fill(): HTMLElement {
    return screen.getByRole('progressbar').firstElementChild as HTMLElement
  }

  it('renders the fill at the given percentage', () => {
    render(<SettlingProgress pct={42} />)

    expect(fill()).toHaveStyle({ width: '42%' })
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '42',
    )
  })

  it.each([
    [140, '100%', '100'],
    [-12, '0%', '0'],
    [Number.NaN, '0%', '0'],
  ])('clamps %p into the track', (pct, width, now) => {
    render(<SettlingProgress pct={pct} />)

    expect(fill()).toHaveStyle({ width })
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      now,
    )
  })

  it('does not sweep a bar whose work is done', () => {
    render(<SettlingProgress pct={100} />)

    expect(screen.getByRole('progressbar')).not.toHaveAttribute('data-settling')
    expect(screen.getByRole('progressbar').className).not.toContain(
      'bar-settling',
    )
  })

  it('sweeps the fill while settling, and says so', () => {
    render(<SettlingProgress pct={100} settling />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('data-settling')
    expect(screen.getByRole('progressbar').className).toContain(
      '[&>span]:bar-settling',
    )
  })

  it('merges a caller className and spreads the rest onto the root', () => {
    render(
      <SettlingProgress
        aria-label="Download progress"
        className="mt-3"
        pct={10}
      />,
    )

    expect(screen.getByRole('progressbar')).toHaveClass('mt-3')
    expect(
      screen.getByRole('progressbar', { name: 'Download progress' }),
    ).toBeInTheDocument()
  })
})
