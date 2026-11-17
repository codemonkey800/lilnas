import { Badge, type BadgeTone } from '@lilnas/ui'

import type { ReminderView } from 'src/api/api.types'

type Status = ReminderView['status']

/** Active is the live one; the rest are quiet. */
const STATUS_BADGES: Record<
  Status,
  { tone: BadgeTone; label: string; live?: boolean }
> = {
  active: { tone: 'accent', label: 'Active', live: true },
  completed: { tone: 'ok', label: 'Completed' },
  cancelled: { tone: 'mute', label: 'Cancelled' },
  missed: { tone: 'warn', label: 'Missed' },
}

export function StatusBadge({ status }: { status: Status }) {
  const { tone, label, live } = STATUS_BADGES[status]

  return (
    <Badge live={live} tone={tone}>
      {label}
    </Badge>
  )
}
