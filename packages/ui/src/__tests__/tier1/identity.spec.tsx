import '@testing-library/jest-dom'

import { render, screen, within } from '@testing-library/react'

import { AppBar } from '../../app-bar'
import { Density } from '../../density'
import { Doorplate } from '../../doorplate'
import { PepeBadge, PepeFull } from '../../marks'

describe('Doorplate', () => {
  it("reads <app>.lilnas.io and links to the app's home", () => {
    render(<Doorplate app="swole" />)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/')
    expect(link).toHaveTextContent('swole.lilnas.io')
    expect(within(link).getByText('.lilnas.io')).toHaveClass('text-ink-3')
    expect(link).toHaveClass('h-8', 'rounded-full', 'border-line', 'bg-surface')
  })

  it('honours a custom href and an inert null href', () => {
    const { rerender } = render(
      <Doorplate app="swole" href="https://lilnas.io" />,
    )
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://lilnas.io',
    )

    rerender(<Doorplate app="swole" href={null} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(
      screen.getByText('.lilnas.io').closest('span.inline-flex'),
    ).not.toBeNull()
  })

  it('without app reads lilnas.io as a span, not a link', () => {
    const { container } = render(<Doorplate />)

    expect(screen.queryByRole('link')).toBeNull()
    expect(container.firstElementChild?.tagName).toBe('SPAN')
    expect(container).toHaveTextContent(/^lilnas\.io$/)
  })

  it('merges className last', () => {
    const { container } = render(<Doorplate className="bg-bad" />)

    expect(container.firstElementChild).toHaveClass('bg-bad')
    expect(container.firstElementChild).not.toHaveClass('bg-surface')
  })
})

describe('AppBar', () => {
  const links = [
    { href: '/a', label: 'Alpha', active: true },
    { href: '/b', label: 'Beta' },
  ]

  it('has the bar chrome and a compact height', () => {
    render(<AppBar app="swole" />)

    expect(screen.getByRole('banner')).toHaveClass(
      'h-14',
      'in-data-[density=compact]:h-12',
      'bg-surface',
      'border-b',
      'border-line',
      'px-4',
    )
  })

  it('hides the links below md', () => {
    render(<AppBar links={links} />)

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(nav).toHaveClass('hidden', 'md:flex')
    expect(
      within(nav)
        .getAllByRole('link')
        .map(l => l.textContent),
    ).toEqual(['Alpha', 'Beta'])
    expect(within(nav).getByText('Alpha')).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByText('Alpha')).toHaveClass('text-ink')
    expect(within(nav).getByText('Beta')).toHaveClass('text-ink-3')
  })

  it('renders the end slot and the phone sheet only below md', () => {
    render(
      <AppBar
        end={<button type="button">Account</button>}
        links={links}
        sheet={<button type="button">Menu</button>}
      />,
    )

    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Menu' }).parentElement,
    ).toHaveClass('md:hidden')
  })

  it('keeps the doorplate and swaps link elements via render', () => {
    render(
      <AppBar
        app="download"
        links={[{ href: '/x', label: 'X', render: <span data-testid="r" /> }]}
      />,
    )

    expect(
      screen.getByRole('link', { name: /download\.lilnas\.io/ }),
    ).toBeVisible()
    expect(screen.getByTestId('r')).toHaveTextContent('X')
    expect(screen.getByTestId('r').tagName).toBe('SPAN')
  })

  it('omits the nav when there are no links', () => {
    render(<AppBar />)

    expect(screen.queryByRole('navigation')).toBeNull()
  })
})

describe('marks', () => {
  it('PepeBadge is a decorative round svg of the requested size', () => {
    const { container } = render(<PepeBadge size={32} />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('width', '32')
    expect(svg).toHaveAttribute('viewBox', '96 38 240 240')
    expect(svg).toHaveClass('rounded-full')
    expect(container.querySelector('rect')).toHaveAttribute('fill', '#5a8d3e')
  })

  it('PepeFull keeps the 338:309 ratio', () => {
    const { container } = render(<PepeFull size={64} />)

    expect(container.querySelector('svg')).toHaveAttribute('height', '64')
    expect(container.querySelector('svg')).toHaveAttribute(
      'viewBox',
      '0 0 338 309',
    )
  })

  it('PepeFull throws in dev below 40px', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => render(<PepeFull size={39} />)).toThrow(/PepeBadge/)
    expect(() => render(<PepeFull size={40} />)).not.toThrow()
  })
})

describe('Density', () => {
  it('renders a wrapper carrying data-density', () => {
    render(
      <Density className="x" mode="compact">
        <p>inside</p>
      </Density>,
    )

    const wrapper = screen.getByText('inside').parentElement
    expect(wrapper).toHaveAttribute('data-density', 'compact')
    expect(wrapper).toHaveClass('x')
  })
})
