'use client'

import { cns } from '@lilnas/utils/cns'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'

import {
  approveRequest,
  blockUser,
  bulkRejectRequests,
  preAuthorizeUser,
  rejectRequest,
  removeUser,
  revokeSessions,
  setUserService,
  unblockUser,
} from 'src/app/admin/actions'
import type {
  AdminQueueEntry,
  AdminServiceEntry,
  AdminUserEntry,
} from 'src/app/admin/require-admin'
import { Brandmark } from 'src/app/components/brandmark'
import { Icon } from 'src/app/components/icons'
import { Toast, useToast } from 'src/app/components/toast'
import { getInitials } from 'src/app/lib/initials'
import { timeAgo } from 'src/app/lib/time-ago'
import { getServiceMeta } from 'src/app/service-meta'

export type AdminDashboardClientProps = {
  initialQueue: AdminQueueEntry[]
  initialUsers: AdminUserEntry[]
  services: AdminServiceEntry[]
}

// The union of the registry's current hosts and a given user's own current
// grants — not the registry alone — so a grant for a host that has since
// left the registry (e.g. this app's own cutover, which renamed
// login.lilnas.io to auth.lilnas.io) still shows up, checked, with a
// checkbox available to uncheck it. Ported from the pre-merge
// users-client.tsx's identical helper; see that file's own history for the
// "why."
function visibleServiceHosts(
  userServices: string[],
  services: AdminServiceEntry[],
): string[] {
  return [...new Set([...services.map(s => s.host), ...userServices])].sort(
    (a, b) => a.localeCompare(b),
  )
}

function ServiceChips({ hosts }: { hosts: string[] }) {
  if (hosts.length === 0) {
    return <span className="caption">No services granted</span>
  }
  const visible = hosts.slice(0, 4)
  const remaining = hosts.length - visible.length
  return (
    <div className="service-chip-list">
      {visible.map(host => (
        <span key={host} className="chip chip-neutral">
          {getServiceMeta(host).name}
        </span>
      ))}
      {remaining > 0 ? (
        <span className="chip chip-neutral">+{remaining}</span>
      ) : null}
    </div>
  )
}

function PersonStatusChip({ user }: { user: AdminUserEntry }) {
  // Priority: Admin > Blocked > Granted > No access. Used in BOTH the
  // People and Blocked panels — Admin still takes priority over the
  // Blocked branch below even though S2a made blocking an admin a real
  // /verify-level action: a blocked admin keeps full, unrestricted /admin
  // access via AdminGuard's own independent check (see verify.service.ts's
  // header comment), which is the more decision-relevant fact for an
  // operator scanning this list. The Blocked branch is what a non-admin
  // blocked row falls into instead — restored so the Blocked panel can
  // distinguish "still has admin access" from "has no access anywhere,"
  // a distinction that didn't exist before S2a, when a blocked admin could
  // never reach the Blocked panel at all.
  if (user.isAdmin) {
    return (
      <span className="chip chip-admin">
        <Icon name="shield" />
        <span>Admin</span>
      </span>
    )
  }
  if (user.blockedAt) {
    return (
      <span className="chip chip-revoked">
        <Icon name="x" />
        <span>Blocked</span>
      </span>
    )
  }
  if (user.services.length > 0) {
    return (
      <span className="chip chip-granted">
        <Icon name="check" />
        <span>Granted</span>
      </span>
    )
  }
  // Deliberately not labeled "Pending" — this list has no relationship to
  // an active queue row (a person can have "no access" simply because they
  // were pre-authorized for a service and haven't signed in yet, or were
  // fully un-authorized, not because they're waiting in the queue below).
  return (
    <span className="chip chip-revoked">
      <Icon name="x" />
      <span>No access</span>
    </span>
  )
}

function ServiceCheckGrid({
  hosts,
  selected,
  onToggle,
  disabled,
}: {
  hosts: string[]
  selected: Set<string>
  onToggle: (host: string, checked: boolean) => void
  disabled: boolean
}) {
  if (hosts.length === 0) {
    return <p className="caption">No services discovered yet.</p>
  }
  return (
    <div className="service-check-grid">
      {hosts.map(host => {
        const meta = getServiceMeta(host)
        return (
          <label key={host} className="checkbox-row">
            <input
              type="checkbox"
              checked={selected.has(host)}
              onChange={event => onToggle(host, event.target.checked)}
              disabled={disabled}
            />
            <span className="service-tile__icon h-[26px] w-[26px]">
              <Icon name={meta.icon} />
            </span>
            <span className="small font-medium">{meta.name}</span>
          </label>
        )
      })}
    </div>
  )
}

