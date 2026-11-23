'use client'

import type { ToastTone } from '@lilnas/ui'
import { Avatar, Button, ConfirmDialog, Dialog, Note } from '@lilnas/ui'
import type { TransitionStartFunction } from 'react'
import { useRef, useState } from 'react'

import { AccessRulesField } from 'src/app/admin/access-rules-field'
import { preAuthorizeUsers, removeInvites } from 'src/app/admin/actions'
import { visibleServiceHosts } from 'src/app/admin/edit-access-modal'
import type {
  AdminInviteEntry,
  AdminServiceEntry,
} from 'src/app/admin/require-admin'
import { ServiceCheckGrid } from 'src/app/components/service-check-grid'
import { getInitials } from 'src/app/lib/initials'
import { toggleInSet } from 'src/app/lib/toggle-in-set'
import { isHostPattern } from 'src/grants/host-matcher'

export type EditInviteModalProps = {
  invite: AdminInviteEntry | null // null = closed
  onClose: () => void
  services: AdminServiceEntry[]
  isPending: boolean
  startTransition: TransitionStartFunction
  showToast: (message: string, tone?: ToastTone) => void
  onCancelInvite: (invite: AdminInviteEntry) => void
}

// Plan 020: Edit access for a person who has been invited but has not signed
// in yet (a PersonRow of kind 'invite', see people-list.tsx).
//
// Why this is NOT EditAccessModal with a flag:
//   - There is no user id. EditAccessModal is addressed by `user.id` and sends
//     setUserServices(userId, changes); an invite is a set of
//     pre_authorized_grant rows addressed by EMAIL, and no `user` row exists
//     to hang a Discord link, a session or a block on. Half of that dialog
//     (Discord, Sign out everywhere, Remove access) has nothing to act on, so
//     it is absent here rather than hidden behind conditionals.
//   - The pending set is edited through TWO routes, not one batched call:
//     additions go through preAuthorizeUsers() (the same action Add person
//     uses) and removals through removeInvites(). Neither action takes the
//     other's direction, so one Save can make two calls — adds first, so a
//     failure part-way leaves the person with more access to be pruned, never
//     an emptied invite nobody asked for.
//
// Why it sends DELTAS: like EditAccessModal, Save diffs the selection against
// a snapshot taken when the dialog opened and sends only what changed, never
// the full set. users.service.ts's header comment documents the real bug a
// full-set resubmit caused (a stale snapshot silently undoing a change made
// elsewhere in the meantime); an invite is just as exposed, since a second
// admin or a refresh can change the pending set while this dialog is open.
// Each call is skipped when its list is empty, and no differences means no
// calls at all. Access rules are just more hosts in the same Set, so they ride
// the same two calls.
//
// Why the warning toast: the dashboard is live, but this dialog's snapshot is
// not. If the person signs in while the dialog is open, their first /verify
// binds the invite into real grants (AccessCacheService.bindPreAuthorizedGrant)
// and the pending rows are gone. Then either preAuthorizeUsers() reports
// outcome 'granted' (the email now has an account, so the additions were
// written as grants) or removeInvites() reports FEWER hosts removed than were
// sent (the rest were already grants). Neither is an error, but "Invite
// updated" would be untrue: nothing was removed, and the person's row is now a
// normal one. The warning says so and points at that row. The dialog closes
// either way.
//
// Saving with nothing left selected sends nothing: an invite with no services
// is not an invite, so it opens the Cancel-invite confirm instead, which is
// the same destructive action with the same warning about what they lose.
//
// The parent mounts this with `key={invite?.email ?? 'none'}` so it remounts
// with fresh state per person, as EditAccessModal is keyed by user id —
// opening a second person never shows the first one's edits.

// "Invited Nov 23" as the invited row draws it: the renderer's own locale.
function invitedLine(createdAt: string): string {
  return `Invited ${new Date(createdAt).toLocaleDateString()} · hasn’t signed in yet`
}

