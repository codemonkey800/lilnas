import { Avatar, Button, Checkbox, EmptyState, Panel } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'

import type { AdminQueueEntry } from 'src/app/admin/require-admin'
import { SectionHead } from 'src/app/admin/section-head'
import { getInitials } from 'src/app/lib/initials'
import { timeAgo } from 'src/app/lib/time-ago'

export type RequestCardsProps = {
  queue: AdminQueueEntry[]
  selectedIds: Set<number>
  isPending: boolean
  onToggle: (id: number) => void
  onApprove: (id: number) => void
  onReject: (id: number) => void
  onBulkDismiss: () => void
  onAddPerson: () => void
}

function RequestCard({
  entry,
  selected,
  isPending,
  onToggle,
  onApprove,
  onReject,
}: {
  entry: AdminQueueEntry
  selected: boolean
  isPending: boolean
  onToggle: () => void
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div
      className={cns(
        'flex flex-col gap-3 rounded-lg border bg-surface p-3 md:flex-row md:items-center',
        selected ? 'border-accent-dim' : 'border-line',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Checkbox
          aria-label={`Select request from ${entry.email}`}
          checked={selected}
          onCheckedChange={onToggle}
        />
        <Avatar initials={getInitials(entry.email)} size={32} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate font-mono text-mono text-ink">{entry.email}</p>
          <p className="text-cap text-ink-3" suppressHydrationWarning>
            <span className="font-mono text-mono-sm">{entry.serviceHost}</span>
            {` · requested ${timeAgo(entry.createdAt)}`}
            {entry.priorDecisions > 0
              ? ` · declined ${entry.priorDecisions}x before`
              : ''}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          className="max-md:flex-1"
          disabled={isPending}
          size="sm"
          variant="outline"
          onClick={onReject}
        >
          Decline
        </Button>
        <Button
          className="max-md:flex-1"
          disabled={isPending}
          size="sm"
          variant="accent"
          onClick={onApprove}
        >
          Approve
        </Button>
      </div>
    </div>
  )
}

// The pending-request queue: one card per request, a bulk "Dismiss selected"
// once any are ticked, and a quiet state when nothing is waiting.
export function RequestCards({
  queue,
  selectedIds,
  isPending,
  onToggle,
  onApprove,
  onReject,
  onBulkDismiss,
  onAddPerson,
}: RequestCardsProps) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHead title="Pending requests" count={queue.length}>
        {selectedIds.size > 0 ? (
          <Button
            disabled={isPending}
            size="sm"
            variant="outline"
            onClick={onBulkDismiss}
          >
            Dismiss selected ({selectedIds.size})
          </Button>
        ) : null}
      </SectionHead>

      {queue.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nothing waiting"
            body="New requests show up here the moment someone asks."
            action={
              <Button variant="outline" onClick={onAddPerson}>
                Add person
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-2">
          {queue.map(entry => (
            <RequestCard
              key={entry.id}
              entry={entry}
              selected={selectedIds.has(entry.id)}
              isPending={isPending}
              onToggle={() => onToggle(entry.id)}
              onApprove={() => onApprove(entry.id)}
              onReject={() => onReject(entry.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
