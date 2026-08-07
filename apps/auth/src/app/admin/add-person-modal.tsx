'use client'

import { cns } from '@lilnas/utils/cns'
import type { Dispatch, SetStateAction, TransitionStartFunction } from 'react'
import { useState } from 'react'

import { preAuthorizeUser } from 'src/app/admin/actions'
import type {
  AdminServiceEntry,
  AdminUserEntry,
} from 'src/app/admin/require-admin'
import { Icon } from 'src/app/components/icons'
import { ServiceCheckGrid } from 'src/app/components/service-check-grid'
import { toggleInSet } from 'src/app/lib/toggle-in-set'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type AddPersonModalProps = {
  isOpen: boolean
  onClose: () => void
  services: AdminServiceEntry[]
  isPending: boolean
  startTransition: TransitionStartFunction
  setUsers: Dispatch<SetStateAction<AdminUserEntry[]>>
  showToast: (message: string) => void
}

// M2: split out of admin-dashboard-client.tsx, which owned this modal's
// state/JSX inline before growing past ~1000 lines. Moved as-is — see that
// file's own header comment for the feature-level "why" behind this modal
// (Add-person grants directly without waiting for a request). The parent
// mounts this component with a `key` that changes between 'closed' and
// 'open' (see admin-dashboard-client.tsx's own usage) rather than this
// component resetting its own state via an effect keyed on `isOpen` — a key
// change forces React to remount with fresh initial state SYNCHRONOUSLY, in
// the same commit that opens the modal, matching the original inline
// version's guarantee that opening never shows a stale value from a
// previous session (an effect-based reset would run one paint later,
// risking a one-frame flash of stale state).
export function AddPersonModal({
  isOpen,
  onClose,
  services,
  isPending,
  startTransition,
  setUsers,
  showToast,
}: AddPersonModalProps) {
  const [addEmail, setAddEmail] = useState('')
  const [addEmailHasError, setAddEmailHasError] = useState(false)
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set())
  const [addModalError, setAddModalError] = useState<string | null>(null)

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
        onClose()
      } catch (err) {
        setAddModalError(
          err instanceof Error ? err.message : 'Failed to add person',
        )
      }
    })
  }

  return (
    <div
      className={cns('modal-overlay', isOpen && 'is-open')}
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal">
        <div className="row between">
          <h2 className="h2">Add a person</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Close"
            onClick={onClose}
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
          <button type="button" className="btn btn-outline" onClick={onClose}>
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
  )
}
