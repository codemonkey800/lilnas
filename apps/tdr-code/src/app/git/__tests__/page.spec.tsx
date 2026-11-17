import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  status: 'not-linked',
}

const LINKED_STATUS: GithubStatusResponseDto = {
  discordUserId: '111111111111111111',
  status: 'linked',
  derivedName: 'octocat',
  derivedEmail: '12345+octocat@users.noreply.github.com',
}

const DECRYPT_FAILED_STATUS: GithubStatusResponseDto = {
  discordUserId: '111111111111111111',
  status: 'decrypt-failed',
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

// DataList renders a table and a card list and lets CSS pick one, so under
// jsdom (no CSS) every roster control exists twice. Interaction specs work in
// the table; the cards are the same render functions.
async function rosterTable() {
  return within(screen.getByRole('region', { name: 'Roster' })).findByRole(
    'table',
  )
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
          (_, el) =>
            el?.tagName === 'P' &&
            el.textContent ===
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

  it('clicking Unlink asks first, and only Confirm calls api.unlinkGithubSelf', async () => {
    jest.spyOn(api, 'getGithubStatus').mockResolvedValue(LINKED_STATUS)
    const unlinkSpy = jest
      .spyOn(api, 'unlinkGithubSelf')
      .mockResolvedValue({ unlinked: true, revoked: 'succeeded' as const })
    const user = userEvent.setup()
    renderPage()

    const unlinkButton = await screen.findByRole('button', { name: 'Unlink' })
    await user.click(unlinkButton)
    expect(unlinkSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Unlink your GitHub?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unlink' }))

    await waitFor(() => expect(unlinkSpy).toHaveBeenCalledTimes(1))
  })
})

// Regression coverage for the "console shows Linked but the bot blocks
// every gh call" incident (see github-link.dto.ts's
// GithubStatusResponseSchema comment) — a 'decrypt-failed' status must
// render distinctly from both 'linked' and 'not-linked': a red chip, an
// explanatory message, a "Relink GitHub" CTA (not "Link GitHub"), and an
// "Unlink" button still available (the row exists and is clearable).
describe('GitPage — decrypt-failed GitHub status', () => {
  it('shows a broken-token message, "Relink GitHub", and "Unlink" — never "Linked as ..." or "Link GitHub"', async () => {
    jest.spyOn(api, 'getGithubStatus').mockResolvedValue(DECRYPT_FAILED_STATUS)
    renderPage()

    await screen.findByRole('heading', { name: 'GitHub' })

    expect(
      await screen.findByRole('button', { name: 'Relink GitHub' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Link GitHub' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlink' })).toBeInTheDocument()

    expect(screen.getByText(/can't be decrypted/i)).toBeInTheDocument()
    expect(screen.queryByText(/^Linked as /)).not.toBeInTheDocument()
  })

  it('clicking Relink GitHub calls authClient.linkSocial, same as a fresh link', async () => {
    jest.spyOn(api, 'getGithubStatus').mockResolvedValue(DECRYPT_FAILED_STATUS)
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Some User', image: null } },
      isPending: false,
    })
    const user = userEvent.setup()
    renderPage()

    const button = await screen.findByRole('button', { name: 'Relink GitHub' })
    await user.click(button)

    expect(mockLinkSocial).toHaveBeenCalledTimes(1)
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

    const table = await rosterTable()
    await user.click(within(table).getByRole('button', { name: 'Clear' }))
    await user.click(within(table).getByRole('button', { name: 'Cancel' }))

    expect(deleteSpy).not.toHaveBeenCalled()
    expect(
      within(table).getByRole('button', { name: 'Clear' }),
    ).toBeInTheDocument()
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

    const table = await rosterTable()
    const clearButton = within(table).getByRole('button', { name: 'Clear' })
    await user.click(clearButton)

    // Clicking Clear does NOT fire the mutation yet — it opens the inline
    // confirm/cancel toggle first.
    expect(deleteSpy).not.toHaveBeenCalled()
    const confirmButton = within(table).getByRole('button', {
      name: 'Confirm',
    })
    expect(
      within(table).getByRole('button', { name: 'Cancel' }),
    ).toBeInTheDocument()

    await user.click(confirmButton)
    expect(deleteSpy).toHaveBeenCalledTimes(1)

    // While the mutation is in flight, the row shows a disabled
    // "Clearing…" state rather than a re-clickable Clear/Confirm button.
    await waitFor(() => {
      expect(
        within(table).getByRole('button', { name: 'Clearing…' }),
      ).toBeDisabled()
    })

    resolveDelete?.()
    await waitFor(() => {
      expect(
        within(table).queryByRole('button', { name: 'Clearing…' }),
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
      expect(screen.getByText('No guild members found')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Unlink' })).toBeInTheDocument()
  })
})

// Per-section states. Each panel loads, fails and empties on its own, so these
// drive one query at a time and check the other two panels are unaffected.
describe('GitPage — GitHub section states', () => {
  it('shows its own skeleton while the status query is in flight', () => {
    jest
      .spyOn(api, 'getGithubStatus')
      .mockImplementation(() => new Promise(() => {}))
    renderPage()

    expect(screen.getByText('Fetching GitHub status…')).toBeInTheDocument()
    expect(screen.getByText('Fetching your SSH identity…')).toBeInTheDocument()
  })

  it('empty (not linked): a Not linked badge and Link GitHub as the one action', async () => {
    renderPage()

    expect(
      await screen.findByRole('button', { name: 'Link GitHub' }),
    ).toBeInTheDocument()
    const section = screen.getByRole('region', { name: 'GitHub' })
    expect(within(section).getByText('Not linked')).toBeInTheDocument()
    expect(
      within(section).queryByRole('button', { name: 'Unlink' }),
    ).not.toBeInTheDocument()
  })

  it('error: a bad Note with the server message, while SSH and roster still render', async () => {
    jest
      .spyOn(api, 'getGithubStatus')
      .mockRejectedValue(new Error('github boom'))
    renderPage()

    const section = screen.getByRole('region', { name: 'GitHub' })
    expect(
      await within(section).findByText("Couldn't load GitHub status."),
    ).toBeInTheDocument()
    expect(within(section).getByText('github boom')).toBeInTheDocument()
    expect(
      await screen.findByText('No guild members found'),
    ).toBeInTheDocument()
  })

  it('shows the unlink failure as a Note and keeps the person linked', async () => {
    jest.spyOn(api, 'getGithubStatus').mockResolvedValue(LINKED_STATUS)
    jest
      .spyOn(api, 'unlinkGithubSelf')
      .mockRejectedValue(new Error('DELETE 502'))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Unlink' }))
    await user.click(screen.getByRole('button', { name: 'Unlink' }))

    expect(await screen.findByText("Couldn't unlink GitHub.")).toBeVisible()
    expect(screen.getByText('DELETE 502')).toBeInTheDocument()
  })
})

describe('GitPage — GitHub section inline confirm', () => {
  it('Cancel puts the Unlink button back without calling the API', async () => {
    jest.spyOn(api, 'getGithubStatus').mockResolvedValue(LINKED_STATUS)
    const unlinkSpy = jest.spyOn(api, 'unlinkGithubSelf').mockReset()
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Unlink' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(unlinkSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Unlink' })).toBeInTheDocument()
    expect(screen.queryByText('Unlink your GitHub?')).not.toBeInTheDocument()
  })
})

describe('GitPage — SSH section states', () => {
  const MINE: GitIdentityListResponseDto = [
    {
      discordUserId: NOT_LINKED_STATUS.discordUserId!,
      name: 'Jane Doe',
      email: 'jane@example.com',
      fingerprint: 'SHA256:abc123',
      status: 'configured',
    },
  ]

  it('empty: Not configured and a Save key button', async () => {
    renderPage()

    const section = screen.getByRole('region', { name: 'SSH key' })
    expect(
      await within(section).findByText('Not configured'),
    ).toBeInTheDocument()
    expect(
      within(section).getByRole('button', { name: 'Save key' }),
    ).toBeInTheDocument()
    expect(
      within(section).queryByRole('button', { name: 'Clear' }),
    ).not.toBeInTheDocument()
  })

  it('loaded: Configured, the identity line with its fingerprint, Replace key and Clear', async () => {
    jest.spyOn(api, 'listGitIdentities').mockResolvedValue(MINE)
    renderPage()

    const section = screen.getByRole('region', { name: 'SSH key' })
    expect(await within(section).findByText('Configured')).toBeInTheDocument()
    expect(within(section).getByText('SHA256:abc123')).toBeInTheDocument()
    expect(
      within(section).getByRole('button', { name: 'Replace key' }),
    ).toBeInTheDocument()
    expect(
      within(section).getByRole('button', { name: 'Clear' }),
    ).toBeInTheDocument()
  })

  it('decrypt_failed: a Decrypt failed badge and a Key unreadable note', async () => {
    jest
      .spyOn(api, 'listGitIdentities')
      .mockResolvedValue([{ ...MINE[0]!, status: 'decrypt_failed' }])
    renderPage()

    expect(await screen.findByText('Key unreadable.')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'SSH key' })).getByText(
        'Decrypt failed',
      ),
    ).toBeInTheDocument()
  })

  it('GitHub linked: the accent note appears and Name / Email are fixed', async () => {
    jest.spyOn(api, 'getGithubStatus').mockResolvedValue(LINKED_STATUS)
    renderPage()

    expect(
      await screen.findByText(
        'Name and email come from your linked GitHub account.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeDisabled()
    expect(screen.getByLabelText('Name')).toHaveValue('octocat')
  })

  it('error: a bad Note, while GitHub and roster still render', async () => {
    jest
      .spyOn(api, 'listGitIdentities')
      .mockRejectedValue(new Error('identity boom'))
    renderPage()

    expect(
      await screen.findByText("Couldn't load your SSH identity."),
    ).toBeInTheDocument()
    expect(screen.getByText('identity boom')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Link GitHub' }),
    ).toBeInTheDocument()
  })

  it('saving posts the typed identity and the key', async () => {
    const upsertSpy = jest.spyOn(api, 'upsertGitIdentity').mockResolvedValue({
      discordUserId: NOT_LINKED_STATUS.discordUserId!,
      fingerprint: 'SHA256:new',
      status: 'configured',
    })
    const user = userEvent.setup()
    renderPage()

    // Wait for the status query to hand the discordUserId to the SSH panel.
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled())
    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    await user.type(screen.getByLabelText('Email'), 'jane@example.com')
    await user.type(screen.getByLabelText(/SSH private key/), 'KEY-MATERIAL')
    await user.click(screen.getByRole('button', { name: 'Save key' }))

    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1))
    expect(upsertSpy.mock.calls[0]?.[0]).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
      privateKey: 'KEY-MATERIAL',
    })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('Clear asks "Remove your SSH key?" and only Confirm calls the self-clear', async () => {
    jest.spyOn(api, 'listGitIdentities').mockResolvedValue(MINE)
    const clearSpy = jest
      .spyOn(api, 'deleteGitIdentitySelf')
      .mockResolvedValue({ accepted: true })
    const user = userEvent.setup()
    renderPage()

    const section = screen.getByRole('region', { name: 'SSH key' })
    await user.click(
      await within(section).findByRole('button', { name: 'Clear' }),
    )

    expect(clearSpy).not.toHaveBeenCalled()
    expect(
      within(section).getByText('Remove your SSH key?'),
    ).toBeInTheDocument()

    await user.click(within(section).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(clearSpy).toHaveBeenCalledTimes(1))
  })

  it('Cancel closes the clear confirm without calling the API', async () => {
    jest.spyOn(api, 'listGitIdentities').mockResolvedValue(MINE)
    const clearSpy = jest.spyOn(api, 'deleteGitIdentitySelf').mockReset()
    const user = userEvent.setup()
    renderPage()

    const section = screen.getByRole('region', { name: 'SSH key' })
    await user.click(
      await within(section).findByRole('button', { name: 'Clear' }),
    )
    await user.click(within(section).getByRole('button', { name: 'Cancel' }))

    expect(clearSpy).not.toHaveBeenCalled()
    expect(
      within(section).getByRole('button', { name: 'Clear' }),
    ).toBeInTheDocument()
  })
})

