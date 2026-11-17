import { Icon } from '@lilnas/ui'
import { render, screen } from '@testing-library/react'

import { LIBRARY_HREF } from 'src/components/detail/library-link'
import {
  NOT_AUTHORIZED_BACK_LABEL,
  NOT_AUTHORIZED_DESCRIPTION,
  NOT_AUTHORIZED_TITLE,
  NotAuthorized,
} from 'src/components/shell/not-authorized'

/** The rendered class list, which is the only place `cns` output is real. */
function classesOf(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

function panelOf(container: HTMLElement): HTMLElement {
  const panel = container.firstElementChild

  if (!(panel instanceof HTMLElement)) {
    throw new Error('expected NotAuthorized to render a root element')
  }

  return panel
}

describe('NotAuthorized', () => {
  it('states the default copy through its exported constants', () => {
    render(<NotAuthorized />)

    expect(
      screen.getByRole('heading', { name: NOT_AUTHORIZED_TITLE }),
    ).toBeInTheDocument()
    expect(screen.getByText(NOT_AUTHORIZED_DESCRIPTION)).toBeInTheDocument()
  })

  it('gives the page a real h2 heading rather than styled prose', () => {
    render(<NotAuthorized />)
    const heading = screen.getByRole('heading', { name: NOT_AUTHORIZED_TITLE })

    // An <h2>, not an <h1>: the route supplies its own
    // title (usually `sr-only`), and this panel is content underneath it.
    expect(heading.tagName).toBe('H2')
  })

  it('specialises its heading and sentence for a call site', () => {
    render(
      <NotAuthorized
        description="The admin dashboard is limited to admins."
        title="Admins only"
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'Admins only' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The admin dashboard is limited to admins.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(NOT_AUTHORIZED_DESCRIPTION)).toBeNull()
  })

  // An empty state is never a dead end, and never offers a second way out.
  it('offers exactly one action: back to the library, as a real anchor', () => {
    render(<NotAuthorized />)
    const link = screen.getByRole('link', { name: NOT_AUTHORIZED_BACK_LABEL })

    expect(NOT_AUTHORIZED_BACK_LABEL).toBe('Back to library')
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', LIBRARY_HREF)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lets a call site redirect and relabel the back link', () => {
    render(<NotAuthorized backHref="/profile" backLabel="Your profile" />)
    const link = screen.getByRole('link', { name: 'Your profile' })

    expect(link).toHaveAttribute('href', '/profile')
  })

  it('is quiet, not an error — no bad ink and no alert role', () => {
    const { container } = render(<NotAuthorized />)
    const panel = panelOf(container)

    expect(screen.queryByRole('alert')).toBeNull()
    expect(panel).not.toHaveAttribute('role')
    expect(
      container.querySelectorAll('[class*="bad"], [class*="text-warn"]'),
    ).toHaveLength(0)
  })

  it('draws a decorative shield icon and no mascot', () => {
    const { container } = render(<NotAuthorized />)
    const link = screen.getByRole('link')
    // Every svg outside the back link: the icon, and nothing else.
    const outside = Array.from(container.querySelectorAll('svg')).filter(
      svg => !link.contains(svg),
    )

    expect(outside).toHaveLength(1)
    const icon = outside[0]
    if (!icon) throw new Error('expected the icon')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveAttribute('width', '24')
    expect(icon).toHaveAttribute('height', '24')
    expect(classesOf(icon)).toContain('text-ink-3')

    // The glyph is the shield one, not just any 24px mark.
    const expected = render(<Icon name="shield" size={24} />).container
    expect(icon.innerHTML).toBe(expected.querySelector('svg')?.innerHTML)
    // The pepe mark is a filled, much larger svg; none of that is here.
    expect(container.querySelector('svg[width="46"]')).toBeNull()
  })

  it('is the centred sunk panel, not a raised card', () => {
    const { container } = render(<NotAuthorized />)
    const classes = classesOf(panelOf(container))

    expect(classes).toEqual(
      expect.arrayContaining([
        'bg-bg-sunk',
        'rounded-lg',
        'border',
        'border-line',
        'mx-auto',
        'max-w-[560px]',
        'text-center',
        'py-12',
      ]),
    )
    expect(classes).not.toContain('bg-surface')
  })

  it('keeps the sentence off ink-4, which is below AA for prose', () => {
    render(<NotAuthorized />)
    const classes = classesOf(screen.getByText(NOT_AUTHORIZED_DESCRIPTION))

    expect(classes).toContain('text-ink-3')
    expect(classes).toContain('text-sm')
    expect(classes).not.toContain('text-ink-4')
  })

  it('merges className through cns rather than appending it', () => {
    const { container } = render(<NotAuthorized className="py-6 mt-10" />)
    const classes = classesOf(panelOf(container))

    // twMerge resolves the padding collision in the caller's favour and keeps
    // the additive utility; asserted on the DOM, never on the input string.
    expect(classes).toContain('py-6')
    expect(classes).not.toContain('py-12')
    expect(classes).toContain('mt-10')
    expect(classes).toContain('bg-bg-sunk')
  })

  it('spreads the rest of its props onto the root div', () => {
    const { container } = render(
      <NotAuthorized data-testid="denied" id="not-authorized" />,
    )
    const panel = panelOf(container)

    expect(panel.tagName).toBe('DIV')
    expect(panel).toHaveAttribute('id', 'not-authorized')
    expect(screen.getByTestId('denied')).toBe(panel)
  })

  it('does not leak its copy props into the DOM', () => {
    const { container } = render(
      <NotAuthorized backHref="/gallery" backLabel="Library" title="Nope" />,
    )
    const panel = panelOf(container)

    expect(panel).not.toHaveAttribute('title')
    expect(panel).not.toHaveAttribute('backHref')
    expect(panel).not.toHaveAttribute('backLabel')
    expect(panel).not.toHaveAttribute('description')
  })
})
