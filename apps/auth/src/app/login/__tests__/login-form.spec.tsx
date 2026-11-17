import { ToastProvider } from '@lilnas/ui'
import {
  fireEvent,
  render as renderPlain,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactElement } from 'react'

import { LoginForm } from 'src/app/login/login-form'

let mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

const mockSignInSocial = jest.fn()
// createAuthClient() (auth-client.ts's own module-top-level call) constructs
// a `Request` at import time, which this jsdom environment has no global
// polyfill for — so the client is stubbed, as in the pending/blocked specs.
jest.mock('src/app/lib/auth-client', () => ({
  signIn: { social: (...args: unknown[]) => mockSignInSocial(...args) },
}))

// "Redirecting…" is also a toast, drawn by the ToastProvider layout.tsx
// mounts once at the root.
function render(ui: ReactElement) {
  return renderPlain(ui, { wrapper: ToastProvider })
}

const CALLBACK_URL = 'https://radarr.lilnas.io/activity'

beforeEach(() => {
  mockSearchParams = new URLSearchParams()
  mockSignInSocial.mockReset().mockResolvedValue(undefined)
})

describe('LoginForm — no target', () => {
  it('renders the plain heading, the pepe, and the Google button with no target pill or error', () => {
    const { container } = render(
      <LoginForm callbackURL="/" targetHost={null} />,
    )

    expect(
      screen.getByRole('heading', { name: 'Sign in to lilnas.io' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Continue with Google' }),
    ).toBeInTheDocument()
    // The pepe-full mark, decorative.
    expect(container.querySelector('svg[viewBox="0 0 338 309"]')).not.toBeNull()
    expect(screen.queryByText('radarr.lilnas.io')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('has no doorplate — the front door carries the mark in its card instead', () => {
    render(<LoginForm callbackURL="/" targetHost={null} />)

    expect(
      screen.queryByRole('link', { name: 'auth.lilnas.io' }),
    ).not.toBeInTheDocument()
  })
})

describe('LoginForm — with a target', () => {
  it('names where the person was headed: heading, service name, and the host in the target pill', () => {
    render(
      <LoginForm callbackURL={CALLBACK_URL} targetHost="radarr.lilnas.io" />,
    )

    expect(
      screen.getByRole('heading', { name: 'Sign in to continue' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Radarr')).toBeInTheDocument()
    expect(screen.getByText('radarr.lilnas.io')).toBeInTheDocument()
  })

  it('falls back to the raw hostname for a host with no service metadata', () => {
    render(
      <LoginForm
        callbackURL="https://unknown.lilnas.io/"
        targetHost="unknown.lilnas.io"
      />,
    )

    // Name and host are the same string, shown in both lines of the pill.
    expect(screen.getAllByText('unknown.lilnas.io')).toHaveLength(2)
  })
})

describe('LoginForm — sign-in failed', () => {
  it('shows a bad note carrying the error code from ?error=', () => {
    mockSearchParams = new URLSearchParams('error=access_denied')
    render(<LoginForm callbackURL="/" targetHost={null} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Google didn’t sign you in.')
    expect(alert).toHaveTextContent('It sent back an error. Try again.')
    expect(screen.getByText('access_denied').tagName).toBe('CODE')
    // The tone icon the mockup's note draws.
    expect(alert.querySelector('svg')).not.toBeNull()
    // The button is still usable to try again.
    expect(
      screen.getByRole('button', { name: 'Continue with Google' }),
    ).not.toHaveAttribute('aria-busy')
  })
})

describe('LoginForm — ?error=x', () => {
  it('draws the note as an alert with an svg icon', () => {
    mockSearchParams = new URLSearchParams('error=x')
    render(<LoginForm callbackURL="/" targetHost={null} />)

    const alert = screen.getByRole('alert')
    expect(alert.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('x').tagName).toBe('CODE')
  })
})

describe('LoginForm — redirecting', () => {
  it('clicking the button starts Google sign-in with the callback URL, goes busy, and toasts', async () => {
    render(
      <LoginForm callbackURL={CALLBACK_URL} targetHost="radarr.lilnas.io" />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Google' }),
    )

    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: CALLBACK_URL,
    })
    const busy = screen.getByRole('button', { name: 'Redirecting…' })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    // The same words appear again as the toast.
    await waitFor(() => {
      expect(screen.getAllByText('Redirecting…').length).toBeGreaterThan(1)
    })
  })

  it('a second click while redirecting does not start sign-in again', () => {
    render(<LoginForm callbackURL="/" targetHost={null} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Google' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Redirecting…' }))

    expect(mockSignInSocial).toHaveBeenCalledTimes(1)
  })
})
