import fs from 'node:fs'
import path from 'node:path'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { BlockedClient } from 'src/app/blocked/blocked-client'

const mockCheckRequestStatus = jest.fn()
jest.mock('src/app/pending/actions', () => ({
  checkRequestStatus: (...args: unknown[]) => mockCheckRequestStatus(...args),
}))

// Same jsdom gap and stub rationale as pending-page.spec.tsx's own mock —
// createAuthClient() (auth-client.ts's own module-top-level call)
// constructs a `Request` at import time, which this jsdom test environment
// has no global polyfill for; no test below exercises sign-out behavior
// itself, so a bare stub is all this suite needs.
jest.mock('src/app/lib/auth-client', () => ({
  signOut: jest.fn().mockResolvedValue(undefined),
}))

const REDIRECT_URL = 'https://swole.lilnas.io/dashboard'
const IDENTITY = {
  name: 'Taylor Quinn',
  email: 'taylor.quinn@example.com',
  initials: 'TQ',
}

beforeEach(() => {
  mockCheckRequestStatus.mockReset().mockResolvedValue({ outcome: 'blocked' })
})

// ──────────────────────────────────────────────────────────────────────────────
// BlockedClient has no SSE/poll loop (see that file's own header comment
// for why) — every test below is a plain render + manual "Check again"
// click, unlike pending-client.tsx's own suite which also has to drive a
// FakeEventSource.
// ──────────────────────────────────────────────────────────────────────────────
describe('BlockedClient — static render', () => {
  it('renders the blocked heading, identity, target pill, and both action buttons', () => {
    render(
      <BlockedClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
      />,
    )

    expect(screen.getByText('Access blocked')).toBeInTheDocument()
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

  it('never renders any text hinting at the pending or rejected outcomes', () => {
    render(
      <BlockedClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
      />,
    )

    expect(screen.queryByText(/waiting for approval/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/declined/i)).not.toBeInTheDocument()
  })
})

describe('BlockedClient — "Check again"', () => {
  it('shows a "Still blocked" toast when the account is still blocked, without navigating', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    render(
      <BlockedClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /check again/i }))

    await waitFor(() => {
      expect(mockCheckRequestStatus).toHaveBeenCalledWith(REDIRECT_URL)
    })
    await waitFor(() => {
      expect(screen.getByText('Still blocked')).toBeInTheDocument()
    })
    expect(consoleErrorSpy).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('navigates to /pending when the account is no longer blocked', async () => {
    // jsdom's window.location cannot be intercepted or reassigned — see
    // pending-page.spec.tsx's identical, previously-established workaround
    // and full citation. What IS observable: assigning window.location.href
    // triggers a real navigation attempt, which jsdom reports via
    // console.error ("Not implemented: navigation") rather than throwing.
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    mockCheckRequestStatus.mockResolvedValueOnce({ outcome: 'pending' })
    render(
      <BlockedClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /check again/i }))

    await waitFor(() => {
      expect(mockCheckRequestStatus).toHaveBeenCalledWith(REDIRECT_URL)
    })
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'not implemented' }),
      )
    })

    consoleErrorSpy.mockRestore()

    // The exact literal target is covered here via a static source check,
    // mirroring pending-page.spec.tsx's own pattern for the same
    // jsdom-unobservable window.location.href assignment.
    const blockedClientSource = fs.readFileSync(
      path.join(__dirname, '../blocked-client.tsx'),
      'utf-8',
    )
    expect(blockedClientSource).toMatch(
      /window\.location\.href\s*=\s*`\/pending\?redirect=\$\{encodeURIComponent\(redirectUrl\)\}`/,
    )
  })

  it('a transient fetch failure shows "Still blocked" rather than crashing the page', async () => {
    mockCheckRequestStatus.mockRejectedValueOnce(new Error('network error'))
    render(
      <BlockedClient
        serviceHost="swole.lilnas.io"
        redirectUrl={REDIRECT_URL}
        identity={IDENTITY}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /check again/i }))

    await waitFor(() => {
      expect(screen.getByText('Still blocked')).toBeInTheDocument()
    })
  })
})
