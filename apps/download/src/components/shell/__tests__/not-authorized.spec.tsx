import { render, screen } from '@testing-library/react'

import { LIBRARY_HREF } from 'src/components/detail/library-link'
import {
  NOT_AUTHORIZED_BACK_LABEL,
  NOT_AUTHORIZED_DESCRIPTION,
  NOT_AUTHORIZED_ICON,
  NOT_AUTHORIZED_TITLE,
  NotAuthorized,
} from 'src/components/shell/not-authorized'
import { iconSymbolId } from 'src/components/ui/icon'

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

  it('gives the page a real heading rather than styled prose', () => {
    render(<NotAuthorized />)
    const heading = screen.getByRole('heading', { name: NOT_AUTHORIZED_TITLE })

    // An <h2>, not an <h1>: the route supplies its own title (usually
    // `sr-only`), and this panel is content underneath it.
    expect(heading.tagName).toBe('H2')
    expect(classesOf(heading)).toContain('text-h2')
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

  it('sends "back" to the library by default, through a real anchor', () => {
    render(<NotAuthorized />)
    const link = screen.getByRole('link', { name: NOT_AUTHORIZED_BACK_LABEL })

    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', LIBRARY_HREF)
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

  it('wears the shield, decorative, at the panel size the empty states use', () => {
    const { container } = render(<NotAuthorized />)
    const icon = container.querySelector('svg')

    expect(icon?.querySelector('use')).toHaveAttribute(
      'href',
      `#${iconSymbolId(NOT_AUTHORIZED_ICON)}`,
    )
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(classesOf(icon as Element)).toEqual(
      expect.arrayContaining(['h-6', 'w-6', 'text-ink-4']),
    )
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
        'flex',
        'flex-col',
        'items-center',
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
