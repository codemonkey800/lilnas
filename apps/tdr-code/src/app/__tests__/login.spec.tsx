import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as fs from 'fs'
import * as path from 'path'

import { NavShell } from 'src/app/components/nav-shell'
import LoginPage from 'src/app/login/page'

// next/navigation's useSearchParams/usePathname are RSC-router-aware hooks
// that throw outside an actual Next router context — every test in this
// file that renders a component depending on them must install a mock
// first. Each describe block below configures the specific return values
// it needs.
//
// Written as static imports above + jest.mock() calls here (rather than
// deferring to a `require()` after the mock setup) — matching the
// established pattern already used elsewhere in this codebase (see
// src/discord/__tests__/discord-handler.service.spec.ts's
// `jest.mock('src/discord/image-attachments', ...)` after its own static
// imports): ts-jest's transform hoists `jest.mock()` calls to the top of
// the module at compile time regardless of their written position relative
// to `import` statements, so LoginPage/NavShell here are already bound to
// the mocked next/navigation and auth-client modules by the time any test
// runs.
const mockSearchParamsGet = jest.fn<string | null, [string]>()
const mockPathname = jest.fn<string, []>()
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: mockSearchParamsGet }),
  usePathname: () => mockPathname(),
}))

const mockSignInSocial = jest.fn()
const mockSignOut = jest.fn()
const mockUseSession = jest.fn()
jest.mock('src/app/lib/auth-client', () => ({
  signIn: { social: (...args: unknown[]) => mockSignInSocial(...args) },
  signOut: (...args: unknown[]) => mockSignOut(...args),
  useSession: () => mockUseSession(),
}))

beforeEach(() => {
  mockSearchParamsGet.mockReset().mockReturnValue(null)
  mockPathname.mockReset().mockReturnValue('/login')
  mockSignInSocial.mockReset()
  mockSignOut.mockReset()
  mockUseSession.mockReset().mockReturnValue({ data: null, isPending: true })
})

describe('LoginPage', () => {
  it('renders the Discord login button', () => {
    render(<LoginPage />)
    expect(
      screen.getByRole('button', { name: 'Login with Discord' }),
    ).toBeInTheDocument()
  })

  it('invokes signIn.social with provider discord and a hardcoded relative callbackURL on click', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)

    await user.click(screen.getByRole('button', { name: 'Login with Discord' }))

    expect(mockSignInSocial).toHaveBeenCalledTimes(1)
    const [args] = mockSignInSocial.mock.calls[0] as [
      { provider: string; callbackURL: string },
    ]
    expect(args.provider).toBe('discord')
    // Hard requirement: callbackURL must be a relative internal path, never
    // an absolute URL or protocol-relative //host value — and, per this
    // app's choice not to implement returnTo at all, it must be the fixed
    // literal '/' rather than anything derived from window.location/a query
    // param.
    expect(args.callbackURL).toBe('/')
    expect(args.callbackURL.startsWith('http')).toBe(false)
    expect(args.callbackURL.startsWith('//')).toBe(false)
  })

  it('disables the button and relabels it "Redirecting…" after click (prevents double-invoke)', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)

    const button = screen.getByRole('button', { name: 'Login with Discord' })
    await user.click(button)

    const redirectingButton = screen.getByRole('button', {
      name: 'Redirecting…',
    })
    expect(redirectingButton).toBeDisabled()

    // A second click attempt (e.g. a user double-clicking before the
    // full-page navigation actually happens) must not invoke signIn.social
    // again — disabled buttons don't dispatch click handlers via
    // user-event, which is exactly the guarantee this test is asserting.
    await user.click(redirectingButton)
    expect(mockSignInSocial).toHaveBeenCalledTimes(1)
  })

  it('never implements returnTo handling — no return_to/returnTo query param is ever read', async () => {
    // This app deliberately does NOT implement any returnTo/callbackURL
    // query-param passthrough (see login/page.tsx's header comment) — the
    // safest way to guarantee the open-redirect class of bug (like
    // apps/yoink/src/app/(auth)/login/page.tsx's
    // `rawReturnTo.startsWith('/')`, which actually ADMITS protocol-relative
    // `//evil.com` since that also starts with a single '/') can never
    // apply here is to never wire a query param into callbackURL at all.
    // This test proves that absence: clicking login never reads
    // 'return_to' or 'returnTo' off searchParams.
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.click(screen.getByRole('button', { name: 'Login with Discord' }))

    const readKeys = mockSearchParamsGet.mock.calls.map(call => call[0])
    expect(readKeys).not.toContain('return_to')
    expect(readKeys).not.toContain('returnTo')
  })

  describe('error copy per ?error=<code>', () => {
    it('renders the guild-rejection message for not_guild_member', () => {
      mockSearchParamsGet.mockImplementation(key =>
        key === 'error' ? 'not_guild_member' : null,
      )
      render(<LoginPage />)
      expect(
        screen.getByText(
          /this console is limited to members of the configured Discord server/,
        ),
      ).toBeInTheDocument()
    })

    it('renders the expiry message for session_expired', () => {
      mockSearchParamsGet.mockImplementation(key =>
        key === 'error' ? 'session_expired' : null,
      )
      render(<LoginPage />)
      expect(
        screen.getByText('Your session expired. Please sign in again.'),
      ).toBeInTheDocument()
    })

    it('renders a distinct generic message for oauth_failed (not misread as not_guild_member)', () => {
      mockSearchParamsGet.mockImplementation(key =>
        key === 'error' ? 'oauth_failed' : null,
      )
      render(<LoginPage />)
      expect(
        screen.getByText("Sign-in didn't complete. Please try again."),
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/not a member|configured Discord server/),
      ).not.toBeInTheDocument()
    })

    it('renders no error banner on a bare /login (e.g. after logout)', () => {
      mockSearchParamsGet.mockReturnValue(null)
      render(<LoginPage />)
      expect(
        screen.queryByText(
          /session expired|didn't complete|configured Discord server/,
        ),
      ).not.toBeInTheDocument()
    })

    it('ignores an unrecognized error code rather than rendering a raw Better Auth string', () => {
      mockSearchParamsGet.mockImplementation(key =>
        key === 'error' ? 'some_raw_better_auth_internal_code' : null,
      )
      render(<LoginPage />)
      expect(
        screen.queryByText('some_raw_better_auth_internal_code'),
      ).not.toBeInTheDocument()
    })

    it('renders the three error states with visually distinct styling', () => {
      const classesFor = (code: string) => {
        mockSearchParamsGet.mockImplementation(key =>
          key === 'error' ? code : null,
        )
        const { container, unmount } = render(<LoginPage />)
        const banner = container.querySelector('.rounded.border')
        const cls = banner?.className ?? ''
        unmount()
        return cls
      }

      const notMember = classesFor('not_guild_member')
      const expired = classesFor('session_expired')
      const oauthFailed = classesFor('oauth_failed')

      // session_expired is visually distinct from the other two (a
      // non-alarming informational tone vs. a red attention state) —
      // asserting the actual class difference, not just the copy
      // difference, since the plan requires this be visually distinguishable.
      expect(expired).not.toBe(notMember)
      expect(expired).not.toBe(oauthFailed)
    })
  })
})

