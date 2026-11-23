import type { Column } from '@lilnas/ui'
import {
  Avatar,
  Badge,
  Button,
  DataList,
  EmptyState,
  Icon,
  Input,
  Panel,
} from '@lilnas/ui'

import type {
  AdminInviteEntry,
  AdminUserEntry,
} from 'src/app/admin/require-admin'
import { SectionHead } from 'src/app/admin/section-head'
import { getInitials } from 'src/app/lib/initials'
import { getServiceMeta } from 'src/app/service-meta'
import { isHostPattern } from 'src/grants/host-matcher'

// How many services a row names before collapsing the rest into "+N".
const VISIBLE_SERVICES = 4

export function PersonCell({ user }: { user: AdminUserEntry }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar initials={getInitials(user.email)} size={32} />
      <span className="truncate font-mono text-mono">{user.email}</span>
    </div>
  )
}

// Priority: Admin > Blocked > Granted > No access. Used in BOTH the People
// and Blocked lists — Admin still takes priority over Blocked: a blocked
// admin keeps full /admin access via AdminGuard's own independent check (see
// verify.service.ts's header comment), which is the more decision-relevant
// fact for an operator scanning the list. The Blocked branch is what a
// non-admin blocked row falls into instead.
export function PersonStatusBadge({ user }: { user: AdminUserEntry }) {
  if (user.isAdmin) return <Badge tone="accent">Admin</Badge>
  if (user.blockedAt) return <Badge tone="bad">Blocked</Badge>
  if (user.services.length > 0) return <Badge tone="ok">Granted</Badge>
  // Deliberately not "Pending": a person can have no access simply because
  // they were pre-authorized and haven't signed in yet, or were fully
  // un-authorized — not because they're waiting in the queue.
  return <Badge tone="mute">No access</Badge>
}

export function ServiceBadges({ hosts }: { hosts: string[] }) {
  if (hosts.length === 0) {
    return <span className="text-cap text-ink-3">No services granted</span>
  }
  const visible = hosts.slice(0, VISIBLE_SERVICES)
  const remaining = hosts.length - visible.length
  return (
    <ul className="flex flex-wrap gap-1.5">
      {visible.map(host => {
        const meta = getServiceMeta(host)
        return (
          <li key={host}>
            <Badge tone="mute">
              {/* Only access rules carry an icon — it's what sets "All
               *.dev.lilnas.io sites" apart from a single service. */}
              {isHostPattern(host) ? <Icon name={meta.icon} /> : null}
              {meta.name}
            </Badge>
          </li>
        )
      })}
      {remaining > 0 ? (
        <li>
          <Badge tone="mute">+{remaining}</Badge>
        </li>
      ) : null}
    </ul>
  )
}

// The linked Discord handle, so an admin can see at a glance who is already
// attributed. `discordUsername` is the HANDLE, not a display name.
export function DiscordBadge({ handle }: { handle: string }) {
  return (
    <Badge tone="mute" className="font-mono text-mono-sm">
      @{handle}
    </Badge>
  )
}

function DiscordCell({ user }: { user: AdminUserEntry }) {
  if (!user.discordUsername) {
    return <span className="text-cap text-ink-3">Not linked</span>
  }
  return <DiscordBadge handle={user.discordUsername} />
}

// An invite has no name before sign-in, so the email is the title (as in
// PersonCell) with the invited date under it, as the approved mockup draws.
// `toLocaleDateString()` resolves against the renderer's own locale and
// timezone, which the server and the browser need not share — hence
// `suppressHydrationWarning`, as the "Linked" column in
// discord-links-panel.tsx does.
function InvitedPersonCell({ invite }: { invite: AdminInviteEntry }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar initials={getInitials(invite.email)} size={32} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-mono">{invite.email}</span>
        <span className="truncate text-cap text-ink-3">
          Invited{' '}
          <span suppressHydrationWarning>
            {new Date(invite.createdAt).toLocaleDateString()}
          </span>
        </span>
      </span>
    </div>
  )
}

// Accent, the one tone left that reads as "in progress": ok means "has
// access", warn is the Pending tile's "needs you" and mute is "No access" and
// the service badges (see the approved mockup, docs/features/auth/designs/
// invited.html).
function InvitedBadge() {
  return <Badge tone="accent">Invited</Badge>
}

// Nothing to link yet: a Discord account pairs with a person who has signed
// in. A dash rather than "Not linked", which would invite an action.
function InvitedDiscordCell() {
  return (
    <>
      <span aria-hidden="true" className="text-cap text-ink-4">
        —
      </span>
      <span className="sr-only">Available after they sign in</span>
    </>
  )
}

