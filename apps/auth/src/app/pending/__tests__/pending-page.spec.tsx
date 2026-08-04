import fs from 'node:fs'
import path from 'node:path'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { PendingClient } from 'src/app/pending/pending-client'

// jsdom does not implement EventSource (confirmed empirically — the same
// class of gap as jsdom's missing fetch, which apps/tdr-code's own
// login.spec.tsx works around identically). A small controllable fake
// stands in: PendingClient only ever calls `new EventSource(url)`,
// `addEventListener('open'|'status-changed'|'error', fn)`, and `close()`.
type Listener = (event: unknown) => void

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  closed = false
  private readonly listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  close(): void {
    this.closed = true
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({})
  }
}

const mockCheckRequestStatus = jest.fn()
const mockSubmitReRequest = jest.fn()
jest.mock('src/app/pending/actions', () => ({
  checkRequestStatus: (...args: unknown[]) => mockCheckRequestStatus(...args),
  submitReRequest: (...args: unknown[]) => mockSubmitReRequest(...args),
}))

// pending-client.tsx now imports signOut for its own "Sign out" button
// (the redesign's one new dependency on this module). Mocked, not real —
// createAuthClient() (auth-client.ts's own module-top-level call)
// constructs a `Request` at import time, which this jsdom test environment
// has no global polyfill for; none of the tests below exercise sign-out
// behavior itself, so a bare stub is all this suite needs.
jest.mock('src/app/lib/auth-client', () => ({
  signOut: jest.fn().mockResolvedValue(undefined),
}))

const REDIRECT_URL = 'https://swole.lilnas.io/dashboard'
const IDENTITY = {
  name: 'Taylor Quinn',
  email: 'taylor.quinn@example.com',
  initials: 'TQ',
}
const REQUESTED_AT = '2026-01-01T00:00:00.000Z'

beforeEach(() => {
  FakeEventSource.instances = []
  global.EventSource = FakeEventSource as unknown as typeof EventSource
  mockCheckRequestStatus.mockReset().mockResolvedValue({ outcome: 'pending' })
  mockSubmitReRequest.mockReset().mockResolvedValue({ ok: true })
})

// ──────────────────────────────────────────────────────────────────────────────
// Revised for the mockup-driven redesign: this component now renders real
// interactive controls (Check again, Sign out) and identity/target-pill
// content sourced from the `identity`/`requestedAt` props — the old
// "byte-identical, zero buttons" guarantee no longer holds (that guarantee
// existed to prove rejection had no separate render branch, which is no
// longer true either — see the "rejected" describe block below, which
// replaces the old "never renders any text hinting at rejection" test now
// that rejection has its own in-place render). The SSE-driven redirect
// behavior itself (the next describe block) is untouched by this redesign.
// ──────────────────────────────────────────────────────────────────────────────
describe('PendingClient — static render (R7)', () => {
  it('renders the waiting heading, identity, target pill, and both action buttons', () => {
    render(
      <PendingClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
        requestedAt={REQUESTED_AT}
        initialOutcome="pending"
      />,
    )

    expect(screen.getByText('Waiting for approval')).toBeInTheDocument()
    expect(screen.getByText(IDENTITY.name)).toBeInTheDocument()
    expect(screen.getByText(IDENTITY.email)).toBeInTheDocument()
    expect(screen.getByText('swole.lilnas.io')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /check again/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /sign out/i }),
    ).toBeInTheDocument()
  })

  it('omits the "Requested" caption when requestedAt is null (the narrow admin-decides-mid-load race)', () => {
    render(
      <PendingClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
        requestedAt={null}
        initialOutcome="pending"
      />,
    )

    expect(screen.queryByText(/requested/i)).not.toBeInTheDocument()
  })

  it('never renders any text hinting at rejection or blocking while pending', () => {
    render(
      <PendingClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
        requestedAt={REQUESTED_AT}
        initialOutcome="pending"
      />,
    )

    expect(screen.queryByText(/declined/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/block/i)).not.toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Rejection visibility (post-launch revision): a rejected outcome used to
// navigate away to /login entirely — see requests.service.ts's own header
// comment for the full history of why that was reversed. It now renders IN
// PLACE, with its own heading/copy/icon and a "Request access again" action
// that replaces "Check again" — covered here via `initialOutcome="rejected"`
// (the static, page.tsx-driven entry point) rather than only via a live
// status-changed transition (covered separately below, in the SSE describe
// block, since that path exercises different code — recheck()'s own
// 'rejected' branch, not just the initial render).
// ──────────────────────────────────────────────────────────────────────────────
describe('PendingClient — rejected render and "Request access again" (rejection visibility revision)', () => {
  it('renders the declined heading, copy, and a "Request access again" button in place of "Check again"', () => {
    render(
      <PendingClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
        requestedAt={null}
        initialOutcome="rejected"
      />,
    )

    expect(screen.getByText('Access declined')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /request access again/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^check again$/i }),
    ).not.toBeInTheDocument()
    // "Sign out" survives the swap — never removed for either outcome.
    expect(
      screen.getByRole('button', { name: /sign out/i }),
    ).toBeInTheDocument()
  })

  it('omits the "Requested" caption while rejected, even if requestedAt is non-null', () => {
    render(
      <PendingClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
        requestedAt={REQUESTED_AT}
        initialOutcome="rejected"
      />,
    )

    expect(screen.queryByText(/requested/i)).not.toBeInTheDocument()
  })

  it('clicking "Request access again" submits a fresh request and returns to the waiting state with a "Requested" caption', async () => {
    render(
      <PendingClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
        requestedAt={null}
        initialOutcome="rejected"
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /request access again/i }),
    )

    await waitFor(() => {
      expect(mockSubmitReRequest).toHaveBeenCalledWith(REDIRECT_URL)
    })
    await waitFor(() => {
      expect(screen.getByText('Waiting for approval')).toBeInTheDocument()
    })
    expect(screen.getByText(/requested/i)).toBeInTheDocument()
  })
})

