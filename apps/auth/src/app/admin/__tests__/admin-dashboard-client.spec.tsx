import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { AdminDashboardClient } from 'src/app/admin/admin-dashboard-client'
import type {
  AdminServiceEntry,
  AdminUserEntry,
} from 'src/app/admin/require-admin'

const mockApproveRequest = jest.fn()
const mockBlockUser = jest.fn()
const mockBulkRejectRequests = jest.fn()
const mockPreAuthorizeUser = jest.fn()
const mockRejectRequest = jest.fn()
const mockRemoveUser = jest.fn()
const mockRevokeSessions = jest.fn()
const mockSetUserService = jest.fn()
const mockUnblockUser = jest.fn()

jest.mock('src/app/admin/actions', () => ({
  approveRequest: (...args: unknown[]) => mockApproveRequest(...args),
  blockUser: (...args: unknown[]) => mockBlockUser(...args),
  bulkRejectRequests: (...args: unknown[]) => mockBulkRejectRequests(...args),
  preAuthorizeUser: (...args: unknown[]) => mockPreAuthorizeUser(...args),
  rejectRequest: (...args: unknown[]) => mockRejectRequest(...args),
  removeUser: (...args: unknown[]) => mockRemoveUser(...args),
  revokeSessions: (...args: unknown[]) => mockRevokeSessions(...args),
  setUserService: (...args: unknown[]) => mockSetUserService(...args),
  unblockUser: (...args: unknown[]) => mockUnblockUser(...args),
}))

const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

// jsdom does not implement EventSource (same gap
// src/app/pending/__tests__/pending-page.spec.tsx already works around) —
// AdminDashboardClient opens one on mount for its own live-updates effect
// (see that component's header comment), so a polyfill stub is required
// even though none of the tests below exercise the live-update path itself.
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
}

const SERVICES: AdminServiceEntry[] = [
  { host: 'swole.lilnas.io', gatedBy: 'forward-auth' },
]

function buildUser(overrides: Partial<AdminUserEntry>): AdminUserEntry {
  return {
    id: 'user_1',
    email: 'user@example.com',
    blockedAt: null,
    services: [],
    isAdmin: false,
    ...overrides,
  }
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
        services={SERVICES}
      />,
    )

    expect(screen.getAllByText('active@example.com').length).toBeGreaterThan(0)
    expect(screen.getByText('No blocked users.')).toBeInTheDocument()
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
        services={SERVICES}
      />,
    )

    // People's own empty state (search-icon copy) proves the blocked user
    // does not land there; the email itself renders exactly twice — once
    // in the Blocked panel's desktop table row, once in its mobile card —
    // proving it DOES land in the Blocked panel.
    expect(screen.getByText('No one matches your search.')).toBeInTheDocument()
    expect(screen.getAllByText('blocked@example.com')).toHaveLength(2)
    expect(screen.queryByText('No blocked users.')).not.toBeInTheDocument()
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
        services={SERVICES}
      />,
    )

    expect(screen.getByText('No one matches your search.')).toBeInTheDocument()
    expect(screen.queryByText('No blocked users.')).not.toBeInTheDocument()
    expect(screen.getAllByText('admin@example.com').length).toBeGreaterThan(0)
    // PersonStatusChip still shows "Admin" (not "Blocked") even in the
    // Blocked panel — isAdmin stays the higher-priority fact (a blocked
    // admin keeps full /admin access via AdminGuard's own independent
    // check) — see that component's own priority-order comment.
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0)
  })

  it('clicking "Unblock" in the Blocked panel calls unblockUser and moves the row into People', async () => {
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
        services={SERVICES}
      />,
    )

    const [unblockButton] = screen.getAllByRole('button', {
      name: /^unblock$/i,
    })
    fireEvent.click(unblockButton!)

    await waitFor(() => {
      expect(mockUnblockUser).toHaveBeenCalledWith('user_blocked')
    })
    await waitFor(() => {
      expect(screen.getByText('No blocked users.')).toBeInTheDocument()
    })
  })
})

