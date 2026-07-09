import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import GitPage from 'src/app/git/page'
import { api } from 'src/app/lib/api'
import type { GitIdentityListResponseDto } from 'src/console/git-identity.dto'
import type { RosterResponseDto } from 'src/console/git-roster.dto'
import type { GithubStatusResponseDto } from 'src/console/github-link.dto'

// src/app/lib/auth-client mock, following login.spec.tsx's established
// precedent (the first — and, per grep before writing this file, still only
// — place this codebase mocks this module): linkSocial is added here
// alongside the pre-existing signIn/signOut/useSession shape since GitPage
// is the first page to call it.
const mockLinkSocial = jest.fn()
const mockUseSession = jest.fn()
jest.mock('src/app/lib/auth-client', () => ({
  authClient: { linkSocial: (...args: unknown[]) => mockLinkSocial(...args) },
  useSession: () => mockUseSession(),
}))

const NOT_LINKED_STATUS: GithubStatusResponseDto = {
  discordUserId: '111111111111111111',
  linked: false,
}

const LINKED_STATUS: GithubStatusResponseDto = {
  discordUserId: '111111111111111111',
  linked: true,
  derivedName: 'octocat',
  derivedEmail: '12345+octocat@users.noreply.github.com',
}

const EMPTY_IDENTITIES: GitIdentityListResponseDto = []

const EMPTY_ROSTER: RosterResponseDto = []

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <GitPage />
      </QueryClientProvider>,
    ),
  }
}

beforeEach(() => {
  mockLinkSocial.mockReset()
  mockUseSession.mockReset().mockReturnValue({ data: null, isPending: false })
  jest.spyOn(api, 'getGithubStatus').mockResolvedValue(NOT_LINKED_STATUS)
  jest.spyOn(api, 'listGitIdentities').mockResolvedValue(EMPTY_IDENTITIES)
  jest.spyOn(api, 'getGitRoster').mockResolvedValue(EMPTY_ROSTER)
})

describe('GitPage — section rendering', () => {
  it('renders the three sections (GitHub, SSH, Roster)', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'GitHub' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'SSH key' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Roster' })).toBeInTheDocument()
  })
})

describe('GitPage — Link GitHub button and session-pending state', () => {
  it('disables "Link GitHub" while the session is pending', async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true })
    renderPage()

    const button = await screen.findByRole('button', { name: 'Link GitHub' })
    expect(button).toBeDisabled()
  })

  it('enables "Link GitHub" once the session resolves, and clicking it calls authClient.linkSocial with the required options', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Some User', image: null } },
      isPending: false,
    })
    const user = userEvent.setup()
    renderPage()

    const button = await screen.findByRole('button', { name: 'Link GitHub' })
    expect(button).not.toBeDisabled()

    await user.click(button)

    expect(mockLinkSocial).toHaveBeenCalledTimes(1)
    expect(mockLinkSocial).toHaveBeenCalledWith({
      provider: 'github',
      scopes: ['repo', 'workflow', 'delete_repo'],
      callbackURL: '/git',
      errorCallbackURL: '/git',
    })
  })

  it('carries a title attribute explaining what linking enables', async () => {
    renderPage()
    const button = await screen.findByRole('button', { name: 'Link GitHub' })
    expect(button).toHaveAttribute('title')
    expect(button.getAttribute('title')).toMatch(/PRs|repos|push/)
  })
})

// Covers the R2 AE gap: the SSH section is self-service only — no
// Discord-member picker anywhere on the page (unlike the old
// git-identity/page.tsx, which is a <select> dropdown).
describe('GitPage — SSH section has no Discord-user picker (R2)', () => {
  it('never renders a combobox/select anywhere on the page', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'SSH key' })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})