function toggleInSet<T>(set: Set<T>, value: T, present: boolean): Set<T> {
  const next = new Set(set)
  if (present) {
    next.add(value)
  } else {
    next.delete(value)
  }
  return next
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ──────────────────────────────────────────────────────────────────────────────
// The merged admin dashboard — replaces the pre-redesign /admin,
// /admin/queue, and /admin/users pages with one screen (stat tiles,
// pending requests, and people), matching the design mockups' own
// single-page layout. The services/gated-by table the mockups also have
// was deliberately dropped — it duplicated the "Gated services" stat tile
// above with no admin action attached, and `services` itself stays a
// required prop purely as the source list for the Add-person/Edit-access
// modals' checkbox grids. Every mutation still goes through the EXISTING
// Server Actions in actions.ts, unchanged — this file only reorganizes how
// they're presented and composed:
//
//   - Approve/Reject act on exactly the one requested service (unchanged
//     approveRequest()/rejectRequest() behavior) — there is no
//     "choose additional services while approving" picker. Granting more
//     happens afterward via Edit access.
//   - The bulk-dismiss checkbox + "Dismiss selected" button on request
//     cards is a deliberate ADDITION beyond the mockups (which have no
//     bulk affordance at all) — preserving a feature the pre-merge
//     queue-client.tsx already had.
//   - The Edit-access modal diffs against its own OPENING snapshot and
//     calls setUserService() only for boxes that actually changed — never
//     a full-set resubmit. This is load-bearing: users.service.ts's own
//     header comment documents the real bug (a stale snapshot silently
//     revoking an unrelated, just-granted service) that setUserService()'s
//     single-host design replaced; this modal must not reintroduce it by
//     resubmitting every checkbox regardless of whether it changed.
//
//   - Live updates (below): the WHOLE dashboard reacts to a single
//     broadcast SSE topic (src/sse/notify-bus.service.ts's ADMIN_TOPIC) —
//     every mutation listed above, from ANY admin's tab, and a brand-new
//     incoming request, all publish to it. This component's own reaction
//     is uniform regardless of which mutation fired: router.refresh(),
//     which re-runs page.tsx's Server Component and re-fetches
//     queue/users/services via the existing requireAdminQueue()/
//     fetchAdminUsers()/fetchAdminServices() calls — never a bespoke
//     per-mutation Server Action. See the SSE effect below for the
//     reconnect-backoff/poll-floor mechanics, ported verbatim from
//     src/app/pending/pending-client.tsx.
//   - People/Blocked split: `users` is partitioned into `activeUsers` and
//     `blockedUsers` (below) on `blockedAt` ALONE — a blocked person, admin
//     or not, renders in their own "Blocked" panel, never in People. S2a
//     (verify.service.ts) made blocking an admin a real action instead of a
//     no-op: it now revokes their /verify access to every gated service,
//     while AdminGuard's own, deliberately independent check leaves their
//     /admin access untouched (see that file's own header comment for the
//     no-lockout rationale) — so a blocked admin still shows up here able
//     to unblock themselves. PersonStatusChip's restored "Blocked" branch
//     is what makes that admin-vs-ordinary-user distinction visible in this
//     panel, rather than every blocked row looking the same. "Remove
//     access" (handleRemove, calling the already-existing but previously-
//     unwired removeUser() Server Action) lives in the Edit-access modal's
//     footer rather than as a row action — reachable from either panel via
//     that modal's "Edit access" entry point.
// ──────────────────────────────────────────────────────────────────────────────

// Same rationale and same values as pending-client.tsx's own constants —
// see that file's header comment for the full "why" (EventSource's
// no-auto-reconnect-on-terminal-failure behavior, and the low-frequency
// poll floor that makes this eventually-correct independent of SSE health).
const RECONNECT_BACKOFF_MS = 5000
const POLL_FLOOR_MS = 30_000

export function AdminDashboardClient({
  initialQueue,
  initialUsers,
  services,
}: AdminDashboardClientProps) {
  const router = useRouter()
  const [queue, setQueue] = useState(initialQueue)
  const [users, setUsers] = useState(initialUsers)
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<number>>(
    new Set(),
  )
  const [searchTerm, setSearchTerm] = useState('')
  const [isPending, startTransition] = useTransition()
  const [actionError, setActionError] = useState<string | null>(null)
  const { message, showToast } = useToast()

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addEmailHasError, setAddEmailHasError] = useState(false)
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set())
  const [addModalError, setAddModalError] = useState<string | null>(null)

  const [accessModalUser, setAccessModalUser] = useState<AdminUserEntry | null>(
    null,
  )
  const [accessSelected, setAccessSelected] = useState<Set<string>>(new Set())
  const [accessModalError, setAccessModalError] = useState<string | null>(null)
  const accessSnapshotRef = useRef<Set<string>>(new Set())

  // A write-only trigger, bumped only by the SSE effect's own 'error'
  // handler below — see pending-client.tsx's identical `epoch` for the
  // full rationale (forces the effect to tear down a terminally-dead
  // EventSource and open a fresh one after a backoff).
  const [sseEpoch, setSseEpoch] = useState(0)

  // useState(initialQueue)/useState(initialUsers) above only consume their
  // initial value on MOUNT — without these, a router.refresh()-driven prop
  // change (see the SSE effect below) would re-run page.tsx's Server
  // Component but never reach this component's own visible state. Local,
  // ephemeral UI state (search term, modals, selection) is untouched by
  // this — only the server-sourced lists resync.
  useEffect(() => {
    setQueue(initialQueue)
  }, [initialQueue])

  useEffect(() => {
    setUsers(initialUsers)
  }, [initialUsers])

  // Live dashboard updates — see this component's own header comment above
  // for what publishes to this one broadcast topic and why router.refresh()
  // is the uniform reaction. Ported verbatim from pending-client.tsx's own
  // SSE effect (same constants, same terminal-vs-transient `error` handling
  // via the `sseEpoch` bump above) — see that file's header comment for the
  // full "why" behind each piece; the only difference is WHAT each event
  // triggers (router.refresh() here vs. a status recheck there).
  useEffect(() => {
    let cancelled = false
    const refresh = () => router.refresh()

    const source = new EventSource('/api/sse/admin')
    source.addEventListener('open', refresh)
    source.addEventListener('admin-changed', refresh)

    let retryTimer: ReturnType<typeof setTimeout> | undefined
    source.addEventListener('error', () => {
      if (cancelled || source.readyState !== EventSource.CLOSED) {
        // A transient/reconnecting state — the browser is already handling
        // this on its own; nothing for this handler to do.
        return
      }
      // The terminal case: the browser has given up and will never retry
      // this connection itself. Refresh immediately (closes the gap for
      // however long this connection has already been dead), then rebuild
      // the EventSource after a backoff by bumping `sseEpoch`.
      refresh()
      retryTimer = setTimeout(() => {
        if (!cancelled) {
          setSseEpoch(current => current + 1)
        }
      }, RECONNECT_BACKOFF_MS)
    })

    const pollFloor = setInterval(refresh, POLL_FLOOR_MS)

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      clearInterval(pollFloor)
      source.close()
    }
    // `sseEpoch` is a write-only trigger (never read in the body) — see its
    // own declaration above.
  }, [router, sseEpoch])

  function runAction(work: () => Promise<void>) {
    setActionError(null)
    startTransition(async () => {
      try {
        await work()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Action failed')
      }
    })
  }

  // ── Pending requests ─────────────────────────────────────────────────

  function toggleSelectedRequest(id: number) {
    setSelectedRequestIds(prev => toggleInSet(prev, id, !prev.has(id)))
  }

  function dropFromQueue(ids: Set<number>) {
    setQueue(prev => prev.filter(entry => !ids.has(entry.id)))
    setSelectedRequestIds(prev => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
  }

  function handleApprove(id: number) {
    runAction(async () => {
      await approveRequest(id)
      dropFromQueue(new Set([id]))
      showToast('Access granted')
    })
  }

  function handleReject(id: number) {
    runAction(async () => {
      const result = await rejectRequest(id)
      if (result.decided) {
        dropFromQueue(new Set([id]))
        showToast('Request declined')
      }
    })
  }

  function handleBulkDismiss() {
    if (selectedRequestIds.size === 0) return
    const ids = Array.from(selectedRequestIds)
    runAction(async () => {
      const result = await bulkRejectRequests(ids)
      dropFromQueue(new Set(result.decided))
      showToast('Selected requests declined')
    })
  }

  // ── People ────────────────────────────────────────────────────────────

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const list = term
      ? users.filter(user => user.email.toLowerCase().includes(term))
      : users
    return [...list].sort((a, b) => a.email.localeCompare(b.email))
  }, [users, searchTerm])

  // Split AFTER search filtering, not before — searching for a blocked
  // person's email still finds them, just in the Blocked panel below
  // rather than here. Split on `blockedAt` alone, with no `isAdmin`
  // carve-out: since S2a, blocking an admin is a real action (it revokes
  // their /verify access to every gated service — see
  // verify.service.ts's header comment), so a blocked admin belongs in the
  // Blocked panel exactly like anyone else, not forced into People as if
  // blocking them had no effect.
  const activeUsers = useMemo(
    () => filteredUsers.filter(user => !user.blockedAt),
    [filteredUsers],
  )
  const blockedUsers = useMemo(
    () => filteredUsers.filter(user => user.blockedAt),
    [filteredUsers],
  )

  function handleBlock(userId: string) {
    runAction(async () => {
      await blockUser(userId)
      setUsers(prev =>
        prev.map(u =>
          u.id === userId ? { ...u, blockedAt: new Date().toISOString() } : u,
        ),
      )
      showToast('Access blocked')
    })
  }

  // Blocking an admin is higher-consequence than blocking an ordinary user:
  // since S2a, it actually revokes their /verify access to every gated
  // service (they keep /admin access via AdminGuard's own, deliberately
  // independent check — see verify.service.ts's header comment for the
  // no-lockout rationale), where blocking a non-admin has always meant the
  // same thing. Row actions route Block through this confirmation gate only
  // for an admin row; an ordinary Block stays a single click, unchanged.
  function handleBlockClick(user: AdminUserEntry) {
    if (
      user.isAdmin &&
      !window.confirm(
        `Block ${user.email} from every gated service? They will keep access to this admin dashboard, but lose access everywhere else until unblocked.`,
      )
    ) {
      return
    }
    handleBlock(user.id)
  }

  function handleUnblock(userId: string) {
    runAction(async () => {
      await unblockUser(userId)
      setUsers(prev =>
        prev.map(u => (u.id === userId ? { ...u, blockedAt: null } : u)),
      )
      showToast('Access unblocked')
    })
  }

  // More consequential than a single Block toggle — revokes EVERY service
  // this person currently has at once — so this is always confirmed,
  // regardless of isAdmin (unlike Block, which is confirmed only for an
  // admin row — see handleBlockClick above).
  function handleRemove(userId: string) {
    if (
      !window.confirm(
        'Remove all access for this person? This revokes every service they currently have.',
      )
    ) {
      return
    }
    runAction(async () => {
      await removeUser(userId)
      setUsers(prev =>
        prev.map(u => (u.id === userId ? { ...u, services: [] } : u)),
      )
      showToast('Access removed')
      closeAccessModal()
    })
  }

  // S2b: the "revoke all sessions" break-glass action — see
  // UsersService.revokeSessions()'s own comment for the full rationale.
  // Confirmed like Remove access above: unlike a single Block toggle, this
  // immediately signs the person out of every device they're currently
  // signed in on.
  function handleSignOutEverywhere(userId: string) {
    if (
      !window.confirm(
        "Sign this person out everywhere? Their current sessions are revoked immediately — they can sign back in right away, so this doesn't otherwise restrict their access.",
      )
    ) {
      return
    }
    runAction(async () => {
      const result = await revokeSessions(userId)
      showToast(
        result.sessionsRevoked > 0
          ? `Signed out of ${result.sessionsRevoked} session${result.sessionsRevoked === 1 ? '' : 's'}`
          : 'No active sessions to sign out',
      )
    })
  }

  // ── Add-person modal ──────────────────────────────────────────────────

  function openAddModal() {
    setAddEmail('')
    setAddEmailHasError(false)
    setAddSelected(new Set())
    setAddModalError(null)
    setIsAddModalOpen(true)
  }

  function closeAddModal() {
    setIsAddModalOpen(false)
  }

  function handleAddConfirm() {
    const email = addEmail.trim()
    const valid = EMAIL_PATTERN.test(email)
    setAddEmailHasError(!valid)
    if (!valid) return

    setAddModalError(null)
    startTransition(async () => {
      try {
        for (const host of addSelected) {
          await preAuthorizeUser(email, host)
        }
        // Only reconciles an EXISTING row (someone who has already signed
        // in before) — a brand-new email correctly stays invisible in
        // People until they actually sign in and materialize a `user` row
        // (see UsersService.preAuthorize()'s own header comment). Nothing
        // further to do for that case; the grant is real on the backend
        // either way.
        setUsers(prev =>
          prev.map(u =>
            u.email === email
              ? {
                  ...u,
                  services: [...new Set([...u.services, ...addSelected])],
                }
              : u,
          ),
        )
        showToast(`Access granted to ${email}`)
        setIsAddModalOpen(false)
      } catch (err) {
        setAddModalError(
          err instanceof Error ? err.message : 'Failed to add person',
        )
      }
    })
  }

  // ── Edit-access modal ─────────────────────────────────────────────────

  function openAccessModal(user: AdminUserEntry) {
    const current = new Set(user.services)
    setAccessModalUser(user)
    setAccessSelected(current)
    accessSnapshotRef.current = current
    setAccessModalError(null)
  }

  function closeAccessModal() {
    setAccessModalUser(null)
  }

  function handleAccessConfirm() {
    const user = accessModalUser
    if (!user) return
    const snapshot = accessSnapshotRef.current
    const selected = accessSelected
    const toGrant = [...selected].filter(host => !snapshot.has(host))
    const toRevoke = [...snapshot].filter(host => !selected.has(host))

    setAccessModalError(null)
    startTransition(async () => {
      try {
        for (const host of toGrant) {
          await setUserService(user.id, host, true)
        }
        for (const host of toRevoke) {
          await setUserService(user.id, host, false)
        }
        setUsers(prev =>
          prev.map(u =>
            u.id === user.id ? { ...u, services: [...selected] } : u,
          ),
        )
        showToast('Access updated')
        setAccessModalUser(null)
      } catch (err) {
        setAccessModalError(
          err instanceof Error ? err.message : 'Failed to update access',
        )
      }
    })
  }

  // Escape closes whichever modal is open — mirrors the design mockups'
  // own keyboard-dismiss behavior.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (isAddModalOpen) closeAddModal()
      else if (accessModalUser) closeAccessModal()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isAddModalOpen, accessModalUser])

  const grantedUsersCount = users.filter(u => u.services.length > 0).length

  return (
    <>
      <header className="topbar">
        <Brandmark href="/" label="admin" />
      </header>

      <div className="shell">
        <div className="stack gap-1">
          <h1 className="h1">Access control</h1>
          <p className="body-text muted">
            Review requests and manage who can reach what behind the gate.
          </p>
        </div>

        {actionError ? (
          <div className="notice" role="alert">
            <Icon name="x" />
            <span>{actionError}</span>
          </div>
        ) : null}

        <div className="stat-row">
          <div className={cns('stat-tile', queue.length > 0 && 'is-flagged')}>
            <span className="stat-tile__value">{queue.length}</span>
            <span className="stat-tile__label">Pending requests</span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile__value">{grantedUsersCount}</span>
            <span className="stat-tile__label">Granted users</span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile__value">{services.length}</span>
            <span className="stat-tile__label">Gated services</span>
          </div>
        </div>

        <div className="stack gap-3.5">
          <div className="panel-head">
            <div className="row gap-2">
              <h2 className="h2">Pending requests</h2>
              <span className="tab-count">{queue.length}</span>
            </div>
            {selectedRequestIds.size > 0 ? (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleBulkDismiss}
                disabled={isPending}
              >
                Dismiss selected ({selectedRequestIds.size})
              </button>
            ) : null}
          </div>

          {queue.length === 0 ? (
            <div className="empty-state">
              <Icon name="check" />
              <p className="body-text">No pending requests right now.</p>
            </div>
          ) : (
            <div>
              {queue.map(entry => (
                <div key={entry.id} className="req-card">
                  <input
                    type="checkbox"
                    checked={selectedRequestIds.has(entry.id)}
                    onChange={() => toggleSelectedRequest(entry.id)}
                    aria-label={`Select request from ${entry.email}`}
                  />
                  <span className="avatar">{getInitials(entry.email)}</span>
                  <div className="req-card__text">
                    <span className="req-card__name">{entry.email}</span>
                    <span className="req-card__meta" suppressHydrationWarning>
                      {entry.serviceHost} · requested {timeAgo(entry.createdAt)}
                      {entry.priorDecisions > 0
                        ? ` · rejected ${entry.priorDecisions}x before`
                        : ''}
                    </span>
                  </div>
                  <div className="req-card__actions">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => handleReject(entry.id)}
                      disabled={isPending}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleApprove(entry.id)}
                      disabled={isPending}
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="stack gap-3.5">
          <div className="panel-head">
            <h2 className="h2">People</h2>
            <div className="people-toolbar">
              <div className="search-input">
                <Icon name="search" />
                <input
                  className="input"
                  type="text"
                  placeholder="Search people…"
                  aria-label="Search people"
                  value={searchTerm}
                  onChange={event => setSearchTerm(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={openAddModal}
              >
                <Icon name="plus" />
                <span>Add person</span>
              </button>
            </div>
          </div>

          {activeUsers.length === 0 ? (
            <div className="empty-state">
              <Icon name="search" />
              <p className="body-text">No one matches your search.</p>
            </div>
          ) : (
            <>
              <div className="card people-table-wrap overflow-x-auto">
                <table className="table min-w-[560px]">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Status</th>
                      <th>Access</th>
                      <th>
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeUsers.map(user => (
                      <tr key={user.id}>
                        <td>
                          <div className="row-user">
                            <span className="avatar">
                              {getInitials(user.email)}
                            </span>
                            <div className="row-user__text">
                              <span className="row-user__name">
                                {user.email}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <PersonStatusChip user={user} />
                        </td>
                        <td>
                          <ServiceChips hosts={user.services} />
                        </td>
                        <td>
                          <div className="table-row-actions">
                            {user.isAdmin ? null : (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => openAccessModal(user)}
                              >
                                Edit access
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm text-red-400 hover:bg-red-950/30 hover:text-red-300"
                              onClick={() => handleBlockClick(user)}
                              disabled={isPending}
                            >
                              Block
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="people-card-list">
                {activeUsers.map(user => (
                  <div key={user.id} className="person-card">
                    <div className="person-card__top">
                      <span className="avatar">{getInitials(user.email)}</span>
                      <div className="person-card__text">
                        <span className="person-card__name">{user.email}</span>
                      </div>
                      <PersonStatusChip user={user} />
                    </div>
                    <div className="person-card__row">
                      <span className="person-card__row-label">Access</span>
                      <ServiceChips hosts={user.services} />
                    </div>
                    <div className="person-card__actions">
                      {user.isAdmin ? null : (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => openAccessModal(user)}
                        >
                          Edit access
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-red-400 hover:bg-red-950/30 hover:text-red-300"
                        onClick={() => handleBlockClick(user)}
                        disabled={isPending}
                      >
                        Block
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="stack gap-3.5">
          <div className="panel-head">
            <div className="row gap-2">
              <h2 className="h2">Blocked</h2>
              <span className="tab-count">{blockedUsers.length}</span>
            </div>
          </div>

          {blockedUsers.length === 0 ? (
            <div className="empty-state">
              <Icon name="check" />
              <p className="body-text">No blocked users.</p>
            </div>
          ) : (
            <>
              <div className="card people-table-wrap overflow-x-auto">
                <table className="table min-w-[560px]">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Status</th>
                      <th>Access</th>
                      <th>
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {blockedUsers.map(user => (
                      <tr key={user.id}>
                        <td>
                          <div className="row-user">
                            <span className="avatar">
                              {getInitials(user.email)}
                            </span>
                            <div className="row-user__text">
                              <span className="row-user__name">
                                {user.email}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <PersonStatusChip user={user} />
                        </td>
                        <td>
                          <ServiceChips hosts={user.services} />
                        </td>
                        <td>
                          <div className="table-row-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleUnblock(user.id)}
                              disabled={isPending}
                            >
                              Unblock
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => openAccessModal(user)}
                            >
                              Edit access
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="people-card-list">
                {blockedUsers.map(user => (
                  <div key={user.id} className="person-card">
                    <div className="person-card__top">
                      <span className="avatar">{getInitials(user.email)}</span>
                      <div className="person-card__text">
                        <span className="person-card__name">{user.email}</span>
                      </div>
                      <PersonStatusChip user={user} />
                    </div>
                    <div className="person-card__row">
                      <span className="person-card__row-label">Access</span>
                      <ServiceChips hosts={user.services} />
                    </div>
                    <div className="person-card__actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleUnblock(user.id)}
                        disabled={isPending}
                      >
                        Unblock
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => openAccessModal(user)}
                      >
                        Edit access
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div
        className={cns('modal-overlay', isAddModalOpen && 'is-open')}
        onClick={event => {
          if (event.target === event.currentTarget) closeAddModal()
        }}
      >
        <div className="modal">
          <div className="row between">
            <h2 className="h2">Add a person</h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Close"
              onClick={closeAddModal}
            >
              <Icon name="x" />
            </button>
          </div>
          <p className="body-text muted">
            Grant access directly without waiting for a request — useful for
            onboarding family or friends ahead of time.
          </p>
          <div className={cns('field', addEmailHasError && 'has-error')}>
            <label htmlFor="add-email">Email address</label>
            <input
              id="add-email"
              className="input"
              type="email"
              placeholder="name@example.com"
              value={addEmail}
              onChange={event => setAddEmail(event.target.value)}
            />
            <span className="field-error">Enter a valid email address.</span>
          </div>
          <div className="field">
            <label>Grant access to</label>
            <ServiceCheckGrid
              hosts={services.map(s => s.host)}
              selected={addSelected}
              onToggle={(host, checked) =>
                setAddSelected(prev => toggleInSet(prev, host, checked))
              }
              disabled={isPending}
            />
          </div>
          {addModalError ? (
            <p role="alert" className="text-sm text-red-400">
              {addModalError}
            </p>
          ) : null}
          <div className="row justify-end gap-2.5">
            <button
              type="button"
              className="btn btn-outline"
              onClick={closeAddModal}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAddConfirm}
              disabled={isPending}
            >
              Grant access
            </button>
          </div>
        </div>
      </div>

      <div
        className={cns('modal-overlay', accessModalUser && 'is-open')}
        onClick={event => {
          if (event.target === event.currentTarget) closeAccessModal()
        }}
      >
        <div className="modal">
          <div className="row between">
            <h2 className="h2">Edit access</h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Close"
              onClick={closeAccessModal}
            >
              <Icon name="x" />
            </button>
          </div>
          {accessModalUser ? (
            <div className="row-user">
              <span className="avatar">
                {getInitials(accessModalUser.email)}
              </span>
              <div className="row-user__text">
                <span className="row-user__name">{accessModalUser.email}</span>
              </div>
            </div>
          ) : null}
          <div className="field">
            <label>Services</label>
            <ServiceCheckGrid
              hosts={visibleServiceHosts(
                accessModalUser?.services ?? [],
                services,
              )}
              selected={accessSelected}
              onToggle={(host, checked) =>
                setAccessSelected(prev => toggleInSet(prev, host, checked))
              }
              disabled={isPending}
            />
          </div>
          {accessModalError ? (
            <p role="alert" className="text-sm text-red-400">
              {accessModalError}
            </p>
          ) : null}
          <div className="row between">
            {accessModalUser ? (
              <div className="row gap-2">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => handleSignOutEverywhere(accessModalUser.id)}
                  disabled={isPending}
                >
                  Sign out everywhere
                </button>
                <button
                  type="button"
                  className="btn btn-ghost text-red-400 hover:bg-red-950/30 hover:text-red-300"
                  onClick={() => handleRemove(accessModalUser.id)}
                  disabled={isPending}
                >
                  Remove access
                </button>
              </div>
            ) : null}
            <div className="row gap-2.5">
              <button
                type="button"
                className="btn btn-outline"
                onClick={closeAccessModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAccessConfirm}
                disabled={isPending}
              >
                Save access
              </button>
            </div>
          </div>
        </div>
      </div>

      <Toast message={message} />
    </>
  )
}
