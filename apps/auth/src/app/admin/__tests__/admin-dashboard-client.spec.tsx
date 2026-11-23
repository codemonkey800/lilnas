import { ToastProvider } from '@lilnas/ui'
import {
  act,
  fireEvent,
  render as renderPlain,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactElement } from 'react'

import { AdminDashboardClient } from 'src/app/admin/admin-dashboard-client'
import type {
  AdminDiscordUnlinked,
  AdminInviteEntry,
  AdminServiceEntry,
  AdminUserEntry,
} from 'src/app/admin/require-admin'

// useToast() now fires into the ToastProvider layout.tsx mounts once at the
// root, so every render here needs one around it.
function render(ui: ReactElement) {
  return renderPlain(ui, { wrapper: ToastProvider })
}

const mockApproveRequest = jest.fn()
const mockBlockUser = jest.fn()
const mockBulkRejectRequests = jest.fn()
const mockPreAuthorizeUsers = jest.fn()
const mockRejectRequest = jest.fn()
const mockRemoveInvites = jest.fn()
const mockRemoveUser = jest.fn()
const mockRevokeSessions = jest.fn()
const mockSetUserServices = jest.fn()
const mockUnblockUser = jest.fn()
const mockLinkDiscordAccount = jest.fn()
const mockUnlinkDiscordAccount = jest.fn()

jest.mock('src/app/admin/actions', () => ({
  approveRequest: (...args: unknown[]) => mockApproveRequest(...args),
  blockUser: (...args: unknown[]) => mockBlockUser(...args),
  bulkRejectRequests: (...args: unknown[]) => mockBulkRejectRequests(...args),
  linkDiscordAccount: (...args: unknown[]) => mockLinkDiscordAccount(...args),
  preAuthorizeUsers: (...args: unknown[]) => mockPreAuthorizeUsers(...args),
  rejectRequest: (...args: unknown[]) => mockRejectRequest(...args),
  removeInvites: (...args: unknown[]) => mockRemoveInvites(...args),
  removeUser: (...args: unknown[]) => mockRemoveUser(...args),
  revokeSessions: (...args: unknown[]) => mockRevokeSessions(...args),
  setUserServices: (...args: unknown[]) => mockSetUserServices(...args),
  unblockUser: (...args: unknown[]) => mockUnblockUser(...args),
  unlinkDiscordAccount: (...args: unknown[]) =>
    mockUnlinkDiscordAccount(...args),
}))

// auth-client.ts builds a Better Auth client at import time, which needs a
// `Request` jsdom doesn't have — stubbed as in the home/pending/blocked specs.
jest.mock('src/app/lib/auth-client', () => ({
  signOut: jest.fn().mockResolvedValue(undefined),
}))

const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

// jsdom does not implement EventSource (same gap
// src/app/pending/__tests__/pending-page.spec.tsx already works around) —
// AdminDashboardClient opens one on mount for its own live-updates effect
// (see that component's header comment), so a polyfill stub is required.
// `emit()` lets the live-updates describe block below drive its listeners.
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
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type })
    }
  }
}

const SERVICES: AdminServiceEntry[] = [
  { host: 'swole.lilnas.io', gatedBy: 'lilnas-auth' },
]

// D3 (plan 017): the shape every test below that has nothing to say about
// Discord passes. `discordUnlinked`/`discordLinks` are REQUIRED props now
// (D2 landed them optional as a stopgap — see AdminDashboardClientProps's
// own comment), and "both lists empty, nothing linked" is the neutral state
// for a test about the queue or the People/Blocked split: it renders the
// panel's two empty states and nothing else. Tests that ARE about Discord
// pass their own fixtures instead.
const NO_DISCORD: AdminDiscordUnlinked = { people: [], accounts: [] }

const TWO_SERVICES: AdminServiceEntry[] = [
  { host: 'swole.lilnas.io', gatedBy: 'lilnas-auth' },
  { host: 'tdr.lilnas.io', gatedBy: 'lilnas-auth' },
]

function buildInvite(overrides: Partial<AdminInviteEntry>): AdminInviteEntry {
  return {
    email: 'invitee@example.com',
    serviceHosts: ['swole.lilnas.io'],
    createdAt: '2026-11-23T12:00:00.000Z',
    ...overrides,
  }
}

function buildUser(overrides: Partial<AdminUserEntry>): AdminUserEntry {
  return {
    id: 'user_1',
    email: 'user@example.com',
    blockedAt: null,
    services: [],
    isAdmin: false,
    discordUserId: null,
    discordUsername: null,
    ...overrides,
  }
}

// People/Blocked rows render TWICE (a desktop <table> row and a mobile
// .person-card, for the responsive layout) with a duplicate "Edit access"
// button each — anchoring on the row/card containing this specific email
// (rather than an index into getAllByRole) finds the right one regardless
// of how many other users are rendered or in what order.
function editAccessButtonFor(email: string): HTMLElement {
  const row = screen.getAllByText(email)[0]!.closest('tr, li')
  if (!row) throw new Error(`no row/card found for ${email}`)
  return within(row as HTMLElement).getByRole('button', {
    name: /edit access/i,
  })
}

// Opens the Edit-access dialog for the first row in either panel.
function openEditAccess(): HTMLElement {
  const [editAccessButton] = screen.getAllByRole('button', {
    name: /edit access/i,
  })
  fireEvent.click(editAccessButton!)
  return screen.getByRole('dialog', { name: /^edit access$/i })
}

// The confirm dialog a destructive action opens: one dialog, named for the
// person, with the consequence as its body.
async function findConfirm(title: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole('dialog', { name: title })
}

// The dialogs on screen. A toast is `role="dialog"` too (its `data-type` marks
// it), and one is usually showing once an action has run.
function openDialogs(): HTMLElement[] {
  return screen
    .queryAllByRole('dialog')
    .filter(el => !el.hasAttribute('data-type'))
}

// A dialog's confirm button, looked up inside it — the same label can also
// sit on the control that opened it.
function confirmButton(dialog: HTMLElement, name: string | RegExp) {
  return within(dialog).getByRole('button', { name })
}

function renderWithUsers(
  users: AdminUserEntry[],
  extra: Partial<Parameters<typeof AdminDashboardClient>[0]> = {},
) {
  return render(
    <AdminDashboardClient
      initialQueue={[]}
      initialUsers={users}
      initialInvites={[]}
      services={SERVICES}
      discordUnlinked={NO_DISCORD}
      discordLinks={[]}
      {...extra}
    />,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  FakeEventSource.instances = []
  global.EventSource = FakeEventSource as unknown as typeof EventSource
})

