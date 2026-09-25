import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import { LIBRARY_HREF } from 'src/components/detail/library-link'
import {
  NOT_AUTHORIZED_ICON,
  NotAuthorized,
} from 'src/components/shell/not-authorized'
import {
  NOT_FOUND_BACK_LABEL,
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_ICON,
  NOT_FOUND_TITLE,
  NotFound,
} from 'src/components/shell/not-found'
import { iconSymbolId } from 'src/components/ui/icon'

/** The rendered class list, which is the only place `cns` output is real. */
function classesOf(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

function panelOf(container: HTMLElement): HTMLElement {
  const panel = container.firstElementChild

  if (!(panel instanceof HTMLElement)) {
    throw new Error('expected NotFound to render a root element')
  }

  return panel
}

describe('NotFound', () => {
  it('states the default copy through its exported constants', () => {
    render(<NotFound />)

    expect(
      screen.getByRole('heading', { name: NOT_FOUND_TITLE }),
    ).toBeInTheDocument()
    expect(screen.getByText(NOT_FOUND_DESCRIPTION)).toBeInTheDocument()
  })

  it('gives the page a real heading rather than styled prose', () => {
    render(<NotFound />)
    const heading = screen.getByRole('heading', { name: NOT_FOUND_TITLE })

    // An <h2>, not an <h1>: the route supplies its own title (usually
    // `sr-only`), and this panel is content underneath it.
    expect(heading.tagName).toBe('H2')
    expect(classesOf(heading)).toContain('text-h2')
  })

  it('specialises its heading and sentence for a call site', () => {
    render(
      <NotFound
        description="Nothing has been downloaded under this address."
        title="No such video"
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'No such video' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Nothing has been downloaded under this address.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(NOT_FOUND_DESCRIPTION)).toBeNull()
  })

  it('sends "back" to the library by default, through a real anchor', () => {
    render(<NotFound />)
    const link = screen.getByRole('link', { name: NOT_FOUND_BACK_LABEL })

    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', LIBRARY_HREF)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lets a call site redirect and relabel the back link', () => {
    render(<NotFound backHref="/" backLabel="Home" />)

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('⚠️ is quiet, not an error — no bad ink and no alert role', () => {
    const { container } = render(<NotFound />)
    const panel = panelOf(container)

    // A 404 is not a fault. The shipped video not-found used to wear `Note`'s
    // `alert` icon, which is this system's error register.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(panel).not.toHaveAttribute('role')
    expect(
      container.querySelectorAll('[class*="bad"], [class*="text-warn"]'),
    ).toHaveLength(0)
  })

  it('⚠️ wears the search icon, not alert and not the shield', () => {
    const { container } = render(<NotFound />)
    const icon = container.querySelector('svg')

    expect(icon?.querySelector('use')).toHaveAttribute(
      'href',
      `#${iconSymbolId(NOT_FOUND_ICON)}`,
    )
    expect(NOT_FOUND_ICON).not.toBe('alert')
    // `shield` is `NotAuthorized`'s, and means "a rule applies to you" — a
    // different answer a reader must never confuse with this one.
    expect(NOT_FOUND_ICON).not.toBe(NOT_AUTHORIZED_ICON)
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(classesOf(icon as Element)).toEqual(
      expect.arrayContaining(['h-6', 'w-6', 'text-ink-4']),
    )
  })

  it('is the centred sunk panel, not a raised card', () => {
    const { container } = render(<NotFound />)
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

  it('⚠️ is geometrically the same panel as NotAuthorized', () => {
    const notFound = render(<NotFound />)
    const notAuthorized = render(<NotAuthorized />)

    // The two are adjacent answers to the same press. Two unrelated designs
    // for them is exactly the drift the shared component exists to stop.
    expect(classesOf(panelOf(notFound.container))).toEqual(
      classesOf(panelOf(notAuthorized.container)),
    )
  })

  it('keeps the sentence off ink-4, which is below AA for prose', () => {
    render(<NotFound />)
    const classes = classesOf(screen.getByText(NOT_FOUND_DESCRIPTION))

    expect(classes).toContain('text-ink-3')
    expect(classes).toContain('text-sm')
    expect(classes).not.toContain('text-ink-4')
  })

  it('merges className through cns rather than appending it', () => {
    const { container } = render(<NotFound className="py-6 mt-10" />)
    const classes = classesOf(panelOf(container))

    expect(classes).toContain('py-6')
    expect(classes).not.toContain('py-12')
    expect(classes).toContain('mt-10')
    expect(classes).toContain('bg-bg-sunk')
  })

  it('spreads the rest of its props onto the root div', () => {
    const { container } = render(
      <NotFound data-testid="missing" id="not-found" />,
    )
    const panel = panelOf(container)

    expect(panel.tagName).toBe('DIV')
    expect(panel).toHaveAttribute('id', 'not-found')
    expect(screen.getByTestId('missing')).toBe(panel)
  })

  it('does not leak its copy props into the DOM', () => {
    const { container } = render(
      <NotFound backHref="/gallery" backLabel="Library" title="Nope" />,
    )
    const panel = panelOf(container)

    expect(panel).not.toHaveAttribute('title')
    expect(panel).not.toHaveAttribute('backHref')
    expect(panel).not.toHaveAttribute('backLabel')
    expect(panel).not.toHaveAttribute('description')
  })
})
