import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useTransition } from 'react'

import { DiscordLinksPanel } from 'src/app/admin/discord-links-panel'
import type {
  AdminDiscordLinkEntry,
  AdminDiscordUnlinked,
  AdminDiscordUnlinkedAccount,
  AdminDiscordUnlinkedPerson,
} from 'src/app/admin/require-admin'

const mockLinkDiscordAccount = jest.fn()
const mockUnlinkDiscordAccount = jest.fn()

jest.mock('src/app/admin/actions', () => ({
  linkDiscordAccount: (...args: unknown[]) => mockLinkDiscordAccount(...args),
  unlinkDiscordAccount: (...args: unknown[]) =>
    mockUnlinkDiscordAccount(...args),
}))

const mockShowToast = jest.fn()

// Snowflakes are STRING literals everywhere in this file, never numeric ones:
// a real 17–20 digit id is past Number.MAX_SAFE_INTEGER, so a numeric literal
// would silently round to a different id (and trip eslint's
// no-loss-of-precision on the way).
const ALICE: AdminDiscordUnlinkedPerson = {
  userId: 'user_alice',
  email: 'alice@example.com',
  name: 'Alice Example',
}
const BOB: AdminDiscordUnlinkedPerson = {
  userId: 'user_bob',
  email: 'bob@example.com',
  name: 'Bob Example',
}

const ALICE_H: AdminDiscordUnlinkedAccount = {
  discordUserId: '111111111111111111',
  username: 'alice_h',
  displayName: 'Alice H',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-02T00:00:00.000Z',
}
const BOBBY: AdminDiscordUnlinkedAccount = {
  discordUserId: '222222222222222222',
  username: 'bobby',
  displayName: null,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
}

const EXISTING_LINK: AdminDiscordLinkEntry = {
  userId: 'user_carol',
  email: 'carol@example.com',
  name: 'Carol Example',
  discordUserId: '333333333333333333',
  username: 'carol_c',
  displayName: 'Carol C',
  createdAt: '2026-02-03T00:00:00.000Z',
}

// The panel takes `isPending`/`startTransition` from its parent (same
// contract as the two admin modals), so the harness supplies a REAL
// useTransition rather than a hand-rolled stand-in — the pending flag that
// disables every control during a mutation is part of what these tests are
// asserting, and a fake that just invoked the callback would never set it.
function renderPanel(
  unlinked: AdminDiscordUnlinked,
  links: AdminDiscordLinkEntry[] = [],
) {
  function Harness() {
    const [isPending, startTransition] = useTransition()
    return (
      <DiscordLinksPanel
        unlinked={unlinked}
        links={links}
        isPending={isPending}
        startTransition={startTransition}
        showToast={mockShowToast}
      />
    )
  }
  return render(<Harness />)
}

// The Link button's label GROWS to name the pair it will create, so it can't
// be matched by an exact string — anchored at the start instead, which also
// keeps it from matching the "Unlink" buttons in the existing-links table.
function linkButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Link\b/ })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('DiscordLinksPanel — picking a pair', () => {
  it('disables Link until BOTH sides are selected, and labels it with the pair', () => {
    renderPanel({ people: [ALICE, BOB], accounts: [ALICE_H, BOBBY] })

    expect(linkButton()).toBeDisabled()

    fireEvent.click(screen.getByRole('radio', { name: /alice@example\.com/ }))
    // One side only — still nothing to link.
    expect(linkButton()).toBeDisabled()

    fireEvent.click(screen.getByRole('radio', { name: /@alice_h/ }))
    expect(linkButton()).toBeEnabled()
    expect(linkButton()).toHaveTextContent('Link alice@example.com ↔ @alice_h')
  })

  it('links the selected pair, then clears both selections', async () => {
    mockLinkDiscordAccount.mockResolvedValue(undefined)
    renderPanel({ people: [ALICE, BOB], accounts: [ALICE_H, BOBBY] })

    fireEvent.click(screen.getByRole('radio', { name: /bob@example\.com/ }))
    fireEvent.click(screen.getByRole('radio', { name: /@bobby/ }))
    fireEvent.click(linkButton())

    await waitFor(() => {
      expect(mockLinkDiscordAccount).toHaveBeenCalledWith(
        'user_bob',
        // The snowflake travels exactly as it arrived — a string, never
        // parsed into a number anywhere along the way.
        '222222222222222222',
      )
    })
    expect(mockLinkDiscordAccount).toHaveBeenCalledTimes(1)
    expect(mockShowToast).toHaveBeenCalledWith(
      'Linked bob@example.com ↔ @bobby',
    )
    // Cleared on success: the button is back to its disabled, unlabelled
    // state, and neither radio is still checked.
    await waitFor(() => expect(linkButton()).toBeDisabled())
    expect(
      screen.getByRole('radio', { name: /bob@example\.com/ }),
    ).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /@bobby/ })).not.toBeChecked()
  })

  it('replaces (never adds to) the selection when another row in the same list is picked', () => {
    renderPanel({ people: [ALICE, BOB], accounts: [ALICE_H] })

    fireEvent.click(screen.getByRole('radio', { name: /alice@example\.com/ }))
    fireEvent.click(screen.getByRole('radio', { name: /bob@example\.com/ }))
    fireEvent.click(screen.getByRole('radio', { name: /@alice_h/ }))

    expect(
      screen.getByRole('radio', { name: /alice@example\.com/ }),
    ).not.toBeChecked()
    expect(
      screen.getByRole('radio', { name: /bob@example\.com/ }),
    ).toBeChecked()
    expect(linkButton()).toHaveTextContent('Link bob@example.com ↔ @alice_h')
  })

  it("surfaces the backend's own message when linking fails, and keeps the picks", async () => {
    mockLinkDiscordAccount.mockRejectedValue(
      new Error(
        'lilnas-auth: /admin/discord/link returned 400: Discord account already linked to someone@example.com',
      ),
    )
    renderPanel({ people: [ALICE], accounts: [ALICE_H] })

    fireEvent.click(screen.getByRole('radio', { name: /alice@example\.com/ }))
    fireEvent.click(screen.getByRole('radio', { name: /@alice_h/ }))
    fireEvent.click(linkButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Discord account already linked to someone@example.com',
    )
    expect(mockShowToast).not.toHaveBeenCalled()
    // A failed link leaves both picks in place so the admin can act on the
    // same pair after reading the message.
    expect(linkButton()).toHaveTextContent('Link alice@example.com ↔ @alice_h')
  })
})