// ──────────────────────────────────────────────────────────────────────────────
// This is the first test file for admin-dashboard-client.tsx — added
// alongside the two features below (Remove access, the People/Blocked
// split) rather than backfilling coverage for the pre-existing
// approve/reject/bulk-dismiss/add-person/edit-access behavior, which this
// suite deliberately does not re-test. `services` and `initialQueue` are
// kept minimal/empty throughout since neither feature under test reads
// them.
//
// M3: `queue`/`users` are the raw `initialQueue`/`initialUsers` props now
// (see admin-dashboard-client.tsx's own header comment) — a real UI update
// after an action is Next.js's own prop-refresh doing its job, which this
// component no longer drives itself and which this render()-once test
// harness has no way to simulate (mockRefresh is a bare spy, not a real
// re-render with new props). Tests below assert on the SERVER ACTION CALL
// an action makes, not on a resulting DOM change — the DOM change is real
// in the browser, just out of this component's own testable scope now.
// ──────────────────────────────────────────────────────────────────────────────
describe('AdminDashboardClient — People/Blocked split', () => {
  it('renders an active user in People, and the Blocked panel stays empty', () => {
    const active = buildUser({
      id: 'user_active',
      email: 'active@example.com',
      services: ['swole.lilnas.io'],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[active]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    expect(screen.getAllByText('active@example.com').length).toBeGreaterThan(0)
    expect(screen.getByText('No one is blocked')).toBeInTheDocument()
  })

  it('renders a blocked, non-admin user in the Blocked panel — never in People', () => {
    const blocked = buildUser({
      id: 'user_blocked',
      email: 'blocked@example.com',
      blockedAt: '2026-01-01T00:00:00.000Z',
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[blocked]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    // People's own empty state proves the blocked user
    // does not land there; the email itself renders exactly twice — once
    // in the Blocked panel's desktop table row, once in its mobile card —
    // proving it DOES land in the Blocked panel.
    expect(screen.getByText('No one here yet')).toBeInTheDocument()
    expect(screen.getAllByText('blocked@example.com')).toHaveLength(2)
    expect(screen.queryByText('No one is blocked')).not.toBeInTheDocument()
  })

  it('S2a: a blocked ADMIN user renders in the Blocked panel, not People — blocking an admin is now a real action', () => {
    const blockedAdmin = buildUser({
      id: 'user_admin',
      email: 'admin@example.com',
      blockedAt: '2026-01-01T00:00:00.000Z',
      isAdmin: true,
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[blockedAdmin]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    expect(screen.getByText('No one here yet')).toBeInTheDocument()
    expect(screen.queryByText('No one is blocked')).not.toBeInTheDocument()
    expect(screen.getAllByText('admin@example.com').length).toBeGreaterThan(0)
    // PersonStatusChip still shows "Admin" (not "Blocked") even in the
    // Blocked panel — isAdmin stays the higher-priority fact (a blocked
    // admin keeps full /admin access via AdminGuard's own independent
    // check) — see that component's own priority-order comment.
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0)
  })

  it('clicking "Unblock" in the Blocked panel calls unblockUser with the right id', async () => {
    mockUnblockUser.mockResolvedValue(undefined)
    const blocked = buildUser({
      id: 'user_blocked',
      email: 'blocked@example.com',
      blockedAt: '2026-01-01T00:00:00.000Z',
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[blocked]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    const [unblockButton] = screen.getAllByRole('button', {
      name: /^unblock$/i,
    })
    fireEvent.click(unblockButton!)

    // M3: moving the row into People is now router.refresh()'s job (the
    // acting browser's own SSE subscription echoes the mutation's admin
    // broadcast back to it) — not something this component does with a
    // local optimistic update, so there is nothing further to assert here.
    await waitFor(() => {
      expect(mockUnblockUser).toHaveBeenCalledWith('user_blocked')
    })
  })
})

describe('AdminDashboardClient — Remove access', () => {
  it('clicking "Remove access" opens a confirm naming the person; confirming calls removeUser and closes the dialog', async () => {
    mockRemoveUser.mockResolvedValue(undefined)
    renderWithUsers([
      buildUser({
        id: 'user_active',
        email: 'active@example.com',
        services: ['swole.lilnas.io'],
      }),
    ])

    const edit = openEditAccess()
    fireEvent.click(
      within(edit).getByRole('button', { name: /remove access/i }),
    )

    const confirm = await findConfirm('Remove active@example.com’s access?')
    expect(confirm).toHaveTextContent(
      'They lose all 1 service. They can ask again from the sign-in page.',
    )
    // Nothing runs until it is confirmed.
    expect(mockRemoveUser).not.toHaveBeenCalled()
    fireEvent.click(confirmButton(confirm, 'Remove access'))

    await waitFor(() => {
      expect(mockRemoveUser).toHaveBeenCalledWith('user_active')
    })
    // Closing the dialog is this component's OWN local UI state
    // (accessModalUser), not a server-data mirror — still directly
    // testable, unlike the now-optimistic-free `services` list (M3).
    await waitFor(() => {
      expect(openDialogs()).toHaveLength(0)
    })
  })

  it('"Keep access" on the Remove confirm never calls removeUser and leaves the Edit-access dialog open', async () => {
    renderWithUsers([
      buildUser({
        id: 'user_active',
        email: 'active@example.com',
        services: ['swole.lilnas.io'],
      }),
    ])

    const edit = openEditAccess()
    fireEvent.click(
      within(edit).getByRole('button', { name: /remove access/i }),
    )
    const confirm = await findConfirm(/^Remove active@example\.com/)
    fireEvent.click(confirmButton(confirm, 'Keep access'))

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /^Remove / }),
      ).not.toBeInTheDocument()
    })
    expect(mockRemoveUser).not.toHaveBeenCalled()
    expect(
      screen.getByRole('dialog', { name: /^edit access$/i }),
    ).toBeInTheDocument()
  })

  it('the Blocked panel\'s Edit-access dialog also has a working "Remove access" action', async () => {
    mockRemoveUser.mockResolvedValue(undefined)
    renderWithUsers([
      buildUser({
        id: 'user_blocked',
        email: 'blocked@example.com',
        blockedAt: '2026-01-01T00:00:00.000Z',
        services: ['swole.lilnas.io'],
      }),
    ])

    const edit = openEditAccess()
    fireEvent.click(
      within(edit).getByRole('button', { name: /remove access/i }),
    )
    const confirm = await findConfirm(/^Remove blocked@example\.com/)
    fireEvent.click(confirmButton(confirm, 'Remove access'))

    await waitFor(() => {
      expect(mockRemoveUser).toHaveBeenCalledWith('user_blocked')
    })
    await waitFor(() => {
      expect(openDialogs()).toHaveLength(0)
    })
  })

  it('S2a: an admin row hides Edit access (and so Remove access, reachable only from that modal), but still shows Block', () => {
    const admin = buildUser({
      id: 'user_admin',
      email: 'admin@example.com',
      isAdmin: true,
      services: ['swole.lilnas.io'],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[admin]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    expect(
      screen.queryByRole('button', { name: /edit access/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /remove access/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: /^block$/i }).length,
    ).toBeGreaterThan(0)
  })
})

describe('AdminDashboardClient — Block confirm', () => {
  it('Block opens a confirm naming the person; the action runs only after confirming', async () => {
    mockBlockUser.mockResolvedValue(undefined)
    renderWithUsers([
      buildUser({ id: 'user_active', email: 'active@example.com' }),
    ])

    const [blockButton] = screen.getAllByRole('button', { name: /^block$/i })
    fireEvent.click(blockButton!)

    const confirm = await findConfirm('Block active@example.com?')
    expect(confirm).toHaveTextContent(
      'They lose every service until you unblock them.',
    )
    // The body does NOT promise dashboard access to a non-admin.
    expect(confirm).not.toHaveTextContent('dashboard')
    expect(mockBlockUser).not.toHaveBeenCalled()

    fireEvent.click(confirmButton(confirm, 'Block'))
    await waitFor(() => {
      expect(mockBlockUser).toHaveBeenCalledWith('user_active')
    })
    expect(mockBlockUser).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(openDialogs()).toHaveLength(0)
    })
  })

  it('"Keep access" closes the confirm and never calls blockUser', async () => {
    renderWithUsers([
      buildUser({ id: 'user_active', email: 'active@example.com' }),
    ])

    const [blockButton] = screen.getAllByRole('button', { name: /^block$/i })
    fireEvent.click(blockButton!)
    const confirm = await findConfirm('Block active@example.com?')
    fireEvent.click(confirmButton(confirm, 'Keep access'))

    await waitFor(() => {
      expect(openDialogs()).toHaveLength(0)
    })
    expect(mockBlockUser).not.toHaveBeenCalled()
  })

  it('S2a: blocking an admin says they keep the dashboard, and confirming calls blockUser', async () => {
    mockBlockUser.mockResolvedValue(undefined)
    renderWithUsers([
      buildUser({
        id: 'user_admin',
        email: 'admin@example.com',
        isAdmin: true,
      }),
    ])

    const [blockButton] = screen.getAllByRole('button', { name: /^block$/i })
    fireEvent.click(blockButton!)

    const confirm = await findConfirm('Block admin@example.com?')
    expect(confirm).toHaveTextContent(
      'They keep this dashboard, because they’re an admin.',
    )
    fireEvent.click(confirmButton(confirm, 'Block'))
    await waitFor(() => {
      expect(mockBlockUser).toHaveBeenCalledWith('user_admin')
    })
  })

  it('Escape dismisses the confirm without blocking', async () => {
    renderWithUsers([
      buildUser({ id: 'user_active', email: 'active@example.com' }),
    ])

    const [blockButton] = screen.getAllByRole('button', { name: /^block$/i })
    fireEvent.click(blockButton!)
    const confirm = await findConfirm('Block active@example.com?')
    fireEvent.keyDown(confirm, { key: 'Escape' })

    await waitFor(() => {
      expect(openDialogs()).toHaveLength(0)
    })
    expect(mockBlockUser).not.toHaveBeenCalled()
  })
})

describe('AdminDashboardClient — Sign out everywhere (S2b)', () => {
  it('"Sign out everywhere" confirms first, then calls revokeSessions and shows the session count', async () => {
    mockRevokeSessions.mockResolvedValue({ ok: true, sessionsRevoked: 2 })
    renderWithUsers([
      buildUser({
        id: 'user_active',
        email: 'active@example.com',
        services: ['swole.lilnas.io'],
      }),
    ])

    const edit = openEditAccess()
    fireEvent.click(
      within(edit).getByRole('button', { name: /sign out everywhere/i }),
    )
    const confirm = await findConfirm('Sign active@example.com out everywhere?')
    expect(mockRevokeSessions).not.toHaveBeenCalled()
    fireEvent.click(confirmButton(confirm, 'Sign out'))

    await waitFor(() => {
      expect(mockRevokeSessions).toHaveBeenCalledWith('user_active')
    })
    await waitFor(() => {
      expect(screen.getByText('Signed out of 2 sessions')).toBeInTheDocument()
    })
  })

  it('"Keep signed in" never calls revokeSessions', async () => {
    renderWithUsers([
      buildUser({
        id: 'user_active',
        email: 'active@example.com',
        services: ['swole.lilnas.io'],
      }),
    ])

    const edit = openEditAccess()
    fireEvent.click(
      within(edit).getByRole('button', { name: /sign out everywhere/i }),
    )
    const confirm = await findConfirm(/out everywhere\?$/)
    fireEvent.click(confirmButton(confirm, 'Keep signed in'))

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /out everywhere/ }),
      ).not.toBeInTheDocument()
    })
    expect(mockRevokeSessions).not.toHaveBeenCalled()
  })

  it('the Blocked panel\'s Edit-access dialog also has a working "Sign out everywhere" action', async () => {
    mockRevokeSessions.mockResolvedValue({ ok: true, sessionsRevoked: 0 })
    renderWithUsers([
      buildUser({
        id: 'user_blocked',
        email: 'blocked@example.com',
        blockedAt: '2026-01-01T00:00:00.000Z',
        services: ['swole.lilnas.io'],
      }),
    ])

    const edit = openEditAccess()
    fireEvent.click(
      within(edit).getByRole('button', { name: /sign out everywhere/i }),
    )
    const confirm = await findConfirm(/out everywhere\?$/)
    fireEvent.click(confirmButton(confirm, 'Sign out'))

    await waitFor(() => {
      expect(mockRevokeSessions).toHaveBeenCalledWith('user_blocked')
    })
    await waitFor(() => {
      expect(
        screen.getByText('No active sessions to sign out'),
      ).toBeInTheDocument()
    })
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// M2 split AddPersonModal/EditAccessModal out of this file into their own
// sibling files (add-person-modal.tsx, edit-access-modal.tsx), moving their
// state and submit handlers as-is. M3 then replaced each modal's per-host
// Server Action loop with a single batched call — see each modal file's
// own header comment for the "one transaction for the whole batch"
// rationale. The pre-existing tests above already cover Remove
// access/Sign out everywhere/Block/Unblock through the Edit-access modal,
// so a broken prop hookup there would already fail one of them — but
// neither the Add-person flow nor the Edit-access modal's own base
// grant/revoke checkbox flow had any coverage before M2, and the two
// things genuinely NEW rather than moved (M2's key-based reset, M3's
// batching) had no coverage at all. These tests close both gaps.
// ──────────────────────────────────────────────────────────────────────────────
describe('AdminDashboardClient — Add person modal (M2/M3)', () => {
  it('a valid email with a service selected calls preAuthorizeUsers with that one host and toasts that they were invited', async () => {
    mockPreAuthorizeUsers.mockResolvedValue({ ok: true, outcome: 'invited' })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /add person/i })[0]!)
    const modal = screen.getByRole('dialog', { name: /add a person/i })
    fireEvent.change(within(modal).getByLabelText('Email address'), {
      target: { value: 'new.person@example.com' },
    })
    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    fireEvent.click(
      within(modal).getByRole('button', { name: /^add person$/i }),
    )

    await waitFor(() => {
      expect(mockPreAuthorizeUsers).toHaveBeenCalledWith(
        'new.person@example.com',
        ['swole.lilnas.io'],
      )
    })
    await waitFor(() => {
      expect(
        screen.getByText('Invited new.person@example.com'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText(/Access granted to/)).toBeNull()
  })

  // Plan 020: the toast follows the backend's `outcome`, not a guess.
  it('toasts "Access granted to <email>" when the email already had an account', async () => {
    mockPreAuthorizeUsers.mockResolvedValue({ ok: true, outcome: 'granted' })
    renderWithUsers([])

    fireEvent.click(screen.getAllByRole('button', { name: /add person/i })[0]!)
    const modal = screen.getByRole('dialog', { name: /add a person/i })
    fireEvent.change(within(modal).getByLabelText('Email address'), {
      target: { value: 'jane.doe@example.com' },
    })
    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    fireEvent.click(
      within(modal).getByRole('button', { name: /^add person$/i }),
    )

    expect(
      await screen.findByText('Access granted to jane.doe@example.com'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Invited /)).toBeNull()
  })

  it('shows a field error and makes no call and no toast when nothing is selected', () => {
    renderWithUsers([])

    fireEvent.click(screen.getAllByRole('button', { name: /add person/i })[0]!)
    const modal = screen.getByRole('dialog', { name: /add a person/i })
    fireEvent.change(within(modal).getByLabelText('Email address'), {
      target: { value: 'erlyne@example.com' },
    })
    fireEvent.click(
      within(modal).getByRole('button', { name: /^add person$/i }),
    )

    expect(
      within(modal).getByText('Pick at least one service or rule.'),
    ).toBeInTheDocument()
    expect(mockPreAuthorizeUsers).not.toHaveBeenCalled()
    expect(screen.queryByText(/Access granted to/)).toBeNull()
    expect(screen.queryByText(/^Invited /)).toBeNull()
    expect(
      screen.getByRole('dialog', { name: /add a person/i }),
    ).toBeInTheDocument()

    // Picking a service clears it.
    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    expect(
      within(modal).queryByText('Pick at least one service or rule.'),
    ).toBeNull()
  })

  // M3: the whole point of batching — checking multiple services sends ONE
  // preAuthorizeUsers() call with every host, not one call per checkbox.
  it('checking two services and confirming calls preAuthorizeUsers exactly once, with both hosts in one array', async () => {
    mockPreAuthorizeUsers.mockResolvedValue({ ok: true, outcome: 'invited' })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[]}
        initialInvites={[]}
        services={TWO_SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /add person/i })[0]!)
    const modal = screen.getByRole('dialog', { name: /add a person/i })
    fireEvent.change(within(modal).getByLabelText('Email address'), {
      target: { value: 'both@example.com' },
    })
    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    fireEvent.click(within(modal).getByRole('checkbox', { name: /tdr/i }))
    fireEvent.click(
      within(modal).getByRole('button', { name: /^add person$/i }),
    )

    await waitFor(() => {
      expect(mockPreAuthorizeUsers).toHaveBeenCalledTimes(1)
    })
    const [, hostsArg] = mockPreAuthorizeUsers.mock.calls[0] as [
      string,
      string[],
    ]
    expect(new Set(hostsArg)).toEqual(
      new Set(['swole.lilnas.io', 'tdr.lilnas.io']),
    )
  })

  it('an invalid email is rejected without ever calling preAuthorizeUsers', () => {
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /add person/i })[0]!)
    const modal = screen.getByRole('dialog', { name: /add a person/i })
    fireEvent.change(within(modal).getByLabelText('Email address'), {
      target: { value: 'not-an-email' },
    })
    fireEvent.click(
      within(modal).getByRole('button', { name: /^add person$/i }),
    )

    expect(mockPreAuthorizeUsers).not.toHaveBeenCalled()
  })

  it('closing without submitting and reopening shows a blank form again, not the previously-typed value', () => {
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /add person/i })[0]!)
    const firstOpen = screen.getByRole('dialog', { name: /add a person/i })
    fireEvent.change(within(firstOpen).getByLabelText('Email address'), {
      target: { value: 'typed-but-not-submitted@example.com' },
    })
    expect(within(firstOpen).getByLabelText('Email address')).toHaveValue(
      'typed-but-not-submitted@example.com',
    )
    fireEvent.click(
      within(firstOpen).getByRole('button', { name: /^cancel$/i }),
    )

    fireEvent.click(screen.getAllByRole('button', { name: /add person/i })[0]!)
    const secondOpen = screen.getByRole('dialog', { name: /add a person/i })
    expect(within(secondOpen).getByLabelText('Email address')).toHaveValue('')
  })
})

