import { render, screen } from '@testing-library/react'

import { APP_NAME, AppBar, LILNAS_HREF } from 'src/components/shell/app-bar'
import type { Viewer } from 'src/lib/viewer'

const VIEWER: Viewer = {
  email: 'jeremy@lilnas.io',
  isAdmin: true,
  userId: 'u_1',
}

function bar(): HTMLElement {
  return screen.getByRole('banner')
}

describe('AppBar', () => {
  it('renders the doorplate pointing out to lilnas, not at this app', () => {
    render(<AppBar viewer={VIEWER} />)
    const doorplate = screen.getByRole('link', { name: APP_NAME })

    expect(doorplate).toHaveAttribute('href', LILNAS_HREF)
    expect(doorplate).not.toHaveAttribute('href', '/')
  })

  it('renders the account link when there is a viewer', () => {
    render(<AppBar viewer={VIEWER} />)

    expect(
      screen.getByRole('link', { name: 'Your account' }),
    ).toBeInTheDocument()
  })

  it('renders without an account link when the viewer is null', () => {
    render(<AppBar viewer={null} />)

    expect(
      screen.queryByRole('link', { name: 'Your account' }),
    ).not.toBeInTheDocument()
    // The rest of the bar still renders — a missing identity degrades the bar,
    // it does not remove it.
    expect(screen.getByRole('link', { name: APP_NAME })).toBeInTheDocument()
  })

  it('does not substitute a masked or placeholder avatar for a null viewer', () => {
    render(<AppBar viewer={null} />)

    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('mounts whatever the nav-search slot is given, exactly once', () => {
    render(<AppBar navSearch={<input aria-label="Search" />} viewer={VIEWER} />)

    expect(screen.getAllByRole('textbox', { name: 'Search' })).toHaveLength(1)
  })

  it('keeps the nav-search slot present even when it is empty', () => {
    const { container } = render(<AppBar viewer={VIEWER} />)
    const slot = container.querySelector('header > div')

    expect(slot?.getAttribute('class')).toContain('flex-1')
    expect(slot?.childNodes).toHaveLength(0)
  })

  it('positions the slot end-aligned on mobile and start-aligned on desktop', () => {
    const { container } = render(<AppBar viewer={VIEWER} />)
    const classes = container
      .querySelector('header > div')
      ?.getAttribute('class')

    expect(classes).toContain('justify-end')
    expect(classes).toContain('sm:justify-start')
    expect(classes).toContain('pr-1.5')
    expect(classes).toContain('pl-2.5')
    expect(classes).toContain('sm:pr-3')
    expect(classes).toContain('sm:pl-[14px]')
  })

  it('orders the row doorplate, nav search, account link', () => {
    render(<AppBar navSearch={<input aria-label="Search" />} viewer={VIEWER} />)
    const links = screen.getAllByRole('link')

    expect(
      links.map(link => link.getAttribute('aria-label') ?? link.textContent),
    ).toEqual([APP_NAME, 'Your account'])
    expect(
      bar()
        .querySelector('input')
        ?.compareDocumentPosition(
          screen.getByRole('link', { name: 'Your account' }),
        ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('renders the optional back control before the doorplate', () => {
    render(
      <AppBar
        back={<button type="button">Back to library</button>}
        viewer={VIEWER}
      />,
    )
    const back = screen.getByRole('button', { name: 'Back to library' })

    expect(
      back.compareDocumentPosition(
        screen.getByRole('link', { name: APP_NAME }),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('omits the back slot entirely when there is no back control', () => {
    const { container } = render(<AppBar viewer={VIEWER} />)

    expect(container.querySelector('header > span')).toBeNull()
  })

  it('is a banner landmark carrying the mockups bar chrome', () => {
    render(<AppBar viewer={VIEWER} />)
    const classes = bar().getAttribute('class') ?? ''

    expect(bar().tagName).toBe('HEADER')
    expect(classes).toContain('border-b')
    expect(classes).toContain('border-line-soft')
    expect(classes).toContain('bg-bg-sunk')
    expect(classes).toContain('shrink-0')
    expect(classes).toContain('pr-[14px]')
    expect(classes).toContain('pl-4')
    expect(classes).toContain('sm:px-4')
    expect(classes).toContain('sm:py-[11px]')
  })

  it('spreads remaining props onto the bar', () => {
    render(<AppBar className="sticky top-0" data-testid="bar" viewer={null} />)

    expect(screen.getByTestId('bar')).toHaveClass('sticky', 'top-0')
  })
})
