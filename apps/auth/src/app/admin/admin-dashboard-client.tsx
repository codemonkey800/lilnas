'use client'

import { AppBar, Button, ConfirmDialog, Note } from '@lilnas/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'

import {
  approveRequest,
  blockUser,
  bulkRejectRequests,
  rejectRequest,
  removeUser,
  revokeSessions,
  unblockUser,
  unlinkDiscordAccount,
} from 'src/app/admin/actions'
import { AddPersonModal } from 'src/app/admin/add-person-modal'
import { BlockedPanel } from 'src/app/admin/blocked-panel'
import { DiscordLinksPanel } from 'src/app/admin/discord-links-panel'
import { EditAccessModal } from 'src/app/admin/edit-access-modal'
import { PeopleList } from 'src/app/admin/people-list'
import { RequestCards } from 'src/app/admin/request-cards'
import type {
  AdminDiscordLinkEntry,
  AdminDiscordUnlinked,
  AdminQueueEntry,
  AdminServiceEntry,
  AdminUserEntry,
} from 'src/app/admin/require-admin'
import { StatTiles } from 'src/app/admin/stat-tiles'
import { useToast } from 'src/app/components/toast'
import { signOut } from 'src/app/lib/auth-client'
import { toggleInSet } from 'src/app/lib/toggle-in-set'

export type AdminDashboardClientProps = {
  initialQueue: AdminQueueEntry[]
  initialUsers: AdminUserEntry[]
  services: AdminServiceEntry[]
  // D2/D3 (plan 017): the Discord link panel's data, fetched alongside
  // everything else by page.tsx. D2 landed these OPTIONAL as a temporary
  // measure — the panel that consumes them didn't exist yet, so the only
  // thing required-ness could have bought was 23 empty
  // `discordUnlinked={{ people: [], accounts: [] }}` props in a spec about
  // the queue and the People/Blocked split. D3 (this change) tightened both
  // to REQUIRED now that DiscordLinksPanel below actually renders them:
  // `discordUnlinked` being absent would silently render a panel with two
  // permanently-empty lists and no way to link anyone, which is exactly the
  // kind of failure a type should catch rather than a bug report.
  discordUnlinked: AdminDiscordUnlinked
  discordLinks: AdminDiscordLinkEntry[]
}

