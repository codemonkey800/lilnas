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

import type { AdminUserEntry } from 'src/app/admin/require-admin'
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

export type PeopleListProps = {
  users: AdminUserEntry[]
  searchTerm: string
  isPending: boolean
  onSearchChange: (term: string) => void
  onAddPerson: () => void
  onEdit: (user: AdminUserEntry) => void
  onBlock: (user: AdminUserEntry) => void
}

// People: ONE DataList (a table from `md`, a card list below it) with the
// search field and Add person in its header.
export function PeopleList({
  users,
  searchTerm,
  isPending,
  onSearchChange,
  onAddPerson,
  onEdit,
  onBlock,
}: PeopleListProps) {
  const query = searchTerm.trim()

  const columns: Column<AdminUserEntry>[] = [
    ...personColumns,
    {
      key: 'discord',
      header: 'Discord',
      render: user => <DiscordCell user={user} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: user => (
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
      ),
    },
  ]

  return (
    <section className="flex flex-col gap-3">
      <SectionHead title="People" count={users.length}>
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
          rowKey={user => user.id}
          rows={users}
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