describe('DiscordLinksPanel — empty states', () => {
  it('tells the admin that an empty accounts list is the expected day-one state, not a failure', () => {
    renderPanel({ people: [ALICE], accounts: [] })

    expect(
      screen.getByText(
        /Discord accounts show up here the first time someone runs\s+\/download/,
      ),
    ).toBeInTheDocument()
    // Nothing about this reads as an error — the only role="alert" in this
    // panel is the mutation-failure line, and no mutation has run.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports an empty people list as everyone already being linked', () => {
    renderPanel({ people: [], accounts: [ALICE_H] })

    expect(
      screen.getByText('Everyone who has signed in is already linked.'),
    ).toBeInTheDocument()
  })
})

describe('DiscordLinksPanel — filters', () => {
  // The threshold itself (FILTER_MIN_ROWS) is an internal detail; what these
  // two tests pin is the BEHAVIOR either side of it — a short list is shown
  // bare, a long one gets a box that narrows it.
  const MANY_ACCOUNTS: AdminDiscordUnlinkedAccount[] = Array.from(
    { length: 9 },
    (_unused, index) => ({
      // String concatenation, not arithmetic on a numeric literal — see the
      // note on the snowflake constants above.
      discordUserId: `44444444444444444${index}`,
      username: `user_${index}`,
      displayName: null,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    }),
  )

  it('renders no filter for a list short enough to read at a glance', () => {
    renderPanel({ people: [ALICE, BOB], accounts: [ALICE_H, BOBBY] })

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('narrows the accounts list to the rows matching the filter', () => {
    renderPanel({ people: [ALICE], accounts: MANY_ACCOUNTS })

    expect(screen.getAllByRole('radio', { name: /^@user_/ })).toHaveLength(9)

    fireEvent.change(
      screen.getByLabelText('Filter Discord accounts without a lilnas link'),
      { target: { value: 'user_7' } },
    )

    const remaining = screen.getAllByRole('radio', { name: /^@user_/ })
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!).toHaveAccessibleName(/^@user_7/)
  })
})

describe('DiscordLinksPanel — existing links', () => {
  it('confirms before unlinking, then calls the action with the person id', async () => {
    mockUnlinkDiscordAccount.mockResolvedValue(undefined)
    const confirmSpy = jest
      .spyOn(window, 'confirm')
      .mockImplementation(() => true)
    renderPanel({ people: [], accounts: [] }, [EXISTING_LINK])

    const row = screen.getByText('carol@example.com').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /^Unlink$/ }))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0]![0]).toContain('carol@example.com')
    expect(confirmSpy.mock.calls[0]![0]).toContain('@carol_c')
    await waitFor(() => {
      expect(mockUnlinkDiscordAccount).toHaveBeenCalledWith('user_carol')
    })
    expect(mockShowToast).toHaveBeenCalledWith('Unlinked @carol_c')
    confirmSpy.mockRestore()
  })

  it('does nothing when the unlink confirmation is declined', () => {
    const confirmSpy = jest
      .spyOn(window, 'confirm')
      .mockImplementation(() => false)
    renderPanel({ people: [], accounts: [] }, [EXISTING_LINK])

    const row = screen.getByText('carol@example.com').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /^Unlink$/ }))

    expect(mockUnlinkDiscordAccount).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  // A 404 here means the view is stale (someone else unlinked them first),
  // NOT an idempotent success — actions.ts deliberately does not swallow it,
  // and neither does this panel: the message is shown and the SSE refresh
  // corrects the list.
  it('surfaces a stale-view unlink failure rather than reporting success', async () => {
    mockUnlinkDiscordAccount.mockRejectedValue(
      new Error(
        'lilnas-auth: /admin/discord/unlink returned 404: user user_carol has no Discord link',
      ),
    )
    const confirmSpy = jest
      .spyOn(window, 'confirm')
      .mockImplementation(() => true)
    renderPanel({ people: [], accounts: [] }, [EXISTING_LINK])

    const row = screen.getByText('carol@example.com').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /^Unlink$/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('user user_carol has no Discord link')
    expect(mockShowToast).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('renders the linked handle as a chip next to the person', () => {
    renderPanel({ people: [], accounts: [] }, [EXISTING_LINK])

    const chip = screen.getByText('@carol_c')
    expect(chip).toHaveClass('chip', 'chip-neutral')
    expect(screen.getByText('Carol Example')).toBeInTheDocument()
  })
})
