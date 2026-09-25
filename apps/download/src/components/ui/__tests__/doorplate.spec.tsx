import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import { Doorplate } from 'src/components/ui/doorplate'
import { PEPE_SYMBOL_ID } from 'src/components/ui/icon'
import { IconSprite } from 'src/components/ui/sprite'

function requireRoot(container: HTMLElement): HTMLElement {
  const element = container.firstElementChild

  if (!(element instanceof HTMLElement)) {
    throw new Error('expected a rendered root element')
  }

  return element
}

describe('Doorplate', () => {
  it('renders a <span> when there is no href', () => {
    const { container } = render(<Doorplate name="Download" />)
    const root = requireRoot(container)

    expect(root.tagName).toBe('SPAN')
    expect(root).not.toHaveAttribute('href')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders an <a> when given an href, rather than a span with one', () => {
    render(<Doorplate href="https://lilnas.io" name="Download" />)
    const link = screen.getByRole('link', { name: 'Download' })

    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', 'https://lilnas.io')
  })

  it('points the badge at the pepe symbol rather than an icon', () => {
    const { container } = render(<Doorplate name="Download" />)
    const use = container.querySelector('use')

    expect(use).toHaveAttribute('href', `#${PEPE_SYMBOL_ID}`)
  })

  it('resolves against a symbol the sprite actually renders', () => {
    const { container } = render(
      <>
        <IconSprite />
        <Doorplate data-testid="doorplate" name="Download" />
      </>,
    )
    const symbolIds = Array.from(container.querySelectorAll('symbol')).map(
      symbol => symbol.getAttribute('id'),
    )

    expect(symbolIds).toContain(PEPE_SYMBOL_ID)
    expect(
      screen.getByTestId('doorplate').querySelector('use'),
    ).toHaveAttribute('href', `#${PEPE_SYMBOL_ID}`)
  })

  it('renders the subdomain in mono', () => {
    render(<Doorplate name="Download" />)

    expect(screen.getByText('Download')).toHaveClass(
      'font-mono',
      'text-[12px]',
      'font-medium',
      'tracking-[-0.01em]',
    )
  })

  it('carries the pill shape and hover treatment', () => {
    const { container } = render(<Doorplate name="Download" />)

    expect(requireRoot(container)).toHaveClass(
      'inline-flex',
      'h-8',
      'items-center',
      'gap-[9px]',
      'rounded-full',
      'border',
      'border-transparent',
      'bg-transparent',
      'hover:border-uv-dim',
      'hover:bg-surface-2',
    )
  })

  it('sizes the badge slot at 24px and fills it', () => {
    const { container } = render(<Doorplate name="Download" />)
    const badge = requireRoot(container).firstElementChild

    expect(badge).toHaveClass(
      'grid',
      'h-6',
      'w-6',
      'shrink-0',
      'place-items-center',
    )
    expect(badge?.firstElementChild).toHaveClass('h-full', 'w-full')
  })

  it('spreads remaining props onto the root element', () => {
    const { container } = render(
      <Doorplate
        aria-label="lilnas"
        className="shrink-0"
        data-testid="doorplate"
        name="Download"
      />,
    )
    const root = requireRoot(container)

    expect(root).toHaveClass('shrink-0')
    expect(root).toHaveAttribute('data-testid', 'doorplate')
    expect(root).toHaveAttribute('aria-label', 'lilnas')
  })
})