// Covers AE1: a mocked "linked" status response shows the GitHub section
// (not the roster) as Linked, with "Link GitHub" gone, "Unlink" present, and
// the derived identity line directly under the status badge.
describe('GitPage — AE1: linked GitHub status', () => {
  it('shows Linked, hides Link GitHub, shows Unlink, and renders "Linked as {name} ({email})"', async () => {
    jest.spyOn(api, 'getGithubStatus').mockResolvedValue(LINKED_STATUS)
    renderPage()

    const githubHeading = await screen.findByRole('heading', {
      name: 'GitHub',
    })
    const githubSection = githubHeading.closest('section')
    expect(githubSection).not.toBeNull()

    await waitFor(() => {
      expect(
        screen.getByText(
          'Linked as octocat (12345+octocat@users.noreply.github.com)',
        ),
      ).toBeInTheDocument()
    })

    expect(
      screen.queryByRole('button', { name: 'Link GitHub' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlink' })).toBeInTheDocument()

    // The "Linked" status text appears in the GitHub section specifically —
    // not merely somewhere on the page (e.g. only in the roster table).
    expect(
      screen.getAllByText('Linked').some(el => githubSection?.contains(el)),
    ).toBe(true)
  })

  it('clicking Unlink calls api.unlinkGithubSelf', async () => {
    jest.spyOn(api, 'getGithubStatus').mockResolvedValue(LINKED_STATUS)
    const unlinkSpy = jest
      .spyOn(api, 'unlinkGithubSelf')
      .mockResolvedValue({ unlinked: true, revoked: 'succeeded' as const })
    const user = userEvent.setup()
    renderPage()

    const unlinkButton = await screen.findByRole('button', { name: 'Unlink' })
    await user.click(unlinkButton)

    await waitFor(() => expect(unlinkSpy).toHaveBeenCalledTimes(1))
  })
})

// Edge case: the roster's own Clear action shows its inline confirm/cancel
// toggle before firing the clear mutation, and is disabled while that row's
// own mutation is in flight.
describe('GitPage — roster Clear inline confirm/cancel toggle', () => {
  const ROSTER_WITH_SSH_ONLY: RosterResponseDto = [
    {
      discordUserId: '222222222222222222',
      displayName: 'Bobby',
      github: 'not-linked',
      ssh: 'configured',
    },
  ]

  // Runs BEFORE the "Confirm" test below on purpose: that test leaves a
  // deliberately never-externally-resolved mutation promise in flight for
  // several assertions before resolving it, and jest's `restoreMocks: true`
  // (jest.config.js) does not reliably restore a jest.spyOn target between
  // `it()` blocks when the prior test's mocked implementation is still the
  // "live" one at teardown time — confirmed empirically while writing this
  // suite (a minimal, React-free spyOn-only repro reproduces it too, so
  // it's a jest/spyOn behavior, not a bug in this page). Ordering this test
  // first, and this file's own `beforeEach` re-establishing every `api.*`
  // spy from scratch each test, avoids depending on that restoration
  // happening at all.
  it('Cancel closes the confirm toggle without firing the mutation', async () => {
    jest.spyOn(api, 'getGitRoster').mockResolvedValue(ROSTER_WITH_SSH_ONLY)
    const deleteSpy = jest
      .spyOn(api, 'deleteGitIdentity')
      .mockResolvedValue({ accepted: true })
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Bobby')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(deleteSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  it('shows Confirm/Cancel (not the mutation firing immediately) after clicking Clear, and disables Confirm while pending', async () => {
    jest.spyOn(api, 'getGitRoster').mockResolvedValue(ROSTER_WITH_SSH_ONLY)
    let resolveDelete: (() => void) | undefined
    const deleteSpy = jest.spyOn(api, 'deleteGitIdentity').mockImplementation(
      () =>
        new Promise(resolve => {
          resolveDelete = () => resolve({ accepted: true })
        }),
    )
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Bobby')
    const clearButton = screen.getByRole('button', { name: 'Clear' })
    await user.click(clearButton)

    // Clicking Clear does NOT fire the mutation yet — it opens the inline
    // confirm/cancel toggle first.
    expect(deleteSpy).not.toHaveBeenCalled()
    const confirmButton = screen.getByRole('button', { name: 'Confirm' })
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    await user.click(confirmButton)
    expect(deleteSpy).toHaveBeenCalledTimes(1)

    // While the mutation is in flight, the row shows a disabled
    // "Clearing…" state rather than a re-clickable Clear/Confirm button.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Clearing…' })).toBeDisabled()
    })

    resolveDelete?.()
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Clearing…' }),
      ).not.toBeInTheDocument()
    })

    // Defensively reset this spy's implementation now that the test is
    // done with it, rather than relying solely on jest's restoreMocks — see
    // this describe block's own header comment above for why.
    deleteSpy.mockReset()
  })
})

// The roster's own loading/error/empty states render independently of the
// GitHub/SSH sections' state — a roster-fetch failure never blocks the
// self-service sections above it.
describe('GitPage — roster section state is independent of GitHub/SSH sections', () => {
  it('shows the roster error state while the GitHub section still renders normally', async () => {
    jest.spyOn(api, 'getGithubStatus').mockResolvedValue(NOT_LINKED_STATUS)
    jest.spyOn(api, 'getGitRoster').mockRejectedValue(new Error('roster boom'))
    renderPage()

    // GitHub section renders its normal not-linked state, unaffected by the
    // roster failure below it.
    expect(
      await screen.findByRole('button', { name: 'Link GitHub' }),
    ).toBeInTheDocument()

    // Roster section shows its own error state.
    await waitFor(() => {
      expect(screen.getByText('roster boom')).toBeInTheDocument()
    })
  })

  it('shows the roster empty state independently when the roster is empty but GitHub/SSH have data', async () => {
    jest.spyOn(api, 'getGithubStatus').mockResolvedValue(LINKED_STATUS)
    jest.spyOn(api, 'getGitRoster').mockResolvedValue(EMPTY_ROSTER)
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No guild members found.')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Unlink' })).toBeInTheDocument()
  })
})
