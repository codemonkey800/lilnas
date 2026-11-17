import { Badge, Button, type Column, DataList } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'

import type { ReminderView } from 'src/api/api.types'

import {
  ACTION_LABELS,
  formatWhen,
  relativeTime,
  scheduleLines,
  whoLabel,
} from './format'
import { StatusBadge } from './StatusBadge'

interface ReminderListProps {
  reminders: ReminderView[]
  now: Date
  onEdit: (reminder: ReminderView) => void
  onCancel: (reminder: ReminderView) => void
  onTest: (reminder: ReminderView) => void
}

function Schedule({ reminder }: { reminder: ReminderView }) {
  const [description, ...rest] = scheduleLines(reminder)

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[13.5px] text-ink">{description}</span>
      {rest.map(line => (
        <span
          key={line}
          className={cns(
            'text-ink-3',
            line === reminder.cronExpression
              ? 'font-mono text-mono-sm'
              : 'text-cap',
          )}
        >
          {line}
        </span>
      ))}
    </div>
  )
}

/** Relative first, since that is the fact you act on, then the date. */
function NextRun({ reminder, now }: { reminder: ReminderView; now: Date }) {
  if (!reminder.nextRunAt) return <span className="text-ink-4">—</span>

  return (
    <div className="flex flex-col">
      <span className="font-mono text-mono-sm text-ink">
        {relativeTime(reminder.nextRunAt, now)}
      </span>
      <span className="text-cap text-ink-3">
        {formatWhen(reminder.nextRunAt)}
      </span>
    </div>
  )
}

function LastRun({ reminder }: { reminder: ReminderView }) {
  if (!reminder.lastRunAt) return <span className="text-ink-4">—</span>

  return (
    <div className="flex flex-col">
      <span className="text-[13.5px] text-ink">
        {formatWhen(reminder.lastRunAt)}
      </span>
      <span className="text-cap text-ink-3 tabular-nums">
        {reminder.runCount} {reminder.runCount === 1 ? 'run' : 'runs'}
      </span>
    </div>
  )
}

/** One table from `md` up, stacked cards below it, from the same columns. */
export function ReminderList({
  reminders,
  now,
  onEdit,
  onCancel,
  onTest,
}: ReminderListProps) {
  const columns: Column<ReminderView>[] = [
    {
      key: 'what',
      header: 'What',
      primary: true,
      render: r => (
        <div className="flex max-w-[260px] min-w-0 flex-col gap-1.5">
          <span className="text-[13.5px] font-medium text-ink">{r.what}</span>
          <span className="flex items-center gap-2">
            <Badge tone="mute">{ACTION_LABELS[r.actionType]}</Badge>
            <span className="font-mono text-mono-sm text-ink-3">
              {r.channelName ? `#${r.channelName}` : 'default'}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: r => <StatusBadge status={r.status} />,
    },
    {
      key: 'who',
      header: 'Who',
      render: r => (
        <span className="text-[13.5px] whitespace-nowrap">{whoLabel(r)}</span>
      ),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      render: r => <Schedule reminder={r} />,
    },
    {
      key: 'next',
      header: 'Next run',
      render: r => <NextRun now={now} reminder={r} />,
    },
    {
      key: 'last',
      header: 'Last run',
      render: r => <LastRun reminder={r} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: r => (
        <div className="flex gap-2 md:justify-end">
          <Button size="sm" variant="ghost" onClick={() => onTest(r)}>
            Test
          </Button>
          <Button size="sm" variant="outline" onClick={() => onEdit(r)}>
            Edit
          </Button>
          {r.status === 'active' && (
            <Button size="sm" variant="bad" onClick={() => onCancel(r)}>
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <DataList
        caption="Reminders"
        columns={columns}
        rowKey={r => r.id}
        rows={reminders}
      />
    </div>
  )
}
