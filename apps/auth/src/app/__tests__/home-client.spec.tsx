import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

import { HomeClient } from 'src/app/home-client'
import type { MeResponse } from 'src/app/lib/require-session'

const mockSignOut = jest.fn()
// createAuthClient() (auth-client.ts's own module-top-level call) constructs
// a `Request` at import time, which this jsdom environment has no global
// polyfill for — so the client is stubbed, as in the pending/blocked specs.
jest.mock('src/app/lib/auth-client', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
}))

const BASE_ME: MeResponse = {
  name: 'Taylor Quinn',
  email: 'taylor.quinn@example.com',
  image: null,
  isAdmin: false,
  blockedAt: null,
  createdAt: '2026-01-02T12:00:00.000Z',
  grants: [],
  rules: [],
  pendingRequests: [],
}

function renderHome(overrides: Partial<MeResponse> = {}) {
  return render(<HomeClient me={{ ...BASE_ME, ...overrides }} />)
}

// The badge sits beside the name in the account card, so that is where each
// status is read — "Admin" also shows up as a link and as the Role value.
function accountCard() {
  return screen.getByRole('heading', { name: BASE_ME.name }).parentElement!
}

beforeEach(() => {
  mockSignOut.mockReset().mockResolvedValue(undefined)
})

describe('HomeClient — status badge', () => {
  it.each([
    ['Admin', { isAdmin: true }],
    ['Blocked', { blockedAt: '2026-02-01T00:00:00.000Z' }],
    ['Granted', { grants: ['radarr.lilnas.io'] }],
    ['Granted', { rules: ['*.dev.lilnas.io'] }],
    [
      'Pending',
      {
        pendingRequests: [
          {
            serviceHost: 'radarr.lilnas.io',
            createdAt: '2026-02-01T00:00:00.000Z',
          },
        ],
      },
    ],
    ['No access', {}],
  ] as [string, Partial<MeResponse>][])(
    'shows a "%s" badge for %j',
    (label, overrides) => {
      renderHome(overrides)

      expect(within(accountCard()).getByText(label)).toBeInTheDocument()
    },
  )

  it('shows exactly one badge, and Admin outranks a block', () => {
    renderHome({ isAdmin: true, blockedAt: '2026-02-01T00:00:00.000Z' })

    const card = within(accountCard())
    expect(card.getByText('Admin')).toBeInTheDocument()
    expect(card.queryByText('Blocked')).not.toBeInTheDocument()
  })

  it('colours the badge by status', () => {
    renderHome({ blockedAt: '2026-02-01T00:00:00.000Z' })

    expect(within(accountCard()).getByText('Blocked')).toHaveClass(
      'bg-bad-ghost',
    )
  })
})

describe('HomeClient — account', () => {
  it('shows the name, the email in mono, and the initials avatar', () => {
    renderHome()

    expect(screen.getByRole('heading', { name: 'Taylor Quinn' })).toBeVisible()
    expect(screen.getByText(BASE_ME.email)).toHaveClass('font-mono')
    // The avatar is named for the person, not the letters in it.
    expect(screen.getAllByRole('img', { name: 'Taylor Quinn' })).toHaveLength(2)
  })

  it('draws the profile photo over the initials when there is one', () => {
    const { container } = renderHome({ image: 'https://example.com/me.png' })

    expect(
      container.querySelector('img[src="https://example.com/me.png"]'),
    ).not.toBeNull()
  })

  it('lists the session details', () => {
    renderHome()

    const details = screen.getByText('Session details').nextElementSibling!
    expect(within(details as HTMLElement).getByText('Role')).toBeInTheDocument()
    expect(
      within(details as HTMLElement).getByText('Member'),
    ).toBeInTheDocument()
    expect(
      within(details as HTMLElement).getByText('Member since'),
    ).toBeInTheDocument()
    expect(
      within(details as HTMLElement).getByText('Google'),
    ).toBeInTheDocument()
  })

  it('shows the pending note only while a request is waiting', () => {
    const { unmount } = renderHome({
      pendingRequests: [
        {
          serviceHost: 'radarr.lilnas.io',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    })
    expect(
      screen.getByText('Your request is waiting for approval.'),
    ).toBeInTheDocument()
    unmount()

    renderHome()
    expect(
      screen.queryByText('Your request is waiting for approval.'),
    ).not.toBeInTheDocument()
  })
})

describe('HomeClient — services', () => {
  it('shows the empty state, with no tiles and a zero count, when nothing is granted', () => {
    renderHome()

    expect(screen.getByText('No services granted yet.')).toBeInTheDocument()
    expect(screen.getByText('0 services')).toBeInTheDocument()
    // Only the doorplate links anywhere.
    expect(
      screen.getAllByRole('link').map(link => link.getAttribute('href')),
    ).toEqual(['https://lilnas.io'])
  })

  it('renders a link tile per granted host, with the service name and the host in mono', () => {
    renderHome({ grants: ['radarr.lilnas.io', 'sonarr.lilnas.io'] })

    const radarr = screen.getByRole('link', { name: /Radarr/ })
    expect(radarr).toHaveAttribute('href', 'https://radarr.lilnas.io')
    expect(within(radarr).getByText('radarr.lilnas.io')).toHaveClass(
      'font-mono',
    )
    expect(screen.getByRole('link', { name: /Sonarr/ })).toHaveAttribute(
      'href',
      'https://sonarr.lilnas.io',
    )
    expect(screen.getByText('2 services')).toBeInTheDocument()
    expect(
      screen.queryByText('No services granted yet.'),
    ).not.toBeInTheDocument()
  })

  it('renders an access rule as a plain, non-link tile ahead of the hosts', () => {
    renderHome({ rules: ['*.dev.lilnas.io'], grants: ['radarr.lilnas.io'] })

    const rule = screen.getByText('Any *.dev.lilnas.io site')
    expect(rule.closest('a')).toBeNull()
    expect(screen.getByText('Access rule')).toBeInTheDocument()
    expect(screen.getByText('2 services')).toBeInTheDocument()
  })

  it('counts one service in the singular', () => {
    renderHome({ grants: ['radarr.lilnas.io'] })

    expect(screen.getByText('1 service')).toBeInTheDocument()
  })
})

describe('HomeClient — app bar', () => {
  it('shows the Admin link only for admins', () => {
    const { unmount } = renderHome({ isAdmin: true })
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/admin',
    )
    unmount()

    renderHome()
    expect(
      screen.queryByRole('link', { name: 'Admin' }),
    ).not.toBeInTheDocument()
  })

  it('carries the auth doorplate', () => {
    renderHome()

    expect(screen.getByRole('link', { name: 'auth.lilnas.io' })).toBeVisible()
  })

  it('signs out from the app bar', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    renderHome()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1))
  })

  it('opens the phone menu as a sheet with Sign out, and Admin only for admins', async () => {
    const { unmount } = renderHome({ isAdmin: true })
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/admin',
    )
    expect(
      within(sheet).getByRole('button', { name: 'Sign out' }),
    ).toBeVisible()
    unmount()

    renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const plain = await screen.findByRole('dialog')
    expect(
      within(plain).queryByRole('link', { name: 'Admin' }),
    ).not.toBeInTheDocument()
    expect(
      within(plain).getByRole('button', { name: 'Sign out' }),
    ).toBeVisible()
  })
})