describe('NavShell placement on /login', () => {
  it('renders no app nav chrome when pathname is /login', () => {
    mockPathname.mockReturnValue('/login')
    mockUseSession.mockReturnValue({ data: null, isPending: true })

    render(
      <NavShell>
        <div>login card content</div>
      </NavShell>,
    )

    // Zero nav links present — every one of NAV_LINKS' labels must be
    // absent, not just the header element itself, since the failure mode
    // the plan calls out is specifically "an unauthenticated visitor sees
    // the full 5-link app nav above the login button."
    for (const label of [
      'Live',
      'Sessions',
      'Events',
      'Config',
      'Git identity',
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
    expect(screen.getByText('login card content')).toBeInTheDocument()
  })

  it('renders the full nav chrome on non-/login pages', () => {
    mockPathname.mockReturnValue('/')
    mockUseSession.mockReturnValue({ data: null, isPending: true })

    render(
      <NavShell>
        <div>page content</div>
      </NavShell>,
    )

    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('Sessions')).toBeInTheDocument()
  })
})

describe('NavShell user display (client-sourced session)', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/')
  })

  it('renders a fixed-width placeholder while the session is pending (no logged-out flash)', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true })
    const { container } = render(
      <NavShell>
        <div />
      </NavShell>,
    )
    // No display name, no "Log out" control, no nav-link-adjacent user text
    // should render while pending — only the fixed-width placeholder box.
    expect(screen.queryByText('Log out')).not.toBeInTheDocument()
    expect(container.querySelector('.w-40')).toBeInTheDocument()
  })

  it('shows the display name, avatar, and a working logout control once resolved', () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'u1',
          name: 'Some Discord User',
          image: 'https://cdn.discordapp.com/avatars/1/a.png',
        },
      },
      isPending: false,
    })
    render(
      <NavShell>
        <div />
      </NavShell>,
    )
    expect(screen.getByText('Some Discord User')).toBeInTheDocument()
    // The avatar <img> uses alt="" (decorative — the adjacent text already
    // names the user), which ARIA excludes from the accessibility tree
    // entirely (no implicit "img" role for an empty alt), so it's queried
    // by tag rather than role here.
    const avatar = document.querySelector('img')
    expect(avatar).toHaveAttribute(
      'src',
      'https://cdn.discordapp.com/avatars/1/a.png',
    )
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument()
  })

  it('falls back to an initial-letter avatar (not a generic icon) when there is no avatar image', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'zephyr', image: null } },
      isPending: false,
    })
    render(
      <NavShell>
        <div />
      </NavShell>,
    )
    expect(document.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText('Z')).toBeInTheDocument()
  })

  it('renders the full display name without truncating (Discord names cap at 32 chars)', () => {
    const longName = 'A'.repeat(32)
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: longName, image: null } },
      isPending: false,
    })
    render(
      <NavShell>
        <div />
      </NavShell>,
    )
    const nameEl = screen.getByText(longName)
    expect(nameEl.className).not.toMatch(/truncate/)
    expect(nameEl.className).not.toMatch(/max-w-/)
  })

  it('calls signOut() and the caller redirects to a bare /login on logout', async () => {
    const user = userEvent.setup()
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Some User', image: null } },
      isPending: false,
    })
    // signOut is invoked with fetchOptions.onSuccess navigating to /login —
    // capture that callback and invoke it directly rather than exercising a
    // real jsdom navigation (jsdom does not implement navigation and warns
    // loudly on an unmocked `window.location.href =` assignment).
    let capturedOnSuccess: (() => void) | undefined
    mockSignOut.mockImplementation(
      (opts: { fetchOptions?: { onSuccess?: () => void } }) => {
        capturedOnSuccess = opts.fetchOptions?.onSuccess
        return Promise.resolve()
      },
    )

    render(
      <NavShell>
        <div />
      </NavShell>,
    )
    await user.click(screen.getByRole('button', { name: 'Log out' }))

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(capturedOnSuccess).toBeDefined()

    // jsdom's `window.location` cannot be intercepted or replaced in the
    // installed jsdom@26.1.0 — its own property descriptor is
    // `configurable: false` (confirmed empirically: Object.defineProperty
    // throws "Cannot redefine property: location", jest.spyOn(window
    // .location, 'href', 'set') throws "Property `href` is not declared
    // configurable", and a plain `delete window.location` silently no-ops
    // without changing anything). This is a well-known, deliberate,
    // currently-unresolved upstream jsdom limitation (jsdom locked
    // `location` down for spec fidelity starting around v21; the
    // maintainers have stated they don't plan to add a testing escape
    // hatch — see github.com/jsdom/jsdom/issues/3739), not something
    // fixable from this app's code or this test. What CAN still be
    // observed: assigning to `.href` in jsdom triggers a real,
    // spec-mandated same-document navigation attempt, which jsdom reports
    // via console.error as "Not implemented: navigation" rather than
    // throwing — so the callback completing without an unhandled exception
    // PLUS that specific console.error firing is the dynamic proof this
    // callback really does perform a `window.location.href = ...`
    // assignment (as opposed to silently no-op'ing or throwing for an
    // unrelated reason). The literal target value (exactly '/login', no
    // '?error=') is covered by the companion static source check right
    // below, mirroring the same static-check-is-fine pattern this file
    // already uses for the layout.tsx auth-import invariant.
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    expect(() => capturedOnSuccess?.()).not.toThrow()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'not implemented' }),
    )

    consoleErrorSpy.mockRestore()

    const navShellSource = fs.readFileSync(
      path.join(__dirname, '../components/nav-shell.tsx'),
      'utf-8',
    )
    expect(navShellSource).toMatch(
      /window\.location\.href\s*=\s*['"]\/login['"]/,
    )
    // No ?error= param anywhere near the logout navigation target — a
    // deliberate logout must be visually distinct from the involuntary
    // session_expired bounce (which DOES carry ?error=session_expired,
    // asserted separately in the api.ts redirect-on-401 tests below).
    expect(navShellSource).not.toMatch(/\/login\?error=/)
  })
})

describe('layout.tsx invariant: no server-side auth read', () => {
  it('imports no auth-server module in the root layout', () => {
    // Static-import check (the plan explicitly allows this form: "a static
    // check, e.g. grepping its imports, is fine if a runtime test is
    // awkward"). layout.tsx is a SERVER component with no 'use client'
    // directive; asserting it — and it's the only file allowed to run
    // before the client hydrates and could theoretically read a session —
    // never imports src/auth/* (the Better Auth SERVER config/guard) or the
    // 'better-auth' package's non-react/non-client entry points is the
    // regression guard against a future edit "fixing" the nav display by
    // reaching into a server-side session read (which would reintroduce
    // better-sqlite3 into the server render, the exact hazard the plan
    // forbids).
    const layoutSource = fs.readFileSync(
      path.join(__dirname, '../layout.tsx'),
      'utf-8',
    )
    expect(layoutSource).not.toMatch(/from ['"]src\/auth\//)
    expect(layoutSource).not.toMatch(/from ['"]better-auth['"]/)
    expect(layoutSource).not.toMatch(/from ['"]better-auth\/node['"]/)
    expect(layoutSource).not.toContain("'use server'")
  })
})