// ──────────────────────────────────────────────────────────────────────────────
// The merged admin dashboard — replaces the pre-redesign /admin,
// /admin/queue, and /admin/users pages with one screen (stat tiles,
// pending requests, and people), matching the design mockups' own
// single-page layout. The services/gated-by table the mockups also have
// was deliberately dropped — it had no admin action attached, and `services`
// stays a required prop purely as the source list for the Add-person/
// Edit-access dialogs' checkbox grids. Every mutation still goes through the EXISTING
// Server Actions in actions.ts, unchanged — this file only reorganizes how
// they're presented and composed:
//
//   - Approve/Reject act on exactly the one requested service (unchanged
//     approveRequest()/rejectRequest() behavior) — there is no
//     "choose additional services while approving" picker. Granting more
//     happens afterward via Edit access.
//   - The bulk-dismiss checkbox + "Dismiss selected" button on request
//     cards is a deliberate ADDITION beyond the mockups (which have no
//     bulk affordance beyond the Decline button) — preserving a feature the
//     pre-merge queue-client.tsx already had.
//   - M2: the Add-person and Edit-access dialogs live in their own sibling
//     files (add-person-modal.tsx, edit-access-modal.tsx) — each owns its
//     own form state and submit handler, mounted below with a `key` that
//     changes whenever it should reset (see each file's own header comment
//     for why `key` rather than an effect). This component still owns
//     `isAddModalOpen`/`accessModalUser` themselves, since the trigger
//     points (the toolbar, each row, the empty states) live outside the
//     dialogs. Escape, the focus trap and the scrim come from `Dialog`.
//   - Every destructive action asks first in a `ConfirmDialog` that names
//     the person and what they lose: Block is confirmed here; Remove access,
//     Sign out everywhere and Unlink live in the Edit-access dialog, which
//     owns their confirms (a dialog opened from a dialog nests under it, so
//     focus returns there rather than to the page).
//   - The Edit-access modal diffs against its own OPENING snapshot and
//     sends only the boxes that actually changed as one batched
//     setUserServices() call — never a full-set resubmit. This is
//     load-bearing: users.service.ts's own header comment documents the
//     real bug (a stale snapshot silently revoking an unrelated,
//     just-granted service) that explicit deltas replaced; this modal must
//     not reintroduce it by resubmitting every checkbox regardless of
//     whether it changed.
//
//   - M3: `queue`/`users` are the `initialQueue`/`initialUsers` PROPS
//     directly, not a local useState mirror — every mutation below already
//     publishes to the admin broadcast topic (see the live-updates bullet
//     next), which router.refresh() reacts to by re-running page.tsx's
//     Server Component and handing this component fresh props. A local
//     optimistic copy had nothing left to buy once that loop existed, and
//     was itself a second source of truth that could drift from what the
//     server actually persisted. `selectedRequestIds`/`searchTerm`/the
//     modal-open state below stay local — they're this component's OWN
//     ephemeral UI state, never mirrored from the server.
//   - Live updates (below): the WHOLE dashboard reacts to a single
//     broadcast SSE topic (src/sse/notify-bus.service.ts's ADMIN_TOPIC) —
//     every mutation listed above, from ANY admin's tab (including this
//     one — the acting browser's own EventSource subscription receives the
//     same broadcast it just caused), and a brand-new incoming request,
//     all publish to it. This component's own reaction is uniform
//     regardless of which mutation fired: router.refresh(), which re-runs
//     page.tsx's Server Component and re-fetches queue/users/services via
//     the existing requireAdminQueue()/fetchAdminUsers()/
//     fetchAdminServices() calls — never a bespoke per-mutation Server
//     Action. See the SSE effect below for the reconnect-backoff/poll-floor
//     mechanics, ported verbatim from src/app/pending/pending-client.tsx.
//   - People/Blocked split: `users` is partitioned into `activeUsers` and
//     `blockedUsers` (below) on `blockedAt` ALONE — a blocked person, admin
//     or not, renders in their own "Blocked" panel, never in People. S2a
//     (verify.service.ts) made blocking an admin a real action instead of a
//     no-op: it now revokes their /verify access to every gated service,
//     while AdminGuard's own, deliberately independent check leaves their
//     /admin access untouched (see that file's own header comment for the
//     no-lockout rationale) — so a blocked admin still shows up here able
//     to unblock themselves. PersonStatusBadge's "Blocked" branch
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
  discordUnlinked,
  discordLinks,
}: AdminDashboardClientProps) {
  const router = useRouter()
  // M3: no local copy — see this component's own header comment for why
  // the props are the whole story now.
  const queue = initialQueue
  const users = initialUsers
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<number>>(
    new Set(),
  )
  const [searchTerm, setSearchTerm] = useState('')
  const [isPending, startTransition] = useTransition()
  const [actionError, setActionError] = useState<string | null>(null)
  const { showToast } = useToast()

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  // The person a Block confirm is about. Kept after the dialog closes so its
  // title doesn't change while it fades out.
  const [blockTarget, setBlockTarget] = useState<AdminUserEntry | null>(null)
  const [isBlockConfirmOpen, setIsBlockConfirmOpen] = useState(false)
  const [accessModalUser, setAccessModalUser] = useState<AdminUserEntry | null>(
    null,
  )

  // A write-only trigger, bumped only by the SSE effect's own 'error'
  // handler below — see pending-client.tsx's identical `epoch` for the
  // full rationale (forces the effect to tear down a terminally-dead
  // EventSource and open a fresh one after a backoff).
  const [sseEpoch, setSseEpoch] = useState(0)

  // Whether the admin SSE stream has opened at least once since mount. The
  // FIRST open lands a moment after page.tsx rendered these very props, so
  // refreshing on it only re-ran the same five backend reads for nothing
  // (every page load cost two full renders). Every LATER open — the
  // browser's own auto-reconnect, or a rebuilt EventSource after an
  // sseEpoch bump — follows a gap where events may have been missed, so
  // those still refresh. A ref, not state: it survives the effect re-running
  // on sseEpoch without itself causing a render.
  const hasConnectedRef = useRef(false)

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
    source.addEventListener('open', () => {
      if (!hasConnectedRef.current) {
        hasConnectedRef.current = true
        return
      }
      refresh()
    })
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

  // M3: no more optimistic setQueue() removal — the row's actual
  // disappearance is now router.refresh()'s job (see this component's own
  // header comment). This is purely local UI cleanup: a request id that's
  // about to be decided shouldn't linger in the bulk-selection Set once
  // it's gone from the next refreshed `queue`.
  function clearSelectedRequests(ids: Set<number>) {
    setSelectedRequestIds(prev => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
  }

  function handleApprove(id: number) {
    runAction(async () => {
      await approveRequest(id)
      clearSelectedRequests(new Set([id]))
      showToast('Access granted')
    })
  }

  function handleReject(id: number) {
    runAction(async () => {
      const result = await rejectRequest(id)
      if (result.decided) {
        clearSelectedRequests(new Set([id]))
        showToast('Request declined')
      }
    })
  }

  function handleBulkDismiss() {
    if (selectedRequestIds.size === 0) return
    const ids = Array.from(selectedRequestIds)
    runAction(async () => {
      const result = await bulkRejectRequests(ids)
      clearSelectedRequests(new Set(result.decided))
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

  // Blocking asks first, for everyone: it revokes the person's /verify access
  // to every gated service. For an admin the confirm says they keep this
  // dashboard — they keep /admin access via AdminGuard's own, deliberately
  // independent check (see verify.service.ts's header comment for the
  // no-lockout rationale).
  function handleBlockClick(user: AdminUserEntry) {
    setBlockTarget(user)
    setIsBlockConfirmOpen(true)
  }

  function handleBlockConfirm() {
    if (!blockTarget) return
    const { id } = blockTarget
    setIsBlockConfirmOpen(false)
    runAction(async () => {
      await blockUser(id)
      showToast('Access blocked')
    })
  }

  function handleUnblock(userId: string) {
    runAction(async () => {
      await unblockUser(userId)
      showToast('Access unblocked')
    })
  }

  // The Edit-access dialog confirms Remove access, Sign out everywhere and
  // Unlink itself (see edit-access-modal.tsx), then calls these.
  //
  // Remove revokes EVERY service this person currently has at once.
  function handleRemove(userId: string) {
    runAction(async () => {
      await removeUser(userId)
      showToast('Access removed')
      closeAccessModal()
    })
  }

  // S2b: the "revoke all sessions" break-glass action — see
  // UsersService.revokeSessions()'s own comment for the full rationale.
  function handleSignOutEverywhere(userId: string) {
    runAction(async () => {
      const result = await revokeSessions(userId)
      showToast(
        result.sessionsRevoked > 0
          ? `Signed out of ${result.sessionsRevoked} session${result.sessionsRevoked === 1 ? '' : 's'}`
          : 'No active sessions to sign out',
      )
    })
  }

  // D3 (plan 017): the Edit-access dialog's Unlink action. The dialog shows a
  // person's current Discord link READ-ONLY — linking itself happens only in
  // the Discord links panel, where both sides are picked from observed lists
  // (see discord-links-panel.tsx's header comment for why that constraint is
  // the whole design) — but unlinking needs no picker, so it is available
  // wherever the link is visible. Handled HERE rather than inside the dialog
  // for the same reason onRemove/onSignOutEverywhere are: the dialog
  // delegates anything that outlives it (its error and toast belong to the
  // dashboard, which stays mounted).
  //
  // A 404 from this call is a genuine error, not an idempotent success — see
  // actions.ts's unlinkDiscordAccount() comment. runAction surfaces it in the
  // page-level note and the SSE refresh corrects the stale view.
  function handleUnlinkDiscord(user: AdminUserEntry) {
    runAction(async () => {
      await unlinkDiscordAccount(user.id)
      showToast('Discord account unlinked')
    })
  }

  // ── Modals ────────────────────────────────────────────────────────────

  function openAddModal() {
    setIsAddModalOpen(true)
  }

  function closeAddModal() {
    setIsAddModalOpen(false)
  }

  function openAccessModal(user: AdminUserEntry) {
    setAccessModalUser(user)
  }

  function closeAccessModal() {
    setAccessModalUser(null)
  }

  function handleSignOut() {
    void signOut().then(() => {
      window.location.href = '/login'
    })
  }

  const grantedUsersCount = users.filter(u => u.services.length > 0).length

  return (
    <>
      <AppBar
        app="auth"
        links={[
          { href: '/', label: 'Home' },
          { href: '/admin', label: 'Admin', active: true },
        ]}
        end={
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            Sign out
          </Button>
        }
      />

      <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-8 px-4 py-6 md:gap-10 md:px-8 md:py-10">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1">Access control</h1>
          <p className="text-body text-ink-3">
            Review requests and manage who can reach what behind the gate.
          </p>
        </div>

        {actionError ? (
          <Note
            tone="bad"
            lead="That didn’t go through."
            onDismiss={() => setActionError(null)}
          >
            {actionError}
          </Note>
        ) : null}

        <StatTiles
          people={users.length}
          granted={grantedUsersCount}
          pending={queue.length}
        />

        <RequestCards
          queue={queue}
          selectedIds={selectedRequestIds}
          isPending={isPending}
          onToggle={toggleSelectedRequest}
          onApprove={handleApprove}
          onReject={handleReject}
          onBulkDismiss={handleBulkDismiss}
          onAddPerson={openAddModal}
        />

        <PeopleList
          users={activeUsers}
          searchTerm={searchTerm}
          isPending={isPending}
          onSearchChange={setSearchTerm}
          onAddPerson={openAddModal}
          onEdit={openAccessModal}
          onBlock={handleBlockClick}
        />

        {/* D3 (plan 017). Sits directly under People, above Blocked: it is
            read as a continuation of the People list (who is this person on
            Discord?), and the two lists it owns are populated by observation,
            so an admin arriving to link someone has almost always just been
            looking at People. Blocked is a rarely-visited tail panel and stays
            below it. */}
        <DiscordLinksPanel
          unlinked={discordUnlinked}
          links={discordLinks}
          isPending={isPending}
          startTransition={startTransition}
          showToast={showToast}
        />

        <BlockedPanel
          users={blockedUsers}
          isPending={isPending}
          onUnblock={handleUnblock}
          onEdit={openAccessModal}
        />
      </main>

      <AddPersonModal
        key={isAddModalOpen ? 'open' : 'closed'}
        isOpen={isAddModalOpen}
        onClose={closeAddModal}
        services={services}
        isPending={isPending}
        startTransition={startTransition}
        showToast={showToast}
      />

      <EditAccessModal
        key={accessModalUser?.id ?? 'none'}
        user={accessModalUser}
        onClose={closeAccessModal}
        services={services}
        isPending={isPending}
        startTransition={startTransition}
        showToast={showToast}
        onRemove={handleRemove}
        onSignOutEverywhere={handleSignOutEverywhere}
        onUnlinkDiscord={handleUnlinkDiscord}
      />

      <ConfirmDialog
        open={isBlockConfirmOpen}
        onOpenChange={setIsBlockConfirmOpen}
        title={`Block ${blockTarget?.email ?? 'this person'}?`}
        body={
          blockTarget?.isAdmin
            ? 'They lose every service until you unblock them. They keep this dashboard, because they’re an admin.'
            : 'They lose every service until you unblock them.'
        }
        confirmLabel="Block"
        cancelLabel="Keep access"
        onConfirm={handleBlockConfirm}
      />
    </>
  )
}
