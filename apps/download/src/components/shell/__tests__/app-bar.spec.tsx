import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePathname } from 'next/navigation'

import {
  ACTIVITY_NAV_HREF,
  ADMIN_HREF,
  ADMIN_LINK_LABEL,
  APP_NAME,
  AppBar,
  LIBRARY_NAV_HREF,
} from 'src/components/shell/app-bar'
import type { Viewer } from 'src/lib/viewer'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}))

const mockUsePathname = jest.mocked(usePathname)

/** The doorplate's accessible name: the address it spells out. */
const DOORPLATE_NAME = `${APP_NAME}.lilnas.io`

const VIEWER: Viewer = {
  email: 'jeremy@lilnas.io',
  isAdmin: true,
  userId: 'u_1',
}

/** The same person without the privilege — the bar's other identity branch. */
const REGULAR_VIEWER: Viewer = {
  email: 'sam@lilnas.io',
  isAdmin: false,
  userId: 'u_2',
}

function bar(): HTMLElement {
  return screen.getByRole('banner')
}

/** The desktop nav. The sheet's copy is only in the DOM once it is opened. */
function primaryNav(): HTMLElement {
  return within(bar()).getByRole('navigation', { name: 'Primary' })
}

beforeEach(() => {
  mockUsePathname.mockReturnValue('/')
})

describe('AppBar', () => {
  it('renders the download.lilnas.io doorplate', () => {
    render(<AppBar viewer={VIEWER} />)

    expect(
      screen.getByRole('link', { name: DOORPLATE_NAME }),
    ).toBeInTheDocument()
  })

  it('is a banner landmark carrying the system bar chrome', () => {
    render(<AppBar viewer={VIEWER} />)
    const classes = bar().getAttribute('class') ?? ''

    expect(bar().tagName).toBe('HEADER')
    expect(classes).toContain('border-b')
    expect(classes).toContain('border-line')
    expect(classes).toContain('bg-surface')
    expect(classes).toContain('h-14')
  })

  describe('primary navigation', () => {
    it('links Library and Activity', () => {
      render(<AppBar viewer={REGULAR_VIEWER} />)
      const nav = primaryNav()

      expect(
        within(nav).getByRole('link', { name: 'Library' }),
      ).toHaveAttribute('href', LIBRARY_NAV_HREF)
      expect(
        within(nav).getByRole('link', { name: 'Activity' }),
      ).toHaveAttribute('href', ACTIVITY_NAV_HREF)
    })

    it.each([
      ['/', 'Library'],
      ['/gallery', 'Library'],
      ['/movies/11', 'Library'],
      ['/search', 'Library'],
      ['/activity', 'Activity'],
      ['/admin', 'Admin'],
    ])('marks the page you are on: %s is %s', (path, current) => {
      mockUsePathname.mockReturnValue(path)
      render(<AppBar viewer={VIEWER} />)

      const marked = within(primaryNav())
        .getAllByRole('link')
        .filter(link => link.getAttribute('aria-current') === 'page')

      expect(marked.map(link => link.textContent)).toEqual([current])
    })

    it('offers the admin dashboard to an admin', () => {
      render(<AppBar viewer={VIEWER} />)

      expect(
        within(primaryNav()).getByRole('link', { name: ADMIN_LINK_LABEL }),
      ).toHaveAttribute('href', ADMIN_HREF)
    })

    it('offers a regular user no admin entry at all, not a disabled one', () => {
      render(<AppBar viewer={REGULAR_VIEWER} />)

      // Neither by name nor by destination: a greyed-out or `aria-disabled`
      // entry would still tell a regular user that a dashboard exists and that
      // they are being kept out of it. The route answers with `NotAuthorized`
      // if they type the URL.
      expect(
        screen.queryByRole('link', { name: ADMIN_LINK_LABEL }),
      ).not.toBeInTheDocument()
      expect(
        screen.getAllByRole('link').map(link => link.getAttribute('href')),
      ).not.toContain(ADMIN_HREF)
    })

    it('offers no admin entry when there is no viewer to be an admin', () => {
      render(<AppBar viewer={null} />)

      expect(
        screen.queryByRole('link', { name: ADMIN_LINK_LABEL }),
      ).not.toBeInTheDocument()
    })
  })

  describe('the account', () => {
    it('renders the account menu when there is a viewer', () => {
      render(<AppBar viewer={VIEWER} />)

      expect(
        screen.getByRole('button', { name: 'Your account' }),
      ).toBeInTheDocument()
    })

    it('renders without an account menu when the viewer is null', () => {
      render(<AppBar viewer={null} />)

      expect(
        screen.queryByRole('button', { name: 'Your account' }),
      ).not.toBeInTheDocument()
      // The rest of the bar still renders — a missing identity degrades the
      // bar, it does not remove it.
      expect(
        screen.getByRole('link', { name: DOORPLATE_NAME }),
      ).toBeInTheDocument()
    })
  })

  it('mounts whatever the nav-search slot is given, exactly once', () => {
    render(<AppBar navSearch={<input aria-label="Search" />} viewer={VIEWER} />)

    expect(screen.getAllByRole('textbox', { name: 'Search' })).toHaveLength(1)
  })

  it('puts the nav search before the account menu', () => {
    render(<AppBar navSearch={<input aria-label="Search" />} viewer={VIEWER} />)

    expect(
      screen
        .getByRole('textbox', { name: 'Search' })
        .compareDocumentPosition(
          screen.getByRole('button', { name: 'Your account' }),
        ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  describe('the phone menu', () => {
    it('opens a sheet holding the same links and the profile', async () => {
      const user = userEvent.setup()
      render(<AppBar viewer={VIEWER} />)

      await user.click(screen.getByRole('button', { name: 'Open menu' }))

      const menu = await screen.findByRole('navigation', { name: 'Menu' })

      expect(
        within(menu)
          .getAllByRole('link')
          .map(link => link.getAttribute('href')),
      ).toEqual([LIBRARY_NAV_HREF, ACTIVITY_NAV_HREF, ADMIN_HREF, '/profile'])
    })

    it('leaves the admin and profile rows out for nobody', async () => {
      const user = userEvent.setup()
      render(<AppBar viewer={null} />)

      await user.click(screen.getByRole('button', { name: 'Open menu' }))

      const menu = await screen.findByRole('navigation', { name: 'Menu' })

      expect(
        within(menu)
          .getAllByRole('link')
          .map(link => link.getAttribute('href')),
      ).toEqual([LIBRARY_NAV_HREF, ACTIVITY_NAV_HREF])
    })
  })
})
