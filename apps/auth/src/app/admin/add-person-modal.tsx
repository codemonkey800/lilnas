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
//
// Plan 020: the toast says what actually happened. preAuthorizeUsers() now
// reports `outcome` — 'invited' when the email had no account yet (the
// services wait as a pending invite until their first sign-in) and 'granted'
// when it did (real grants were written) — and only the backend, inside the
// transaction that did the write, knows which branch ran. "Access granted"
// for an invite that grants nothing yet was the lie this replaces.
//
// Submitting with nothing selected used to skip the call and still toast
// success, an "Access granted" for nothing. It is now a field error under the
// service grid (a rule alone is enough, so the message names both): no call,
// no toast, the dialog stays open. The error is derived from the selection
// rather than stored, so it clears the moment a service or rule is picked.
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
  // Whether the last submit found nothing selected. The message only shows
  // while the selection is still empty (see `serviceError` below).
  const [serviceSubmitted, setServiceSubmitted] = useState(false)
  const serviceError =
    serviceSubmitted && addSelected.size === 0
      ? 'Pick at least one service or rule.'
      : null

  function handleAddConfirm() {
    const email = addEmail.trim()
    const valid = EMAIL_PATTERN.test(email)
    const hasSelection = addSelected.size > 0
    setAddEmailHasError(!valid)
    setServiceSubmitted(!hasSelection)
    if (!valid || !hasSelection) return

    setAddModalError(null)
    startTransition(async () => {
      try {
        const { outcome } = await preAuthorizeUsers(email, [...addSelected])
        showToast(
          outcome === 'granted'
            ? `Access granted to ${email}`
            : `Invited ${email}`,
        )
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
          <fieldset
            aria-describedby={
              serviceError ? 'add-person-service-error' : undefined
            }
            className="flex flex-col gap-1.5"
          >
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
            {serviceError ? (
              <p className="text-cap text-bad" id="add-person-service-error">
                {serviceError}
              </p>
            ) : null}
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
