import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { DotTone } from 'src/components/ui/status'
import {
  Bar,
  BAR_MAX_PCT,
  BAR_MIN_PCT,
  clampPct,
  Dot,
} from 'src/components/ui/status'

function renderRoot(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  const root = container.firstElementChild

  if (!(root instanceof HTMLElement)) {
    throw new Error('expected a single root element')
  }

  return root
}

function fillWidth(bar: HTMLElement): string {
  const fill = bar.firstElementChild

  if (!(fill instanceof HTMLElement)) {
    throw new Error('expected the bar to have a fill')
  }

  return fill.style.width
}

describe('Dot', () => {
  const cases: Array<[DotTone, string]> = [
    ['live', 'dot-live'],
    ['ok', 'bg-ok'],
    ['warn', 'bg-warn'],
    ['bad', 'bg-bad'],
  ]

  it.each(cases)('%s owns its own fill', (tone, fill) => {
    const dot = renderRoot(<Dot tone={tone} />)

    expect(dot).toHaveClass(fill)
    expect(dot).toHaveClass('h-[7px]', 'w-[7px]', 'rounded-full')
  })

  it('does not leak one tone into another', () => {
    const dot = renderRoot(<Dot tone="ok" />)

    expect(dot).not.toHaveClass('dot-live')
    expect(dot).not.toHaveClass('bg-warn')
    expect(dot).not.toHaveClass('bg-ink-4')
  })

  it('falls back to the inert fill with no tone', () => {
    const dot = renderRoot(<Dot />)

    expect(dot).toHaveClass('bg-ink-4')
    expect(dot).not.toHaveClass('dot-live')
  })

  it('is decorative', () => {
    expect(renderRoot(<Dot tone="ok" />)).toHaveAttribute('aria-hidden', 'true')
  })

  it('merges a caller className and spreads the rest onto the root', () => {
    const dot = renderRoot(<Dot className="mr-2" data-testid="d" tone="ok" />)

    expect(dot).toHaveClass('mr-2', 'shrink-0')
    expect(dot).toHaveAttribute('data-testid', 'd')
  })
})

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
    expect([BAR_MIN_PCT, BAR_MAX_PCT]).toEqual([0, 100])
  })
})

describe('Bar', () => {
  it('renders the fill at the given percentage', () => {
    expect(fillWidth(renderRoot(<Bar pct={42} />))).toBe('42%')
  })

  it('clamps a percentage above 100', () => {
    expect(fillWidth(renderRoot(<Bar pct={140} />))).toBe('100%')
  })

  it('clamps a negative percentage', () => {
    expect(fillWidth(renderRoot(<Bar pct={-12} />))).toBe('0%')
  })

  it('treats a non-finite percentage as empty', () => {
    expect(fillWidth(renderRoot(<Bar pct={Number.NaN} />))).toBe('0%')
  })

  it('reports the clamped value to assistive technology', () => {
    render(<Bar pct={140} />)

    const bar = screen.getByRole('progressbar')

    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('lets a caller opt out of the progressbar role', () => {
    const bar = renderRoot(<Bar pct={10} role="presentation" />)

    expect(bar).toHaveAttribute('role', 'presentation')
  })

  it('keeps the track from painting outside itself', () => {
    expect(renderRoot(<Bar pct={50} />)).toHaveClass(
      'overflow-hidden',
      'rounded-full',
      'bg-surface-3',
    )
  })

  it('merges a caller className and spreads the rest onto the root', () => {
    const bar = renderRoot(<Bar className="mt-3" data-testid="b" pct={10} />)

    expect(bar).toHaveClass('mt-3', 'h-[5px]')
    expect(bar).toHaveAttribute('data-testid', 'b')
  })
})
