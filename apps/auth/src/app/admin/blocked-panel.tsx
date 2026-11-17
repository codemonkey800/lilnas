import type { Column } from '@lilnas/ui'
import { Button, DataList, Panel } from '@lilnas/ui'

import { personColumns } from 'src/app/admin/people-list'
import type { AdminUserEntry } from 'src/app/admin/require-admin'
import { SectionHead } from 'src/app/admin/section-head'

export type BlockedPanelProps = {
  users: AdminUserEntry[]
  isPending: boolean
  onUnblock: (userId: string) => void
  onEdit: (user: AdminUserEntry) => void
}

// People who are blocked — admin or not — with the two things worth doing to
// them: unblock, or open their access.
export function BlockedPanel({
  users,
  isPending,
  onUnblock,
  onEdit,
}: BlockedPanelProps) {
  const columns: Column<AdminUserEntry>[] = [
    ...personColumns,
    {
      key: 'actions',
      header: 'Actions',
      render: user => (
        <div className="flex flex-wrap gap-2 md:justify-end">
          <Button
            disabled={isPending}
            size="sm"
            variant="ghost"
            onClick={() => onUnblock(user.id)}
          >
            Unblock
          </Button>
          <Button size="sm" variant="outline" onClick={() => onEdit(user)}>
            Edit access
          </Button>
        </div>
      ),
    },
  ]

  return (
    <section className="flex flex-col gap-3">
      <SectionHead title="Blocked" count={users.length} />

      <Panel>
        <DataList
          caption="Blocked"
          columns={columns}
          rowKey={user => user.id}
          rows={users}
          empty={
            <div className="px-4 py-8 text-center">
              <p className="text-h3">No one is blocked</p>
              <p className="mt-1 text-sm text-ink-3">
                Block someone from People and they’ll show up here.
              </p>
            </div>
          }
        />
      </Panel>
    </section>
  )
}