export function EditInviteModal({
  invite,
  onClose,
  services,
  isPending,
  startTransition,
  showToast,
  onCancelInvite,
}: EditInviteModalProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(invite?.serviceHosts ?? []),
  )
  const [modalError, setModalError] = useState<string | null>(null)
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false)
  const snapshotRef = useRef<Set<string>>(new Set(invite?.serviceHosts ?? []))

  function handleSave() {
    if (!invite) return
    // Nothing left: that is cancelling the invite, which asks first.
    if (selected.size === 0 && snapshotRef.current.size > 0) {
      setIsCancelConfirmOpen(true)
      return
    }

    const snapshot = snapshotRef.current
    const added = [...selected].filter(host => !snapshot.has(host))
    const removed = [...snapshot].filter(host => !selected.has(host))

    setModalError(null)
    startTransition(async () => {
      try {
        let signedIn = false
        if (added.length > 0) {
          const result = await preAuthorizeUsers(invite.email, added)
          if (result.outcome === 'granted') signedIn = true
        }
        if (removed.length > 0) {
          const result = await removeInvites(invite.email, removed)
          if (result.removed.length < removed.length) signedIn = true
        }
        if (signedIn) {
          showToast(
            `${invite.email} has signed in. Edit their access from their row.`,
            'warn',
          )
        } else {
          showToast('Invite updated')
        }
        onClose()
      } catch (err) {
        setModalError(
          err instanceof Error ? err.message : 'Failed to update invite',
        )
      }
    })
  }

  function handleCancelConfirm() {
    if (!invite) return
    setIsCancelConfirmOpen(false)
    onCancelInvite(invite)
  }

  const email = invite?.email ?? 'this person'
  const pendingCount = invite?.serviceHosts.length ?? 0

  return (
    <Dialog.Root
      open={invite !== null}
      onOpenChange={open => {
        if (!open) onClose()
      }}
    >
      <Dialog.Popup className="max-w-[640px]">
        <Dialog.Title>Edit access</Dialog.Title>
        <div className="flex flex-col gap-4">
          {invite ? (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar initials={getInitials(invite.email)} size={32} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-mono text-ink">
                  {invite.email}
                </span>
                <span className="text-cap text-ink-3">
                  {invitedLine(invite.createdAt)}
                </span>
              </span>
            </div>
          ) : null}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium text-ink-2">
              Services
            </legend>
            <ServiceCheckGrid
              hosts={visibleServiceHosts(invite?.serviceHosts ?? [], services)}
              selected={selected}
              onToggle={(host, checked) =>
                setSelected(prev => toggleInSet(prev, host, checked))
              }
              disabled={isPending}
            />
          </fieldset>
          <AccessRulesField
            rules={[...selected].filter(isHostPattern)}
            onAdd={rule => setSelected(prev => toggleInSet(prev, rule, true))}
            onRemove={rule =>
              setSelected(prev => toggleInSet(prev, rule, false))
            }
            disabled={isPending}
          />
          {modalError ? <Note tone="bad" lead={modalError} /> : null}
          {invite ? (
            <div className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
              <Button
                disabled={isPending}
                icon="trash"
                size="sm"
                variant="bad"
                onClick={() => setIsCancelConfirmOpen(true)}
              >
                Cancel invite
              </Button>
            </div>
          ) : null}
        </div>
        <Dialog.Actions>
          <Dialog.Close render={<Button variant="ghost" />}>
            Cancel
          </Dialog.Close>
          <Button variant="accent" loading={isPending} onClick={handleSave}>
            Save access
          </Button>
        </Dialog.Actions>

        {/* Nested in the dialog's own tree, so focus and the scrim stack over
            it and Escape closes only the confirm. */}
        <ConfirmDialog
          open={isCancelConfirmOpen}
          onOpenChange={setIsCancelConfirmOpen}
          title={`Cancel ${email}’s invite?`}
          body={`They won’t get ${pendingCount === 1 ? 'this service' : `these ${pendingCount} services`} when they sign in. You can add them again any time.`}
          confirmLabel="Cancel invite"
          cancelLabel="Keep invite"
          onConfirm={handleCancelConfirm}
        />
      </Dialog.Popup>
    </Dialog.Root>
  )
}