// Shared by People and Blocked: who, what state, what they can open.
export const personColumns: Column<AdminUserEntry>[] = [
  {
    key: 'person',
    header: 'Person',
    primary: true,
    render: user => <PersonCell user={user} />,
  },
  {
    key: 'status',
    header: 'Status',
    render: user => <PersonStatusBadge user={user} />,
  },
  {
    key: 'services',
    header: 'Access',
    render: user => <ServiceBadges hosts={user.services} />,
  },
]

// One People row: an account (`user`) or a pending invite (`invite`). `email`
// is what search and the sort run on; `key` is the React/DataList key. An
// invite's key is prefixed because the same email can briefly be both a user
// and an invite (between a person's Google sign-in and their first visit to a
// service, when their invites are bound into grants), and both rows render.
export type PersonRow =
  | { kind: 'user'; key: string; email: string; user: AdminUserEntry } // key = user.id
  | { kind: 'invite'; key: string; email: string; invite: AdminInviteEntry } // key = `invite:${email}`

export type PeopleListProps = {
  rows: PersonRow[]
  searchTerm: string
  isPending: boolean
  onSearchChange: (term: string) => void
  onAddPerson: () => void
  onEdit: (user: AdminUserEntry) => void
  onEditInvite: (invite: AdminInviteEntry) => void
  onBlock: (user: AdminUserEntry) => void
}

// People: ONE DataList (a table from `md`, a card list below it) with the
// search field and Add person in its header.
//
// Two kinds of row share it. A person added with "Add a person" who has not
// signed in yet has no `user` row: their pending services live in
// `pre_authorized_grant` until their first sign-in binds them into grants. So
// the dashboard hands this list invites as well as users, and an invited row
// reads like a person with an "Invited" badge, the pending services and the
// invited date, but no Block button (they have no session to cut off) and no
// Discord handle (a link needs an account). Its one action is "Edit access",
// which opens the invite's own dialog (edit-invite-modal.tsx) — a separate one
// because there is no user id to address.
export function PeopleList({
  rows,
  searchTerm,
  isPending,
  onSearchChange,
  onAddPerson,
  onEdit,
  onEditInvite,
  onBlock,
}: PeopleListProps) {
  const query = searchTerm.trim()

  const columns: Column<PersonRow>[] = [
    {
      key: 'person',
      header: 'Person',
      primary: true,
      render: row =>
        row.kind === 'invite' ? (
          <InvitedPersonCell invite={row.invite} />
        ) : (
          <PersonCell user={row.user} />
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: row =>
        row.kind === 'invite' ? (
          <InvitedBadge />
        ) : (
          <PersonStatusBadge user={row.user} />
        ),
    },
    {
      key: 'services',
      header: 'Access',
      render: row => (
        <ServiceBadges
          hosts={
            row.kind === 'invite' ? row.invite.serviceHosts : row.user.services
          }
        />
      ),
    },
    {
      key: 'discord',
      header: 'Discord',
      render: row =>
        row.kind === 'invite' ? (
          <InvitedDiscordCell />
        ) : (
          <DiscordCell user={row.user} />
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: row => {
        if (row.kind === 'invite') {
          const { invite } = row
          return (
            <div className="flex flex-wrap gap-2 md:justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onEditInvite(invite)}
              >
                Edit access
              </Button>
            </div>
          )
        }
        const { user } = row
        return (
          <div className="flex flex-wrap gap-2 md:justify-end">
            {user.isAdmin ? null : (
              <Button size="sm" variant="ghost" onClick={() => onEdit(user)}>
                Edit access
              </Button>
            )}
            <Button
              disabled={isPending}
              size="sm"
              variant="bad"
              onClick={() => onBlock(user)}
            >
              Block
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <section className="flex flex-col gap-3">
      <SectionHead title="People" count={rows.length}>
        <div className="flex w-full items-center gap-2 md:w-[420px]">
          <Input
            aria-label="Search people"
            className="min-w-0"
            icon="search"
            placeholder="Search people…"
            value={searchTerm}
            wrapperClassName="min-w-0 flex-1"
            onChange={event => onSearchChange(event.target.value)}
          />
          <Button icon="plus" variant="outline" onClick={onAddPerson}>
            Add person
          </Button>
        </div>
      </SectionHead>

      <Panel>
        <DataList
          caption="People"
          columns={columns}
          rowKey={row => row.key}
          rows={rows}
          empty={
            <EmptyState
              title={query ? `No one matches “${query}”` : 'No one here yet'}
              body={
                query
                  ? 'Check the spelling, or search by email.'
                  : 'Add someone to give them access before they ask.'
              }
              action={
                query ? (
                  <Button variant="outline" onClick={() => onSearchChange('')}>
                    Clear search
                  </Button>
                ) : (
                  <Button variant="outline" onClick={onAddPerson}>
                    Add person
                  </Button>
                )
              }
            />
          }
        />
      </Panel>
    </section>
  )
}
