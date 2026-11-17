import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { NavShell } from 'src/app/components/nav-shell'

const mockPathname = jest.fn<string, []>()
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))

const mockSignOut = jest.fn()
const mockUseSession = jest.fn()
jest.mock('src/app/lib/auth-client', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
  useSession: () => mockUseSession(),
}))

const LABELS = ['Live', 'Sessions', 'Events', 'Logs', 'Config', 'Git']
const HREFS = ['/', '/sessions', '/events', '/logs', '/config', '/git']

const SIGNED_IN = {
  data: { user: { id: 'u1', name: 'Jeremy', image: null } },
  isPending: false,
}

function renderShell() {
  return render(
    <NavShell>
      <div>page content</div>
    </NavShell>,
  )
}

beforeEach(() => {
  mockPathname.mockReset().mockReturnValue('/')
  mockSignOut.mockReset().mockResolvedValue(undefined)
  mockUseSession.mockReset().mockReturnValue(SIGNED_IN)
})

describe('NavShell', () => {
  it('renders the six links, in order, with their hrefs', () => {
    renderShell()

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const links = within(nav).getAllByRole('link')
    expect(links.map(l => l.textContent)).toEqual(LABELS)
    expect(links.map(l => l.getAttribute('href'))).toEqual(HREFS)
  })

  it('wears the tdr-code doorplate and renders its children in <main>', () => {
    renderShell()

    expect(screen.getByText('tdr-code')).toBeInTheDocument()
    expect(
      within(screen.getByRole('main')).getByText('page content'),
    ).toBeInTheDocument()
  })

  it.each([
    ['/', 'Live'],
    ['/sessions', 'Sessions'],
    ['/sessions/abc123', 'Sessions'],
    ['/logs', 'Logs'],
    ['/git', 'Git'],
  ])('marks only the current page active on %s', (pathname, active) => {
    mockPathname.mockReturnValue(pathname)
    renderShell()

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const current = within(nav)
      .getAllByRole('link')
      .filter(l => l.getAttribute('aria-current') === 'page')
    expect(current.map(l => l.textContent)).toEqual([active])
  })

  it('shows the user as an avatar, a name and a Log out button, and signs out to a bare /login', async () => {
    const user = userEvent.setup()
    renderShell()

    expect(screen.getByText('Jeremy', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Jeremy' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Log out' }))

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    const [opts] = mockSignOut.mock.calls[0] as [
      { fetchOptions?: { onSuccess?: () => void } },
    ]
    expect(opts.fetchOptions?.onSuccess).toEqual(expect.any(Function))
  })

  describe('phone nav', () => {
    it('opens the menu sheet from the app bar button, with the links and Log out', async () => {
      const user = userEvent.setup()
      renderShell()

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Open menu' }))

      const dialog = await screen.findByRole('dialog')
      const menu = within(dialog).getByRole('navigation', { name: 'Menu' })
      expect(
        within(menu)
          .getAllByRole('link')
          .map(l => l.textContent),
      ).toEqual(LABELS)
      expect(within(dialog).getByText('Menu')).toBeInTheDocument()
      expect(
        within(dialog).getByRole('button', { name: 'Log out' }),
      ).toBeInTheDocument()
    })

    it('marks the current page in the sheet', async () => {
      const user = userEvent.setup()
      mockPathname.mockReturnValue('/events')
      renderShell()

      await user.click(screen.getByRole('button', { name: 'Open menu' }))
      const dialog = await screen.findByRole('dialog')

      const current = within(dialog)
        .getAllByRole('link')
        .filter(l => l.getAttribute('aria-current') === 'page')
      expect(current.map(l => l.textContent)).toEqual(['Events'])
    })

    it('closes the sheet when a link is picked', async () => {
      const user = userEvent.setup()
      renderShell()

      await user.click(screen.getByRole('button', { name: 'Open menu' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('link', { name: 'Logs' }))

      await expect(screen.findByRole('dialog')).rejects.toThrow()
    })
  })

  describe('on /login', () => {
    it('renders no chrome at all, just the children', () => {
      mockPathname.mockReturnValue('/login')
      renderShell()

      expect(screen.getByText('page content')).toBeInTheDocument()
      expect(screen.queryByRole('banner')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Open menu' }),
      ).not.toBeInTheDocument()
      for (const label of LABELS) {
        expect(screen.queryByText(label)).not.toBeInTheDocument()
      }
    })
  })

  describe('while the session loads', () => {
    it('holds the user slot with a blank placeholder and no Log out', () => {
      mockUseSession.mockReturnValue({ data: null, isPending: true })
      renderShell()

      expect(
        screen.queryByRole('button', { name: 'Log out' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('banner').querySelector('.w-40'),
      ).toBeInTheDocument()
    })
  })
})