describe('AdminDashboardClient — Edit access modal checkbox diffing (M2/M3)', () => {
  it('checking a not-yet-granted service and saving calls setUserServices with one grant:true change', async () => {
    mockSetUserServices.mockResolvedValue(undefined)
    const user = buildUser({
      id: 'user_1',
      email: 'user@example.com',
      services: [],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[user]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    fireEvent.click(editAccessButtonFor('user@example.com'))
    const modal = screen.getByRole('dialog', { name: /^edit access$/i })
    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    fireEvent.click(within(modal).getByRole('button', { name: /save access/i }))

    await waitFor(() => {
      expect(mockSetUserServices).toHaveBeenCalledWith('user_1', [
        { serviceHost: 'swole.lilnas.io', grant: true },
      ])
    })
    expect(mockSetUserServices).toHaveBeenCalledTimes(1)
  })

  it('unchecking a currently-granted service and saving calls setUserServices with one grant:false change', async () => {
    mockSetUserServices.mockResolvedValue(undefined)
    const user = buildUser({
      id: 'user_1',
      email: 'user@example.com',
      services: ['swole.lilnas.io'],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[user]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    fireEvent.click(editAccessButtonFor('user@example.com'))
    const modal = screen.getByRole('dialog', { name: /^edit access$/i })
    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    fireEvent.click(within(modal).getByRole('button', { name: /save access/i }))

    await waitFor(() => {
      expect(mockSetUserServices).toHaveBeenCalledWith('user_1', [
        { serviceHost: 'swole.lilnas.io', grant: false },
      ])
    })
    expect(mockSetUserServices).toHaveBeenCalledTimes(1)
  })

  // M3: the whole point of batching — granting one service AND revoking
  // another in the same save sends ONE setUserServices() call carrying
  // both deltas, not two sequential calls.
  it('granting one service and revoking another in the same save calls setUserServices exactly once, with both changes in one array', async () => {
    mockSetUserServices.mockResolvedValue(undefined)
    const user = buildUser({
      id: 'user_1',
      email: 'user@example.com',
      services: ['swole.lilnas.io'],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[user]}
        initialInvites={[]}
        services={TWO_SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    fireEvent.click(editAccessButtonFor('user@example.com'))
    const modal = screen.getByRole('dialog', { name: /^edit access$/i })
    // swole starts checked (revoke it), tdr starts unchecked (grant it).
    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    fireEvent.click(within(modal).getByRole('checkbox', { name: /tdr/i }))
    fireEvent.click(within(modal).getByRole('button', { name: /save access/i }))

    await waitFor(() => {
      expect(mockSetUserServices).toHaveBeenCalledTimes(1)
    })
    const [userIdArg, changesArg] = mockSetUserServices.mock.calls[0] as [
      string,
      { serviceHost: string; grant: boolean }[],
    ]
    expect(userIdArg).toBe('user_1')
    expect(
      [...changesArg].sort((a, b) =>
        a.serviceHost.localeCompare(b.serviceHost),
      ),
    ).toEqual([
      { serviceHost: 'swole.lilnas.io', grant: false },
      { serviceHost: 'tdr.lilnas.io', grant: true },
    ])
  })

  it('saving with no checkboxes touched never calls setUserServices', async () => {
    const user = buildUser({
      id: 'user_1',
      email: 'user@example.com',
      services: ['swole.lilnas.io'],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[user]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    fireEvent.click(editAccessButtonFor('user@example.com'))
    const modal = screen.getByRole('dialog', { name: /^edit access$/i })
    fireEvent.click(within(modal).getByRole('button', { name: /save access/i }))

    // handleAccessConfirm still enters startTransition()'s async callback
    // even with an empty diff (it just skips the network call inside it) —
    // waitFor lets that microtask settle before asserting, same as every
    // other test here that clicks a button wired to a Server Action.
    await waitFor(() => {
      expect(mockSetUserServices).not.toHaveBeenCalled()
    })
  })

  it("editing one user then a different user without saving shows the second user's own services, not the first user's uncommitted edits", () => {
    const userA = buildUser({
      id: 'user_a',
      email: 'a@example.com',
      services: ['swole.lilnas.io'],
    })
    const userB = buildUser({
      id: 'user_b',
      email: 'b@example.com',
      services: ['tdr.lilnas.io'],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[userA, userB]}
        initialInvites={[]}
        services={TWO_SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    fireEvent.click(editAccessButtonFor('a@example.com'))
    let modal = screen.getByRole('dialog', { name: /^edit access$/i })
    // Flip both checkboxes for A — never saved, only Cancel below.
    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    fireEvent.click(within(modal).getByRole('checkbox', { name: /tdr/i }))
    fireEvent.click(within(modal).getByRole('button', { name: /^cancel$/i }))

    fireEvent.click(editAccessButtonFor('b@example.com'))
    modal = screen.getByRole('dialog', { name: /^edit access$/i })
    // B's own real services (tdr, not swole) — if A's uncommitted edits had
    // leaked, this would show the opposite of both checkboxes.
    expect(
      within(modal).getByRole('checkbox', { name: /swole/i }),
    ).not.toBeChecked()
    expect(within(modal).getByRole('checkbox', { name: /tdr/i })).toBeChecked()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// D3 (plan 017): what the dashboard ITSELF gained from the Discord feature —
// the handle chip on a People row, and the Edit-access modal's read-only view
// of an existing link. The link/unlink panel's own behavior is tested
// separately in discord-links-panel.spec.tsx.
// ──────────────────────────────────────────────────────────────────────────────
describe('AdminDashboardClient — access rules', () => {
  function openEditAccess(user: AdminUserEntry): HTMLElement {
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[user]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )
    fireEvent.click(editAccessButtonFor(user.email))
    return screen.getByRole('dialog', { name: /^edit access$/i })
  }

  it('renders a held rule as a chip, never as a checkbox, and lists it on the People row', () => {
    const modal = openEditAccess(
      buildUser({ services: ['swole.lilnas.io', '*.dev.lilnas.io'] }),
    )

    expect(
      within(modal).queryByRole('checkbox', { name: /\*\.dev/ }),
    ).not.toBeInTheDocument()
    expect(
      within(modal).getByRole('button', {
        name: 'Remove rule *.dev.lilnas.io',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByText('All *.dev.lilnas.io sites').length,
    ).toBeGreaterThan(0)
  })

  it('adding a typed rule and saving sends it as a grant in the same batched call', async () => {
    mockSetUserServices.mockResolvedValue(undefined)
    const modal = openEditAccess(buildUser({ services: [] }))

    fireEvent.change(within(modal).getByLabelText('Access rules'), {
      target: { value: ' *.Preview.lilnas.io ' },
    })
    fireEvent.click(within(modal).getByRole('button', { name: 'Add rule' }))
    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    fireEvent.click(within(modal).getByRole('button', { name: /save access/i }))

    await waitFor(() => {
      expect(mockSetUserServices).toHaveBeenCalledWith('user_1', [
        { serviceHost: '*.preview.lilnas.io', grant: true },
        { serviceHost: 'swole.lilnas.io', grant: true },
      ])
    })
  })

  it('removing a held rule and saving sends a grant:false change for it', async () => {
    mockSetUserServices.mockResolvedValue(undefined)
    const modal = openEditAccess(buildUser({ services: ['*.dev.lilnas.io'] }))

    fireEvent.click(
      within(modal).getByRole('button', {
        name: 'Remove rule *.dev.lilnas.io',
      }),
    )
    fireEvent.click(within(modal).getByRole('button', { name: /save access/i }))

    await waitFor(() => {
      expect(mockSetUserServices).toHaveBeenCalledWith('user_1', [
        { serviceHost: '*.dev.lilnas.io', grant: false },
      ])
    })
  })

  it('rejects a malformed rule client-side without adding it', () => {
    const modal = openEditAccess(buildUser({ services: [] }))

    fireEvent.change(within(modal).getByLabelText('Access rules'), {
      target: { value: 'foo-*.lilnas.io' },
    })
    fireEvent.click(within(modal).getByRole('button', { name: 'Add rule' }))

    expect(
      within(modal).queryByRole('button', { name: /remove rule/i }),
    ).not.toBeInTheDocument()
    expect(within(modal).getByLabelText('Access rules')).toBeInvalid()
    expect(
      within(modal).getByText(/use a single leading wildcard/i),
    ).toBeInTheDocument()
  })

  it('shows the server error when saving a rule fails', async () => {
    mockSetUserServices.mockRejectedValue(
      new Error('"*.example.com" is not a valid access rule'),
    )
    const modal = openEditAccess(buildUser({ services: [] }))

    fireEvent.change(within(modal).getByLabelText('Access rules'), {
      target: { value: '*.example.com' },
    })
    fireEvent.click(within(modal).getByRole('button', { name: 'Add rule' }))
    fireEvent.click(within(modal).getByRole('button', { name: /save access/i }))

    expect(await within(modal).findByRole('alert')).toHaveTextContent(
      'not a valid access rule',
    )
  })

  it('the Add-person preset chip appends *.dev.lilnas.io to the hosts sent to preAuthorizeUsers', async () => {
    mockPreAuthorizeUsers.mockResolvedValue({ ok: true, outcome: 'invited' })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /add person/i })[0]!)
    const modal = screen.getByRole('dialog', { name: /add a person/i })
    fireEvent.change(within(modal).getByLabelText('Email address'), {
      target: { value: 'dev.friend@example.com' },
    })
    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    fireEvent.click(
      within(modal).getByRole('button', { name: '*.dev.lilnas.io' }),
    )
    fireEvent.click(
      within(modal).getByRole('button', { name: /^add person$/i }),
    )

    await waitFor(() => {
      expect(mockPreAuthorizeUsers).toHaveBeenCalledWith(
        'dev.friend@example.com',
        ['swole.lilnas.io', '*.dev.lilnas.io'],
      )
    })
  })
})

describe('AdminDashboardClient — Discord handle on People rows', () => {
  it('renders the linked handle as a chip in BOTH the desktop row and the mobile card', () => {
    const linked = buildUser({
      id: 'user_linked',
      email: 'alice@example.com',
      services: ['swole.lilnas.io'],
      // Snowflakes stay string literals — a 19-digit numeric literal is past
      // Number.MAX_SAFE_INTEGER and would silently lose digits.
      discordUserId: '111111111111111111',
      discordUsername: 'alice_h',
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[linked]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    // Both responsive renderings are always in the DOM (CSS decides which is
    // visible), so the chip must appear twice — asserting on only one would
    // pass with the mobile card silently missing it.
    const chips = screen.getAllByText('@alice_h')
    expect(chips).toHaveLength(2)
    // A badge is a plain span — never a control.
    expect(chips[0]!.tagName).toBe('SPAN')
    expect(chips[0]!.closest('button, a')).toBeNull()
    expect(chips[0]!.closest('tr')).not.toBeNull()
    expect(chips[1]!.closest('li')).not.toBeNull()
  })

  it('renders no handle chip for a person with no link', () => {
    const unlinkedUser = buildUser({
      id: 'user_plain',
      email: 'plain@example.com',
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[unlinkedUser]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    expect(screen.queryByText(/^@/)).not.toBeInTheDocument()
  })
})

describe('AdminDashboardClient — Edit access modal, Discord section', () => {
  it('shows the current link read-only, with no way to type a handle', () => {
    const linked = buildUser({
      id: 'user_linked',
      email: 'alice@example.com',
      discordUserId: '111111111111111111',
      discordUsername: 'alice_h',
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[linked]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    fireEvent.click(editAccessButtonFor('alice@example.com'))
    const modal = screen.getByRole('dialog', { name: /^edit access$/i })

    expect(within(modal).getByText('@alice_h')).toBeInTheDocument()
    expect(
      within(modal).getByRole('button', { name: /^unlink$/i }),
    ).toBeInTheDocument()
    // The whole design constraint, asserted: the only text input this modal
    // has is the access-rule pattern box — there is no handle/snowflake box
    // here to type into.
    expect(within(modal).getAllByRole('textbox')).toEqual([
      within(modal).getByLabelText('Access rules'),
    ])
  })

  it('unlinking from the modal confirms first, then calls unlinkDiscordAccount with the user id', async () => {
    mockUnlinkDiscordAccount.mockResolvedValue(undefined)
    renderWithUsers([
      buildUser({
        id: 'user_linked',
        email: 'alice@example.com',
        discordUserId: '111111111111111111',
        discordUsername: 'alice_h',
      }),
    ])

    fireEvent.click(editAccessButtonFor('alice@example.com'))
    const modal = screen.getByRole('dialog', { name: /^edit access$/i })
    fireEvent.click(within(modal).getByRole('button', { name: /^unlink$/i }))

    const confirm = await findConfirm('Unlink alice@example.com from @alice_h?')
    expect(confirm).toHaveTextContent(
      'Their Discord downloads stop being attributed to them until you link them again.',
    )
    expect(mockUnlinkDiscordAccount).not.toHaveBeenCalled()
    fireEvent.click(confirmButton(confirm, 'Unlink'))

    await waitFor(() => {
      expect(mockUnlinkDiscordAccount).toHaveBeenCalledWith('user_linked')
    })
  })

  it('"Keep link" on the unlink confirmation calls nothing', async () => {
    renderWithUsers([
      buildUser({
        id: 'user_linked',
        email: 'alice@example.com',
        discordUserId: '111111111111111111',
        discordUsername: 'alice_h',
      }),
    ])

    fireEvent.click(editAccessButtonFor('alice@example.com'))
    const modal = screen.getByRole('dialog', { name: /^edit access$/i })
    fireEvent.click(within(modal).getByRole('button', { name: /^unlink$/i }))
    const confirm = await findConfirm(/^Unlink alice@example\.com/)
    fireEvent.click(confirmButton(confirm, 'Keep link'))

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /^Unlink / }),
      ).not.toBeInTheDocument()
    })
    expect(mockUnlinkDiscordAccount).not.toHaveBeenCalled()
  })

  it('offers no Unlink action for a person with no link', () => {
    const unlinkedUser = buildUser({
      id: 'user_plain',
      email: 'plain@example.com',
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[unlinkedUser]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )

    fireEvent.click(editAccessButtonFor('plain@example.com'))
    const modal = screen.getByRole('dialog', { name: /^edit access$/i })

    expect(
      within(modal).queryByRole('button', { name: /^unlink$/i }),
    ).not.toBeInTheDocument()
    expect(within(modal).getByText(/not linked/i)).toBeInTheDocument()
  })
})

describe('AdminDashboardClient — People and Blocked as one DataList', () => {
  const PEOPLE = [
    buildUser({
      id: 'user_a',
      email: 'a@example.com',
      services: ['swole.lilnas.io'],
    }),
    buildUser({ id: 'user_b', email: 'b@example.com' }),
    buildUser({
      id: 'user_c',
      email: 'c@example.com',
      blockedAt: '2026-01-01T00:00:00.000Z',
    }),
  ]

  it('renders one table row and one card per person, in both layouts', () => {
    renderWithUsers(PEOPLE)

    const tables = screen.getAllByRole('table', { hidden: true })
    // People and Blocked each own one table; Discord links is empty.
    expect(tables).toHaveLength(2)
    const [peopleTable, blockedTable] = tables as [HTMLElement, HTMLElement]
    // Header row + one row per active person / blocked person.
    expect(
      within(peopleTable).getAllByRole('row', { hidden: true }),
    ).toHaveLength(3)
    expect(
      within(blockedTable).getAllByRole('row', { hidden: true }),
    ).toHaveLength(2)

    for (const email of ['a@example.com', 'b@example.com', 'c@example.com']) {
      const matches = screen.getAllByText(email)
      expect(matches).toHaveLength(2)
      expect(matches.map(el => el.closest('tr, li')!.tagName)).toEqual([
        'TR',
        'LI',
      ])
    }
  })

  it('keeps the old parallel markup gone: no .people-card-list or .person-card', () => {
    const { container } = renderWithUsers(PEOPLE)

    expect(container.querySelector('.people-card-list')).toBeNull()
    expect(container.querySelector('.person-card')).toBeNull()
    expect(container.querySelector('.people-table-wrap')).toBeNull()
  })

  it('shows status as a badge and services as a badge list', () => {
    renderWithUsers(PEOPLE)

    expect(screen.getAllByText('Granted').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No access').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0)
    // The services list renders a badge per service on both layouts.
    expect(screen.getAllByText('swole.lilnas.io').length).toBe(2)
  })

  it('filters People by the search box and offers to clear it', () => {
    renderWithUsers(PEOPLE)

    fireEvent.change(screen.getByLabelText('Search people'), {
      target: { value: 'zed' },
    })
    expect(screen.getByText('No one matches “zed”')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByText('a@example.com')).toHaveLength(2)
  })
})

// An invite is a person added with "Add a person" who has no account yet: it
// comes from fetchAdminInvites() (pre_authorized_grant), not from the user
// list, and renders as a row in the same People table.
describe('AdminDashboardClient — invited people in People', () => {
  const INVITE = buildInvite({
    email: 'erlyne@example.com',
    serviceHosts: ['swole.lilnas.io', 'tdr.lilnas.io'],
    createdAt: '2026-11-23T12:00:00.000Z',
  })

  // The People section's count pill, read from its heading.
  function peopleCount(): string {
    const heading = screen.getByRole('heading', { name: /^People/ })
    return heading.parentElement!.textContent ?? ''
  }

  function tileValue(label: string): string {
    // The tile's label is the only `text-cap` span with this text; its value
    // is the span just before it.
    const labelEl = screen
      .getAllByText(label)
      .find(el => el.classList.contains('text-cap'))
    return labelEl!.previousElementSibling!.textContent ?? ''
  }

  it('renders an invite as one table row and one card with email, badge, services and date', () => {
    renderWithUsers([], { initialInvites: [INVITE] })

    const matches = screen.getAllByText('erlyne@example.com')
    expect(matches).toHaveLength(2)
    const [tr, li] = matches.map(el => el.closest('tr, li')!) as [
      HTMLElement,
      HTMLElement,
    ]
    expect(tr.tagName).toBe('TR')
    expect(li.tagName).toBe('LI')

    const date = new Date(INVITE.createdAt).toLocaleDateString()
    for (const row of [tr, li]) {
      // The accent badge; "Invited <date>" under the email has the same text.
      const badge = within(row)
        .getAllByText('Invited')
        .find(el => el.classList.contains('bg-accent-ghost'))
      expect(badge).toBeDefined()
      expect(within(row).getByText('swole.lilnas.io')).toBeInTheDocument()
      expect(within(row).getByText('TDR Bot')).toBeInTheDocument()
      expect(within(row).getByText(date)).toBeInTheDocument()
      expect(
        within(row).getByText('Available after they sign in'),
      ).toBeInTheDocument()
      expect(within(row).queryByText('Not linked')).toBeNull()
    }
  })

  it('gives an invited row no Block button, and a normal row still has one', () => {
    renderWithUsers([buildUser({ id: 'user_a', email: 'a@example.com' })], {
      initialInvites: [INVITE],
    })

    const invitedRow = screen
      .getAllByText('erlyne@example.com')[0]!
      .closest('tr, li') as HTMLElement
    expect(
      within(invitedRow).queryByRole('button', { name: 'Block' }),
    ).toBeNull()
    expect(
      within(invitedRow).getByRole('button', { name: 'Edit access' }),
    ).toBeInTheDocument()

    const normalRow = screen
      .getAllByText('a@example.com')[0]!
      .closest('tr, li') as HTMLElement
    expect(
      within(normalRow).getByRole('button', { name: 'Block' }),
    ).toBeInTheDocument()
  })

  it('searches invited emails: part of one shows that row and hides the rest', () => {
    renderWithUsers([buildUser({ id: 'user_a', email: 'a@example.com' })], {
      initialInvites: [INVITE],
    })

    fireEvent.change(screen.getByLabelText('Search people'), {
      target: { value: 'ERLY' },
    })

    expect(screen.getAllByText('erlyne@example.com')).toHaveLength(2)
    expect(screen.queryByText('a@example.com')).toBeNull()
    expect(screen.queryByText(/No one matches/)).toBeNull()
  })

  it('shows the existing empty state when a term matches nobody, invites included', () => {
    renderWithUsers([buildUser({ id: 'user_a', email: 'a@example.com' })], {
      initialInvites: [INVITE],
    })

    fireEvent.change(screen.getByLabelText('Search people'), {
      target: { value: 'zed' },
    })

    expect(screen.getByText('No one matches “zed”')).toBeInTheDocument()
    expect(screen.queryByText('erlyne@example.com')).toBeNull()
  })

  it('counts invites in the People tile and the section count, but not in Granted', () => {
    renderWithUsers(
      [
        buildUser({
          id: 'user_a',
          email: 'a@example.com',
          services: ['swole.lilnas.io'],
        }),
        buildUser({ id: 'user_b', email: 'b@example.com' }),
      ],
      {
        initialInvites: [INVITE, buildInvite({ email: 'tomas@example.com' })],
      },
    )

    expect(tileValue('People')).toBe('4')
    expect(tileValue('Granted')).toBe('1')
    expect(peopleCount()).toContain('4')
  })

  it('sorts users and invites together by email', () => {
    renderWithUsers(
      [
        buildUser({ id: 'user_b', email: 'b@example.com' }),
        buildUser({ id: 'user_d', email: 'd@example.com' }),
      ],
      {
        initialInvites: [
          buildInvite({ email: 'c@example.com' }),
          buildInvite({ email: 'a@example.com' }),
        ],
      },
    )

    const [peopleTable] = screen.getAllByRole('table', { hidden: true }) as [
      HTMLElement,
    ]
    const emails = within(peopleTable)
      .getAllByRole('row', { hidden: true })
      .slice(1)
      .map(row => /[a-z]@example\.com/.exec(row.textContent ?? '')![0])
    expect(emails).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
    ])
  })

  it('renders a user and an invite with the same email without a React key warning', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      renderWithUsers(
        [buildUser({ id: 'user_a', email: 'same@example.com' })],
        { initialInvites: [buildInvite({ email: 'same@example.com' })] },
      )

      // One row and one card for the user, one of each for the invite.
      expect(screen.getAllByText('same@example.com')).toHaveLength(4)
      const keyWarnings = errorSpy.mock.calls.filter(call =>
        String(call[0]).includes('same key'),
      )
      expect(keyWarnings).toEqual([])
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('AdminDashboardClient — editing and cancelling an invite', () => {
  const EMAIL = 'erlyne@example.com'
  const SWOLE = 'swole.lilnas.io'
  const TDR = 'tdr.lilnas.io'
  const INVITE = buildInvite({
    email: EMAIL,
    serviceHosts: [SWOLE],
    createdAt: '2026-11-23T12:00:00.000Z',
  })
  const SIGNED_IN = `${EMAIL} has signed in. Edit their access from their row.`

  function openInvite(
    invite: AdminInviteEntry = INVITE,
    invites: AdminInviteEntry[] = [invite],
  ): HTMLElement {
    renderWithUsers([], { initialInvites: invites, services: TWO_SERVICES })
    fireEvent.click(editAccessButtonFor(invite.email))
    return screen.getByRole('dialog', { name: /^edit access$/i })
  }

  function save(modal: HTMLElement) {
    fireEvent.click(within(modal).getByRole('button', { name: /save access/i }))
  }

  beforeEach(() => {
    mockPreAuthorizeUsers.mockResolvedValue({ ok: true, outcome: 'invited' })
    mockRemoveInvites.mockImplementation((_email: string, hosts: string[]) =>
      Promise.resolve({ ok: true, removed: hosts }),
    )
  })

  it('opens from the invited row with the pending services checked and none of the account controls', () => {
    const modal = openInvite()

    expect(within(modal).getByText(EMAIL)).toBeInTheDocument()
    expect(within(modal).getByText(/hasn’t signed in yet/)).toBeInTheDocument()
    expect(
      within(modal).getByRole('checkbox', { name: /swole/i }),
    ).toBeChecked()
    expect(
      within(modal).getByRole('checkbox', { name: /tdr/i }),
    ).not.toBeChecked()
    expect(within(modal).queryByText('Discord')).toBeNull()
    expect(within(modal).queryByText(/sign out everywhere/i)).toBeNull()
    expect(within(modal).queryByText(/remove access/i)).toBeNull()
    expect(
      within(modal).getByRole('button', { name: 'Cancel invite' }),
    ).toBeInTheDocument()
  })

  it('checking one more service and saving sends only that add', async () => {
    const modal = openInvite()

    fireEvent.click(within(modal).getByRole('checkbox', { name: /tdr/i }))
    save(modal)

    await waitFor(() => {
      expect(mockPreAuthorizeUsers).toHaveBeenCalledWith(EMAIL, [TDR])
    })
    expect(mockPreAuthorizeUsers).toHaveBeenCalledTimes(1)
    expect(mockRemoveInvites).not.toHaveBeenCalled()
    expect(await screen.findByText('Invite updated')).toBeInTheDocument()
  })

  it('unchecking one and saving sends only that removal', async () => {
    const modal = openInvite(
      buildInvite({ email: EMAIL, serviceHosts: [SWOLE, TDR] }),
    )

    fireEvent.click(within(modal).getByRole('checkbox', { name: /tdr/i }))
    save(modal)

    await waitFor(() => {
      expect(mockRemoveInvites).toHaveBeenCalledWith(EMAIL, [TDR])
    })
    expect(mockRemoveInvites).toHaveBeenCalledTimes(1)
    expect(mockPreAuthorizeUsers).not.toHaveBeenCalled()
    expect(await screen.findByText('Invite updated')).toBeInTheDocument()
  })

  it('one add and one removal in the same save make exactly one call to each, with only the differences', async () => {
    const modal = openInvite()

    fireEvent.click(within(modal).getByRole('checkbox', { name: /tdr/i }))
    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    save(modal)

    await waitFor(() => {
      expect(mockRemoveInvites).toHaveBeenCalledWith(EMAIL, [SWOLE])
    })
    expect(mockPreAuthorizeUsers).toHaveBeenCalledTimes(1)
    expect(mockPreAuthorizeUsers).toHaveBeenCalledWith(EMAIL, [TDR])
    expect(mockRemoveInvites).toHaveBeenCalledTimes(1)
  })

  it('saving untouched calls neither action', async () => {
    const modal = openInvite()

    save(modal)

    expect(await screen.findByText('Invite updated')).toBeInTheDocument()
    expect(mockPreAuthorizeUsers).not.toHaveBeenCalled()
    expect(mockRemoveInvites).not.toHaveBeenCalled()
  })

  it('sends a rule added in the dialog through preAuthorizeUsers', async () => {
    const modal = openInvite()

    fireEvent.change(within(modal).getByLabelText('Access rules'), {
      target: { value: '*.preview.lilnas.io' },
    })
    fireEvent.click(within(modal).getByRole('button', { name: 'Add rule' }))
    save(modal)

    await waitFor(() => {
      expect(mockPreAuthorizeUsers).toHaveBeenCalledWith(EMAIL, [
        '*.preview.lilnas.io',
      ])
    })
    expect(mockRemoveInvites).not.toHaveBeenCalled()
  })

  it('sends a held rule removed in the dialog through removeInvites', async () => {
    const modal = openInvite(
      buildInvite({ email: EMAIL, serviceHosts: [SWOLE, '*.dev.lilnas.io'] }),
    )

    fireEvent.click(
      within(modal).getByRole('button', {
        name: 'Remove rule *.dev.lilnas.io',
      }),
    )
    save(modal)

    await waitFor(() => {
      expect(mockRemoveInvites).toHaveBeenCalledWith(EMAIL, ['*.dev.lilnas.io'])
    })
    expect(mockPreAuthorizeUsers).not.toHaveBeenCalled()
  })

  it('renders a pending host that left the registry, checked, and a registry host the invite lacks, unchecked', async () => {
    const modal = openInvite(
      buildInvite({ email: EMAIL, serviceHosts: ['old.lilnas.io'] }),
    )

    const old = within(modal).getByRole('checkbox', {
      name: /old\.lilnas\.io/i,
    })
    expect(old).toBeChecked()
    expect(
      within(modal).getByRole('checkbox', { name: /swole/i }),
    ).not.toBeChecked()

    fireEvent.click(old)
    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    save(modal)

    await waitFor(() => {
      expect(mockRemoveInvites).toHaveBeenCalledWith(EMAIL, ['old.lilnas.io'])
    })
    expect(mockPreAuthorizeUsers).toHaveBeenCalledWith(EMAIL, [SWOLE])
  })

  it('opening another invited person after editing the first shows the second one’s own services', () => {
    const second = buildInvite({
      email: 'tomas@example.com',
      serviceHosts: [TDR],
    })
    const modal = openInvite(INVITE, [INVITE, second])

    fireEvent.click(within(modal).getByRole('checkbox', { name: /tdr/i }))
    fireEvent.click(within(modal).getByRole('button', { name: /^cancel$/i }))

    fireEvent.click(editAccessButtonFor('tomas@example.com'))
    const next = screen.getByRole('dialog', { name: /^edit access$/i })
    expect(within(next).getByText('tomas@example.com')).toBeInTheDocument()
    expect(within(next).getByRole('checkbox', { name: /tdr/i })).toBeChecked()
    expect(
      within(next).getByRole('checkbox', { name: /swole/i }),
    ).not.toBeChecked()
  })

  it('unchecking everything and saving opens the confirm and sends nothing until confirmed', async () => {
    const modal = openInvite()

    fireEvent.click(within(modal).getByRole('checkbox', { name: /swole/i }))
    save(modal)

    const confirm = await findConfirm(`Cancel ${EMAIL}’s invite?`)
    expect(mockRemoveInvites).not.toHaveBeenCalled()
    expect(mockPreAuthorizeUsers).not.toHaveBeenCalled()

    fireEvent.click(confirmButton(confirm, 'Cancel invite'))
    await waitFor(() => {
      expect(mockRemoveInvites).toHaveBeenCalledWith(EMAIL, [SWOLE])
    })
    expect(await screen.findByText('Invite cancelled')).toBeInTheDocument()
  })

  it('"Cancel invite" confirms first, naming the person; confirming removes every pending host and toasts', async () => {
    const modal = openInvite(
      buildInvite({ email: EMAIL, serviceHosts: [SWOLE, TDR] }),
    )

    fireEvent.click(
      within(modal).getByRole('button', { name: 'Cancel invite' }),
    )

    const confirm = await findConfirm(`Cancel ${EMAIL}’s invite?`)
    expect(
      within(confirm).getByText(
        'They won’t get these 2 services when they sign in. You can add them again any time.',
      ),
    ).toBeInTheDocument()
    expect(mockRemoveInvites).not.toHaveBeenCalled()

    fireEvent.click(confirmButton(confirm, 'Cancel invite'))
    await waitFor(() => {
      expect(mockRemoveInvites).toHaveBeenCalledWith(EMAIL, [SWOLE, TDR])
    })
    expect(await screen.findByText('Invite cancelled')).toBeInTheDocument()
    await waitFor(() => {
      expect(openDialogs()).toHaveLength(0)
    })
  })

  it('says "this service" for a single pending service', async () => {
    const modal = openInvite()

    fireEvent.click(
      within(modal).getByRole('button', { name: 'Cancel invite' }),
    )

    const confirm = await findConfirm(`Cancel ${EMAIL}’s invite?`)
    expect(
      within(confirm).getByText(
        'They won’t get this service when they sign in. You can add them again any time.',
      ),
    ).toBeInTheDocument()
  })

  it('"Keep invite" calls nothing and leaves the dialog open', async () => {
    const modal = openInvite()

    fireEvent.click(
      within(modal).getByRole('button', { name: 'Cancel invite' }),
    )
    const confirm = await findConfirm(`Cancel ${EMAIL}’s invite?`)
    fireEvent.click(confirmButton(confirm, 'Keep invite'))

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: `Cancel ${EMAIL}’s invite?` }),
      ).toBeNull()
    })
    expect(mockRemoveInvites).not.toHaveBeenCalled()
    expect(
      screen.getByRole('dialog', { name: /^edit access$/i }),
    ).toBeInTheDocument()
  })

  it('toasts the signed-in warning when cancelling removes nothing', async () => {
    mockRemoveInvites.mockResolvedValue({ ok: true, removed: [] })
    const modal = openInvite()

    fireEvent.click(
      within(modal).getByRole('button', { name: 'Cancel invite' }),
    )
    const confirm = await findConfirm(`Cancel ${EMAIL}’s invite?`)
    fireEvent.click(confirmButton(confirm, 'Cancel invite'))

    expect(await screen.findByText(SIGNED_IN)).toBeInTheDocument()
    expect(screen.queryByText('Invite cancelled')).toBeNull()
  })

  it('toasts the signed-in warning when a save removes fewer hosts than it sent', async () => {
    mockRemoveInvites.mockResolvedValue({ ok: true, removed: [] })
    const modal = openInvite(
      buildInvite({ email: EMAIL, serviceHosts: [SWOLE, TDR] }),
    )

    fireEvent.click(within(modal).getByRole('checkbox', { name: /tdr/i }))
    save(modal)

    expect(await screen.findByText(SIGNED_IN)).toBeInTheDocument()
    expect(screen.queryByText('Invite updated')).toBeNull()
    await waitFor(() => {
      expect(openDialogs()).toHaveLength(0)
    })
  })

  it('toasts the signed-in warning when the add reports the email already had an account', async () => {
    mockPreAuthorizeUsers.mockResolvedValue({ ok: true, outcome: 'granted' })
    const modal = openInvite()

    fireEvent.click(within(modal).getByRole('checkbox', { name: /tdr/i }))
    save(modal)

    expect(await screen.findByText(SIGNED_IN)).toBeInTheDocument()
    expect(screen.queryByText('Invite updated')).toBeNull()
    await waitFor(() => {
      expect(openDialogs()).toHaveLength(0)
    })
  })

  it('shows a rejected save’s message in the dialog and keeps it open', async () => {
    mockPreAuthorizeUsers.mockRejectedValue(new Error('Backend said no'))
    const modal = openInvite()

    fireEvent.click(within(modal).getByRole('checkbox', { name: /tdr/i }))
    save(modal)

    expect(await within(modal).findByRole('alert')).toHaveTextContent(
      'Backend said no',
    )
    expect(
      screen.getByRole('dialog', { name: /^edit access$/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Invite updated')).toBeNull()
  })
})

describe('AdminDashboardClient — stat tiles, requests and errors', () => {
  const REQUEST = {
    id: 7,
    userId: 'user_req',
    email: 'req@example.com',
    serviceHost: 'swole.lilnas.io',
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    priorDecisions: 1,
  }

  it('flags the Pending tile as warn only while something is pending', () => {
    const { unmount } = renderWithUsers([], { initialQueue: [REQUEST] })
    expect(screen.getByText('Pending').closest('[data-flagged]')).not.toBeNull()
    unmount()

    renderWithUsers([])
    expect(screen.getByText('Pending').closest('[data-flagged]')).toBeNull()
  })

  it('Approve and Decline call the request actions; Decline reads as outline, Approve as accent', async () => {
    mockApproveRequest.mockResolvedValue(undefined)
    mockRejectRequest.mockResolvedValue({ decided: true })
    renderWithUsers([], { initialQueue: [REQUEST] })

    const approve = screen.getByRole('button', { name: 'Approve' })
    const decline = screen.getByRole('button', { name: 'Decline' })
    expect(approve).toHaveClass('bg-accent')
    expect(decline).toHaveClass('bg-surface-2')

    fireEvent.click(approve)
    await waitFor(() => expect(mockApproveRequest).toHaveBeenCalledWith(7))
    // Both buttons are `disabled` while Approve's transition is pending, and a
    // click on a disabled button is dropped — wait for it to settle first.
    await waitFor(() => expect(decline).toBeEnabled())
    fireEvent.click(decline)
    await waitFor(() => expect(mockRejectRequest).toHaveBeenCalledWith(7))
  })

  it('ticking a request offers Dismiss selected, which declines the batch', async () => {
    mockBulkRejectRequests.mockResolvedValue({ decided: [7] })
    renderWithUsers([], { initialQueue: [REQUEST] })

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select request from req@example.com',
      }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss selected (1)' }),
    )
    await waitFor(() =>
      expect(mockBulkRejectRequests).toHaveBeenCalledWith([7]),
    )
  })

  it('shows a failed action as a dismissible bad Note', async () => {
    mockBlockUser.mockRejectedValue(
      new Error('The auth service didn’t answer.'),
    )
    renderWithUsers([buildUser({ id: 'user_a', email: 'a@example.com' })])

    fireEvent.click(screen.getAllByRole('button', { name: /^block$/i })[0]!)
    const confirm = await findConfirm('Block a@example.com?')
    fireEvent.click(confirmButton(confirm, 'Block'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The auth service didn’t answer.')

    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('AdminDashboardClient — live updates', () => {
  function renderDashboard() {
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[]}
        initialInvites={[]}
        services={SERVICES}
        discordUnlinked={NO_DISCORD}
        discordLinks={[]}
      />,
    )
    const source = FakeEventSource.instances[0]
    if (!source)
      throw new Error('expected the dashboard to open an EventSource')
    return source
  }

  it('does not refresh on the first SSE open — the page just rendered these props', () => {
    const source = renderDashboard()

    act(() => source.emit('open'))

    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('refreshes on a later open (a reconnect may have missed events)', () => {
    const source = renderDashboard()

    act(() => source.emit('open'))
    act(() => source.emit('open'))

    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes on every admin-changed event', () => {
    const source = renderDashboard()

    act(() => source.emit('open'))
    act(() => source.emit('admin-changed'))
    act(() => source.emit('admin-changed'))

    expect(mockRefresh).toHaveBeenCalledTimes(2)
  })
})