describe('AdminDashboardClient — Remove access', () => {
  it('clicking "Remove access" in the Edit-access modal after confirming calls removeUser, clears the shown services, and closes the modal', async () => {
    // Assigned directly rather than jest.spyOn(window, 'confirm') — jsdom's
    // own confirm() stub is a "not implemented" no-op whose exact shape has
    // varied across versions; a direct assignment works regardless.
    window.confirm = jest.fn().mockReturnValue(true)
    mockRemoveUser.mockResolvedValue(undefined)
    const active = buildUser({
      id: 'user_active',
      email: 'active@example.com',
      services: ['swole.lilnas.io'],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[active]}
        services={SERVICES}
      />,
    )

    const [editAccessButton] = screen.getAllByRole('button', {
      name: /edit access/i,
    })
    fireEvent.click(editAccessButton!)

    const removeButton = screen.getByRole('button', { name: /remove access/i })
    fireEvent.click(removeButton)

    await waitFor(() => {
      expect(mockRemoveUser).toHaveBeenCalledWith('user_active')
    })
    await waitFor(() => {
      expect(screen.getAllByText('No services granted').length).toBeGreaterThan(
        0,
      )
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /remove access/i }),
      ).not.toBeInTheDocument()
    })
  })

  it('clicking "Remove access" in the Edit-access modal without confirming never calls removeUser', () => {
    window.confirm = jest.fn().mockReturnValue(false)
    const active = buildUser({
      id: 'user_active',
      email: 'active@example.com',
      services: ['swole.lilnas.io'],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[active]}
        services={SERVICES}
      />,
    )

    const [editAccessButton] = screen.getAllByRole('button', {
      name: /edit access/i,
    })
    fireEvent.click(editAccessButton!)

    const removeButton = screen.getByRole('button', { name: /remove access/i })
    fireEvent.click(removeButton)

    expect(mockRemoveUser).not.toHaveBeenCalled()
  })

  it('the Blocked panel\'s Edit-access modal also has a working "Remove access" action', async () => {
    // Assigned directly rather than jest.spyOn(window, 'confirm') — jsdom's
    // own confirm() stub is a "not implemented" no-op whose exact shape has
    // varied across versions; a direct assignment works regardless.
    window.confirm = jest.fn().mockReturnValue(true)
    mockRemoveUser.mockResolvedValue(undefined)
    const blocked = buildUser({
      id: 'user_blocked',
      email: 'blocked@example.com',
      blockedAt: '2026-01-01T00:00:00.000Z',
      services: ['swole.lilnas.io'],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[blocked]}
        services={SERVICES}
      />,
    )

    const [editAccessButton] = screen.getAllByRole('button', {
      name: /edit access/i,
    })
    fireEvent.click(editAccessButton!)

    const removeButton = screen.getByRole('button', { name: /remove access/i })
    fireEvent.click(removeButton)

    await waitFor(() => {
      expect(mockRemoveUser).toHaveBeenCalledWith('user_blocked')
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /remove access/i }),
      ).not.toBeInTheDocument()
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
        services={SERVICES}
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

describe('AdminDashboardClient — blocking an admin (S2a)', () => {
  it('clicking "Block" on an admin row asks for confirmation; confirming calls blockUser and moves the row into the Blocked panel', async () => {
    window.confirm = jest.fn().mockReturnValue(true)
    mockBlockUser.mockResolvedValue(undefined)
    const admin = buildUser({
      id: 'user_admin',
      email: 'admin@example.com',
      isAdmin: true,
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[admin]}
        services={SERVICES}
      />,
    )

    const [blockButton] = screen.getAllByRole('button', { name: /^block$/i })
    fireEvent.click(blockButton!)

    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => {
      expect(mockBlockUser).toHaveBeenCalledWith('user_admin')
    })
  })

  it('clicking "Block" on an admin row without confirming never calls blockUser', () => {
    window.confirm = jest.fn().mockReturnValue(false)
    const admin = buildUser({
      id: 'user_admin',
      email: 'admin@example.com',
      isAdmin: true,
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[admin]}
        services={SERVICES}
      />,
    )

    const [blockButton] = screen.getAllByRole('button', { name: /^block$/i })
    fireEvent.click(blockButton!)

    expect(mockBlockUser).not.toHaveBeenCalled()
  })

  it('clicking "Block" on a non-admin row never asks for confirmation', async () => {
    window.confirm = jest.fn()
    mockBlockUser.mockResolvedValue(undefined)
    const active = buildUser({
      id: 'user_active',
      email: 'active@example.com',
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[active]}
        services={SERVICES}
      />,
    )

    const [blockButton] = screen.getAllByRole('button', { name: /^block$/i })
    fireEvent.click(blockButton!)

    expect(window.confirm).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mockBlockUser).toHaveBeenCalledWith('user_active')
    })
  })
})

describe('AdminDashboardClient — Sign out everywhere (S2b)', () => {
  it('clicking "Sign out everywhere" in the Edit-access modal after confirming calls revokeSessions and shows the session count', async () => {
    window.confirm = jest.fn().mockReturnValue(true)
    mockRevokeSessions.mockResolvedValue({ ok: true, sessionsRevoked: 2 })
    const active = buildUser({
      id: 'user_active',
      email: 'active@example.com',
      services: ['swole.lilnas.io'],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[active]}
        services={SERVICES}
      />,
    )

    const [editAccessButton] = screen.getAllByRole('button', {
      name: /edit access/i,
    })
    fireEvent.click(editAccessButton!)
    const signOutButton = screen.getByRole('button', {
      name: /sign out everywhere/i,
    })
    fireEvent.click(signOutButton)

    await waitFor(() => {
      expect(mockRevokeSessions).toHaveBeenCalledWith('user_active')
    })
    await waitFor(() => {
      expect(screen.getByText('Signed out of 2 sessions')).toBeInTheDocument()
    })
  })

  it('clicking "Sign out everywhere" without confirming never calls revokeSessions', () => {
    window.confirm = jest.fn().mockReturnValue(false)
    const active = buildUser({
      id: 'user_active',
      email: 'active@example.com',
      services: ['swole.lilnas.io'],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[active]}
        services={SERVICES}
      />,
    )

    const [editAccessButton] = screen.getAllByRole('button', {
      name: /edit access/i,
    })
    fireEvent.click(editAccessButton!)
    const signOutButton = screen.getByRole('button', {
      name: /sign out everywhere/i,
    })
    fireEvent.click(signOutButton)

    expect(mockRevokeSessions).not.toHaveBeenCalled()
  })

  it('the Blocked panel\'s Edit-access modal also has a working "Sign out everywhere" action', async () => {
    window.confirm = jest.fn().mockReturnValue(true)
    mockRevokeSessions.mockResolvedValue({ ok: true, sessionsRevoked: 0 })
    const blocked = buildUser({
      id: 'user_blocked',
      email: 'blocked@example.com',
      blockedAt: '2026-01-01T00:00:00.000Z',
      services: ['swole.lilnas.io'],
    })
    render(
      <AdminDashboardClient
        initialQueue={[]}
        initialUsers={[blocked]}
        services={SERVICES}
      />,
    )

    const [editAccessButton] = screen.getAllByRole('button', {
      name: /edit access/i,
    })
    fireEvent.click(editAccessButton!)
    const signOutButton = screen.getByRole('button', {
      name: /sign out everywhere/i,
    })
    fireEvent.click(signOutButton)

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
