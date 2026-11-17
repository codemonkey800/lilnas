'use client'

import { Button, Dialog, Field, Input, Note } from '@lilnas/ui'
import type { TransitionStartFunction } from 'react'
import { useState } from 'react'

import { AccessRulesField } from 'src/app/admin/access-rules-field'
import { preAuthorizeUsers } from 'src/app/admin/actions'
import type { AdminServiceEntry } from 'src/app/admin/require-admin'
import { ServiceCheckGrid } from 'src/app/components/service-check-grid'
import { toggleInSet } from 'src/app/lib/toggle-in-set'
import { isHostPattern } from 'src/grants/host-matcher'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type AddPersonModalProps = {
  isOpen: boolean
  onClose: () => void
  services: AdminServiceEntry[]
  isPending: boolean
  startTransition: TransitionStartFunction
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
//
// M3: no more optimistic setUsers() call after a successful grant — every
// mutation this app makes already publishes to the admin broadcast topic
// (see users.service.ts's own header comment), which this SAME browser's
// own SSE subscription also receives, triggering router.refresh() and a
// fresh `users` prop from the server. There is no local copy left for this
// modal to keep in sync by hand. `addSelected` is sent as ONE batched
// preAuthorizeUsers() call rather than one call per checkbox — see
// UsersService.preAuthorizeMany()'s own comment for the "one transaction
// for the whole batch" rationale. Access rules live in that same Set
// (AccessRulesField below), so they're sent in the same call as the
// checked hosts.
export function AddPersonModal({
  isOpen,
  onClose,
  services,
  isPending,
  startTransition,
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
        // Matches the old per-host loop's own behavior when nothing is
        // checked: zero iterations, zero network calls, and the toast
        // still confirms the (empty) grant — preAuthorizeUsers() itself
        // requires at least one host, so an empty selection must skip the
        // call rather than send an invalid empty array.
        if (addSelected.size > 0) {
          await preAuthorizeUsers(email, [...addSelected])
        }
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
    <Dialog.Root
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose()
      }}
    >
      <Dialog.Popup className="max-w-[520px]">
        <Dialog.Title>Add a person</Dialog.Title>
        <div className="flex flex-col gap-4">
          <Dialog.Description className="text-ink-3">
            Give someone access before they ask — handy for family and friends
            you’re onboarding.
          </Dialog.Description>
          <Field
            label="Email address"
            error={
              addEmailHasError ? 'Enter an email like name@example.com.' : null
            }
          >
            <Input
              mono
              type="email"
              placeholder="name@example.com"
              value={addEmail}
              onChange={event => setAddEmail(event.target.value)}
            />
          </Field>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium text-ink-2">
              Grant access to
            </legend>
            <ServiceCheckGrid
              hosts={services.map(s => s.host)}
              selected={addSelected}
              onToggle={(host, checked) =>
                setAddSelected(prev => toggleInSet(prev, host, checked))
              }
              disabled={isPending}
            />
          </fieldset>
          <AccessRulesField
            rules={[...addSelected].filter(isHostPattern)}
            onAdd={rule =>
              setAddSelected(prev => toggleInSet(prev, rule, true))
            }
            onRemove={rule =>
              setAddSelected(prev => toggleInSet(prev, rule, false))
            }
            disabled={isPending}
          />
          {addModalError ? <Note tone="bad" lead={addModalError} /> : null}
        </div>
        <Dialog.Actions>
          <Dialog.Close render={<Button variant="ghost" />}>
            Cancel
          </Dialog.Close>
          <Button
            variant="accent"
            loading={isPending}
            onClick={handleAddConfirm}
          >
            Add person
          </Button>
        </Dialog.Actions>
      </Dialog.Popup>
    </Dialog.Root>
  )
}
