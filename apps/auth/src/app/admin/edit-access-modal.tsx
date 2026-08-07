'use client'

import { cns } from '@lilnas/utils/cns'
import type { TransitionStartFunction } from 'react'
import { useRef, useState } from 'react'

import { setUserServices } from 'src/app/admin/actions'
import type {
  AdminServiceEntry,
  AdminUserEntry,
} from 'src/app/admin/require-admin'
import { Icon } from 'src/app/components/icons'
import { ServiceCheckGrid } from 'src/app/components/service-check-grid'
import { getInitials } from 'src/app/lib/initials'
import { toggleInSet } from 'src/app/lib/toggle-in-set'

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

export type EditAccessModalProps = {
  user: AdminUserEntry | null
  onClose: () => void
  services: AdminServiceEntry[]
  isPending: boolean
  startTransition: TransitionStartFunction
  showToast: (message: string) => void
  onRemove: (userId: string) => void
  onSignOutEverywhere: (userId: string) => void
}

// M2: split out of admin-dashboard-client.tsx, which owned this modal's
// state/JSX inline before growing past ~1000 lines. Moved as-is — see that
// file's own header comment for the feature-level "why" behind this modal,
// including the load-bearing "diff against the opening snapshot, never a
// full-set resubmit" behavior handleAccessConfirm below still has. The
// parent mounts this component with a `key` derived from the edited user's
// id (`user?.id ?? 'none'`, see admin-dashboard-client.tsx's own usage)
// rather than this component resetting its own state via an effect keyed
// on `user` — a key change forces React to remount with fresh initial
// state SYNCHRONOUSLY, in the same commit that opens the modal for a given
// user, matching the original inline version's guarantee that opening
// never shows a stale selection from a previous editing session.
//
// M3: no more optimistic setUsers() call after a successful save — every
// mutation this app makes already publishes to the admin broadcast topic
// (see users.service.ts's own header comment), which this SAME browser's
// own SSE subscription also receives, triggering router.refresh() and a
// fresh `users` prop from the server. There is no local copy left for this
// modal to keep in sync by hand. The diff against the opening snapshot is
// sent as ONE batched setUserServices() call rather than one call per
// checkbox — see UsersService.setUserServices()'s own comment for the
// "one transaction for the whole batch" rationale.
export function EditAccessModal({
  user,
  onClose,
  services,
  isPending,
  startTransition,
  showToast,
  onRemove,
  onSignOutEverywhere,
}: EditAccessModalProps) {
  const [accessSelected, setAccessSelected] = useState<Set<string>>(
    () => new Set(user?.services ?? []),
  )
  const [accessModalError, setAccessModalError] = useState<string | null>(null)
  const accessSnapshotRef = useRef<Set<string>>(new Set(user?.services ?? []))

  function handleAccessConfirm() {
    if (!user) return
    const snapshot = accessSnapshotRef.current
    const selected = accessSelected
    const toGrant = [...selected].filter(host => !snapshot.has(host))
    const toRevoke = [...snapshot].filter(host => !selected.has(host))
    const changes = [
      ...toGrant.map(serviceHost => ({ serviceHost, grant: true })),
      ...toRevoke.map(serviceHost => ({ serviceHost, grant: false })),
    ]

    setAccessModalError(null)
    startTransition(async () => {
      try {
        // Matches the old per-host loops' own behavior when nothing
        // changed: zero iterations, zero network calls — setUserServices()
        // itself requires at least one change, so an empty diff must skip
        // the call rather than send an invalid empty array.
        if (changes.length > 0) {
          await setUserServices(user.id, changes)
        }
        showToast('Access updated')
        onClose()
      } catch (err) {
        setAccessModalError(
          err instanceof Error ? err.message : 'Failed to update access',
        )
      }
    })
  }

  return (
    <div
      className={cns('modal-overlay', user && 'is-open')}
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal">
        <div className="row between">
          <h2 className="h2">Edit access</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        {user ? (
          <div className="row-user">
            <span className="avatar">{getInitials(user.email)}</span>
            <div className="row-user__text">
              <span className="row-user__name">{user.email}</span>
            </div>
          </div>
        ) : null}
        <div className="field">
          <label>Services</label>
          <ServiceCheckGrid
            hosts={visibleServiceHosts(user?.services ?? [], services)}
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
          {user ? (
            <div className="row gap-2">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => onSignOutEverywhere(user.id)}
                disabled={isPending}
              >
                Sign out everywhere
              </button>
              <button
                type="button"
                className="btn btn-ghost text-red-400 hover:bg-red-950/30 hover:text-red-300"
                onClick={() => onRemove(user.id)}
                disabled={isPending}
              >
                Remove access
              </button>
            </div>
          ) : null}
          <div className="row gap-2.5">
            <button type="button" className="btn btn-outline" onClick={onClose}>
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
  )
}