describe('PendingClient — SSE-driven redirect (R9, AE3)', () => {
  it('covers AE3: opening the SSE connection and receiving status-changed re-checks status and redirects on grant', async () => {
    // jsdom's window.location cannot be intercepted or reassigned (a
    // deliberate, unfixed jsdom limitation — the property descriptor is
    // configurable: false; see apps/tdr-code/src/app/__tests__/login.spec.tsx's
    // identical, previously-established workaround and full citation).
    // What IS observable: assigning window.location.href triggers a real
    // navigation attempt, which jsdom reports via console.error ("Not
    // implemented: navigation") rather than throwing — that specific error
    // firing, only AFTER the granted status resolves, is the dynamic proof
    // this component really performs the assignment in reaction to it.
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    render(
      <PendingClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
        requestedAt={REQUESTED_AT}
        initialOutcome="pending"
      />,
    )

    const source = FakeEventSource.instances[0]
    expect(source).toBeDefined()
    expect(source?.url).toBe('/api/sse/pending?host=swole.lilnas.io')
    expect(consoleErrorSpy).not.toHaveBeenCalled()

    mockCheckRequestStatus.mockResolvedValueOnce({ outcome: 'granted' })
    source?.emit('status-changed')

    await waitFor(() => {
      expect(mockCheckRequestStatus).toHaveBeenCalledWith(REDIRECT_URL)
    })
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'not implemented' }),
      )
    })

    consoleErrorSpy.mockRestore()
  })

  it('renders the declined state in place (no navigation away) when status-changed reveals a rejection', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    render(
      <PendingClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
        requestedAt={REQUESTED_AT}
        initialOutcome="pending"
      />,
    )
    const source = FakeEventSource.instances[0]

    mockCheckRequestStatus.mockResolvedValueOnce({ outcome: 'rejected' })
    source?.emit('status-changed')

    await waitFor(() => {
      expect(screen.getByText('Access declined')).toBeInTheDocument()
    })
    expect(
      screen.getByRole('button', { name: /request access again/i }),
    ).toBeInTheDocument()
    // The rejected outcome no longer navigates anywhere — no "Not
    // implemented: navigation" console.error, unlike the granted case above.
    expect(consoleErrorSpy).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('navigates to /blocked when status-changed reveals the account is now blocked', async () => {
    // Same jsdom-navigation-cannot-be-intercepted limitation and workaround
    // as the granted case above — the navigation ATTEMPT firing, only
    // after the blocked status resolves, is the dynamic proof this branch
    // executes. The exact literal target is covered by the companion
    // static source check below, mirroring the granted case's own pattern.
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    render(
      <PendingClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
        requestedAt={REQUESTED_AT}
        initialOutcome="pending"
      />,
    )
    const source = FakeEventSource.instances[0]

    mockCheckRequestStatus.mockResolvedValueOnce({ outcome: 'blocked' })
    source?.emit('status-changed')

    await waitFor(() => {
      expect(mockCheckRequestStatus).toHaveBeenCalledWith(REDIRECT_URL)
    })
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'not implemented' }),
      )
    })

    consoleErrorSpy.mockRestore()

    const pendingClientSource = fs.readFileSync(
      path.join(__dirname, '../pending-client.tsx'),
      'utf-8',
    )
    expect(pendingClientSource).toMatch(
      /window\.location\.href\s*=\s*`\/blocked\?redirect=\$\{encodeURIComponent\(redirectUrl\)\}`/,
    )
  })

  it('re-checks status on every SSE "open" event (the reconnect-then-recheck property — a decision made during a dropped connection is still caught)', async () => {
    render(
      <PendingClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
        requestedAt={REQUESTED_AT}
        initialOutcome="pending"
      />,
    )
    const source = FakeEventSource.instances[0]

    source?.emit('open')
    await waitFor(() => {
      expect(mockCheckRequestStatus).toHaveBeenCalledWith(REDIRECT_URL)
    })
    const callsAfterFirstOpen = mockCheckRequestStatus.mock.calls.length

    // A second 'open' (a real browser firing this on every native
    // auto-reconnect) triggers another recheck — not just the first one.
    source?.emit('open')
    await waitFor(() => {
      expect(mockCheckRequestStatus.mock.calls.length).toBeGreaterThan(
        callsAfterFirstOpen,
      )
    })
  })

  it('closes the EventSource connection on unmount', () => {
    const { unmount } = render(
      <PendingClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
        requestedAt={REQUESTED_AT}
        initialOutcome="pending"
      />,
    )
    const source = FakeEventSource.instances[0]
    expect(source?.closed).toBe(false)

    unmount()

    expect(source?.closed).toBe(true)
  })
})