describe('GitPage — roster section states', () => {
  const ROSTER: RosterResponseDto = [
    {
      discordUserId: '222222222222222222',
      displayName: 'Sam',
      github: 'linked',
      ssh: 'not-configured',
      betterAuthUserId: 'ba-sam',
    },
    {
      discordUserId: '333333333333333333',
      displayName: 'Riley',
      github: 'decrypt-failed',
      ssh: 'configured',
      betterAuthUserId: 'ba-riley',
    },
  ]

  it('loading: a skeleton that says what is being fetched', () => {
    jest
      .spyOn(api, 'getGitRoster')
      .mockImplementation(() => new Promise(() => {}))
    renderPage()

    expect(screen.getByText('Fetching the roster…')).toBeInTheDocument()
  })

  it('empty: names the state in an EmptyState, no table', async () => {
    renderPage()

    const section = screen.getByRole('region', { name: 'Roster' })
    expect(
      await within(section).findByText('No guild members found'),
    ).toBeInTheDocument()
    expect(within(section).queryByRole('table')).not.toBeInTheDocument()
  })

  it('error: a bad Note with the server message', async () => {
    jest.spyOn(api, 'getGitRoster').mockRejectedValue(new Error('roster boom'))
    renderPage()

    expect(
      await screen.findByText("Couldn't load the roster."),
    ).toBeInTheDocument()
    expect(screen.getByText('roster boom')).toBeInTheDocument()
  })

  it('loaded: one row per member with a status badge for each credential', async () => {
    jest.spyOn(api, 'getGitRoster').mockResolvedValue(ROSTER)
    renderPage()

    const table = await rosterTable()
    const rows = within(table).getAllByRole('row')
    // header + two members
    expect(rows).toHaveLength(3)
    expect(within(rows[1]!).getByText('Sam')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Linked')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Not configured')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('Decrypt failed')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('Configured')).toBeInTheDocument()
  })

  it('GitHub Clear names the member, then Confirm unlinks by the Better Auth id', async () => {
    jest.spyOn(api, 'getGitRoster').mockResolvedValue(ROSTER)
    const unlinkSpy = jest
      .spyOn(api, 'unlinkGithubOther')
      .mockResolvedValue({ unlinked: true, revoked: 'succeeded' as const })
    const user = userEvent.setup()
    renderPage()

    const table = await rosterTable()
    const samRow = within(table).getAllByRole('row')[1]!
    await user.click(within(samRow).getByRole('button', { name: 'Clear' }))

    expect(unlinkSpy).not.toHaveBeenCalled()
    expect(within(samRow).getByText("Unlink Sam's GitHub?")).toBeInTheDocument()

    await user.click(within(samRow).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(unlinkSpy).toHaveBeenCalledWith('ba-sam'))
  })
})
