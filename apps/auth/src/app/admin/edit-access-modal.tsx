'use client'

import { Avatar, Button, ConfirmDialog, Dialog, Field, Note } from '@lilnas/ui'
import type { TransitionStartFunction } from 'react'
import { useRef, useState } from 'react'

import { AccessRulesField } from 'src/app/admin/access-rules-field'
import { setUserServices } from 'src/app/admin/actions'
import { DiscordBadge } from 'src/app/admin/people-list'
import type {
  AdminServiceEntry,
  AdminUserEntry,
} from 'src/app/admin/require-admin'
import { ServiceCheckGrid } from 'src/app/components/service-check-grid'
import { getInitials } from 'src/app/lib/initials'
import { toggleInSet } from 'src/app/lib/toggle-in-set'
import { isHostPattern } from 'src/grants/host-matcher'

// The union of the registry's current hosts and a given user's own current
// grants — not the registry alone — so a grant for a host that has since
// left the registry (e.g. this app's own cutover, which renamed
// login.lilnas.io to auth.lilnas.io) still shows up, checked, with a
// checkbox available to uncheck it. Ported from the pre-merge
// users-client.tsx's identical helper; see that file's own history for the
// "why." Access-rule patterns in the user's grants are left out — they
// aren't services to check, and AccessRulesField renders them instead.
// Exported so edit-invite-modal.tsx builds its grid the same way: an invite's
// pending hosts can leave the registry just as a grant can.
export function visibleServiceHosts(
  userServices: string[],
  services: AdminServiceEntry[],
): string[] {
  const literalGrants = userServices.filter(host => !isHostPattern(host))
  return [...new Set([...services.map(s => s.host), ...literalGrants])].sort(
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
  // D3 (plan 017): takes the whole user, not just an id, so the parent can
  // name the person in its toast. Only ever called for a user that HAS a
  // link, since the button renders only then. The confirm lives in this
  // dialog ("Unlink alice@example.com from @alice_h?").
  onUnlinkDiscord: (user: AdminUserEntry) => void
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
//
// Access rules ride the SAME selection Set and diff as the checkboxes: a
// rule is just another host matcher in `accessSelected`, so adding or
// removing one produces a grant/revoke change in that one batched call.
// Which confirm is showing over the dialog. Each names the person and what
// they lose; confirming hands off to the parent (which owns the action, its
// error and its toast) and closes the confirm.
type PendingConfirm = 'remove' | 'signOut' | 'unlink' | null

export function EditAccessModal({
  user,
  onClose,
  services,
  isPending,
  startTransition,
  showToast,
  onRemove,
  onSignOutEverywhere,
  onUnlinkDiscord,
}: EditAccessModalProps) {
  const [accessSelected, setAccessSelected] = useState<Set<string>>(
    () => new Set(user?.services ?? []),
  )
  const [accessModalError, setAccessModalError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<PendingConfirm>(null)
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

  const email = user?.email ?? 'this person'
  const handle = user?.discordUsername ?? null

  function handleConfirm() {
    if (!user) return
    const action = confirm
    setConfirm(null)
    if (action === 'remove') onRemove(user.id)
    else if (action === 'signOut') onSignOutEverywhere(user.id)
    else if (action === 'unlink') onUnlinkDiscord(user)
  }

  return (
    <Dialog.Root
      open={user !== null}
      onOpenChange={open => {
        if (!open) onClose()
      }}
    >
      <Dialog.Popup className="max-w-[640px]">
        <Dialog.Title>Edit access</Dialog.Title>
        <div className="flex flex-col gap-4">
          {user ? (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar initials={getInitials(user.email)} size={32} />
              <span className="truncate font-mono text-mono text-ink">
                {user.email}
              </span>
            </div>
          ) : null}
          {/* D3 (plan 017): READ-ONLY. This dialog can break a Discord link
              but never create one — creating one requires picking BOTH sides
              from lists of accounts this system has actually observed (see
              discord-links-panel.tsx's header comment for why a typed handle
              is unacceptable), and a per-person dialog has only one of those
              two halves. Anyone who lands here wanting to link someone is
              pointed at the panel that can do it safely. */}
          {user ? (
            <Field
              label="Discord"
              hint={
                handle
                  ? 'Linking is done from the Discord links panel, where both sides are picked from accounts this system has seen.'
                  : 'Not linked. Pair this person with a Discord account from the Discord links panel.'
              }
            >
              <>
                {handle ? (
                  <div className="flex items-center justify-between gap-2">
                    <DiscordBadge handle={handle} />
                    <Button
                      disabled={isPending}
                      size="sm"
                      variant="bad"
                      onClick={() => setConfirm('unlink')}
                    >
                      Unlink
                    </Button>
                  </div>
                ) : null}
              </>
            </Field>
          ) : null}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium text-ink-2">
              Services
            </legend>
            <ServiceCheckGrid
              hosts={visibleServiceHosts(user?.services ?? [], services)}
              selected={accessSelected}
              onToggle={(host, checked) =>
                setAccessSelected(prev => toggleInSet(prev, host, checked))
              }
              disabled={isPending}
            />
          </fieldset>
          <AccessRulesField
            rules={[...accessSelected].filter(isHostPattern)}
            onAdd={rule =>
              setAccessSelected(prev => toggleInSet(prev, rule, true))
            }
            onRemove={rule =>
              setAccessSelected(prev => toggleInSet(prev, rule, false))
            }
            disabled={isPending}
          />
          {accessModalError ? (
            <Note tone="bad" lead={accessModalError} />
          ) : null}
          {user ? (
            <div className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
              <Button
                disabled={isPending}
                icon="logout"
                size="sm"
                variant="outline"
                onClick={() => setConfirm('signOut')}
              >
                Sign out everywhere
              </Button>
              <Button
                disabled={isPending}
                icon="trash"
                size="sm"
                variant="bad"
                onClick={() => setConfirm('remove')}
              >
                Remove access
              </Button>
            </div>
          ) : null}
        </div>
        <Dialog.Actions>
          <Dialog.Close render={<Button variant="ghost" />}>
            Cancel
          </Dialog.Close>
          <Button
            variant="accent"
            loading={isPending}
            onClick={handleAccessConfirm}
          >
            Save access
          </Button>
        </Dialog.Actions>

        {/* Nested in the dialog's own tree, so focus and the scrim stack
            over it and Escape closes only the confirm. */}
        <ConfirmDialog
          open={confirm === 'remove'}
          onOpenChange={open => !open && setConfirm(null)}
          title={`Remove ${email}’s access?`}
          body={`They lose all ${user?.services.length ?? 0} service${user?.services.length === 1 ? '' : 's'}. They can ask again from the sign-in page.`}
          confirmLabel="Remove access"
          cancelLabel="Keep access"
          onConfirm={handleConfirm}
        />
        <ConfirmDialog
          open={confirm === 'signOut'}
          onOpenChange={open => !open && setConfirm(null)}
          title={`Sign ${email} out everywhere?`}
          body="Their sessions end now. They can sign straight back in — this doesn’t change what they can open."
          confirmLabel="Sign out"
          cancelLabel="Keep signed in"
          onConfirm={handleConfirm}
        />
        <ConfirmDialog
          open={confirm === 'unlink'}
          onOpenChange={open => !open && setConfirm(null)}
          title={`Unlink ${email} from @${handle ?? ''}?`}
          body="Their Discord downloads stop being attributed to them until you link them again."
          confirmLabel="Unlink"
          cancelLabel="Keep link"
          onConfirm={handleConfirm}
        />
      </Dialog.Popup>
    </Dialog.Root>
  )
}
