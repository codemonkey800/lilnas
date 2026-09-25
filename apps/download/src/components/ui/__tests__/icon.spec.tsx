import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import {
  Icon,
  ICON_NAMES,
  iconSymbolId,
  PEPE_SYMBOL_ID,
} from 'src/components/ui/icon'
import { IconSprite } from 'src/components/ui/sprite'

function requireElement(root: HTMLElement, selector: string): SVGElement {
  const element = root.querySelector<SVGElement>(selector)

  if (!element) {
    throw new Error(`expected to find ${selector}`)
  }

  return element
}

function symbolIds(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('symbol'))
    .map(symbol => symbol.getAttribute('id'))
    .filter((id): id is string => id !== null)
}

describe('IconSprite', () => {
  it('renders a <symbol> for every name in IconName', () => {
    const { container } = render(<IconSprite />)
    const ids = symbolIds(container)

    for (const name of ICON_NAMES) {
      expect(ids).toContain(iconSymbolId(name))
    }
  })

  it('renders the pepe doorplate badge', () => {
    const { container } = render(<IconSprite />)

    expect(symbolIds(container)).toContain(PEPE_SYMBOL_ID)
  })

  it('renders each symbol exactly once and nothing else', () => {
    const { container } = render(<IconSprite />)
    const ids = symbolIds(container)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.slice().sort()).toEqual(
      [PEPE_SYMBOL_ID, ...ICON_NAMES.map(iconSymbolId)].sort(),
    )
  })

  it('gives every symbol a viewBox and at least one drawn shape', () => {
    const { container } = render(<IconSprite />)

    for (const symbol of Array.from(container.querySelectorAll('symbol'))) {
      expect(symbol).toHaveAttribute('viewBox')
      expect(
        symbol.querySelectorAll('path, rect, circle, ellipse, line, polygon')
          .length,
      ).toBeGreaterThan(0)
    }
  })

  it('is visually hidden, unfocusable and unannounced', () => {
    const { container } = render(<IconSprite />)
    const svg = requireElement(container, 'svg')

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).toHaveAttribute('width', '0')
    expect(svg).toHaveAttribute('height', '0')
    expect(svg).toHaveClass('absolute', 'h-0', 'w-0', 'overflow-hidden')
  })
})

describe('Icon', () => {
  it.each(ICON_NAMES)('points <use> at the #i-%s symbol', name => {
    const { container } = render(<Icon name={name} />)

    expect(requireElement(container, 'use')).toHaveAttribute(
      'href',
      `#${iconSymbolId(name)}`,
    )
  })

  it('is decorative by default', () => {
    const { container } = render(<Icon name="film" />)
    const svg = requireElement(container, 'svg')

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('applies the caller class list and omits class when there is none', () => {
    const { container: withClass } = render(
      <Icon className="h-4 w-4 text-uv" name="search" />,
    )
    expect(requireElement(withClass, 'svg')).toHaveClass(
      'h-4',
      'w-4',
      'text-uv',
    )

    const { container: withoutClass } = render(<Icon name="search" />)
    expect(requireElement(withoutClass, 'svg')).not.toHaveAttribute('class')
  })

  it('spreads remaining props onto the root <svg>', () => {
    const { container } = render(
      <Icon data-testid="sort-handle" name="sort" viewBox="0 0 10 10" />,
    )
    const svg = requireElement(container, 'svg')

    expect(svg).toHaveAttribute('data-testid', 'sort-handle')
    expect(svg).toHaveAttribute('viewBox', '0 0 10 10')
  })

  it('lets a caller opt into being announced', () => {
    render(<Icon aria-hidden={false} aria-label="Delete" name="trash" />)

    expect(screen.getByLabelText('Delete')).toBeInTheDocument()
  })
})

describe('iconSymbolId', () => {
  it('prefixes the name so grid and grid-fill stay distinct', () => {
    expect(iconSymbolId('grid')).toBe('i-grid')
    expect(iconSymbolId('grid-fill')).toBe('i-grid-fill')
  })
})
